import { issueSession } from '../../server/sessions'
import { describe, expect, it } from 'vitest'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'
import { TENANT_BUSINESS_TABLES } from '../../server/tenancySchema'
import { NEON_SCHEMA_SQL } from '../../server/neonSchema'
import { defaultTenantId, resolveSessionTenant, withTenantClient } from '../../server/tenantContext'
import { signAuthSessionToken } from '../../server/authEngine'
import { syncWithNeonDatabase } from '../../server/syncEngine'
import { apiTestClient } from './apiTestClient'
import { buildDefaultSalonInfo, buildDefaultSettings } from '../db/seed'
import type { SalonBackupPayload, PublicSalonUser } from '../domain/models'
import type { SqlPoolLike } from '../../server/neonClient'

function payload(amount: number): SalonBackupPayload {
  return {
    format: 'SALON_PRO_BACKUP_V1', exportedAt: new Date().toISOString(),
    salon: buildDefaultSalonInfo(), settings: buildDefaultSettings(), categories: [],
    services: [], employees: [], expenses: [], cashSessions: [], cashMovements: [], advances: [],
    bonuses: [], salaryPayments: [], products: [], stockMovements: [], budgets: [], correctionLogs: [],
    revenues: [{ id: 'shared-revenue-id', label: 'Prestation enregistrée', date: new Date().toISOString(), categoryCode: 'service', amount, paymentMethod: 'cash', sourceModule: 'revenue', isArchived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
  }
}

async function twoTenants() {
  const { pool } = createPostgresTestPool()
  await runMigrations(pool)
  const a = await defaultTenantId(pool)
  const result = await pool.query<{ id: string }>(`INSERT INTO tenants (org_id) SELECT org_id FROM tenants WHERE id = $1 RETURNING id`, [a])
  return { pool, a, b: result.rows[0].id }
}

async function register(pool: SqlPoolLike) {
  const result = await apiTestClient(pool, 'POST', '/api/auth/register', { fullName: 'Responsable Isolation', email: 'isolation@example.invalid', password: 'Password2026' })
  expect(result.status).toBe(201)
  return { user: result.body.user as PublicSalonUser, token: result.body.sessionToken as string }
}

describe('Isolation multi-tenant — PostgreSQL réel embarqué', () => {
  it('rattache les écritures héritées sans perte et crée une appartenance pour chaque identité', async () => {
    const { pool } = createPostgresTestPool()
    await pool.query(NEON_SCHEMA_SQL)
    const original = payload(1234).revenues[0]
    await pool.query(`INSERT INTO revenues (id, date, label, category_code, amount, payment_method, updated_at, payload_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [original.id, original.date, original.label, original.categoryCode, original.amount, original.paymentMethod, original.updatedAt, JSON.stringify(original)])
    const legacyUser = { id: 'legacy-user', fullName: 'Responsable Existant', email: 'legacy@example.invalid', role: 'manager', passwordHash: crypto.randomUUID(), isActive: true, createdAt: original.createdAt, updatedAt: original.updatedAt }
    await pool.query(`INSERT INTO salon_users (id, email, full_name, role, password_hash, created_at, updated_at, payload_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [legacyUser.id, legacyUser.email, legacyUser.fullName, legacyUser.role, legacyUser.passwordHash, legacyUser.createdAt, legacyUser.updatedAt, JSON.stringify(legacyUser)])
    await runMigrations(pool)
    const tenantId = await defaultTenantId(pool)
    const memberships = await pool.query<{ tenant_id: string; user_id: string; role: string }>('SELECT tenant_id, user_id, role FROM memberships')
    expect(memberships.rows).toEqual([{ tenant_id: tenantId, user_id: legacyUser.id, role: 'manager' }])
    expect((await pool.query<{ payload_json: unknown }>('SELECT payload_json FROM salon_users')).rows[0].payload_json).toEqual(legacyUser)
    const result = await withTenantClient(pool, tenantId, (client) => client.query<{ tenant_id: string; payload_json: unknown }>('SELECT tenant_id, payload_json FROM revenues'))
    expect(result.rows).toEqual([{ tenant_id: tenantId, payload_json: original }])
    const tables = await pool.query<{ relname: string; relforcerowsecurity: boolean }>(`SELECT relname, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[])`, [[...TENANT_BUSINESS_TABLES]])
    expect(tables.rows).toHaveLength(18)
    expect(tables.rows.every((row) => row.relforcerowsecurity)).toBe(true)
  })

  it('isole deux lignes de même identifiant, les pulls et les suppressions', async () => {
    const { pool, a, b } = await twoTenants()
    const initial = await syncWithNeonDatabase(pool, { payload: payload(1000) }, a)
    await syncWithNeonDatabase(pool, { payload: payload(9000) }, b)
    const read = (id: string) => withTenantClient(pool, id, (client) => client.query<{ payload_json: { amount: number } }>('SELECT payload_json FROM revenues'))
    expect((await read(a)).rows[0].payload_json.amount).toBe(1000)
    expect((await read(b)).rows[0].payload_json.amount).toBe(9000)
    await syncWithNeonDatabase(pool, { cursor: initial.cursor, payload: { ...payload(1000), revenues: [] }, tombstones: [{ entityType: 'revenue', entityId: 'shared-revenue-id', deletedAt: '2099-01-01T00:00:00.000Z' }] }, a)
    expect((await read(a)).rows).toHaveLength(0)
    expect((await read(b)).rows).toHaveLength(1)
    expect((await withTenantClient(pool, b, (client) => client.query('SELECT * FROM sync_tombstones'))).rows).toHaveLength(0)
  })

  it('impose un rôle sans BYPASSRLS, rejette les écritures inter-salons et ferme sans contexte', async () => {
    const { pool, a, b } = await twoTenants()
    await withTenantClient(pool, a, async (client) => {
      const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user')
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
    })
    await expect(withTenantClient(pool, a, (client) => client.query(`INSERT INTO categories (tenant_id, id, scope, code, label, updated_at, payload_json)
      VALUES ($1, 'forbidden', 'revenue', 'test', 'Test', $2, '{}'::jsonb)`, [b, new Date().toISOString()]))).rejects.toThrow(/row-level security/i)
    const client = await pool.connect()
    await client.query('BEGIN')
    try {
      await client.query("SELECT set_config('role', 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12), true)")
      const rows = await client.query('SELECT * FROM revenues')
      expect(rows.rows).toHaveLength(0)
    } finally { await client.query('ROLLBACK'); client.release() }
    const config = await pool.query<{ tid: string | null }>("SELECT NULLIF(current_setting('app.tenant_id', true), '') AS tid")
    expect(config.rows[0].tid).toBeNull()
  })

  it('ignore le salon du corps et refuse une session signée sans appartenance', async () => {
    const { pool, a, b } = await twoTenants()
    const { user, token } = await register(pool)
    const response = await apiTestClient(pool, 'POST', '/api/sync', { tenantId: b, tid: b, payload: payload(4500) }, token)
    expect(response.status).toBe(200)
    expect((await withTenantClient(pool, a, (client) => client.query('SELECT * FROM revenues'))).rows).toHaveLength(1)
    expect((await withTenantClient(pool, b, (client) => client.query('SELECT * FROM revenues'))).rows).toHaveLength(0)
    const unauthorizedToken = (await withTenantClient(pool, b, (client) => issueSession(client, { ...user, tenantId: b }))).sessionToken
    const denied = await apiTestClient(pool, 'GET', '/api/sync/pull', undefined, unauthorizedToken)
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('TENANT_ACCESS_DENIED')
  })

  it('refuse les jetons historiques sans session et un salon suspendu', async () => {
    const { pool, a } = await twoTenants()
    const { user, token } = await register(pool)
    const legacy = signAuthSessionToken({ id: user.id, email: user.email, role: user.role })
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, legacy)).status).toBe(401)
    await pool.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [a])
    expect((await apiTestClient(pool, 'GET', '/api/sync/pull', undefined, token)).status).toBe(403)
    await expect(resolveSessionTenant(pool, { uid: user.id, email: user.email, role: user.role, exp: Date.now() + 1000 })).rejects.toThrow('accès actif')
  })

  it('limite les changements de droits au salon et conserve une identité utilisable ailleurs', async () => {
    const { pool, a, b } = await twoTenants()
    const { user, token } = await register(pool)
    await pool.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)', [b, user.id, 'cashier'])
    const member = await apiTestClient(pool, 'POST', '/api/users', { fullName: 'Second Responsable', email: 'second-isolation@example.invalid', password: 'Password2026', role: 'manager' }, token)
    expect(member.status).toBe(201)
    // Le Gérant modifie sa propre appartenance dans B en utilisant une session de gestion distincte dans B.
    const other = member.body.user as PublicSalonUser
    await pool.query('INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, $3)', [b, other.id, 'manager'])
    const tokenB = (await withTenantClient(pool, b, (client) => issueSession(client, { ...other, tenantId: b }))).sessionToken
    const patch = await apiTestClient(pool, 'PATCH', `/api/users/${user.id}`, { isActive: false }, tokenB)
    expect(patch.status).toBe(200)
    expect((await apiTestClient(pool, 'GET', '/api/users', undefined, token)).status).toBe(200)
    const resolved = await resolveSessionTenant(pool, { uid: user.id, email: user.email, role: 'manager', tid: a, exp: Date.now() + 1000 })
    expect(resolved.role).toBe('manager')
  })
})
