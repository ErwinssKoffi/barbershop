import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { withTenantClient } from '../../server/tenantContext'
import { SUBSCRIPTION_SQL } from '../../server/subscriptionSchema'
import { ESSENTIEL_V1 } from '../domain/subscriptions'
import { readSubscriptionAccess } from '../../server/subscriptions'
import { apiTestClient } from './apiTestClient'
import { createPostgresTestPool } from './postgresTestPool'
import type { SqlPoolLike } from '../../server/neonClient'
let c:Awaited<ReturnType<typeof setup>>
let plan:string
async function installPlan(){
 const p=ESSENTIEL_V1
 return (await c.pool.query<{id:string}>(`INSERT INTO saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,[p.code,p.version,p.name,p.priceXof,p.currency,p.periodKind,p.graceSeconds,JSON.stringify(p.entitlements)])).rows[0].id
}
async function grant(tenant=c.tenant,offset=0){
 return (await c.pool.query<{id:string}>(`INSERT INTO tenant_subscriptions(tenant_id,plan_id,activation_key,billing_anchor_at,period_index,billing_timezone,starts_at,ends_at,grace_ends_at,amount_xof,external_reference,evidence_reference,operator_reference)
 VALUES($1,$2,$3::uuid,date_trunc('month',now()),$4::integer,'Africa/Abidjan',date_trunc('month',now())+$4::integer*interval '1 month',date_trunc('month',now())+($4::integer+1)*interval '1 month',date_trunc('month',now())+($4::integer+1)*interval '1 month'+interval '72 hours',4900,'external-verified-reference-' || $3::uuid::text,'restricted-evidence-reference','verified-operator-reference') RETURNING id`,[tenant,plan,crypto.randomUUID(),offset])).rows[0].id
}
beforeEach(async()=>{
 vi.stubEnv('SALON_VISIBILITY_ENABLED','true');c=await setup(false)
 await c.pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
 await runMigrations(c.pool,{includeSubscriptions:true})
})
afterEach(()=>vi.unstubAllEnvs())
it('019 indépendante et sans forfait/compte/souscription fictifs ; export et réexécution',async()=>{
 expect((await c.pool.query<{id:string}>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r=>r.id)).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','019_saas_subscriptions'])
 for(const table of ['saas_plans','tenant_subscriptions','subscription_events'])expect((await c.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([])
 expect(readFileSync('supabase/optional/019_saas_subscriptions.sql','utf8')).toBe(SUBSCRIPTION_SQL.trim()+'\n')
 await runMigrations(c.pool,{includeSubscriptions:true})
})
it('activation attestée explicite, lecture calculée, renouvellement adjacent autorisé sans finance',async()=>{
 const before=await c.financialState();plan=await installPlan()
 expect((await readSubscriptionAccess(c.pool,c.tenant,c.actorId,{})).subscription.state).toBe('absent')
 await grant();await grant(c.tenant,1)
 const view=await readSubscriptionAccess(c.pool,c.tenant,c.actorId,{})
 expect(view.subscription).toMatchObject({state:'active',canPublish:true,canBook:false,canAppointmentRequest:true,quotas:{galleryImages:3,publicServices:10}})
 expect(JSON.stringify(view)).not.toContain('restricted-evidence-reference')
 expect((await c.pool.query('SELECT event_type FROM subscription_events')).rows).toEqual([{event_type:'activated'},{event_type:'activated'}])
 expect(await c.financialState()).toEqual(before)
})
it('chevauchement, prix incorrect, dérive mensuelle et quotas mal typés refusés',async()=>{
 plan=await installPlan();await grant()
 await expect(grant()).rejects.toThrow(/Overlapping/i)
 await expect(c.pool.query(`INSERT INTO saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements) VALUES('invalid',1,'Invalid',4900,'XOF','calendar_month',259200,$1::jsonb)`,[JSON.stringify({...ESSENTIEL_V1.entitlements,galleryImages:'3'})])).rejects.toThrow(/check/i)
 await expect(c.pool.query("UPDATE tenant_subscriptions SET ends_at=ends_at+interval '1 day'")).rejects.toThrow(/immutable/i)
 await expect(c.pool.query('UPDATE saas_plans SET price_xof=1')).rejects.toThrow(/immutable/i)
})
it('RLS, grants colonne sensibles et aucune écriture runtime ou navigateur',async()=>{
 plan=await installPlan();await grant()
 const b=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 expect((await withTenantClient(c.pool,b,db=>db.query('SELECT id FROM tenant_subscriptions'))).rows).toEqual([])
 for(const sql of ['SELECT evidence_reference FROM tenant_subscriptions','DELETE FROM tenant_subscriptions','UPDATE saas_plans SET price_xof=0','SELECT * FROM subscription_events'])await expect(withTenantClient(c.pool,c.tenant,db=>db.query(sql))).rejects.toThrow(/permission denied/i)
 for(const browser of ['anon','authenticated'])for(const table of ['saas_plans','tenant_subscriptions','subscription_events'])expect((await c.pool.query<{ok:boolean}>("SELECT has_table_privilege($1,$2,'SELECT') AS ok",[browser,table])).rows[0].ok).toBe(false)
 expect((await c.pool.query<{forced:boolean}>("SELECT bool_and(relforcerowsecurity) AS forced FROM pg_class WHERE relname IN ('saas_plans','tenant_subscriptions','subscription_events')")).rows[0].forced).toBe(true)
})
it('révocation unique et audit immuable, sans suspension du tenant',async()=>{
 plan=await installPlan();const id=await grant()
 await c.pool.query("UPDATE tenant_subscriptions SET revoked_at=now(),revoked_by='operator-revoker',revocation_reason='Verification withdrawal' WHERE id=$1",[id])
 expect((await readSubscriptionAccess(c.pool,c.tenant,c.actorId,{})).subscription).toMatchObject({state:'revoked',canPublish:false,canKeepVisible:false})
 await expect(c.pool.query('UPDATE tenant_subscriptions SET revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL')).rejects.toThrow(/immutable/i)
 await expect(c.pool.query('DELETE FROM subscription_events')).rejects.toThrow(/immutable/i)
 expect((await c.pool.query('SELECT status FROM tenants WHERE id=$1',[c.tenant])).rows[0].status).toBe('active')
})
it('API session/Gérant et migration absente, aucun endpoint activation',async()=>{
 expect((await apiTestClient(c.pool,'POST','/api/visibility/subscription/read',{},c.manager)).status).toBe(200)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/subscription/read',{},c.cashier)).status).toBe(403)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/subscription/read',{})).status).toBe(401)
 await c.pool.query('DROP TABLE subscription_events,tenant_subscriptions,saas_plans CASCADE')
 await expect(readSubscriptionAccess(c.pool,c.tenant,c.actorId,{})).rejects.toMatchObject({code:'SUBSCRIPTION_MIGRATION_REQUIRED'})
})
it('audit défaillant annule grant ; rollback DDL 019 complet',async()=>{
 plan=await installPlan()
 await c.pool.query("CREATE FUNCTION fail_subscription_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_subscription BEFORE INSERT ON subscription_events FOR EACH ROW EXECUTE FUNCTION fail_subscription_audit()")
 await expect(grant()).rejects.toThrow(/audit failed/)
 expect((await c.pool.query('SELECT * FROM tenant_subscriptions')).rows).toEqual([])
 const pool=createPostgresTestPool().pool;await runMigrations(pool)
 const broken:SqlPoolLike={...pool,connect:async()=>{const db=await pool.connect();return {...db,query:<R>(sql:string,values?:unknown[])=>db.query<R>(sql===SUBSCRIPTION_SQL?sql+'\nSELECT absent_subscription_function();':sql,values)}}}
 await expect(runMigrations(broken,{includeSubscriptions:true})).rejects.toThrow(/absent_subscription_function/)
 expect((await pool.query("SELECT to_regclass('tenant_subscriptions') AS name")).rows[0].name).toBeNull()
})
it('autorité serveur relit révocation et refuse un autre tenant malgré le contexte actif',async()=>{
 const {resolveSubscriptionAccess}=await import('../../server/subscriptionAccess')
 plan=await installPlan();const id=await grant()
 const b=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 const read=(tenant=c.tenant)=>withTenantClient(c.pool,c.tenant,db=>resolveSubscriptionAccess(db,tenant))
 expect((await read()).access.canPublish).toBe(true)
 expect((await read(b)).access.canPublish).toBe(false)
 await c.pool.query("UPDATE tenant_subscriptions SET revoked_at=now(),revoked_by='operator',revocation_reason='Verification withdrawn' WHERE id=$1",[id])
 expect((await read()).access).toMatchObject({state:'revoked',canPublish:false,canKeepVisible:false})
})
