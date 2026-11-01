import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { withTenantClient } from '../../server/tenantContext'
import { ESSENTIEL_V1,subscriptionMonthEnd } from '../domain/subscriptions'
import { PUBLIC_ACCESS_ENFORCEMENT_SQL } from '../../server/publicAccessEnforcementSchema'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
let c:Awaited<ReturnType<typeof setup>>,profile:string,plan:string
beforeEach(async()=>{
 vi.stubEnv('SALON_VISIBILITY_ENABLED','true');c=await setup(false)
 await c.pool.query('CREATE ROLE anon; CREATE ROLE authenticated')
 await runMigrations(c.pool,{includePublicAccessEnforcement:true})
 profile=(await c.pool.query<{id:string}>("INSERT INTO salon_public_profiles(tenant_id,display_name,city) VALUES($1,'Profil recette','Abidjan') RETURNING id",[c.tenant])).rows[0].id
 const p=ESSENTIEL_V1
 plan=(await c.pool.query<{id:string}>(`INSERT INTO saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,[p.code,p.version,p.name,p.priceXof,p.currency,p.periodKind,p.graceSeconds,JSON.stringify(p.entitlements)])).rows[0].id
})
afterEach(()=>vi.unstubAllEnvs())
async function grant(anchor=new Date(new Date().setUTCDate(1)).toISOString()) {
 const end=subscriptionMonthEnd(anchor,1,'Africa/Abidjan'),grace=new Date(Date.parse(end)+259200000).toISOString()
 return (await c.pool.query<{id:string}>(`INSERT INTO tenant_subscriptions(tenant_id,plan_id,activation_key,billing_anchor_at,period_index,billing_timezone,starts_at,ends_at,grace_ends_at,amount_xof,external_reference,evidence_reference,operator_reference)
 VALUES($1,$2,$3::uuid,$4::timestamptz,0,'Africa/Abidjan',$4::timestamptz,$5,$6,4900,$3::text,'private-case','test-operator') RETURNING id`,[c.tenant,plan,crypto.randomUUID(),anchor,end,grace])).rows[0].id
}
async function publish(){
 await c.pool.query("INSERT INTO salon_public_visibility(tenant_id,profile_id,published,allowed_from,allowed_until) VALUES($1,$2,true,now()-interval '1 day',now()+interval '2 months')",[c.tenant,profile])
 await c.pool.query("INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision) VALUES($1,$2,'recette-quota','Profil','','Abidjan','',1)",[c.tenant,profile])
}
async function visible(){
 const db=await c.pool.connect()
 try{await db.query('BEGIN');await db.query("SELECT set_config('role','salon_pro_public_' || substr(md5(current_schema()),1,12),true)");const result=(await db.query('SELECT * FROM salon_public_projection')).rows;await db.query('COMMIT');return result}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
async function upload(){
 const id=crypto.randomUUID()
 await c.pool.query("INSERT INTO salon_media(tenant_id,id,profile_id,purpose,original_key,declared_mime,declared_bytes,upload_expires_at) VALUES($1::uuid,$2::uuid,$3,'gallery',$1::uuid::text || '/' || $2::uuid::text || '/original','image/jpeg',100,now()+interval '1 hour')",[c.tenant,id,profile]);return id
}
it('021 opt-in sauvegarde, exports, indépendance et aucun grant runtime de publication',async()=>{
 expect(()=>marketplaceMigrationOptions(['--include-public-access-enforcement'],undefined)).toThrow(/backup/)
 expect(marketplaceMigrationOptions(['--include-public-access-enforcement'],'true').includePublicAccessEnforcement).toBe(true)
 expect(readFileSync('supabase/optional/021_public_access_enforcement.sql','utf8')).toBe(PUBLIC_ACCESS_ENFORCEMENT_SQL.trim()+'\n')
 expect((await c.pool.query<{id:string}>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r=>r.id)).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','009_marketplace_profiles','011_public_catalog','012_marketplace_media','019_saas_subscriptions','021_public_access_enforcement'])
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query('SELECT * FROM salon_public_quota_usage'))).rejects.toThrow(/permission/)
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query('UPDATE salon_public_visibility SET published=true'))).rejects.toThrow(/permission/)
 for(const role of ['anon','authenticated'])expect((await c.pool.query<{ok:boolean}>("SELECT has_function_privilege($1,'subscription_public_visible(uuid)','EXECUTE') AS ok",[role])).rows[0].ok).toBe(false)
 await runMigrations(c.pool,{includePublicAccessEnforcement:true})
})
it('sans droit : gate/projection/upload refusés ; révocation masque sans détruire',async()=>{
 await expect(publish()).rejects.toThrow(/Active subscription/)
 await expect(upload()).rejects.toThrow(/Active subscription/)
 const id=await grant();await publish();expect(await visible()).toHaveLength(1)
 const finance=await c.financialState()
 await c.pool.query("UPDATE tenant_subscriptions SET revoked_at=now(),revoked_by='operator',revocation_reason='withdrawn' WHERE id=$1",[id])
 expect(await visible()).toHaveLength(0)
 expect((await c.pool.query('SELECT * FROM salon_public_projection')).rows).toHaveLength(1)
 await c.pool.query('UPDATE salon_public_visibility SET published=false')
 expect(await c.financialState()).toEqual(finance)
})
it('trois uploads réservés atomiquement ; quatrième et batch échoué ne consomment rien',async()=>{
 await grant();const ids=[await upload(),await upload(),await upload()]
 await expect(upload()).rejects.toThrow(/quota/)
 expect((await c.pool.query<{used:number}>('SELECT used::integer FROM salon_public_quota_usage WHERE resource=\'uploads\'')).rows[0].used).toBe(3)
 await c.pool.query("UPDATE salon_media SET state='deleted' WHERE id=$1",[ids[0]])
 await upload()
 await expect(c.pool.query('UPDATE salon_media SET alt_text=\'changed\'; SELECT absent_quota_test();')).rejects.toThrow()
 expect((await c.pool.query('SELECT alt_text FROM salon_media WHERE alt_text=\'changed\'')).rows).toHaveLength(0)
})
it('fin réelle de grâce masque à la requête suivante sans cron, même si le gate dépasse',async()=>{
 // Original anchor chosen so grace ends shortly in the future; no production clock override.
 const target=new Date(Date.now()-259200000+1200);const anchor=new Date(target);anchor.setUTCMonth(anchor.getUTCMonth()-1)
 await grant(anchor.toISOString());
 // Existing copy may have been published while the period was active, before 021.
 // Create it with enforcement temporarily disabled only in this isolated fixture.
 await c.pool.query('ALTER TABLE salon_public_visibility DISABLE TRIGGER subscription_gate_write; ALTER TABLE salon_public_projection DISABLE TRIGGER subscription_profile_write')
 await publish()
 await c.pool.query('ALTER TABLE salon_public_visibility ENABLE TRIGGER subscription_gate_write; ALTER TABLE salon_public_projection ENABLE TRIGGER subscription_profile_write')
 expect(await visible()).toHaveLength(1)
 await expect(upload()).rejects.toThrow(/Active subscription/)
 await delay(1400)
 expect(await visible()).toHaveLength(0)
 expect((await c.pool.query('SELECT published FROM salon_public_visibility')).rows[0].published).toBe(true)
})
async function service(variant:number){
 const id=(await c.pool.query<{id:string}>("INSERT INTO salon_public_services(tenant_id,profile_id,source_service_id,source_variant_id,display_name) VALUES($1,$2,'service-quote',$3,'Prestation') RETURNING id",[c.tenant,profile,`v${variant}`])).rows[0].id
 await c.pool.query(`INSERT INTO salon_public_service_projection(tenant_id,id,profile_id,source_service_id,source_variant_id,source_updated_at,source_available,display_name,description,price_xof,booking_requested,revision)
 SELECT $1,$2,$3,id,$4,updated_at,true,'Prestation','',3000,false,1 FROM services_catalog WHERE id='service-quote'`,[c.tenant,id,profile,`v${variant}`]);return id
}
it('dix projections prestations, pas onze ; upsert et rollback ne dérivent pas les compteurs',async()=>{
 await grant();await publish()
 await c.pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{variants}',$1::jsonb) WHERE id='service-quote'",[JSON.stringify(Array.from({length:11},(_,i)=>({id:`v${i}`,label:`Variante ${i}`,price:3000})))])
 const ids=[];for(let i=0;i<10;i++)ids.push(await service(i))
 await expect(service(10)).rejects.toThrow(/quota/)
 await c.pool.query(`INSERT INTO salon_public_service_projection SELECT * FROM salon_public_service_projection WHERE id=$1 ON CONFLICT(tenant_id,id) DO UPDATE SET revision=salon_public_service_projection.revision+1`,[ids[0]])
 expect((await c.pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='services'")).rows[0].used).toBe(10)
 await c.pool.query('BEGIN');await c.pool.query('DELETE FROM salon_public_service_projection WHERE id=$1',[ids[0]]);await c.pool.query('ROLLBACK')
 expect((await c.pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='services'")).rows[0].used).toBe(10)
 // Safety invalidation must still work without any paid entitlement.
 await c.pool.query("UPDATE tenant_subscriptions SET revoked_at=now(),revoked_by='operator',revocation_reason='withdrawn'")
 await c.pool.query("UPDATE services_catalog SET name='Changed ERP source' WHERE id='service-quote'")
 await c.pool.query("UPDATE services_catalog SET name='Changed again without subscription' WHERE id='service-quote'")
 expect((await c.pool.query('SELECT id FROM salon_public_service_projection WHERE source_available')).rows).toHaveLength(0)
 await expect(c.pool.query('UPDATE salon_public_service_projection SET revision=revision+1')).rejects.toThrow(/Active subscription/)
 await c.pool.query('DELETE FROM salon_public_service_projection WHERE id=$1',[ids[0]])
 expect((await c.pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='services'")).rows[0].used).toBe(9)
})
it('trois photos publiques, quatrième refusée ; suppression média invalide même après révocation',async()=>{
 await grant();await publish();const media=await upload(),variant=crypto.randomUUID()
 await c.pool.query("UPDATE salon_media SET state='processing' WHERE id=$1",[media])
 await c.pool.query(`INSERT INTO salon_media_variants(tenant_id,id,profile_id,media_id,object_key,mime,byte_size,width,height,sha256)
 VALUES($1::uuid,$2::uuid,$3,$4::uuid,$1::uuid::text || '/' || $4::uuid::text || '/variants/' || $2::uuid::text,'image/jpeg',100,100,100,repeat('a',64))`,[c.tenant,variant,profile,media])
 await c.pool.query("UPDATE salon_media SET state='ready',actual_mime='image/jpeg',actual_bytes=100,width=100,height=100,sha256=repeat('a',64) WHERE id=$1",[media])
 const photo=(order:number)=>c.pool.query("INSERT INTO salon_public_media_projection(tenant_id,profile_id,media_id,variant_id,purpose,sort_order,alt_text,width,height,mime,renderable,revision) VALUES($1,$2,$3,$4,'gallery',$5,'Photo',100,100,'image/jpeg',true,1)",[c.tenant,profile,media,variant,order])
 for(let i=0;i<3;i++)await photo(i)
 await expect(photo(3)).rejects.toThrow(/quota/)
 expect((await c.pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='photos'")).rows[0].used).toBe(3)
 await c.pool.query("UPDATE tenant_subscriptions SET revoked_at=now(),revoked_by='operator',revocation_reason='withdrawn'")
 await c.pool.query("UPDATE salon_media SET state='deleted' WHERE id=$1",[media])
 expect((await c.pool.query('SELECT id FROM salon_public_media_projection WHERE renderable')).rows).toHaveLength(0)
 expect((await c.pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='uploads'")).rows[0].used).toBe(0)
})
it('isolation des compteurs entre tenants et refus cross-tenant du runtime',async()=>{
 await grant();await upload();await upload();await upload()
 const other=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 expect((await c.pool.query<{cap:number}>('SELECT subscription_public_cap($1,\'uploads\',false) AS cap',[other])).rows[0].cap).toBe(0)
 expect((await c.pool.query<{visible:boolean}>('SELECT subscription_public_visible($1) AS visible',[other])).rows[0].visible).toBe(false)
 await expect(withTenantClient(c.pool,other,db=>db.query('INSERT INTO salon_public_quota_usage(tenant_id,resource,used) VALUES($1,\'uploads\',0)',[c.tenant]))).rejects.toThrow(/permission/)
 expect((await c.pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE tenant_id=$1 AND resource='uploads'",[c.tenant])).rows[0].used).toBe(3)
})
