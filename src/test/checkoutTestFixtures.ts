import { expect } from 'vitest'
import { runMigrations } from '../../server/migrations'
import { syncWithNeonDatabase } from '../../server/syncEngine'
import { withTenantClient } from '../../server/tenantContext'
import { createPostgresTestPool } from './postgresTestPool'
import { apiTestClient } from './apiTestClient'
import { buildDefaultSalonInfo, buildDefaultSettings, buildSystemCategories } from '../db/seed'
import type { CheckoutCommand } from '../domain/checkout'
import type { SalonBackupPayload } from '../domain/models'

export function command(): CheckoutCommand {
  return { idempotencyKey: 'checkout-quote-test-0001', clientName: 'Client comptoir',
    lines: [{ kind: 'service', catalogId: 'service-quote', variantId: 'variant-long', quantity: 2, expectedUnitPrice: 4500 }, { kind: 'product', catalogId: 'product-quote', quantity: 2, expectedUnitPrice: 500 }],
    payments: [{ method: 'cash', amount: 4000 }, { method: 'wave', amount: 6000 }], cashSessionId: 'cash-quote', amountTendered: 5000, expectedTotal: 10000 }
}
export async function setup(checkout = false) {
  const { pool } = createPostgresTestPool()
  const signup = await apiTestClient(pool, 'POST', '/api/auth/register', { fullName: 'Responsable Recette', email: 'quote-manager@example.invalid', password: 'Password2026' })
  expect(signup.status).toBe(201)
  const manager = signup.body.sessionToken as string
  const tenant = (signup.body.user as { tenantId: string }).tenantId
  await apiTestClient(pool, 'POST', '/api/users', { fullName: 'Compte Caisse', email: 'quote-cashier@example.invalid', password: 'Password2026', role: 'cashier' }, manager)
  const login = await apiTestClient(pool, 'POST', '/api/auth/login', { email: 'quote-cashier@example.invalid', password: 'Password2026' })
  const cashier = login.body.sessionToken as string
  const time = new Date().toISOString()
  const snapshot: SalonBackupPayload = { format: 'SALON_PRO_BACKUP_V1', exportedAt: time, salon: buildDefaultSalonInfo(), settings: buildDefaultSettings(), categories: buildSystemCategories(),
    services: [{ id: 'service-quote', name: 'Prestation', categoryCode: 'service', referencePrice: 3000, description: '', commissionOverride: { mode: 'rate', value: 25 }, variants: [{ id: 'variant-long', label: 'Long', price: 4500 }], defaultConsumables: [{ productId: 'product-quote', quantity: 2 }], isActive: true, createdAt: time, updatedAt: time }],
    products: [{ id: 'product-quote', name: 'Produit mixte', sku: 'QUOTE-01', categoryCode: 'other', quantity: 10, unit: 'unité', costPrice: 100, salePrice: 500, alertThreshold: 1, usageType: 'both', isActive: true, createdAt: time, updatedAt: time }],
    employees: [], revenues: [], expenses: [], cashSessions: [{ id: 'cash-quote', openedAt: time, openingBalance: 1000, totalCashIn: 0, totalCashOut: 0, theoreticalClosingBalance: 1000, status: 'open', createdAt: time, updatedAt: time }], cashMovements: [], stockMovements: [], advances: [], bonuses: [], salaryPayments: [], budgets: [], correctionLogs: [] }
  await syncWithNeonDatabase(pool, { payload: snapshot }, tenant, 'manager')
  const financialState = () => withTenantClient(pool, tenant, async (db) => (await db.query(`SELECT (SELECT count(*) FROM revenues)::int AS revenues,
    (SELECT count(*) FROM stock_movements)::int AS movements, (SELECT count(*) FROM cash_movements)::int AS cash,
    (SELECT quantity FROM products WHERE id = 'product-quote') AS quantity, (SELECT revision FROM sync_state) AS revision`)).rows[0])
  if (checkout) await runMigrations(pool, { includeCheckout: true })
  const actorId = (signup.body.user as { id: string }).id
  const cashierId = (login.body.user as { id: string }).id
  const call = (value: unknown, token = manager) => apiTestClient(pool, 'POST', '/api/checkout/quote', value, token)
  return { pool, tenant, manager, cashier, actorId, cashierId, financialState, call, snapshot }
}
