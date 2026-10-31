import { describe, expect, it } from 'vitest'
import { createPostgresTestPool } from './postgresTestPool'
import { ensureNeonSchema, syncWithNeonDatabase } from '../../server/syncEngine'
import { defaultTenantId, withTenantClient } from '../../server/tenantContext'
import { readSyncDelta } from '../../server/syncProtocol'
import { apiTestClient } from './apiTestClient'
import { buildDefaultSalonInfo, buildDefaultSettings } from '../db/seed'
import type { SalonBackupPayload } from '../domain/models'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'

function snapshot(): SalonBackupPayload {
 const time = new Date().toISOString()
 return { format: 'SALON_PRO_BACKUP_V1', exportedAt: time, salon: buildDefaultSalonInfo(), settings: buildDefaultSettings(), categories: [], services: [], employees: [], revenues: [{ id: 'revenue-shared', label: 'Prestation', categoryCode: 'service', amount: 1000, date: time, createdAt: time, updatedAt: time, paymentMethod: 'cash', sourceModule: 'revenue', isArchived: false }], expenses: [], cashSessions: [], cashMovements: [], advances: [], bonuses: [], salaryPayments: [], products: [], stockMovements: [], budgets: [], correctionLogs: [] }
}
async function setup() {
 const { pool } = createPostgresTestPool(); await ensureNeonSchema(pool)
 return { pool, tenant: await defaultTenantId(pool) }
}

describe('Delta serveur-autoritaire et RBAC — PostgreSQL', () => {
 it('ne crée aucune révision pour un renvoi identique et ignore les horloges futures', async () => {
  const { pool, tenant } = await setup(); const payload = snapshot()
  const first = await syncWithNeonDatabase(pool, { payload }, tenant)
  const same = await syncWithNeonDatabase(pool, { payload, cursor: first.cursor }, tenant)
  expect(same.cursor).toBe(first.cursor); expect(same.stats.pushedRecords).toBe(0)
  const next = structuredClone(payload); next.revenues[0].amount = 2500; next.revenues[0].updatedAt = '2099-01-01T00:00:00.000Z'
  const update = await syncWithNeonDatabase(pool, { payload: next, cursor: same.cursor }, tenant)
  const rows = update.changes.revenues as { amount: number; updatedAt: string }[]
  expect(rows[0].amount).toBe(2500); expect(rows[0].updatedAt).not.toContain('2099')
  const final = structuredClone(next); final.revenues[0].amount = 3000; final.revenues[0].updatedAt = '2000-01-01T00:00:00.000Z'
  const accepted = await syncWithNeonDatabase(pool, { payload: final, cursor: update.cursor }, tenant)
  expect((accepted.changes.revenues as { amount: number }[])[0].amount).toBe(3000)
 })

 it('refuse un écrasement aveugle ou obsolète et renvoie la version autoritaire', async () => {
  const { pool, tenant } = await setup(); const payload = snapshot()
  const initial = await syncWithNeonDatabase(pool, { payload }, tenant)
  const newer = structuredClone(payload); newer.revenues[0].amount = 2000
  await syncWithNeonDatabase(pool, { payload: newer, cursor: initial.cursor }, tenant)
  const stale = structuredClone(payload); stale.revenues[0].amount = 9000
  const result = await syncWithNeonDatabase(pool, { payload: stale, cursor: initial.cursor }, tenant)
  expect(result.rejected).toContainEqual({ table: 'revenues', id: 'revenue-shared', code: 'STALE_REVISION' })
  expect((result.changes.revenues as { amount: number }[]).at(-1)?.amount).toBe(2000)
  const blind = await syncWithNeonDatabase(pool, { payload: stale }, tenant)
  expect(blind.rejected.some((r) => r.code === 'BASE_CURSOR_REQUIRED')).toBe(true)
 })

 it('propage les suppressions, refuse la résurrection et cloisonne le journal', async () => {
  const { pool, tenant } = await setup(); const payload = snapshot()
  const initial = await syncWithNeonDatabase(pool, { payload }, tenant)
  const removed = await syncWithNeonDatabase(pool, { payload: { ...payload, revenues: [] }, cursor: initial.cursor, tombstones: [{ entityType: 'revenue', entityId: 'revenue-shared', deletedAt: '2099-01-01T00:00:00.000Z' }] }, tenant)
  expect(removed.deleted).toContainEqual({ table: 'revenues', id: 'revenue-shared' })
  const replay = await syncWithNeonDatabase(pool, { payload, cursor: removed.cursor }, tenant)
  expect(replay.rejected.some((r) => r.code === 'RECORD_DELETED')).toBe(true)
  const other = await pool.query<{ id: string }>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id', [tenant])
  const delta = await withTenantClient(pool, other.rows[0].id, (client) => readSyncDelta(client, 0))
  expect(delta.changes).toEqual({}); expect(delta.deleted).toEqual([])
 })

 it('pagine sans sauter de révisions et valide les curseurs', async () => {
  const { pool, tenant } = await setup(); const payload = snapshot()
  const initial = await syncWithNeonDatabase(pool, { payload }, tenant)
  let cursor = 0; const seen: string[] = []
  for (let i = 0; i < 10; i++) {
   const page = await withTenantClient(pool, tenant, (client) => readSyncDelta(client, cursor, undefined, 1))
   seen.push(...Object.keys(page.changes)); expect(page.cursor).toBeGreaterThan(cursor)
   cursor = page.cursor; if (!page.hasMore) break
  }
  expect(cursor).toBe(initial.cursor); expect(seen).toContain('revenues')
  await expect(withTenantClient(pool, tenant, (client) => readSyncDelta(client, cursor + 1))).rejects.toThrow('curseur')
 })

 it('applique les droits serveur aux écritures, suppressions et lectures du Caissier', async () => {
  const { pool, tenant } = await setup()
  const manager = await apiTestClient(pool, 'POST', '/api/auth/register', { fullName: 'Responsable Droits', email: 'manager@example.invalid', password: 'Password2026' })
  const token = manager.body.sessionToken as string
  const payload = snapshot()
  payload.employees = [{ id: 'employee-private', fullName: 'Employé', roleTitle: 'Coiffeur', firstName: 'Employé', lastName: '', phone: '', hireDate: '2026-10-01', remunerationType: 'fixed', defaultBonus: 0, commissionEnabled: false, commissionBasis: 'employee_services', commissionRate: 0, adminNote: 'private-admin-note', baseSalary: 987654, isActive: true, createdAt: payload.exportedAt, updatedAt: payload.exportedAt }]
  payload.settings.lastBackupExportedAt = '2088-01-01T00:00:00.000Z'
  const initial = await syncWithNeonDatabase(pool, { payload }, tenant)
  expect((await apiTestClient(pool, 'POST', '/api/users', { fullName: 'Compte Caisse', email: 'cashier@example.invalid', password: 'Password2026', role: 'cashier' }, token)).status).toBe(201)
  const login = await apiTestClient(pool, 'POST', '/api/auth/login', { email: 'cashier@example.invalid', password: 'Password2026' })
  const cashier = login.body.sessionToken as string
  const forged = structuredClone(payload); forged.settings.theme = 'dark'; forged.employees[0].baseSalary = 1
  forged.expenses = [{ id: 'forged-payroll-expense', date: payload.exportedAt, label: 'Paiement', categoryCode: 'salaries', amount: 1, paymentMethod: 'cash', sourceModule: 'payroll', isStockPurchase: false, isArchived: false, createdAt: payload.exportedAt, updatedAt: payload.exportedAt }]
  const response = await apiTestClient(pool, 'POST', '/api/sync', { payload: forged, cursor: initial.cursor, tombstones: [{ entityType: 'revenue', entityId: 'revenue-shared', deletedAt: payload.exportedAt }] }, cashier)
  expect(response.status).toBe(200)
  expect(response.body.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'employees', code: 'WRITE_FORBIDDEN_FOR_ROLE' }), expect.objectContaining({ code: 'DELETE_FORBIDDEN_FOR_ROLE' })]))
  expect(JSON.stringify(response.body)).not.toContain('987654')
  expect(JSON.stringify(response.body)).not.toContain('private-admin-note')
  expect(JSON.stringify(response.body)).not.toContain('2088-01-01')
  expect(response.body.rejected).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'forged-payroll-expense', code: 'WRITE_FORBIDDEN_FOR_ROLE' })]))
  const directory = await apiTestClient(pool, 'GET', '/api/sync/pull?since=0&limit=500', undefined, cashier)
  expect(JSON.stringify(directory.body)).toContain('employee-private')
  expect(JSON.stringify(directory.body)).not.toContain('baseSalary')
  expect(JSON.stringify(directory.body)).not.toContain('private-admin-note')
  expect(JSON.stringify(directory.body)).not.toContain('2088-01-01')
  const pull = await apiTestClient(pool, 'GET', '/api/sync/pull?since=0&limit=1', undefined, cashier)
  expect(pull.status).toBe(200)
  const full = await apiTestClient(pool, 'GET', '/api/sync/pull', undefined, cashier)
  expect(JSON.stringify(full.body)).not.toContain('987654')
  expect(full.body.payload).toHaveProperty('employees'); expect(full.body.payload).toHaveProperty('settings')
  expect(JSON.stringify(full.body)).not.toContain('baseSalary')
  expect(JSON.stringify(full.body)).not.toContain('adminNote')
  expect((await apiTestClient(pool, 'GET', '/api/sync/pull?since=NaN', undefined, cashier)).status).toBe(400)
 })
})

describe('Delta IndexedDB', () => {
 it('envoie seulement les modifications, fusionne les tables présentes et conserve une saisie faite pendant le push', async () => {
  const db = new SalonProDatabase(`delta-local-${crypto.randomUUID()}`); const repo = new SalonRepositoryHub(db)
  try {
   await repo.ensureInitialized()
   const first = await repo.buildCloudSyncEnvelope()
   await repo.mergeCloudDelta({ cursor: 1, hasMore: false, payload: first.payload }, first.payload)
   const empty = await repo.buildCloudDeltaEnvelope()
   expect(empty.payload.revenues).toEqual([]); expect(empty.payload.categories).toEqual([]); expect(empty.payload.salon).toBeUndefined()
   await repo.addRevenue({ date: new Date().toISOString(), label: 'Recette locale', categoryCode: 'service', amount: 1000, paymentMethod: 'cash' })
   const sent = await repo.buildCloudDeltaEnvelope(); expect(sent.payload.revenues).toHaveLength(1)
   const row = sent.payload.revenues[0]
   await db.revenues.update(row.id, { amount: 1500 })
   await repo.mergeCloudDelta({ cursor: 2, hasMore: false, changes: { revenues: [{ ...row, updatedAt: new Date().toISOString() }] } }, sent.payload)
   expect((await db.revenues.get(row.id))?.amount).toBe(1500)
   expect((await repo.buildCloudDeltaEnvelope()).payload.revenues).toHaveLength(1)
   expect(await db.categories.count()).toBeGreaterThan(0)
  } finally { await db.delete() }
 })

 it('archive durablement une version locale conflictuelle avant application du serveur', async () => {
  const name = `delta-conflict-${crypto.randomUUID()}`; let db = new SalonProDatabase(name); let repo = new SalonRepositoryHub(db)
  try {
   await repo.ensureInitialized()
   const local = snapshot().revenues[0]; await db.revenues.put(local)
   await repo.mergeCloudDelta({ cursor: 1, hasMore: false, changes: { revenues: [local] } }, { revenues: [local] })
   await db.revenues.update(local.id, { amount: 9000 })
   const result = await repo.mergeCloudDelta({ cursor: 2, hasMore: false, changes: { revenues: [{ ...local, amount: 2000 }] } })
   expect(result.conflicts).toBe(1); expect((await db.revenues.get(local.id))?.amount).toBe(2000)
   db.close(); db = new SalonProDatabase(name); repo = new SalonRepositoryHub(db)
   expect(await repo.exportCloudConflicts()).toContain('9000')
   expect(await repo.cloudSyncCursor()).toBe(2)
   await expect(repo.mergeCloudDelta({ cursor: 1, hasMore: false })).rejects.toThrow('périmée')
  } finally { await db.delete() }
 })
 it('persiste les suppressions distantes et archive une suppression locale devenue obsolète', async () => {
  const db = new SalonProDatabase(`delta-delete-${crypto.randomUUID()}`); const repo = new SalonRepositoryHub(db)
  try {
   await repo.ensureInitialized()
   const row = snapshot().revenues[0]
   await repo.mergeCloudDelta({ cursor: 1, hasMore: false, changes: { revenues: [row] } })
   await db.revenues.delete(row.id)
   await db.syncTombstones.put({ id: `revenue:${row.id}`, entityType: 'revenue', entityId: row.id, deletedAt: new Date().toISOString() })
   const conflict = await repo.mergeCloudDelta({ cursor: 2, hasMore: false, changes: { revenues: [{ ...row, amount: 2200 }] } })
   expect(conflict.conflicts).toBe(1)
   expect(await db.syncTombstones.get(`revenue:${row.id}`)).toBeUndefined()
   expect((await repo.buildCloudDeltaEnvelope()).tombstones).toEqual([])
   expect(await repo.exportCloudConflicts()).toContain('LOCAL_DELETE_REMOTE_CHANGED')
   await repo.mergeCloudDelta({ cursor: 3, hasMore: false, deleted: [{ table: 'revenues', id: row.id }] })
   expect(await db.revenues.get(row.id)).toBeUndefined()
   expect(await db.syncTombstones.get(`revenue:${row.id}`)).toBeDefined()
   expect((await repo.buildCloudDeltaEnvelope()).tombstones).toEqual([])
  } finally { await db.delete() }
 })

 it('annule une suppression locale refusée sans la renvoyer indéfiniment', async () => {
  const db = new SalonProDatabase(`delta-denied-delete-${crypto.randomUUID()}`); const repo = new SalonRepositoryHub(db)
  try {
   await repo.ensureInitialized()
   const row = snapshot().revenues[0]
   await repo.mergeCloudDelta({ cursor: 1, hasMore: false, changes: { revenues: [row] } })
   await db.revenues.delete(row.id)
   const tombstone = { id: `revenue:${row.id}`, entityType: 'revenue' as const, entityId: row.id, deletedAt: new Date().toISOString() }
   await db.syncTombstones.put(tombstone)
   await repo.mergeCloudDelta({ cursor: 2, hasMore: false, changes: { revenues: [row] }, rejected: [{ table: 'revenues', id: row.id, code: 'DELETE_FORBIDDEN_FOR_ROLE' }] }, {}, [tombstone])
   expect(await db.revenues.get(row.id)).toEqual(row)
   expect(await db.syncTombstones.get(tombstone.id)).toBeUndefined()
   expect((await repo.buildCloudDeltaEnvelope()).tombstones).toEqual([])
   expect(await repo.exportCloudConflicts()).toContain('DELETE_FORBIDDEN_FOR_ROLE')
  } finally { await db.delete() }
 })

})
