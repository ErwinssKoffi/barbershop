import { resolveSubscriptionAccess } from './subscriptionAccess.ts'
import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import { guardVisibility } from './visibility.ts'
import type { SqlPoolLike } from './neonClient.ts'
import type { VisibilityPublicationStatus } from '../src/domain/visibilityPublication.ts'
export async function readVisibilityPublication(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw new AuthApiError(400,'INVALID_PUBLICATION','Lecture sans filtre requise.')
  return withTenantClient(pool,tenant,async db=>{
    await guardVisibility(db,tenant,actor)
    await db.query("SET LOCAL lock_timeout='5000ms'")
    await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':visibility:' || $1))",[tenant])
    const row=(await db.query<{version:number;display_name:string;city:string;requested:boolean;visible:boolean;revision:number|null}>(`SELECT p.version,p.display_name,p.city,COALESCE(g.published,false) AS requested,
      COALESCE(g.published AND g.tenant_active AND g.allowed_from<=now() AND g.allowed_until>now() AND x.profile_id IS NOT NULL,false) AS visible,x.revision
      FROM salon_public_profiles p LEFT JOIN salon_public_visibility g ON g.tenant_id=p.tenant_id AND g.profile_id=p.id
      LEFT JOIN salon_public_projection x ON x.tenant_id=p.tenant_id AND x.profile_id=p.id`)).rows[0]
    const {ready,access}=await resolveSubscriptionAccess(db,tenant)
    const enforced=(await db.query<{ready:boolean}>("SELECT to_regprocedure('subscription_public_visible(uuid)') IS NOT NULL AS ready")).rows[0]?.ready
    if(enforced && row?.visible)row.visible=(await db.query<{visible:boolean}>('SELECT subscription_public_visible($1::uuid) AS visible',[tenant])).rows[0]?.visible===true
    const publishReady=(await db.query<{ready:boolean}>("SELECT to_regprocedure('publish_salon_profile_text(text,uuid,integer,text,boolean)') IS NOT NULL AS ready")).rows[0]?.ready
    const blockers:{code:string;message:string}[]=[]
    if(!publishReady)blockers.push({code:'PUBLICATION_PIPELINE_INCOMPLETE',message:'Publication fermée : migration volontaire 022 du parcours textuel requise.'})
    if(process.env.SALON_TEXT_PUBLICATION_ENABLED!=='true')blockers.push({code:'TEXT_PUBLICATION_DISABLED',message:'Publication textuelle désactivée sur le serveur.'})
    if(publishReady) {
      const counts=(await db.query<{days:string;photos:string}>("SELECT (SELECT count(*) FROM salon_opening_hours) AS days,(SELECT count(*) FROM salon_public_media_projection) AS photos")).rows[0]
      if(Number(counts?.days)!==7)blockers.push({code:'SAVED_WEEK_REQUIRED',message:'Enregistrez les sept jours de la semaine, y compris les jours fermés.'})
      if(Number(counts?.photos)>0)blockers.push({code:'PUBLIC_MEDIA_REVIEW_REQUIRED',message:'Des photos publiques existent : ce parcours sans photos ne les modifie pas.'})
    }
    if(!ready)blockers.push({code:'SUBSCRIPTION_MIGRATION_REQUIRED',message:'Migration volontaire 019 requise pour les droits.'})
    else if(!access.canPublish)blockers.push({code:'SUBSCRIPTION_PUBLICATION_DENIED',message:'Un abonnement actif autorisant le profil public est requis pour publier.'})
    if(access.canPublish) {
      const selectionsReady=(await db.query<{ready:boolean}>("SELECT to_regclass('salon_service_selections') IS NOT NULL AS ready")).rows[0]?.ready
      if(!selectionsReady)blockers.push({code:'SERVICE_SELECTION_MIGRATION_REQUIRED',message:'Migration volontaire 017 requise pour contrôler les prestations.'})
      else {
        const count=Number((await db.query<{count:string|number}>('SELECT count(*) AS count FROM salon_service_selections WHERE tenant_id=$1',[tenant])).rows[0]?.count)
        const max=access.quotas?.serviceListing?access.quotas.publicServices:0
        if(!Number.isSafeInteger(count) || count<1 || count>max)blockers.push({code:'PUBLIC_SERVICE_QUOTA_EXCEEDED',message:`La sélection dépasse le quota de ${max} prestations visibles.`})
      }
    }
    if(!row)blockers.push({code:'PROFILE_REQUIRED',message:'Enregistrez le brouillon du profil.'})
    else {
      if(!row.display_name.trim())blockers.push({code:'PUBLIC_NAME_REQUIRED',message:'Renseignez le nom public.'})
      if(!row.city.trim())blockers.push({code:'PUBLIC_CITY_REQUIRED',message:'Renseignez la ville.'})
    }
    const status:VisibilityPublicationStatus={version:row?.version??null,visibility:row?.visible?'visible':'not_visible',publicationRequested:row?.requested??false,publishedRevision:row?.revision??null,canPublish:blockers.length===0,blockers}
    return {status}
  })
}
export async function unpublishVisibility(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
  const r=input as Record<string,unknown>
  if(!r || typeof r!=='object' || Array.isArray(r) || Object.keys(r).some(k=>k!=='expectedVersion') || !Number.isSafeInteger(r.expectedVersion) || Number(r.expectedVersion)<1 || Number(r.expectedVersion)>=2147483647)throw new AuthApiError(400,'INVALID_PUBLICATION','Version attendue requise.')
  return withTenantClient(pool,tenant,async db=>{
    await guardVisibility(db,tenant,actor)
    if(!(await db.query<{ready:boolean}>("SELECT to_regprocedure('unpublish_salon_profile(text,integer)') IS NOT NULL AS ready")).rows[0].ready)throw new AuthApiError(503,'VISIBILITY_UNPUBLISH_MIGRATION_REQUIRED','Migration volontaire 018 requise.')
    await db.query("SET LOCAL lock_timeout='5000ms'");await db.query("SET LOCAL statement_timeout='10000ms'")
    try {
      const result=(await db.query<{version:number;changed:boolean}>('SELECT * FROM unpublish_salon_profile($1,$2)',[actor,r.expectedVersion])).rows[0]
      return {result}
    } catch(error) {
      if((error as {code?:string}).code==='40001')throw new AuthApiError(409,'VISIBILITY_VERSION_CONFLICT','Profil modifié ailleurs. Rechargez avant de dépublier.')
      throw error
    }
  })
}
