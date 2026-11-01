import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import { guardVisibility } from './visibility.ts'
import type { SqlPoolLike } from './neonClient.ts'
import type { ServiceCatalogItem } from '../src/domain/models/index.ts'
import { deriveServicePublication } from '../src/domain/publicCatalog.ts'
import { emptyVisibilityWeek } from '../src/domain/visibilityConfig.ts'
import { emptyProfileDetails } from '../src/domain/profileDetails.ts'
import { parseVisibilityPreview,type VisibilityPreview } from '../src/domain/visibilityPreview.ts'
export async function readVisibilityPreview(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
 if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw new AuthApiError(400,'INVALID_VISIBILITY_PREVIEW','Lecture sans filtre requise.')
 return withTenantClient(pool,tenant,async db=>{
  await db.query("SET LOCAL statement_timeout='10000ms'")
  await guardVisibility(db,tenant,actor,{readOnlySnapshot:true})
  const ready=(await db.query<{ready:boolean}>("SELECT to_regclass('salon_service_selections') IS NOT NULL AND to_regclass('salon_opening_hours') IS NOT NULL AND to_regclass('schedule_exceptions') IS NOT NULL AS ready")).rows[0]?.ready
  if(!ready)throw new AuthApiError(503,'VISIBILITY_EDITOR_MIGRATION_REQUIRED','Migrations 010/011/017 requises.')
  const p=(await db.query<{id:string;version:number;display_name:string;description:string;city:string;commune:string;public_phone:string|null}>('SELECT id,version,display_name,description,city,commune,public_phone FROM salon_public_profiles WHERE tenant_id=$1',[tenant])).rows[0]
  if(!p)throw new AuthApiError(409,'VISIBILITY_PROFILE_REQUIRED','Enregistrez d’abord le profil.')
  const details=(await db.query("SELECT slogan,category,public_address AS \"publicAddress\",whatsapp,public_email AS \"publicEmail\",website,facebook,instagram,tiktok FROM salon_profile_details WHERE tenant_id=$1 AND profile_id=$2",[tenant,p.id])).rows[0]??emptyProfileDetails()
  const source=(await db.query<{id:string;source_service_id:string;source_variant_id:string|null;name:string;reference_price:string|number;updated_at:string;is_active:boolean;payload_json:ServiceCatalogItem}>(`SELECT s.id,s.source_service_id,s.source_variant_id,c.name,c.reference_price,c.updated_at,c.is_active,c.payload_json
   FROM salon_service_selections x JOIN salon_public_services s ON s.tenant_id=x.tenant_id AND s.profile_id=x.profile_id AND s.id=x.service_id
   LEFT JOIN services_catalog c ON c.tenant_id=s.tenant_id AND c.id=s.source_service_id
   WHERE x.tenant_id=$1 AND x.profile_id=$2 ORDER BY s.id LIMIT 501`,[tenant,p.id])).rows
  if(source.length>500)throw new AuthApiError(409,'VISIBILITY_CATALOG_LIMIT','Sélection trop volumineuse.')
  const services:VisibilityPreview['services']=[]
  for(const s of source){
   try {
    if(!s.is_active || !s.payload_json || !Array.isArray(s.payload_json.variants??[]) || (s.payload_json.variants??[]).length>500)continue
    const snapshot=deriveServicePublication({...s.payload_json,id:s.source_service_id,name:s.name,referencePrice:Number(s.reference_price),updatedAt:s.updated_at},s.source_variant_id,false)
    services.push({id:s.id,displayName:snapshot.displayName,description:snapshot.description,priceXof:snapshot.priceXof,durationMinutes:snapshot.durationMinutes})
   }catch{/* Unavailable sources are signalled explicitly, never replaced with invented metadata. */}
  }
  const windows="COALESCE((SELECT json_agg(json_build_object('startMinute',lower(w),'endMinute',upper(w)) ORDER BY lower(w)) FROM unnest(windows) w),'[]'::json)"
  const weekly=(await db.query<VisibilityPreview['weekly'][number]>(`SELECT iso_weekday AS "isoWeekday",${windows} AS windows FROM salon_opening_hours WHERE tenant_id=$1 AND profile_id=$2 ORDER BY iso_weekday`,[tenant,p.id])).rows
  const exceptions=(await db.query<VisibilityPreview['exceptions'][number]>(`SELECT to_char(local_date,'YYYY-MM-DD') AS "localDate",${windows} AS windows FROM schedule_exceptions WHERE tenant_id=$1 AND profile_id=$2 ORDER BY local_date LIMIT 367`,[tenant,p.id])).rows
  const clock=(await db.query<{at:Date;timezone:string}>('SELECT now() AS at,timezone FROM tenants WHERE id=$1',[tenant])).rows[0]
  const preview=parseVisibilityPreview({version:p.version,capturedAt:new Date(clock.at).toISOString(),profile:{displayName:p.display_name,description:p.description,city:p.city,commune:p.commune,publicPhone:p.public_phone,details},timezone:clock.timezone,services,selectedServiceCount:source.length,weekly:emptyVisibilityWeek().map(day=>weekly.find(w=>w.isoWeekday===day.isoWeekday)??day),exceptions,warnings:services.length<source.length?['SOURCE_UNAVAILABLE']:[],published:false,onlineBooking:false,media:'not_connected'})
  return {preview}
 },{readOnlySnapshot:true})
}
