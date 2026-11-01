import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'
import { MARKETPLACE_SQL } from '../../server/marketplaceSchema'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
import { defaultTenantId, withTenantClient } from '../../server/tenantContext'
import { publicSalonProfileDto } from '../domain/marketplace'
import type { SqlClientLike, SqlPoolLike } from '../../server/neonClient'

let pool: SqlPoolLike
let a: string
let b: string
let profileA: string
let profileB: string

async function reader<T>(work: (db: SqlClientLike) => Promise<T>): Promise<T> {
  const db = await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("SELECT set_config('role','salon_pro_public_' || substr(md5(current_schema()),1,12),true)")
    const result = await work(db)
    await db.query('COMMIT')
    return result
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally { db.release() }
}
async function projection(tenant: string, profile: string, slug: string) {
  await pool.query(`INSERT INTO salon_public_visibility(tenant_id,profile_id) VALUES($1,$2)`, [tenant, profile])
  await pool.query(`INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision)
    VALUES($1,$2,$3,'Identité publiée de recette','Description publique','Ville de recette','',1)`, [tenant, profile, slug])
}
async function allow(tenant: string) {
  await pool.query(`UPDATE salon_public_visibility SET published=true,allowed_from=now()-interval '1 day',allowed_until=now()+interval '1 day' WHERE tenant_id=$1`, [tenant])
}
beforeEach(async () => {
  pool = createPostgresTestPool().pool
  await runMigrations(pool)
  // Browser roles exist in Supabase; deliberately hostile defaults must be revoked by 009.
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
  await runMigrations(pool, { includeMarketplace: true })
  a = await defaultTenantId(pool)
  b = (await pool.query<{ id: string }>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id', [a])).rows[0].id
  for (const [tenant, id] of [[a, 'actor-a'], [b, 'actor-b']]) {
    await pool.query(`INSERT INTO salon_users(id,email,full_name,role,password_hash,created_at,updated_at,payload_json,tenant_id)
      VALUES($1,$2,'Acteur de test','manager','test-only-unused-hash','2026-11-01','2026-11-01','{}',$3)`, [id, `${id}@example.invalid`, tenant])
    await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')", [tenant, id])
  }
  profileA = (await withTenantClient(pool, a, db => db.query<{ id: string }>("INSERT INTO salon_public_profiles(tenant_id,display_name) VALUES($1,'Brouillon confidentiel A') RETURNING id", [a]))).rows[0].id
  profileB = (await withTenantClient(pool, b, db => db.query<{ id: string }>("INSERT INTO salon_public_profiles(tenant_id,display_name) VALUES($1,'Brouillon confidentiel B') RETURNING id", [b]))).rows[0].id
})

it('009 est opt-in, vide à la migration, sans 006/007/008, et réexécutable sans changer les données', async () => {
  const ids = (await pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(row => row.id)
  expect(ids).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','009_marketplace_profiles'])
  expect((await pool.query("SELECT to_regclass('bookings') AS name")).rows[0].name).toBeNull()
  expect((await pool.query('SELECT * FROM salon_public_projection')).rows).toEqual([])
  expect((await pool.query('SELECT * FROM salon_public_visibility')).rows).toEqual([])
  const before = (await pool.query('SELECT * FROM salon_public_profiles ORDER BY tenant_id')).rows
  await runMigrations(pool, { includeMarketplace: true })
  expect((await pool.query('SELECT * FROM salon_public_profiles ORDER BY tenant_id')).rows).toEqual(before)
  expect(readFileSync('supabase/optional/009_marketplace_profiles.sql', 'utf8')).toBe(MARKETPLACE_SQL.trim()+'\n')
  expect(MARKETPLACE_SQL).not.toMatch(/INSERT INTO salon_public_/i)
})

it('isole les brouillons en lecture et mutation, avec FORCE RLS et refus sans contexte', async () => {
  const rows = await withTenantClient(pool, a, db => db.query<{ id: string }>('SELECT id FROM salon_public_profiles'))
  expect(rows.rows).toEqual([{ id: profileA }])
  expect((await withTenantClient(pool, a, db => db.query('UPDATE salon_public_profiles SET display_name=$1 WHERE tenant_id=$2', ['forged', b]))).rowCount).toBe(0)
  await expect(withTenantClient(pool, a, db => db.query('UPDATE salon_public_profiles SET tenant_id=$1', [b]))).rejects.toThrow()
  await expect(withTenantClient(pool, a, db => db.query('INSERT INTO salon_public_profiles(tenant_id) VALUES($1)', [b]))).rejects.toThrow()
  const tables = await pool.query<{ relforcerowsecurity: boolean }>("SELECT relforcerowsecurity FROM pg_class WHERE relname LIKE 'salon_public_%' AND relkind='r'")
  expect(tables.rows).toHaveLength(4)
  expect(tables.rows.every(row => row.relforcerowsecurity)).toBe(true)
  const db = await pool.connect()
  await db.query('BEGIN')
  await db.query("SELECT set_config('role','salon_pro_runtime_' || substr(md5(current_schema()),1,12),true)")
  expect((await db.query('SELECT * FROM salon_public_profiles')).rows).toEqual([])
  await db.query('ROLLBACK'); db.release()
})

it('un brouillon ou une projection sans gate actif ne devient pas public', async () => {
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toEqual([])
  await projection(a, profileA, 'profil-a')
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toEqual([])
  // Published without an explicit time-bounded authorization is still invisible.
  await pool.query('UPDATE salon_public_visibility SET published=true WHERE tenant_id=$1', [a])
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toEqual([])
})

it('résout les slugs visibles entre tenants sans exposer les brouillons ni les données privées', async () => {
  await projection(a, profileA, 'profil-a'); await projection(b, profileB, 'profil-b')
  await allow(a); await allow(b)
  const rows = await reader(db => db.query<{ slug: string }>('SELECT slug FROM salon_public_projection ORDER BY slug'))
  expect(rows.rows).toEqual([{ slug: 'profil-a' }, { slug: 'profil-b' }])
  for (const table of ['salon_public_profiles','salon_public_profile_events','salon_users','employees','revenues','memberships','tenants']) {
    await expect(reader(db => db.query(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/i)
  }
  await expect(reader(db => db.query("UPDATE salon_public_projection SET display_name='forged'"))).rejects.toThrow(/permission denied/i)
  await expect(reader(db => db.query("INSERT INTO salon_public_profiles(tenant_id) VALUES($1)", [a]))).rejects.toThrow(/permission denied/i)
})

it('le runtime privé ne peut pas publier ni modifier le gate ou la projection', async () => {
  await projection(a, profileA, 'profil-a')
  await expect(withTenantClient(pool, a, db => db.query('UPDATE salon_public_visibility SET published=true'))).rejects.toThrow(/permission denied/i)
  await expect(withTenantClient(pool, a, db => db.query("UPDATE salon_public_projection SET display_name='forged'"))).rejects.toThrow(/permission denied/i)
  await expect(withTenantClient(pool, a, db => db.query('DELETE FROM salon_public_profiles'))).rejects.toThrow(/permission denied/i)
})

it('une modification du brouillon ne change pas la révision publiée', async () => {
  await projection(a, profileA, 'profil-a'); await allow(a)
  await withTenantClient(pool, a, db => db.query("UPDATE salon_public_profiles SET display_name='Nouveau brouillon secret',version=2"))
  const row = (await reader(db => db.query<{ display_name: string; revision: number }>('SELECT display_name,revision FROM salon_public_projection'))).rows[0]
  expect(row).toEqual({ display_name: 'Identité publiée de recette', revision: 1 })
})

it('ferme immédiatement à dépublication et expiration, sans worker', async () => {
  await projection(a, profileA, 'profil-a'); await allow(a)
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toHaveLength(1)
  await pool.query('UPDATE salon_public_visibility SET published=false WHERE tenant_id=$1', [a])
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toHaveLength(0)
  await pool.query("UPDATE salon_public_visibility SET published=true,allowed_from=now()-interval '2 days',allowed_until=now()-interval '1 day' WHERE tenant_id=$1", [a])
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toHaveLength(0)
  await pool.query("UPDATE salon_public_visibility SET allowed_from=now()+interval '1 day',allowed_until=now()+interval '2 days' WHERE tenant_id=$1", [a])
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toHaveLength(0)
})

it('suspension tenant ferme atomiquement le gate, et réactivation ne republie pas', async () => {
  await projection(a, profileA, 'profil-a'); await allow(a)
  await pool.query("UPDATE tenants SET status='suspended' WHERE id=$1", [a])
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toHaveLength(0)
  await pool.query('UPDATE salon_public_visibility SET tenant_active=true,published=true WHERE tenant_id=$1', [a])
  expect((await pool.query<{ tenant_active: boolean }>('SELECT tenant_active FROM salon_public_visibility WHERE tenant_id=$1', [a])).rows[0].tenant_active).toBe(false)
  await pool.query("UPDATE tenants SET status='active' WHERE id=$1", [a])
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toHaveLength(0)
  await allow(a)
  expect((await reader(db => db.query('SELECT * FROM salon_public_projection'))).rows).toHaveLength(1)
})

it('rejette les FK inter-salons pour gate, projection et acteur d’audit', async () => {
  await expect(pool.query('INSERT INTO salon_public_visibility(tenant_id,profile_id) VALUES($1,$2)', [a, profileB])).rejects.toThrow(/foreign key/i)
  await projection(b, profileB, 'profil-b')
  await expect(pool.query("INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision) VALUES($1,$2,'forged','Nom','','Ville','',1)", [a, profileB])).rejects.toThrow(/foreign key/i)
  await expect(withTenantClient(pool, a, db => db.query("INSERT INTO salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version) VALUES($1,$2,'actor-b','draft_saved',1)", [a, profileA]))).rejects.toThrow(/foreign key/i)
})

it('impose cardinalité, slug global et contraintes de version/période', async () => {
  await expect(pool.query('INSERT INTO salon_public_profiles(tenant_id) VALUES($1)', [a])).rejects.toThrow(/unique/i)
  await projection(a, profileA, 'profil-a'); await projection(b, profileB, 'profil-b')
  await expect(pool.query("UPDATE salon_public_projection SET slug='profil-a' WHERE tenant_id=$1", [b])).rejects.toThrow(/unique/i)
  await expect(pool.query("UPDATE salon_public_projection SET slug='../Private' WHERE tenant_id=$1", [a])).rejects.toThrow(/check/i)
  await expect(pool.query('UPDATE salon_public_profiles SET version=0 WHERE tenant_id=$1', [a])).rejects.toThrow(/check/i)
  await expect(pool.query("UPDATE salon_public_visibility SET allowed_from=now(),allowed_until=now() WHERE tenant_id=$1", [a])).rejects.toThrow(/check/i)
})

it('audit tenant-scoped append-only, y compris contre mutation privilégiée', async () => {
  await withTenantClient(pool, a, db => db.query("INSERT INTO salon_public_profile_events(tenant_id,profile_id,actor_id,event_type,profile_version) VALUES($1,$2,'actor-a','draft_saved',1)", [a, profileA]))
  expect((await withTenantClient(pool, b, db => db.query('SELECT * FROM salon_public_profile_events'))).rows).toEqual([])
  await expect(withTenantClient(pool, a, db => db.query("UPDATE salon_public_profile_events SET event_type='published'"))).rejects.toThrow()
  await expect(pool.query('DELETE FROM salon_public_profile_events')).rejects.toThrow(/immutable/i)
})

it('rôles navigateur révoqués et lecteur sans privilèges dangereux ni rôle hérité', async () => {
  const role = (await pool.query<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean; rolinherit: boolean }>("SELECT rolcanlogin,rolbypassrls,rolsuper,rolinherit FROM pg_roles WHERE rolname='salon_pro_public_' || substr(md5(current_schema()),1,12)")).rows[0]
  expect(role).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false, rolinherit: false })
  for (const browser of ['anon','authenticated']) {
    for (const fn of ['derive_public_tenant_activity()','close_public_visibility_on_suspension()','protect_public_profile_event()']) {
      expect((await pool.query<{ allowed: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [browser, fn])).rows[0].allowed).toBe(false)
    }
    for (const table of ['salon_public_profiles','salon_public_visibility','salon_public_projection','salon_public_profile_events']) {
      expect((await pool.query<{ allowed: boolean }>('SELECT has_table_privilege($1,$2,\'SELECT\') AS allowed', [browser, table])).rows[0].allowed).toBe(false)
    }
  }
  const reset = (await pool.query<{ role: string; tenant: string | null }>("SELECT current_user AS role,NULLIF(current_setting('app.tenant_id',true),'') AS tenant")).rows[0]
  expect(reset.role).not.toMatch(/^salon_pro_(public|runtime)_/)
  expect(reset.tenant).toBeNull()
})

it('DTO allowlist élimine identités internes, secrets et champs supplémentaires', () => {
  const row = { slug: 'profil-a', display_name: 'Nom public', description: '', city: 'Ville', commune: '', public_phone: null, revision: 1, tenant_id: a, profile_id: profileA, password_hash: 'not-public', salary: 123, payload_json: { private: true } }
  expect(publicSalonProfileDto(row)).toEqual({ slug: 'profil-a', displayName: 'Nom public', description: '', location: { city: 'Ville', commune: '' }, publicPhone: null, revision: 1 })
})

it('CLI exige opt-in et approbation backup/restore explicite pour 009', () => {
  expect(marketplaceMigrationOptions([], 'true')).toEqual({ includeMarketplace: false })
  for (const approval of [undefined, '', 'false', 'TRUE']) {
    expect(() => marketplaceMigrationOptions(['--include-marketplace'], approval)).toThrow(/backup\/restore/i)
  }
  expect(marketplaceMigrationOptions(['--include-marketplace'], 'true')).toEqual({ includeMarketplace: true })
})

it('migration depuis 001–008 préserve les réservations et identités existantes', async () => {
  const legacy = createPostgresTestPool().pool
  await runMigrations(legacy, { includeCheckout: true, includeRefunds: true, includeBooking: true })
  const tenant = await defaultTenantId(legacy)
  await legacy.query(`INSERT INTO salon_users(id,email,full_name,role,password_hash,created_at,updated_at,payload_json,tenant_id)
    VALUES('legacy-author','legacy-author@example.invalid','Auteur existant de test','manager',$1,'2026-11-01','2026-11-01','{}',$2)`, [crypto.randomUUID(), tenant])
  await legacy.query(`INSERT INTO bookings(tenant_id,id,employee_id,start_at,end_at,status,request_key,request_hash,created_by,payload_json)
    VALUES($1,'legacy-booking','legacy-resource','2026-11-05T10:00:00Z','2026-11-05T10:30:00Z','planned','legacy-request-key','legacy-request-hash','legacy-author','{"legacy":true}')`, [tenant])
  const bookings = (await legacy.query('SELECT * FROM bookings')).rows
  const users = (await legacy.query('SELECT * FROM salon_users')).rows
  await runMigrations(legacy, { includeMarketplace: true })
  expect((await legacy.query('SELECT * FROM bookings')).rows).toEqual(bookings)
  expect((await legacy.query('SELECT * FROM salon_users')).rows).toEqual(users)
  expect((await legacy.query('SELECT * FROM salon_public_profiles')).rows).toEqual([])
})

it('refuse un rôle lecteur préexistant dangereux et annule toute la migration 009', async () => {
  const isolated = createPostgresTestPool().pool
  await runMigrations(isolated)
  await isolated.query(`DO $test$ BEGIN
    EXECUTE format('CREATE ROLE %I NOLOGIN BYPASSRLS','salon_pro_public_' || substr(md5(current_schema()),1,12));
  END $test$`)
  await expect(runMigrations(isolated, { includeMarketplace: true })).rejects.toThrow(/Unsafe public reader role/)
  expect((await isolated.query("SELECT to_regclass('salon_public_profiles') AS name")).rows[0].name).toBeNull()
  expect((await isolated.query("SELECT id FROM schema_migrations WHERE id='009_marketplace_profiles'")).rows).toEqual([])
})

it('refuse aussi un rôle préexistant à attributs sûrs mais avec grants privés', async () => {
  const isolated = createPostgresTestPool().pool
  await runMigrations(isolated)
  await isolated.query(`DO $test$ DECLARE r TEXT := 'salon_pro_public_' || substr(md5(current_schema()),1,12); BEGIN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT',r);
    EXECUTE format('GRANT SELECT ON salon_users TO %I',r);
  END $test$`)
  await expect(runMigrations(isolated, { includeMarketplace: true })).rejects.toThrow(/already exists/)
  expect((await isolated.query("SELECT to_regclass('salon_public_profiles') AS name")).rows[0].name).toBeNull()
})
