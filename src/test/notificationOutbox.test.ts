import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'
import { NOTIFICATION_SQL } from '../../server/notificationSchema'
import { defaultTenantId, withTenantClient } from '../../server/tenantContext'
import { claimNotifications, recoverExpiredNotifications, settleNotification } from '../../server/notificationOutbox'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
import type { SqlPoolLike } from '../../server/neonClient'
let pool: SqlPoolLike
let a: string
let b: string
async function enqueue(tenant=a,key=crypto.randomUUID(),max=2,available="now()-interval '1 minute'",expires="now()+interval '1 hour'") {
  return (await pool.query<{id: string}>(`INSERT INTO notification_outbox(tenant_id,deduplication_key,resource_id,event_type,channel,available_at,expires_at,max_attempts)
    VALUES($1,$2,$3,'booking_reminder','email',${available},${expires},$4) RETURNING id`,[tenant,key,crypto.randomUUID(),max])).rows[0].id
}
beforeEach(async () => {
  pool=createPostgresTestPool().pool
  await runMigrations(pool)
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
  await runMigrations(pool,{includeNotifications:true})
  a=await defaultTenantId(pool)
  b=(await pool.query<{id: string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[a])).rows[0].id
})
it('013 indépendante, sans seed, opt-in strict, export exact et réexécution sûre',async () => {
  expect((await pool.query<{id:string}>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r=>r.id)).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','013_notification_outbox'])
  expect((await pool.query('SELECT * FROM notification_outbox')).rows).toEqual([])
  await runMigrations(pool,{includeNotifications:true})
  expect(readFileSync('supabase/optional/013_notification_outbox.sql','utf8')).toBe(NOTIFICATION_SQL.trim()+'\n')
  expect(() => marketplaceMigrationOptions(['--include-notifications'],undefined)).toThrow(/backup/)
  expect(marketplaceMigrationOptions(['--include-notifications'],'true')).toEqual({includeMarketplace:false,includeNotifications:true})
})
it('RLS et claims limités au tenant ; FK inter-tenant journal refusée',async () => {
  const id=await enqueue(); await enqueue(b)
  expect((await withTenantClient(pool,a,db=>db.query('SELECT * FROM notification_outbox'))).rows).toHaveLength(1)
  expect(await claimNotifications(pool,a,100,60)).toHaveLength(1)
  expect((await withTenantClient(pool,b,db=>db.query('SELECT state FROM notification_outbox'))).rows).toEqual([{state:'pending'}])
  await expect(pool.query("INSERT INTO notification_outbox_events(tenant_id,notification_id,to_state,attempt,actor_db_role) VALUES($1,$2,'pending',0,'test')",[b,id])).rejects.toThrow(/foreign key/i)
  expect((await pool.query<{forced:boolean}>("SELECT bool_and(relforcerowsecurity) AS forced FROM pg_class WHERE relname IN ('notification_outbox','notification_outbox_events')")).rows[0].forced).toBe(true)
})
it('runtime en lecture seulement, worker sans finance ni publication, navigateur sans accès',async () => {
  await enqueue()
  for(const sql of ['DELETE FROM notification_outbox','UPDATE notification_outbox SET attempts=1','DELETE FROM notification_outbox_events']) await expect(withTenantClient(pool,a,db=>db.query(sql))).rejects.toThrow(/permission denied/i)
  for(const browser of ['anon','authenticated']) {
    for(const table of ['notification_outbox','notification_outbox_events']) expect((await pool.query<{ok:boolean}>("SELECT has_table_privilege($1,$2,'SELECT') AS ok",[browser,table])).rows[0].ok).toBe(false)
    for(const fn of ['protect_notification_transition()','record_notification_event()','protect_notification_event()']) expect((await pool.query<{ok:boolean}>("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[browser,fn])).rows[0].ok).toBe(false)
  }
  const name=(await pool.query<{name:string}>("SELECT 'salon_pro_notify_' || substr(md5(current_schema()),1,12) AS name")).rows[0].name
  expect((await pool.query<{ok:boolean}>("SELECT has_table_privilege($1,'revenues','SELECT') AS ok",[name])).rows[0].ok).toBe(false)
  expect((await pool.query('SELECT rolcanlogin,rolsuper,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=$1',[name])).rows[0]).toEqual({rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolinherit:false})
})
it('déduplication tenant-scoped, enveloppe et journal immuables, terminal sans résurrection',async () => {
  const key=crypto.randomUUID(); const id=await enqueue(a,key)
  await expect(enqueue(a,key)).rejects.toThrow(/unique/i); await enqueue(b,key)
  await expect(pool.query("UPDATE notification_outbox SET channel='sms' WHERE id=$1",[id])).rejects.toThrow(/immutable/i)
  const [claim]=await claimNotifications(pool,a,1,60)
  expect(await settleNotification(pool,a,id,claim.lease_token,'sent')).toBe(true)
  expect(await settleNotification(pool,a,id,claim.lease_token,'sent')).toBe(false)
  await expect(pool.query("UPDATE notification_outbox SET state='pending' WHERE id=$1",[id])).rejects.toThrow(/transition/i)
  await expect(pool.query('DELETE FROM notification_outbox_events')).rejects.toThrow(/immutable/i)
  const events=(await pool.query<{to_state:string}>('SELECT to_state FROM notification_outbox_events WHERE notification_id=$1 ORDER BY at',[id])).rows
  expect(events.map(r=>r.to_state)).toEqual(['pending','processing','sent'])
})
it('ne réclame ni futur ni expiré, récupère expirés vers dead, bornes obligatoires',async () => {
  await enqueue(a,crypto.randomUUID(),2,"now()+interval '10 minutes'")
  const expired=await enqueue(a,crypto.randomUUID(),2,"now()-interval '2 hours'","now()-interval '1 hour'")
  expect(await claimNotifications(pool,a,10,60)).toEqual([])
  expect(await recoverExpiredNotifications(pool,a,10)).toBe(1)
  expect((await pool.query('SELECT state FROM notification_outbox WHERE id=$1',[expired])).rows[0].state).toBe('dead')
  for(const limit of [0,101,1.5]) await expect(claimNotifications(pool,a,limit,60)).rejects.toThrow(/bound/)
  await expect(claimNotifications(pool,a,1,0)).rejects.toThrow(/bound/)
})
it('retry explicite, jeton clôture borné à la bonne tentative et plafond respecté',async () => {
  const id=await enqueue(a,crypto.randomUUID(),1)
  const [claim]=await claimNotifications(pool,a,1,60)
  expect(await claimNotifications(pool,a,1,60)).toEqual([])
  expect(await settleNotification(pool,a,id,crypto.randomUUID(),'sent')).toBe(false)
  expect(await settleNotification(pool,b,id,claim.lease_token,'sent')).toBe(false)
  await expect(settleNotification(pool,a,id,claim.lease_token,'retry')).rejects.toThrow(/instant/)
  await expect(settleNotification(pool,a,id,claim.lease_token,'retry',new Date(Date.now()+60000).toISOString())).rejects.toThrow(/retry/)
  expect(await settleNotification(pool,a,id,claim.lease_token,'dead')).toBe(true)
  expect((await pool.query('SELECT attempts FROM notification_outbox WHERE id=$1',[id])).rows[0].attempts).toBe(1)
})
it('salon suspendu ne démarre pas le worker ; NULL lease et états initiaux invalides refusés',async () => {
  const id=await enqueue()
  await expect(pool.query("UPDATE notification_outbox SET state='processing',attempts=1,leased_at=now(),lease_token=gen_random_uuid() WHERE id=$1",[id])).rejects.toThrow()
  await pool.query("UPDATE tenants SET status='suspended' WHERE id=$1",[a])
  await expect(claimNotifications(pool,a,1,60)).rejects.toThrow(/suspendu/)
})
it('rollback DDL/rôle de 013 et refus du rôle préexistant',async () => {
  const isolated=createPostgresTestPool().pool
  await runMigrations(isolated)
  const broken: SqlPoolLike={...isolated,connect:async()=>{
    const db=await isolated.connect()
    return {...db,query:<R>(text:string,values?:unknown[])=>db.query<R>(text===NOTIFICATION_SQL?text+'\nSELECT absent_notification_function();':text,values)}
  }}
  await expect(runMigrations(broken,{includeNotifications:true})).rejects.toThrow(/absent_notification_function/)
  expect((await isolated.query("SELECT to_regclass('notification_outbox') AS name")).rows[0].name).toBeNull()
  expect((await isolated.query("SELECT rolname FROM pg_roles WHERE rolname='salon_pro_notify_' || substr(md5(current_schema()),1,12)")).rows).toEqual([])
  await isolated.query("DO $role$ BEGIN EXECUTE format('CREATE ROLE %I NOLOGIN','salon_pro_notify_' || substr(md5(current_schema()),1,12)); END $role$")
  await expect(runMigrations(isolated,{includeNotifications:true})).rejects.toThrow(/already exists/)
})
it('récupération après expiration : nouveau jeton, ancienne complétion refusée',async () => {
  const id=await enqueue()
  const [first]=await claimNotifications(pool,a,1,1)
  await new Promise(resolve=>setTimeout(resolve,1100))
  expect(await settleNotification(pool,a,id,first.lease_token,'sent')).toBe(false)
  expect(await recoverExpiredNotifications(pool,a,10)).toBe(1)
  const [second]=await claimNotifications(pool,a,1,60)
  expect(second.lease_token).not.toBe(first.lease_token)
  expect(second.attempts).toBe(2)
  expect(await settleNotification(pool,a,id,first.lease_token,'sent')).toBe(false)
  expect(await settleNotification(pool,a,id,second.lease_token,'sent')).toBe(true)
})
it('retry différé valide ; au plafond une lease expirée devient dead',async () => {
  const id=await enqueue()
  const [first]=await claimNotifications(pool,a,1,60)
  expect(await settleNotification(pool,a,id,first.lease_token,'retry',new Date(Date.now()+1000).toISOString())).toBe(true)
  expect(await claimNotifications(pool,a,1,60)).toEqual([])
  await new Promise(resolve=>setTimeout(resolve,1100))
  const [last]=await claimNotifications(pool,a,1,1)
  expect(last.attempts).toBe(2)
  await new Promise(resolve=>setTimeout(resolve,1100))
  expect(await recoverExpiredNotifications(pool,a,1)).toBe(1)
  expect((await pool.query('SELECT state,attempts FROM notification_outbox WHERE id=$1',[id])).rows[0]).toEqual({state:'dead',attempts:2})
})
