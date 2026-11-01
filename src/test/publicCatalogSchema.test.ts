import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'
import { PUBLIC_CATALOG_SQL } from '../../server/publicCatalogSchema'
import { defaultTenantId, withTenantClient } from '../../server/tenantContext'
import type { SqlClientLike, SqlPoolLike } from '../../server/neonClient'

let pool: SqlPoolLike
let a: string
let b: string
let pa: string
let pb: string
const stamp = '2026-11-01T00:00:00.000Z'
const tables = ['salon_public_services','salon_public_service_projection','salon_booking_rules','salon_public_booking_rules']
async function reader<T>(work: (db: SqlClientLike) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('BEGIN READ ONLY')
    await db.query("SELECT set_config('role','salon_pro_public_' || substr(md5(current_schema()),1,12),true)")
    const result = await work(db); await db.query('COMMIT'); return result
  } catch(error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}
async function draft(tenant: string, profile: string, source='catalogue-service', variant: string | null=null) {
  return (await withTenantClient(pool,tenant,db => db.query<{ id: string }>(`INSERT INTO salon_public_services(tenant_id,profile_id,source_service_id,source_variant_id,display_name)
    VALUES($1,$2,$3,$4,'Prestation de recette') RETURNING id`,[tenant,profile,source,variant]))).rows[0].id
}
async function publish(tenant: string, profile: string, id: string, variant: string | null=null) {
  await pool.query(`INSERT INTO salon_public_service_projection(tenant_id,id,profile_id,source_service_id,source_variant_id,source_updated_at,source_available,display_name,description,price_xof,duration_minutes,booking_requested,revision)
    VALUES($1,$2,$3,'catalogue-service',$4,$5,true,'Prestation publiée','',1000,30,true,1)`,[tenant,id,profile,variant,stamp])
}
async function rules(table: string, tenant: string, profile: string) {
  await pool.query(`INSERT INTO ${table}(tenant_id,profile_id,online_booking_enabled,slot_step_minutes,minimum_notice_minutes,horizon_days,buffer_before_minutes,buffer_after_minutes,cancellation_allowed,cancellation_notice_minutes,employee_choice_allowed,revision)
    VALUES($1,$2,false,15,60,30,5,5,true,60,false,1)`,[tenant,profile])
}
beforeEach(async () => {
  pool = createPostgresTestPool().pool
  await runMigrations(pool)
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
  await runMigrations(pool,{includePublicCatalog:true})
  a=await defaultTenantId(pool)
  b=(await pool.query<{ id: string }>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[a])).rows[0].id
  for (const [tenant,slug] of [[a,'profil-a'],[b,'profil-b']]) {
    const id=(await pool.query<{ id: string }>('INSERT INTO salon_public_profiles(tenant_id) VALUES($1) RETURNING id',[tenant])).rows[0].id
    if (tenant===a) pa=id; else pb=id
    await pool.query("INSERT INTO salon_public_visibility(tenant_id,profile_id,published,allowed_from,allowed_until) VALUES($1,$2,true,now()-interval '1 day',now()+interval '1 day')",[tenant,id])
    await pool.query("INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision) VALUES($1,$2,$3,'Salon de test','','Ville','',1)",[tenant,id,slug])
    const body={id:'catalogue-service',name:'Prestation',description:'',referencePrice:1000,durationMinutes:30,isActive:true,variants:[{id:'variant-a',label:'Variante',price:1500,durationMinutes:45}],createdAt:stamp,updatedAt:stamp}
    await withTenantClient(pool,tenant,db => db.query(`INSERT INTO services_catalog(id,name,category_code,reference_price,is_active,updated_at,payload_json)
      VALUES('catalogue-service','Prestation','service',1000,true,$1,$2::jsonb)`,[stamp,JSON.stringify(body)]))
  }
})

it('011 implique seulement 009, sans seed et réexécutable ; SQL exporté aligné',async () => {
  const ids=(await pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(row => row.id)
  expect(ids).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','009_marketplace_profiles','011_public_catalog'])
  for (const table of tables) expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([])
  await runMigrations(pool,{includePublicCatalog:true})
  expect((await pool.query('SELECT id FROM schema_migrations')).rows).toHaveLength(7)
  expect(readFileSync('supabase/optional/011_public_catalog.sql','utf8')).toBe(PUBLIC_CATALOG_SQL.trim()+'\n')
})
it('RLS isole les brouillons et refuse les FK inter-salons profil/source',async () => {
  await draft(a,pa); await draft(b,pb)
  expect((await withTenantClient(pool,a,db => db.query('SELECT * FROM salon_public_services'))).rows).toHaveLength(1)
  expect((await withTenantClient(pool,a,db => db.query('UPDATE salon_public_services SET version=2 WHERE tenant_id=$1',[b]))).rowCount).toBe(0)
  expect((await withTenantClient(pool,a,db => db.query('DELETE FROM salon_public_services WHERE tenant_id=$1',[b]))).rowCount).toBe(0)
  await expect(draft(a,pb,'different')).rejects.toThrow(/foreign key/i)
  await expect(draft(a,pa,'absent-source')).rejects.toThrow(/foreign key/i)
  await expect(withTenantClient(pool,a,db => db.query('UPDATE salon_public_services SET tenant_id=$1',[b]))).rejects.toThrow()
  await rules('salon_booking_rules',a,pa)
  await expect(pool.query('UPDATE salon_booking_rules SET profile_id=$1 WHERE tenant_id=$2',[pb,a])).rejects.toThrow(/foreign key/i)
})
it('variante vérifiée dans sa prestation ; unicité des offres base et variante',async () => {
  await draft(a,pa)
  await expect(draft(a,pa)).rejects.toThrow(/unique/i)
  await draft(a,pa,'catalogue-service','variant-a')
  await expect(draft(a,pa,'catalogue-service','variant-a')).rejects.toThrow(/unique/i)
  await expect(draft(a,pa,'catalogue-service','variant-other')).rejects.toThrow(/variant/i)
})
it('prix entiers XOF, durées et règles explicites sans valeurs commerciales automatiques',async () => {
  const id=await draft(a,pa); await publish(a,pa,id)
  for (const price of ['-1','9007199254740992']) await expect(pool.query('UPDATE salon_public_service_projection SET price_xof=$1::bigint',[price])).rejects.toThrow(/check/i)
  for (const duration of [0,4,481]) await expect(pool.query('UPDATE salon_public_service_projection SET duration_minutes=$1',[duration])).rejects.toThrow(/check/i)
  await expect(pool.query('UPDATE salon_public_service_projection SET duration_minutes=NULL')).rejects.toThrow(/check/i)
  await pool.query('UPDATE salon_public_service_projection SET booking_requested=false,duration_minutes=NULL')
  await expect(pool.query('INSERT INTO salon_booking_rules(tenant_id,profile_id) VALUES($1,$2)',[a,pa])).rejects.toThrow(/not-null/i)
  await rules('salon_booking_rules',a,pa)
  for (const [field,value] of [['slot_step_minutes',0],['minimum_notice_minutes',-1],['horizon_days',0],['buffer_before_minutes',-1],['buffer_after_minutes',1441],['cancellation_notice_minutes',-1],['revision',0]] as const) {
    await expect(pool.query(`UPDATE salon_booking_rules SET ${field}=$1`,[value])).rejects.toThrow(/check/i)
  }
})
it('lecteur public ne lit que les projections, sans données ERP privées et sans droit d’écriture',async () => {
  const id=await draft(a,pa); await publish(a,pa,id); await rules('salon_public_booking_rules',a,pa)
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(1)
  expect((await reader(db => db.query('SELECT * FROM salon_public_booking_rules'))).rows).toHaveLength(1)
  for (const table of ['salon_public_services','salon_booking_rules','services_catalog','revenues','employees']) await expect(reader(db => db.query(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/i)
  for (const table of ['salon_public_service_projection','salon_public_booking_rules']) await expect(withTenantClient(pool,a,db => db.query(`DELETE FROM ${table}`))).rejects.toThrow(/permission denied/i)
  const rls=await pool.query<{ relforcerowsecurity: boolean }>('SELECT relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])',[tables])
  expect(rls.rows).toHaveLength(4); expect(rls.rows.every(row => row.relforcerowsecurity)).toBe(true)
})
it('modification/désactivation source retire l’offre ; réactivation ne republie jamais',async () => {
  const id=await draft(a,pa); await publish(a,pa,id)
  await withTenantClient(pool,a,db => db.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{description}','\"Changement privé\"') WHERE id='catalogue-service'"))
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(0)
  // Stamp deliberately unchanged: false must not be recomputed to true by the derive trigger.
  expect((await pool.query<{ source_available: boolean }>('SELECT source_available FROM salon_public_service_projection')).rows[0].source_available).toBe(false)
  await withTenantClient(pool,a,db => db.query("UPDATE services_catalog SET is_active=false WHERE id='catalogue-service'"))
  await pool.query('UPDATE salon_public_service_projection SET source_available=true')
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(0)
  await withTenantClient(pool,a,db => db.query("UPDATE services_catalog SET is_active=true WHERE id='catalogue-service'"))
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(0)
})
it('suppression source par le runtime conserve les purges et retire les offres publiques du seul tenant',async () => {
  const ia=await draft(a,pa); const ib=await draft(b,pb)
  await publish(a,pa,ia); await publish(b,pb,ib)
  await withTenantClient(pool,a,db => db.query("DELETE FROM services_catalog WHERE id='catalogue-service'"))
  expect((await pool.query('SELECT * FROM salon_public_services WHERE tenant_id=$1',[a])).rows).toHaveLength(0)
  const rows=(await reader(db => db.query<{ tenant_id: string }>('SELECT tenant_id FROM salon_public_service_projection'))).rows
  expect(rows).toEqual([{tenant_id:b}])
})
it('gate fermé masque catalogue et règles ; brouillon édité ne réécrit pas le publié',async () => {
  const id=await draft(a,pa); await publish(a,pa,id); await rules('salon_public_booking_rules',a,pa)
  await withTenantClient(pool,a,db => db.query("UPDATE salon_public_services SET display_name='Brouillon confidentiel'"))
  expect((await reader(db => db.query<{ display_name: string }>('SELECT display_name FROM salon_public_service_projection'))).rows[0].display_name).toBe('Prestation publiée')
  await pool.query('UPDATE salon_public_visibility SET published=false WHERE tenant_id=$1',[a])
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(0)
  expect((await reader(db => db.query('SELECT * FROM salon_public_booking_rules'))).rows).toHaveLength(0)
})
it('grants navigateur et defaults EXECUTE révoqués',async () => {
  for (const role of ['anon','authenticated']) {
    for (const table of tables) expect((await pool.query<{ allowed: boolean }>("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[role,table])).rows[0].allowed).toBe(false)
    for (const fn of ['validate_public_service_variant()','derive_public_service_availability()','invalidate_public_service_source()']) {
      expect((await pool.query<{ allowed: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[role,fn])).rows[0].allowed).toBe(false)
    }
  }
})

it('refuse visibilité pour stamp périmé, variante disparue ou payload source inactif',async () => {
  const id=await draft(a,pa,'catalogue-service','variant-a'); await publish(a,pa,id,'variant-a')
  await pool.query("UPDATE salon_public_service_projection SET source_updated_at='stale',source_available=true")
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(0)
  await pool.query('UPDATE salon_public_service_projection SET source_updated_at=$1,source_available=true',[stamp])
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(1)
  await pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{variants}','[]') WHERE tenant_id=$1",[a])
  await pool.query('UPDATE salon_public_service_projection SET source_available=true')
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(0)
  await pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{isActive}','false') WHERE tenant_id=$1",[a])
  await pool.query('UPDATE salon_public_service_projection SET source_variant_id=NULL,source_available=true')
  expect((await reader(db => db.query('SELECT * FROM salon_public_service_projection'))).rows).toHaveLength(0)
})
it('upgrade 010 et 008 préserve catalogue privé, bookings et réglages existants',async () => {
  const legacy=createPostgresTestPool().pool
  await runMigrations(legacy,{includeScheduling:true,includeBooking:true})
  const tenant=await defaultTenantId(legacy)
  await legacy.query("INSERT INTO services_catalog(tenant_id,id,name,category_code,reference_price,is_active,updated_at,payload_json) VALUES($1,'existing-source','Prestation existante','service',1000,true,$2,'{}')",[tenant,stamp])
  const before=(await legacy.query('SELECT * FROM services_catalog')).rows
  await runMigrations(legacy,{includePublicCatalog:true})
  expect((await legacy.query('SELECT * FROM services_catalog')).rows).toEqual(before)
  expect((await legacy.query('SELECT * FROM bookings')).rows).toEqual([])
  expect((await legacy.query('SELECT * FROM salon_public_services')).rows).toEqual([])
  expect((await legacy.query('SELECT * FROM salon_opening_hours')).rows).toEqual([])
})
it('échec SQL 011 annule tables/triggers/registre sans retirer 009/010',async () => {
  const isolated=createPostgresTestPool().pool
  await runMigrations(isolated,{includeScheduling:true})
  const broken: SqlPoolLike={...isolated,connect:async () => {
    const db=await isolated.connect()
    return {...db,query:<R>(text: string, values?: unknown[]) => db.query<R>(text===PUBLIC_CATALOG_SQL ? text+'\nSELECT absent_catalogue_function();' : text,values)}
  }}
  await expect(runMigrations(broken,{includePublicCatalog:true})).rejects.toThrow(/absent_catalogue_function/)
  expect((await isolated.query("SELECT to_regclass('salon_public_services') AS name")).rows[0].name).toBeNull()
  expect((await isolated.query("SELECT to_regclass('salon_opening_hours') AS name")).rows[0].name).not.toBeNull()
  expect((await isolated.query("SELECT id FROM schema_migrations WHERE id='011_public_catalog'")).rows).toEqual([])
  expect((await isolated.query("SELECT proname FROM pg_proc WHERE proname='derive_public_service_availability'")).rows).toEqual([])
})
