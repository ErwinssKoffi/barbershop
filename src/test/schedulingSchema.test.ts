import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'
import { SCHEDULING_SQL } from '../../server/schedulingSchema'
import { defaultTenantId, withTenantClient } from '../../server/tenantContext'
import type { SqlClientLike, SqlPoolLike } from '../../server/neonClient'

let pool: SqlPoolLike
let a: string
let b: string
let pa: string
let pb: string
const tables = ['salon_opening_hours','schedule_exceptions','salon_public_schedules','salon_public_opening_hours','salon_public_schedule_exceptions']
async function reader<T>(work: (db: SqlClientLike) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('BEGIN READ ONLY')
    await db.query("SELECT set_config('role','salon_pro_public_' || substr(md5(current_schema()),1,12),true)")
    const result = await work(db)
    await db.query('COMMIT')
    return result
  } catch (error) { await db.query('ROLLBACK'); throw error }
  finally { db.release() }
}
async function snapshot(tenant: string, profile: string, slug: string) {
  await pool.query('INSERT INTO salon_public_visibility(tenant_id,profile_id) VALUES($1,$2)', [tenant,profile])
  await pool.query(`INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision)
    VALUES($1,$2,$3,'Identité de test','','Ville','',1)`, [tenant,profile,slug])
  await pool.query("INSERT INTO salon_public_schedules(tenant_id,profile_id,timezone,revision) VALUES($1,$2,'Africa/Abidjan',1)", [tenant,profile])
  await pool.query("INSERT INTO salon_public_opening_hours(tenant_id,profile_id,schedule_revision,iso_weekday,windows) VALUES($1,$2,1,1,'{[540,720),[780,1020)}')", [tenant,profile])
  await pool.query("INSERT INTO salon_public_schedule_exceptions(tenant_id,profile_id,schedule_revision,local_date,windows) VALUES($1,$2,1,'2026-11-09','{}')", [tenant,profile])
}
async function allow(tenant: string) {
  await pool.query("UPDATE salon_public_visibility SET published=true,allowed_from=now()-interval '1 day',allowed_until=now()+interval '1 day' WHERE tenant_id=$1", [tenant])
}
beforeEach(async () => {
  pool = createPostgresTestPool().pool
  await runMigrations(pool)
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
  await runMigrations(pool, { includeScheduling: true })
  a = await defaultTenantId(pool)
  b = (await pool.query<{ id: string }>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id', [a])).rows[0].id
  pa = (await pool.query<{ id: string }>('INSERT INTO salon_public_profiles(tenant_id) VALUES($1) RETURNING id', [a])).rows[0].id
  pb = (await pool.query<{ id: string }>('INSERT INTO salon_public_profiles(tenant_id) VALUES($1) RETURNING id', [b])).rows[0].id
})

it('010 implique 009, sans booking/finance ni seed, SQL exporté identique et migration idempotente', async () => {
  const ids = (await pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(row => row.id)
  expect(ids).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','009_marketplace_profiles','010_marketplace_scheduling'])
  expect((await pool.query("SELECT to_regclass('bookings') AS name")).rows[0].name).toBeNull()
  for (const table of tables) expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([])
  await runMigrations(pool, { includeScheduling: true })
  expect((await pool.query('SELECT id FROM schema_migrations')).rows).toHaveLength(7)
  expect(readFileSync('supabase/optional/010_marketplace_scheduling.sql','utf8')).toBe(SCHEDULING_SQL.trim()+'\n')
  expect(SCHEDULING_SQL).not.toMatch(/INSERT INTO (salon_|schedule_)/i)
})

it('isole horaires et exceptions en lecture, mise à jour et suppression entre salons', async () => {
  for (const [tenant,profile] of [[a,pa],[b,pb]]) {
    await withTenantClient(pool, tenant, db => db.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,'{[540,1020)}')", [tenant,profile]))
    await withTenantClient(pool, tenant, db => db.query("INSERT INTO schedule_exceptions(tenant_id,profile_id,local_date,windows,private_note) VALUES($1,$2,'2026-11-09','{}','Note privée')", [tenant,profile]))
  }
  expect((await withTenantClient(pool,a,db => db.query('SELECT * FROM salon_opening_hours'))).rows).toHaveLength(1)
  expect((await withTenantClient(pool,a,db => db.query('SELECT * FROM schedule_exceptions'))).rows).toHaveLength(1)
  expect((await withTenantClient(pool,a,db => db.query('UPDATE salon_opening_hours SET windows=$1 WHERE tenant_id=$2',['{}',b]))).rowCount).toBe(0)
  expect((await withTenantClient(pool,a,db => db.query('DELETE FROM schedule_exceptions WHERE tenant_id=$1',[b]))).rowCount).toBe(0)
  await expect(withTenantClient(pool,a,db => db.query('UPDATE schedule_exceptions SET tenant_id=$1',[b]))).rejects.toThrow()
  await withTenantClient(pool,a,db => db.query('DELETE FROM schedule_exceptions'))
  expect((await withTenantClient(pool,b,db => db.query('SELECT * FROM schedule_exceptions'))).rows).toHaveLength(1)
})

it('FK composites refusent les profils et révisions de publication inter-salons', async () => {
  await expect(withTenantClient(pool,a,db => db.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,'{}')",[a,pb]))).rejects.toThrow(/foreign key/i)
  await expect(withTenantClient(pool,a,db => db.query("INSERT INTO schedule_exceptions(tenant_id,profile_id,local_date,windows) VALUES($1,$2,'2026-11-09','{}')",[a,pb]))).rejects.toThrow(/foreign key/i)
  await snapshot(b,pb,'profil-b')
  await expect(pool.query("INSERT INTO salon_public_schedules(tenant_id,profile_id,timezone,revision) VALUES($1,$2,'UTC',1)",[a,pb])).rejects.toThrow(/foreign key/i)
  await expect(pool.query("INSERT INTO salon_public_opening_hours(tenant_id,profile_id,schedule_revision,iso_weekday,windows) VALUES($1,$2,1,1,'{}')",[a,pb])).rejects.toThrow(/foreign key/i)
  await expect(pool.query("INSERT INTO salon_public_schedule_exceptions(tenant_id,profile_id,schedule_revision,local_date,windows) VALUES($1,$2,2,'2026-11-10','{}')",[b,pb])).rejects.toThrow(/foreign key/i)
})

it('bornes du jour, semaine et dates sont contraintes sans extension PostgreSQL', async () => {
  for (const windows of ['{[-1,60)}','{[0,1441)}','{(,60)}','{[60,)}']) {
    await expect(pool.query('INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,$3::int4multirange)',[a,pa,windows])).rejects.toThrow(/check/i)
  }
  for (const day of [0,8]) {
    await expect(pool.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,$3,'{}')",[a,pa,day])).rejects.toThrow(/check/i)
  }
  for (const date of ['infinity','-infinity','2026-02-30']) {
    await expect(pool.query("INSERT INTO schedule_exceptions(tenant_id,profile_id,local_date,windows) VALUES($1,$2,$3::date,'{}')",[a,pa,date])).rejects.toThrow()
  }
  await pool.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,'{[0,1440)}')",[a,pa])
  await expect(pool.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,'{}')",[a,pa])).rejects.toThrow(/unique/i)
  await pool.query("INSERT INTO schedule_exceptions(tenant_id,profile_id,local_date,windows) VALUES($1,$2,'2026-11-09','{}')",[a,pa])
  await expect(pool.query("INSERT INTO schedule_exceptions(tenant_id,profile_id,local_date,windows) VALUES($1,$2,'2026-11-09','{}')",[a,pa])).rejects.toThrow(/unique/i)
})

it('multiranges stockés canoniques : pauses conservées, bornes adjacentes fusionnées', async () => {
  await pool.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,'{[780,1020),[600,720),[540,600)}')",[a,pa])
  expect((await pool.query<{ windows: string }>('SELECT windows::text FROM salon_opening_hours')).rows[0].windows).toBe('{[540,720),[780,1020)}')
})

it('cinq tables FORCE RLS, aucune écriture publiée ni lecture de brouillon par le lecteur', async () => {
  const states = await pool.query<{ relforcerowsecurity: boolean }>('SELECT relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])',[tables])
  expect(states.rows).toHaveLength(5)
  expect(states.rows.every(row => row.relforcerowsecurity)).toBe(true)
  for (const table of ['salon_opening_hours','schedule_exceptions']) {
    await expect(reader(db => db.query(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/i)
  }
  for (const table of ['salon_public_schedules','salon_public_opening_hours','salon_public_schedule_exceptions']) {
    await expect(withTenantClient(pool,a,db => db.query(`DELETE FROM ${table}`))).rejects.toThrow(/permission denied/i)
    expect((await pool.query<{ allowed: boolean }>("SELECT has_table_privilege('salon_pro_public_' || substr(md5(current_schema()),1,12),$1,'UPDATE') AS allowed",[table])).rows[0].allowed).toBe(false)
  }
  for (const browser of ['anon','authenticated']) {
    for (const table of tables) expect((await pool.query<{ allowed: boolean }>("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[browser,table])).rows[0].allowed).toBe(false)
    expect((await pool.query<{ allowed: boolean }>("SELECT has_function_privilege($1,'validate_public_schedule_timezone()','EXECUTE') AS allowed",[browser])).rows[0].allowed).toBe(false)
  }
})

it('horaires publiés invisibles sans gate, puis visibles entre tenants sans note privée', async () => {
  await snapshot(a,pa,'profil-a'); await snapshot(b,pb,'profil-b')
  expect((await reader(db => db.query('SELECT * FROM salon_public_opening_hours'))).rows).toHaveLength(0)
  await allow(a); await allow(b)
  expect((await reader(db => db.query('SELECT * FROM salon_public_schedules'))).rows).toHaveLength(2)
  expect((await reader(db => db.query('SELECT * FROM salon_public_opening_hours'))).rows).toHaveLength(2)
  const exceptions = (await reader(db => db.query('SELECT * FROM salon_public_schedule_exceptions'))).rows
  expect(exceptions).toHaveLength(2)
  expect(JSON.stringify(exceptions)).not.toMatch(/private_note|Note privée/)
})

it('édition privée ne modifie pas les horaires ni le fuseau publiés', async () => {
  await snapshot(a,pa,'profil-a'); await allow(a)
  await withTenantClient(pool,a,db => db.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,'{}')",[a,pa]))
  await pool.query("UPDATE tenants SET timezone='Europe/Paris' WHERE id=$1",[a])
  const schedule = (await reader(db => db.query<{ timezone: string }>('SELECT timezone FROM salon_public_schedules'))).rows[0]
  expect(schedule.timezone).toBe('Africa/Abidjan')
  expect((await reader(db => db.query<{ windows: string }>('SELECT windows::text FROM salon_public_opening_hours'))).rows[0].windows).toBe('{[540,720),[780,1020)}')
  await expect(pool.query("UPDATE salon_public_schedules SET timezone='Not/A-Timezone' WHERE tenant_id=$1",[a])).rejects.toThrow(/timezone/i)
  await expect(pool.query('UPDATE salon_public_schedules SET revision=2 WHERE tenant_id=$1',[a])).rejects.toThrow(/foreign key/i)
})

it('dépublication, expiration et suspension masquent aussi les enfants horaires', async () => {
  await snapshot(a,pa,'profil-a'); await allow(a)
  const visible = async () => {
    for (const table of ['salon_public_schedules','salon_public_opening_hours','salon_public_schedule_exceptions']) {
      expect((await reader(db => db.query(`SELECT * FROM ${table}`))).rows).toHaveLength(0)
    }
  }
  await pool.query('UPDATE salon_public_visibility SET published=false WHERE tenant_id=$1',[a]); await visible()
  await allow(a)
  await pool.query("UPDATE salon_public_visibility SET allowed_from=now()-interval '2 days',allowed_until=now()-interval '1 day' WHERE tenant_id=$1",[a]); await visible()
  await allow(a)
  await pool.query("UPDATE tenants SET status='suspended' WHERE id=$1",[a]); await visible()
})

it('sans contexte le runtime ne voit pas les horaires, et la transaction nettoie le rôle lecteur', async () => {
  await pool.query("INSERT INTO salon_opening_hours(tenant_id,profile_id,iso_weekday,windows) VALUES($1,$2,1,'{}')",[a,pa])
  const db = await pool.connect()
  await db.query('BEGIN')
  await db.query("SELECT set_config('role','salon_pro_runtime_' || substr(md5(current_schema()),1,12),true)")
  expect((await db.query('SELECT * FROM salon_opening_hours')).rows).toEqual([])
  await db.query('ROLLBACK'); db.release()
  await reader(conn => conn.query('SELECT * FROM salon_public_schedules'))
  expect((await pool.query<{ name: string }>('SELECT current_user AS name')).rows[0].name).not.toMatch(/^salon_pro_(public|runtime)_/)
})

it('migration depuis 009 préserve profils, droits et projection précédents', async () => {
  const legacy = createPostgresTestPool().pool
  await runMigrations(legacy,{includeMarketplace:true})
  const tenant = await defaultTenantId(legacy)
  await legacy.query("INSERT INTO salon_public_profiles(tenant_id,display_name,version) VALUES($1,'Identité existante de test',4)",[tenant])
  const profiles = (await legacy.query('SELECT * FROM salon_public_profiles')).rows
  const migrations = (await legacy.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')).rows
  await runMigrations(legacy,{includeScheduling:true})
  expect((await legacy.query('SELECT * FROM salon_public_profiles')).rows).toEqual(profiles)
  expect((await legacy.query('SELECT * FROM salon_opening_hours')).rows).toEqual([])
  expect((await legacy.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')).rows).toEqual([...migrations,{id:'010_marketplace_scheduling'}])
})

it('un échec SQL après création de 010 annule tables, triggers et registre sans retirer 009', async () => {
  const isolated = createPostgresTestPool().pool
  await runMigrations(isolated,{includeMarketplace:true})
  const broken: SqlPoolLike = { ...isolated, connect: async () => {
    const db = await isolated.connect()
    return { ...db,query: <R>(text: string, values?: unknown[]) => db.query<R>(text === SCHEDULING_SQL ? text+'\nSELECT absent_scheduling_function();' : text,values) }
  } }
  await expect(runMigrations(broken,{includeScheduling:true})).rejects.toThrow(/absent_scheduling_function/)
  expect((await isolated.query("SELECT to_regclass('salon_opening_hours') AS name")).rows[0].name).toBeNull()
  expect((await isolated.query("SELECT to_regclass('salon_public_profiles') AS name")).rows[0].name).not.toBeNull()
  expect((await isolated.query("SELECT id FROM schema_migrations WHERE id='010_marketplace_scheduling'")).rows).toEqual([])
  expect((await isolated.query("SELECT proname FROM pg_proc WHERE proname='validate_public_schedule_timezone'")).rows).toEqual([])
})
