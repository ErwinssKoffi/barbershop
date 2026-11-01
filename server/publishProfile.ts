import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import { guardVisibility } from './visibility.ts'
import type { SqlPoolLike } from './neonClient.ts'
import { parseTextPublicationCommand,parseTextPublicationResult } from '../src/domain/textPublication.ts'
export async function publishVisibilityText(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
 if(process.env.SALON_TEXT_PUBLICATION_ENABLED!=='true')throw new AuthApiError(503,'TEXT_PUBLICATION_DISABLED','Publication textuelle désactivée sur le serveur.')
 let command
 try{command=parseTextPublicationCommand(input)}catch{throw new AuthApiError(400,'INVALID_PUBLICATION','Intention de publication sans photos explicitement confirmée requise.')}
 return withTenantClient(pool,tenant,async db=>{
  await guardVisibility(db,tenant,actor)
  if(!(await db.query<{ready:boolean}>("SELECT to_regprocedure('publish_salon_profile_text(text,uuid,integer,text,boolean)') IS NOT NULL AS ready")).rows[0]?.ready)throw new AuthApiError(503,'TEXT_PUBLICATION_MIGRATION_REQUIRED','Migration volontaire 022 requise.')
  await db.query("SET LOCAL lock_timeout='5000ms'");await db.query("SET LOCAL statement_timeout='15000ms'")
  try{
   const row=(await db.query<{result:unknown}>('SELECT publish_salon_profile_text($1,$2::uuid,$3,$4,$5) AS result',[actor,command.idempotencyKey,command.expectedVersion,command.slug,command.confirmedWithoutPhotos])).rows[0]
   return {result:parseTextPublicationResult(row?.result)}
  }catch(error){
   const code=(error as {code?:string}).code
   if(code==='40001')throw new AuthApiError(409,'VISIBILITY_VERSION_CONFLICT','Version ou clé différente : rechargez. Après résultat incertain, reprenez la même intention.')
   if(code==='23505')throw new AuthApiError(409,'PUBLIC_SLUG_CONFLICT','Adresse publique déjà utilisée. Choisissez un autre identifiant après relecture.')
   if(code==='23514' || code==='22P02')throw new AuthApiError(409,'PUBLICATION_REVIEW_REQUIRED','Publication refusée : revérifiez abonnement actif, sélection, prix/durées, sept jours enregistrés et absence de photos déjà publiées.')
   throw error
  }
 })
}
