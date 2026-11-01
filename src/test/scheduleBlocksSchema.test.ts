import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { SCHEDULE_BLOCKS_SQL } from '../../server/scheduleBlocksSchema'
import { withTenantClient } from '../../server/tenantContext'
import { createPostgresTestPool } from './postgresTestPool'
import type { SqlPoolLike } from '../../server/neonClient'
let context: Awaited<ReturnType<typeof setup>>
let b: string
async function block(scope='salon',employee: string|null=null,tenant=context.tenant,actor=context.actorId) {
  return (await context.pool.query<{id:string}>(`INSERT INTO schedule_blocks(tenant_id,scope,employee_id,start_at,end_at,private_note,created_by)
    VALUES($1,$2,$3,'2026-11-04T10:00:00Z','2026-11-08T12:00:00Z','Note privée de recette',$4) RETURNING id`,[tenant,scope,employee,actor])).rows[0].id
}
beforeEach(async()=>{
  context=await setup(false)
  await context.pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
  await runMigrations(context.pool,{includeScheduleBlocks:true})
  b=(await context.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[context.tenant])).rows[0].id
  await context.pool.query(`INSERT INTO employees(tenant_id,id,full_name,role_title,updated_at,payload_json)
    VALUES($1,'employee','Employé de recette','Coiffure','2026-11-01','{}')`,[context.tenant])
})
it('015 indépendante de 008/009 et finance, vide, export exact et réexécutable',async()=>{
  expect((await context.pool.query<{id:string}>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r=>r.id)).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','015_schedule_blocks'])
  expect((await context.pool.query('SELECT * FROM schedule_blocks')).rows).toEqual([])
  await runMigrations(context.pool,{includeScheduleBlocks:true})
  expect(readFileSync('supabase/optional/015_schedule_blocks.sql','utf8')).toBe(SCHEDULE_BLOCKS_SQL.trim()+'\n')
})
it('salon et employé multijours, acteur réel, audit atomique et aucune écriture financière',async()=>{
  const before=await context.financialState()
  const salon=await block(); const employee=await block('employee','employee')
  expect((await context.pool.query('SELECT scope,employee_ref FROM schedule_blocks ORDER BY scope')).rows).toEqual([{scope:'employee',employee_ref:'employee'},{scope:'salon',employee_ref:null}])
  expect((await context.pool.query('SELECT event_type,actor_id,version FROM schedule_block_events')).rows).toEqual([{event_type:'created',actor_id:context.actorId,version:1},{event_type:'created',actor_id:context.actorId,version:1}])
  expect(salon).not.toBe(employee)
  expect(await context.financialState()).toEqual(before)
})
it('RLS et FK tenant-scoped ; employé cross-tenant et acteur Caissier/inactif refusés',async()=>{
  await block('employee','employee')
  expect((await withTenantClient(context.pool,b,db=>db.query('SELECT * FROM schedule_blocks'))).rows).toEqual([])
  expect((await withTenantClient(context.pool,b,db=>db.query('SELECT * FROM schedule_block_events'))).rows).toEqual([])
  await context.pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[b,context.actorId])
  await expect(block('employee','employee',b)).rejects.toThrow(/same tenant/i)
  await expect(block('salon',null,context.tenant,context.cashierId)).rejects.toThrow(/manager/i)
  await context.pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[context.tenant,context.actorId])
  await expect(block()).rejects.toThrow(/manager/i)
})
it('runtime lecture seule et navigateur sans droits, RLS FORCE, fonctions protégées',async()=>{
  await block()
  for(const sql of ['DELETE FROM schedule_blocks',"UPDATE schedule_blocks SET state='cancelled'",'DELETE FROM schedule_block_events']) await expect(withTenantClient(context.pool,context.tenant,db=>db.query(sql))).rejects.toThrow(/permission denied/i)
  for(const table of ['schedule_blocks','schedule_block_events']) {
    expect((await context.pool.query<{forced:boolean}>('SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname=$1',[table])).rows[0].forced).toBe(true)
    for(const browser of ['anon','authenticated']) expect((await context.pool.query<{ok:boolean}>("SELECT has_table_privilege($1,$2,'SELECT') AS ok",[browser,table])).rows[0].ok).toBe(false)
  }
  for(const browser of ['anon','authenticated']) for(const fn of ['validate_schedule_block()','record_schedule_block_event()','protect_schedule_block_history()']) expect((await context.pool.query<{ok:boolean}>("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[browser,fn])).rows[0].ok).toBe(false)
})
it('annulation auditée sans résurrection ni effacement ; corrections par remplacement',async()=>{
  const id=await block()
  await context.pool.query("UPDATE schedule_blocks SET state='cancelled',cancelled_by=$2 WHERE id=$1",[id,context.actorId])
  expect((await context.pool.query('SELECT state,version FROM schedule_blocks WHERE id=$1',[id])).rows[0]).toEqual({state:'cancelled',version:2})
  expect((await context.pool.query('SELECT event_type FROM schedule_block_events ORDER BY version')).rows).toEqual([{event_type:'created'},{event_type:'cancelled'}])
  await expect(context.pool.query("UPDATE schedule_blocks SET state='active',cancelled_by=NULL WHERE id=$1",[id])).rejects.toThrow(/transition/i)
  await expect(context.pool.query('DELETE FROM schedule_blocks')).rejects.toThrow(/immutable/i)
  await expect(context.pool.query('DELETE FROM schedule_block_events')).rejects.toThrow(/immutable/i)
  await expect(context.pool.query("UPDATE schedule_blocks SET private_note='autre'")).rejects.toThrow(/immutable/i)
})
it('purge employé détache sans devenir fermeture salon, et journal sans faux acteur',async()=>{
  const id=await block('employee','employee')
  await expect(context.pool.query('UPDATE schedule_blocks SET employee_id=NULL WHERE id=$1',[id])).rejects.toThrow(/still exists/i)
  await withTenantClient(context.pool,context.tenant,db=>db.query("DELETE FROM employees WHERE id='employee'"))
  expect((await context.pool.query('SELECT scope,employee_id,employee_ref,version FROM schedule_blocks WHERE id=$1',[id])).rows[0]).toEqual({scope:'employee',employee_id:null,employee_ref:'employee',version:2})
  expect((await context.pool.query('SELECT event_type,actor_id FROM schedule_block_events WHERE version=2')).rows[0]).toEqual({event_type:'employee_detached',actor_id:null})
})
it('bornes finies et scope stricts, employé inactif et salon suspendu refusés',async()=>{
  const {pool,tenant,actorId}=context
  for(const [start,end] of [['infinity','infinity'],['2026-11-01','2026-11-01'],['2026-11-02','2026-11-01']]) await expect(pool.query(`INSERT INTO schedule_blocks(tenant_id,scope,start_at,end_at,created_by) VALUES($1,'salon',$2,$3,$4)`,[tenant,start,end,actorId])).rejects.toThrow(/check/i)
  await expect(block('salon','employee')).rejects.toThrow(/check/i)
  await pool.query('UPDATE employees SET is_active=false WHERE tenant_id=$1',[tenant])
  await expect(block('employee','employee')).rejects.toThrow(/employee/i)
  await pool.query("UPDATE tenants SET status='suspended' WHERE id=$1",[tenant])
  await expect(block()).rejects.toThrow(/manager/i)
})
it('rollback métier annule bloc et journal ensemble ; FK événements inter-tenant refusée',async()=>{
  const id=await block()
  await expect(context.pool.query("INSERT INTO schedule_block_events(tenant_id,block_id,event_type,version,actor_db_role) VALUES($1,$2,'created',2,'test')",[b,id])).rejects.toThrow(/foreign key/i)
  const db=await context.pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("UPDATE schedule_blocks SET state='cancelled',cancelled_by=$1 WHERE id=$2",[context.actorId,id])
    await expect(db.query('SELECT absent_block_function()')).rejects.toThrow()
    await db.query('ROLLBACK')
  } finally {db.release()}
  expect((await context.pool.query('SELECT state,version FROM schedule_blocks WHERE id=$1',[id])).rows[0]).toEqual({state:'active',version:1})
  expect((await context.pool.query('SELECT * FROM schedule_block_events')).rows).toHaveLength(1)
})
it('échec de migration annule toute la DDL 015',async()=>{
  const isolated=createPostgresTestPool().pool
  await runMigrations(isolated)
  const broken:SqlPoolLike={...isolated,connect:async()=>{
    const db=await isolated.connect()
    return {...db,query:<R>(text:string,values?:unknown[])=>db.query<R>(text===SCHEDULE_BLOCKS_SQL?text+'\nSELECT absent_block_function();':text,values)}
  }}
  await expect(runMigrations(broken,{includeScheduleBlocks:true})).rejects.toThrow(/absent_block_function/)
  expect((await isolated.query("SELECT to_regclass('schedule_blocks') AS name")).rows[0].name).toBeNull()
  expect((await isolated.query("SELECT id FROM schema_migrations WHERE id='015_schedule_blocks'")).rows).toEqual([])
})
