import { randomUUID } from 'node:crypto'
import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import type { SqlPoolLike, SqlQueryable } from './neonClient.ts'
import { parseVisibilityDraft, type VisibilityDraftFields } from '../src/domain/visibility.ts'
import type { SalonPublicProfileDraft } from '../src/domain/marketplace.ts'
function fail(status: number, code: string, message: string): never {throw new AuthApiError(status,code,message)}
export async function guardVisibility(db: SqlQueryable,tenant: string,actor: string,options: {readOnlySnapshot?:boolean} = {}) {
  if (process.env.SALON_VISIBILITY_ENABLED!=='true') fail(503,'VISIBILITY_DISABLED','Visibilité en ligne désactivée sur le serveur.')
  if (!(await db.query<{ready:boolean}>("SELECT to_regclass('salon_public_profiles') IS NOT NULL AND to_regclass('salon_public_profile_events') IS NOT NULL AS ready")).rows[0]?.ready) fail(503,'VISIBILITY_MIGRATION_REQUIRED','Migration volontaire 009 requise.')
  const member=(await db.query(`SELECT m.user_id FROM memberships m JOIN salon_users u ON u.id=m.user_id
    WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='manager' AND m.is_active AND u.is_active${options.readOnlySnapshot?'':' FOR SHARE OF m,u'}`,[tenant,actor])).rows[0]
  if (!(await db.query<{ready:boolean}>("SELECT to_regclass('salon_profile_details') IS NOT NULL AS ready")).rows[0]?.ready) fail(503,'VISIBILITY_DETAILS_MIGRATION_REQUIRED','Migration volontaire 016 requise.')
  if (!member) fail(403,'VISIBILITY_MANAGER_REQUIRED','Modification du profil réservée au Gérant actif.')
}
async function draft(db: SqlQueryable, lock=false): Promise<SalonPublicProfileDraft|null> {
  const row=(await db.query<SalonPublicProfileDraft>(`SELECT p.id,p.tenant_id AS "tenantId",p.display_name AS "displayName",p.description,p.city,p.commune,p.public_phone AS "publicPhone",p.version,
    json_build_object('slogan',COALESCE(d.slogan,''),'category',COALESCE(d.category,''),'publicAddress',COALESCE(d.public_address,''),'whatsapp',COALESCE(d.whatsapp,''),'publicEmail',COALESCE(d.public_email,''),'website',COALESCE(d.website,''),'facebook',COALESCE(d.facebook,''),'instagram',COALESCE(d.instagram,''),'tiktok',COALESCE(d.tiktok,'')) AS details
    FROM salon_public_profiles p LEFT JOIN salon_profile_details d ON d.tenant_id=p.tenant_id AND d.profile_id=p.id${lock?' FOR UPDATE OF p':''}`)).rows[0]
  return row??null
}
export async function readVisibilityDraft(pool: SqlPoolLike,tenant: string,actor: string,input:unknown) {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length) fail(400,'INVALID_VISIBILITY','Lecture sans filtre arbitraire requise.')
  return withTenantClient(pool,tenant,async db=>{await guardVisibility(db,tenant,actor);return {draft:await draft(db)}})
}
export async function saveVisibilityDraft(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
  let command: VisibilityDraftFields & {expectedVersion:number}
  try {command=parseVisibilityDraft(input)} catch {fail(400,'INVALID_VISIBILITY','Champs du profil invalides.')}
  return withTenantClient(pool,tenant,async db=>{
    await guardVisibility(db,tenant,actor)
    await db.query("SET LOCAL lock_timeout='5000ms'")
    await db.query("SET LOCAL statement_timeout='10000ms'")
    await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':visibility:' || $1))",[tenant])
    const existing=await draft(db,true)
    if ((existing?.version??0)!==command.expectedVersion) fail(409,'VISIBILITY_VERSION_CONFLICT','Profil modifié ailleurs. Rechargez avant de réessayer.')
    const id=existing?.id??randomUUID()
    if(existing) await db.query(`UPDATE salon_public_profiles SET display_name=$1,description=$2,city=$3,commune=$4,public_phone=$5,version=version+1,updated_at=now() WHERE id=$6`,[command.displayName,command.description,command.city,command.commune,command.publicPhone,id])
    else await db.query(`INSERT INTO salon_public_profiles(tenant_id,id,display_name,description,city,commune,public_phone) VALUES($1,$2,$3,$4,$5,$6,$7)`,[tenant,id,command.displayName,command.description,command.city,command.commune,command.publicPhone])
    if(command.details) {
      const d=command.details
      await db.query(`INSERT INTO salon_profile_details(tenant_id,profile_id,slogan,category,public_address,whatsapp,public_email,website,facebook,instagram,tiktok)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,profile_id) DO UPDATE SET
        slogan=EXCLUDED.slogan,category=EXCLUDED.category,public_address=EXCLUDED.public_address,whatsapp=EXCLUDED.whatsapp,public_email=EXCLUDED.public_email,website=EXCLUDED.website,facebook=EXCLUDED.facebook,instagram=EXCLUDED.instagram,tiktok=EXCLUDED.tiktok`,
        [tenant,id,d.slogan,d.category,d.publicAddress,d.whatsapp,d.publicEmail,d.website,d.facebook,d.instagram,d.tiktok])
    }
    await db.query(`INSERT INTO salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version) VALUES($1,$2,$3,'draft_saved',$4)`,[tenant,id,actor,command.expectedVersion+1])
    return {draft:await draft(db)}
  })
}
