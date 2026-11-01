import { AuthApiError } from './authEngine.ts'
import { guardVisibility } from './visibility.ts'
import { withTenantClient } from './tenantContext.ts'
import type { SqlPoolLike,SqlQueryable } from './neonClient.ts'
import type { ServiceCatalogItem } from '../src/domain/models/index.ts'
import { deriveServicePublication } from '../src/domain/publicCatalog.ts'
import { openingWindowsSqlValue } from '../src/domain/scheduling.ts'
import { parseVisibilityConfig,emptyVisibilityWeek,type VisibilityConfig,type VisibilityOffer,type VisibilityConfigView } from '../src/domain/visibilityConfig.ts'
const error=(code:string,message:string,status=409):never=>{throw new AuthApiError(status,code,message)}
async function ready(db:SqlQueryable,tenant:string,actor:string) {
  await guardVisibility(db,tenant,actor)
  if(!(await db.query<{ready:boolean}>("SELECT to_regclass('salon_service_selections') IS NOT NULL AND to_regclass('salon_opening_hours') IS NOT NULL AND to_regclass('schedule_exceptions') IS NOT NULL AS ready")).rows[0].ready) error('VISIBILITY_EDITOR_MIGRATION_REQUIRED','Migrations 010, 011 et 017 requises.',503)
}
async function offers(db:SqlQueryable,lock=false):Promise<VisibilityOffer[]> {
  const rows=(await db.query<{id:string;name:string;reference_price:string|number;updated_at:string;payload_json:ServiceCatalogItem}>(`SELECT id,name,reference_price,updated_at,payload_json FROM services_catalog WHERE is_active ORDER BY id LIMIT 501${lock?' FOR SHARE':''}`)).rows
  const result:VisibilityOffer[]=[]
  if(rows.length>500) error('VISIBILITY_CATALOG_LIMIT','Catalogue trop volumineux pour cet éditeur.')
  for(const row of rows) {
    const body={...row.payload_json,id:row.id,name:row.name,referencePrice:Number(row.reference_price),updatedAt:row.updated_at}
    if(!body.isActive)continue
    if(!Array.isArray(body.variants??[]) || (body.variants??[]).length>500)error('VISIBILITY_CATALOG_LIMIT','Variantes invalides ou trop nombreuses.')
    for(const variant of [null,...(body.variants??[]).map(v=>v.id)]) {
      try {
        const s=deriveServicePublication(body,variant,false)
        result.push({serviceId:row.id,variantId:variant,label:s.displayName,priceXof:s.priceXof,durationMinutes:s.durationMinutes})
      } catch { /* Invalid ERP metadata is not offered as a selectable public service. */ }
    }
  }
  if(result.length>500) error('VISIBILITY_CATALOG_LIMIT','Trop de variantes pour cet éditeur.')
  return result
}
const windowsSql="COALESCE((SELECT json_agg(json_build_object('startMinute',lower(w),'endMinute',upper(w)) ORDER BY lower(w)) FROM unnest(windows) w),'[]'::json)"
async function view(db:SqlQueryable):Promise<VisibilityConfigView> {
  const profile=(await db.query<{id:string;version:number}>('SELECT id,version FROM salon_public_profiles')).rows[0]
  if(!profile)error('VISIBILITY_PROFILE_REQUIRED','Enregistrez d’abord le profil du salon.')
  const services=(await db.query<VisibilityConfig['services'][number]>(`SELECT s.source_service_id AS "serviceId",s.source_variant_id AS "variantId" FROM salon_service_selections x JOIN salon_public_services s ON s.tenant_id=x.tenant_id AND s.profile_id=x.profile_id AND s.id=x.service_id ORDER BY s.source_service_id,s.source_variant_id`)).rows
  const days=(await db.query<VisibilityConfig['weekly'][number]>(`SELECT iso_weekday AS "isoWeekday",${windowsSql} AS windows FROM salon_opening_hours ORDER BY iso_weekday`)).rows
  const exceptions=(await db.query<VisibilityConfig['exceptions'][number]>(`SELECT to_char(local_date,'YYYY-MM-DD') AS "localDate",${windowsSql} AS windows FROM schedule_exceptions ORDER BY local_date LIMIT 367`)).rows
  const timezone=(await db.query<{timezone:string}>('SELECT timezone FROM tenants')).rows[0].timezone
  return {...parseVisibilityConfig({expectedVersion:profile.version,services,weekly:emptyVisibilityWeek().map(d=>days.find(x=>x.isoWeekday===d.isoWeekday)??d),exceptions}),timezone,offers:await offers(db)}
}
export async function readVisibilityConfig(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)error('INVALID_VISIBILITY_CONFIG','Lecture sans filtre requise.',400)
  return withTenantClient(pool,tenant,async db=>{await ready(db,tenant,actor);await db.query("SET LOCAL lock_timeout='5000ms'");await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':visibility:' || $1))",[tenant]);return {config:await view(db)}})
}
export async function saveVisibilityConfig(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
  let command:VisibilityConfig
  try {command=parseVisibilityConfig(input)} catch {error('INVALID_VISIBILITY_CONFIG','Sélection ou horaires invalides.',400)}
  return withTenantClient(pool,tenant,async db=>{
    await ready(db,tenant,actor)
    await db.query("SET LOCAL lock_timeout='5000ms'");await db.query("SET LOCAL statement_timeout='10000ms'")
    await db.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':visibility:' || $1))",[tenant])
    const p=(await db.query<{id:string;version:number}>('SELECT id,version FROM salon_public_profiles FOR UPDATE')).rows[0]
    if(!p || p.version!==command.expectedVersion)error('VISIBILITY_VERSION_CONFLICT','Profil modifié ailleurs. Rechargez les deux éditeurs.')
    const catalog=await offers(db,true)
    for(const s of command.services) if(!catalog.some(o=>o.serviceId===s.serviceId && o.variantId===s.variantId))error('VISIBILITY_SOURCE_UNAVAILABLE','Prestation ou variante indisponible : retirez-la ou rechargez le catalogue.')
    // Remove membership only: deleting a draft service would cascade its published copy.
    await db.query('DELETE FROM salon_service_selections WHERE profile_id=$1',[p.id])
    for(const choice of command.services) {
      const offer=catalog.find(o=>o.serviceId===choice.serviceId && o.variantId===choice.variantId)!
      const row=(await db.query<{id:string}>(`INSERT INTO salon_public_services(tenant_id,profile_id,source_service_id,source_variant_id,display_name)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,source_service_id,source_variant_id) DO UPDATE SET display_name=EXCLUDED.display_name,version=salon_public_services.version+1,updated_at=now() RETURNING id`,[tenant,p.id,choice.serviceId,choice.variantId,offer.label])).rows[0]
      await db.query('INSERT INTO salon_service_selections(tenant_id,profile_id,service_id) VALUES($1,$2,$3)',[tenant,p.id,row.id])
    }
    for(const day of command.weekly) await db.query(`INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,$3,$4::int4multirange)
      ON CONFLICT(tenant_id,iso_weekday) DO UPDATE SET windows=EXCLUDED.windows,version=salon_opening_hours.version+1,updated_at=now()`,[tenant,p.id,day.isoWeekday,openingWindowsSqlValue(day.windows)])
    await db.query('DELETE FROM schedule_exceptions WHERE NOT(local_date=ANY($1::date[]))',[command.exceptions.map(x=>x.localDate)])
    for(const day of command.exceptions) await db.query(`INSERT INTO schedule_exceptions(tenant_id,profile_id,local_date,windows) VALUES($1,$2,$3::date,$4::int4multirange)
      ON CONFLICT(tenant_id,local_date) DO UPDATE SET windows=EXCLUDED.windows,version=schedule_exceptions.version+1,updated_at=now()`,[tenant,p.id,day.localDate,openingWindowsSqlValue(day.windows)])
    await db.query('UPDATE salon_public_profiles SET version=version+1,updated_at=now() WHERE id=$1',[p.id])
    await db.query("INSERT INTO salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version) VALUES($1,$2,$3,'draft_saved',$4)",[tenant,p.id,actor,p.version+1])
    return {config:await view(db)}
  })
}
