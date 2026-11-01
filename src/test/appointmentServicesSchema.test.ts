import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runMigrations } from '../../server/migrations'
import { APPOINTMENT_SERVICES_SQL } from '../../server/appointmentServicesSchema'
import { withTenantClient } from '../../server/tenantContext'
import { setup } from './checkoutTestFixtures'
import { createPostgresTestPool } from './postgresTestPool'
import type { SqlPoolLike } from '../../server/neonClient'
let context: Awaited<ReturnType<typeof setup>>
let other: string
async function booking(id='appointment',tenant=context.tenant,kind='appointment',status='planned') {
  await context.pool.query(`INSERT INTO bookings(tenant_id,id,employee_id,start_at,end_at,status,request_key,request_hash,created_by,payload_json)
    VALUES($1,$2,'employee-ref',now(),now()+interval '30 minutes',$3,$2,'hash',$4,$5::jsonb)`,[tenant,id,status,context.actorId,JSON.stringify({kind})])
}
async function snapshot(position=1,variant: string|null=null,tenant=context.tenant,actor=context.actorId,source='service-quote',parent='appointment') {
  return context.pool.query(`INSERT INTO appointment_services(tenant_id,booking_id,position,source_service_id,source_variant_id,actor_id)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[tenant,parent,position,source,variant,actor])
}
beforeEach(async()=>{
  context=await setup(false)
  await context.pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
  await runMigrations(context.pool,{includeAppointmentServices:true})
  other=(await context.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[context.tenant])).rows[0].id
  await context.pool.query("UPDATE services_catalog SET payload_json=jsonb_set(jsonb_set(payload_json,'{durationMinutes}','30'),'{variants,0,durationMinutes}','45') WHERE tenant_id=$1",[context.tenant])
  await booking()
})
it('014 implique 008 seulement ; export exact, sans backfill et réexécution sûre',async()=>{
  const ids=(await context.pool.query<{id:string}>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r=>r.id)
  expect(ids).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','008_booking','014_appointment_services'])
  expect((await context.pool.query('SELECT * FROM appointment_services')).rows).toEqual([])
  await runMigrations(context.pool,{includeAppointmentServices:true})
  expect(readFileSync('supabase/optional/014_appointment_services.sql','utf8')).toBe(APPOINTMENT_SERVICES_SQL.trim()+'\n')
})
it('prix/durée/libellés dérivés du catalogue, pas du payload fourni ; variante liée à la source',async()=>{
  const {pool,tenant,actorId}=context
  const base=(await snapshot()).rows[0]
  expect(base).toMatchObject({service_name:'Prestation',price_xof:3000,duration_minutes:30,variant_label:null})
  const variant=(await snapshot(2,'variant-long')).rows[0]
  expect(variant).toMatchObject({price_xof:4500,duration_minutes:45,variant_label:'Long'})
  const forged=(await pool.query(`INSERT INTO appointment_services(tenant_id,booking_id,position,source_service_id,actor_id,price_xof,duration_minutes,service_name,source_updated_at)
    VALUES($1,'appointment',3,'service-quote',$2,1,5,'forgé','forgé') RETURNING *`,[tenant,actorId])).rows[0]
  expect(forged).toMatchObject({price_xof:3000,duration_minutes:30,service_name:'Prestation'})
  await expect(snapshot(4,'missing')).rejects.toThrow(/variant/i)
})
it('isolation tenant, source inter-salon et parent inter-salon refusés, acteur vérifié',async()=>{
  const {pool,tenant,cashierId}=context
  await snapshot()
  expect((await withTenantClient(pool,other,db=>db.query('SELECT * FROM appointment_services'))).rows).toEqual([])
  await expect(snapshot(1,null,other)).rejects.toThrow(/same tenant/i)
  await booking('other',other)
  await expect(snapshot(1,null,other,context.actorId,'service-quote','other')).rejects.toThrow(/manager/i)
  await expect(snapshot(2,null,tenant,cashierId)).rejects.toThrow(/manager/i)
  await pool.query("INSERT INTO memberships(tenant_id,user_id,role,is_active) VALUES($1,$2,'manager',true)",[other,context.actorId])
  await expect(snapshot(1,null,other,context.actorId,'service-quote','other')).rejects.toThrow(/source.*same tenant/i)
  await pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[tenant,context.actorId])
  await expect(snapshot(2)).rejects.toThrow(/manager/i)
})
it('snapshots immuables et préservés après modification ou purge source, sans effet financier',async()=>{
  const {pool,tenant,financialState}=context
  const before=await financialState(); const initial=(await snapshot()).rows[0]
  expect(await financialState()).toEqual(before)
  await pool.query('UPDATE services_catalog SET reference_price=9999 WHERE tenant_id=$1',[tenant])
  await pool.query('DELETE FROM services_catalog WHERE tenant_id=$1',[tenant])
  expect((await pool.query('SELECT * FROM appointment_services')).rows).toEqual([initial])
  await expect(pool.query('UPDATE appointment_services SET price_xof=1')).rejects.toThrow(/immutable/i)
  await expect(pool.query('DELETE FROM appointment_services')).rejects.toThrow(/immutable/i)
  expect(await financialState()).toEqual({...before,revision:Number(before.revision)+1})
})
it('aucune écriture runtime/navigateur, RLS FORCE et fonctions de trigger révoquées',async()=>{
  const {pool,tenant}=context
  await snapshot()
  for(const sql of ['DELETE FROM appointment_services','UPDATE appointment_services SET price_xof=1']) await expect(withTenantClient(pool,tenant,db=>db.query(sql))).rejects.toThrow(/permission denied/i)
  expect((await pool.query<{forced:boolean}>("SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname='appointment_services'")).rows[0].forced).toBe(true)
  for(const browser of ['anon','authenticated']) {
    expect((await pool.query<{ok:boolean}>("SELECT has_table_privilege($1,'appointment_services','SELECT') AS ok",[browser])).rows[0].ok).toBe(false)
    for(const fn of ['derive_appointment_service_snapshot()','protect_appointment_service_snapshot()']) expect((await pool.query<{ok:boolean}>("SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",[browser,fn])).rows[0].ok).toBe(false)
  }
})
it('durée absente, fractionnaire, prix invalide ou source inactive refusés',async()=>{
  const {pool,tenant}=context
  for(const minutes of ['null','4','481','30.5','"30"']) {
    await pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{durationMinutes}',$2::jsonb) WHERE tenant_id=$1",[tenant,minutes])
    await expect(snapshot()).rejects.toThrow(/duration/i)
  }
  await pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{durationMinutes}','30'),reference_price=-1 WHERE tenant_id=$1",[tenant])
  await expect(snapshot()).rejects.toThrow(/price/i)
  await pool.query("UPDATE services_catalog SET reference_price=3000,payload_json=jsonb_set(payload_json,'{variants,0,price}','1.5') WHERE tenant_id=$1",[tenant])
  await expect(snapshot(1,'variant-long')).rejects.toThrow(/price/i)
  await pool.query('UPDATE services_catalog SET reference_price=3000,is_active=false WHERE tenant_id=$1',[tenant])
  await expect(snapshot()).rejects.toThrow(/source/i)
})
it('interdit pause et rendez-vous non planned ; unicité/cardinalité et capture atomique',async()=>{
  const {pool}=context
  await snapshot()
  await expect(snapshot()).rejects.toThrow(/unique/i)
  await expect(snapshot(0)).rejects.toThrow(/check/i)
  await booking('pause',context.tenant,'unavailable')
  await expect(snapshot(1,null,context.tenant,context.actorId,'service-quote','pause')).rejects.toThrow(/planned appointment/i)
  await pool.query("UPDATE bookings SET status='confirmed' WHERE id='appointment'")
  await expect(snapshot(2)).rejects.toThrow(/planned appointment/i)
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("UPDATE bookings SET status='planned' WHERE id='appointment'")
    await db.query("INSERT INTO appointment_services(tenant_id,booking_id,position,source_service_id,actor_id) VALUES($1,'appointment',2,'service-quote',$2)",[context.tenant,context.actorId])
    await expect(db.query("SELECT absent_snapshot_function()" )).rejects.toThrow()
    await db.query('ROLLBACK')
  } finally {db.release()}
  expect((await pool.query('SELECT * FROM appointment_services')).rows).toHaveLength(1)
})
it('échec DDL 014 annule sa table sans retirer 008 déjà appliquée',async()=>{
  const isolated=createPostgresTestPool().pool
  await runMigrations(isolated,{includeBooking:true})
  const broken:SqlPoolLike={...isolated,connect:async()=>{
    const db=await isolated.connect()
    return {...db,query:<R>(text:string,values?:unknown[])=>db.query<R>(text===APPOINTMENT_SERVICES_SQL?text+'\nSELECT absent_snapshot_function();':text,values)}
  }}
  await expect(runMigrations(broken,{includeAppointmentServices:true})).rejects.toThrow(/absent_snapshot_function/)
  expect((await isolated.query("SELECT to_regclass('appointment_services') AS name")).rows[0].name).toBeNull()
  expect((await isolated.query("SELECT to_regclass('bookings') AS name")).rows[0].name).toBe('bookings')
})
