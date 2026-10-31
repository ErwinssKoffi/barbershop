import { createPostgresTestPool } from './postgresTestPool'
import { ensureNeonSchema } from '../../server/syncEngine'
import { defaultTenantId } from '../../server/tenantContext'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { handleSalonApiRequest } from '../../server/apiHandler'
import {
  sanitizeDatabaseUrl,
  verifyManagerPin,
  type SqlPoolLike,
} from '../../server/neonClient'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'

function createTestNeonPool(options?: { failNetwork?: boolean }): { pool: SqlPoolLike } {
  if (options?.failNetwork) return { pool: {
    async query() { throw new Error('getaddrinfo ENOTFOUND ep-test.aws.neon.tech') },
    async connect() { throw new Error('getaddrinfo ENOTFOUND ep-test.aws.neon.tech') },
  } }
  return createPostgresTestPool()
}

async function invokeApi(params: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
  poolOverride?: SqlPoolLike | null
  expectedPinOverride?: string
}): Promise<{ statusCode: number; json: Record<string, unknown> }> {
  const reqEmitter = new EventEmitter() as IncomingMessage & { body?: unknown }
  reqEmitter.method = params.method
  reqEmitter.url = params.url
  reqEmitter.headers = Object.fromEntries(
    Object.entries(params.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  )
  if (params.body !== undefined) {
    reqEmitter.body = params.body
  }

  let statusCode = 200
  let rawResponse = ''
  const res = {
    get statusCode() {
      return statusCode
    },
    set statusCode(code: number) {
      statusCode = code
    },
    setHeader: () => res,
    end: (chunk?: string) => {
      if (chunk) rawResponse += chunk
    },
  } as unknown as ServerResponse

  await handleSalonApiRequest(reqEmitter, res, {
    poolOverride: params.poolOverride,
    expectedPinOverride: params.expectedPinOverride,
    databaseUrlOverride: 'postgresql://demo:secret@ep-demo.neon.tech/neondb',
  })

  return {
    statusCode,
    json: rawResponse ? (JSON.parse(rawResponse) as Record<string, unknown>) : {},
  }
}

describe('Synchronisation Hybride IndexedDB + Neon PostgreSQL', () => {
  const TEST_SYNC_CODE = 'test-sync-secret'

  it('exclut les comptes du push et du pull, et ignore les comptes forgés côté serveur et local', async () => {
    const { pool } = createTestNeonPool()
    const database = new SalonProDatabase(`test-sync-security-${crypto.randomUUID()}`)
    const repo = new SalonRepositoryHub(database)
    try {
      await repo.ensureInitialized()
      const account = {
        id: crypto.randomUUID(),
        fullName: 'Compte de test',
        email: 'security@example.invalid',
        role: 'cashier' as const,
        passwordHash: crypto.randomUUID(),
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      await database.users.put(account)
      await ensureNeonSchema(pool)
      const tenantId = await defaultTenantId(pool)
      await pool.query(`INSERT INTO salon_users (id, tenant_id, email, full_name, role, password_hash, created_at, updated_at, payload_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [account.id, tenantId, account.email, account.fullName, account.role, account.passwordHash, account.createdAt, account.updatedAt, JSON.stringify(account)])
      const envelope = await repo.buildCloudSyncEnvelope()
      expect(envelope.payload).not.toHaveProperty('users')
      expect(JSON.stringify(envelope)).not.toContain(account.passwordHash)

      const forged = {
        ...account,
        role: 'manager' as const,
        passwordHash: crypto.randomUUID(),
        updatedAt: '2099-01-01T00:00:00.000Z',
      }
      const payload = { ...envelope.payload, users: [forged] }
      const result = await invokeApi({
        method: 'POST', url: '/api/sync',
        headers: { 'x-salon-pin': TEST_SYNC_CODE },
        body: { ...envelope, payload },
        poolOverride: pool, expectedPinOverride: TEST_SYNC_CODE,
      })
      expect(result.statusCode).toBe(200)
      expect((await pool.query<{ payload_json: unknown }>('SELECT payload_json FROM salon_users')).rows[0].payload_json).toEqual(account)
      expect(result.json.payload).not.toHaveProperty('users')
      expect(JSON.stringify(result.json)).not.toContain(account.passwordHash)

      const pull = await invokeApi({
        method: 'GET', url: '/api/sync/pull',
        headers: { 'x-salon-pin': TEST_SYNC_CODE },
        poolOverride: pool, expectedPinOverride: TEST_SYNC_CODE,
      })
      expect(pull.statusCode).toBe(200)
      expect(pull.json.payload).not.toHaveProperty('users')
      expect(JSON.stringify(pull.json)).not.toContain(account.passwordHash)

      await repo.mergeCloudSyncResult({ payload, tombstones: [] })
      expect(await database.users.get(account.id)).toEqual(account)
    } finally {
      await database.delete()
    }
  })

  it('nettoie les URL PostgreSQL copiées depuis du Markdown et vérifie le code serveur en temps constant', () => {
    const pastedMarkdown =
      'postgresql://[neondb_owner:npg_test123@ep-mute-glade.aws.neon.tech](mailto:neondb_owner:npg_test123@ep-mute-glade.aws.neon.tech)/neondb?sslmode=require&amp;channel_binding=require'

    expect(sanitizeDatabaseUrl(pastedMarkdown)).toBe(
      'postgresql://neondb_owner:npg_test123@ep-mute-glade.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    )

    expect(verifyManagerPin(TEST_SYNC_CODE, TEST_SYNC_CODE).authorized).toBe(
      true,
    )
    expect(verifyManagerPin('wrong', TEST_SYNC_CODE).authorized).toBe(false)
    expect(verifyManagerPin(undefined, TEST_SYNC_CODE).authorized).toBe(false)
    expect(verifyManagerPin('', '').authorized).toBe(false)
  })

  it('protège /api/sync et n’expose aucun secret sur /api/health', async () => {
    const { pool } = createTestNeonPool()

    const health = await invokeApi({
      method: 'GET',
      url: '/api/health',
      poolOverride: pool,
      expectedPinOverride: TEST_SYNC_CODE,
    })
    expect(health.statusCode).toBe(200)
    expect(health.json).toEqual({
      ok: true,
      databaseConfigured: true,
      pinRequired: true,
    })
    expect(JSON.stringify(health.json)).not.toContain('neondb_owner')
    expect(JSON.stringify(health.json)).not.toContain(TEST_SYNC_CODE)

    const unauthorized = await invokeApi({
      method: 'POST',
      url: '/api/sync/verify',
      headers: { 'x-salon-pin': 'wrong' },
      poolOverride: pool,
      expectedPinOverride: TEST_SYNC_CODE,
    })
    expect(unauthorized.statusCode).toBe(401)
    expect(unauthorized.json.code).toBe('INVALID_PIN')
  })

  it('initialise une base vierge sans aucune donnée fictive, synchronise deux appareils (LWW) et propage les suppressions (tombstones)', async () => {
    const { pool } = createTestNeonPool()

    // Appareil A : initialisé totalement vierge (0 donnée mock) + 1 recette réelle + 1 budget réel
    const dbA = new SalonProDatabase(`test-sync-a-${crypto.randomUUID()}`)
    const repoA = new SalonRepositoryHub(dbA)
    await repoA.ensureInitialized()

    const initialStateA = await repoA.readFullState()
    expect(initialStateA.salon.name).toBe('')
    expect(initialStateA.services).toHaveLength(0)
    expect(initialStateA.employees).toHaveLength(0)
    expect(initialStateA.revenues).toHaveLength(0)
    expect(initialStateA.expenses).toHaveLength(0)
    expect(initialStateA.products).toHaveLength(0)
    expect(initialStateA.recurringExpenses).toHaveLength(0)

    await repoA.updateSalonInfo({
      name: 'Salon Prestige Plateau',
      managerName: 'Responsable A',
    })
    await repoA.addRevenue({
      date: '2026-10-30T10:00:00.000Z',
      label: 'Tresses Nattes Collées',
      categoryCode: 'braiding_weaving',
      clientName: 'Cliente A',
      amount: 15_000,
      paymentMethod: 'wave',
    })
    const budgetToKeepAndDelete = await repoA.upsertBudgetTarget({
      periodMonth: '2026-10',
      kind: 'revenue_goal',
      categoryCode: 'global',
      plannedAmount: 1_500_000,
    })

    const envA = await repoA.buildCloudSyncEnvelope()
    expect(envA.payload.revenues).toHaveLength(1)

    const syncA1 = await invokeApi({
      method: 'POST',
      url: '/api/sync',
      headers: { 'x-salon-pin': TEST_SYNC_CODE },
      body: envA,
      poolOverride: pool,
      expectedPinOverride: TEST_SYNC_CODE,
    })
    expect(syncA1.statusCode).toBe(200)
    expect(Number((await pool.query<{ count: string }>('SELECT count(*) AS count FROM revenues')).rows[0].count)).toBe(1)
    expect(Number((await pool.query<{ count: string }>('SELECT count(*) AS count FROM budgets')).rows[0].count)).toBe(1)

    // Appareil B : initialisé vierge, saisit une dépense hors-ligne puis synchronise
    const dbB = new SalonProDatabase(`test-sync-b-${crypto.randomUUID()}`)
    const repoB = new SalonRepositoryHub(dbB)
    await repoB.ensureInitialized()

    await repoB.addExpense({
      date: '2026-10-30T14:00:00.000Z',
      label: 'Facture Électricité Octobre',
      categoryCode: 'utilities',
      amount: 35_000,
      paymentMethod: 'orange_money',
    })

    const envB = await repoB.buildCloudSyncEnvelope()
    const syncB1 = await invokeApi({
      method: 'POST',
      url: '/api/sync',
      headers: { 'x-salon-pin': TEST_SYNC_CODE },
      body: envB,
      poolOverride: pool,
      expectedPinOverride: TEST_SYNC_CODE,
    })
    expect(syncB1.statusCode).toBe(200)

    await repoB.mergeCloudSyncResult({
      payload: syncB1.json.payload as typeof envB.payload,
      tombstones: syncB1.json.tombstones as typeof envB.tombstones,
    })

    const stateBAfter = await repoB.readFullState()
    expect(stateBAfter.salon.name).toBe('Salon Prestige Plateau')
    expect(stateBAfter.revenues).toHaveLength(1)
    expect(stateBAfter.revenues[0].label).toBe('Tresses Nattes Collées')
    expect(stateBAfter.expenses).toHaveLength(1)
    expect(stateBAfter.budgets).toHaveLength(1)

    // Appareil A supprime le budget -> Tombstone propagé à Neon puis à l'Appareil B
    await repoA.deleteBudgetTarget(budgetToKeepAndDelete.id)
    const envA2 = await repoA.buildCloudSyncEnvelope()
    expect(envA2.tombstones).toHaveLength(1)

    const syncA2 = await invokeApi({
      method: 'POST',
      url: '/api/sync',
      headers: { 'x-salon-pin': TEST_SYNC_CODE },
      body: { ...envA2, cursor: syncA1.json.cursor },
      poolOverride: pool,
      expectedPinOverride: TEST_SYNC_CODE,
    })
    expect(syncA2.statusCode).toBe(200)
    expect(Number((await pool.query<{ count: string }>('SELECT count(*) AS count FROM budgets')).rows[0].count)).toBe(0)

    const pullB = await invokeApi({
      method: 'GET',
      url: '/api/sync/pull',
      headers: { Authorization: `Bearer ${TEST_SYNC_CODE}` },
      poolOverride: pool,
      expectedPinOverride: TEST_SYNC_CODE,
    })
    expect(pullB.statusCode).toBe(200)

    await repoB.mergeCloudSyncResult({
      payload: pullB.json.payload as typeof envB.payload,
      tombstones: pullB.json.tombstones as typeof envB.tombstones,
    })

    const stateBFinal = await repoB.readFullState()
    expect(stateBFinal.budgets).toHaveLength(0)
    expect(stateBFinal.expenses).toHaveLength(1)
  })

  it('renvoie proprement un statut 503 NETWORK_UNREACHABLE si Neon est hors-ligne', async () => {
    const { pool } = createTestNeonPool({ failNetwork: true })

    const res = await invokeApi({
      method: 'POST',
      url: '/api/sync/verify',
      headers: { 'x-salon-pin': TEST_SYNC_CODE },
      poolOverride: pool,
      expectedPinOverride: TEST_SYNC_CODE,
    })

    expect(res.statusCode).toBe(503)
    expect(res.json.code).toBe('NETWORK_UNREACHABLE')
  })
})
