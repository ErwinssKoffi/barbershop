import { describe, expect, it } from 'vitest'
import { createPostgresTestPool } from './postgresTestPool'
import { ensureNeonSchema, syncWithNeonDatabase } from '../../server/syncEngine'
import { defaultTenantId, withTenantClient } from '../../server/tenantContext'
import { buildDefaultSalonInfo, buildDefaultSettings } from '../db/seed'
import type { ProductItem, SalonBackupPayload, StockMovement } from '../domain/models'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'

function payload(): SalonBackupPayload {
 return { format: 'SALON_PRO_BACKUP_V1', exportedAt: new Date().toISOString(), salon: buildDefaultSalonInfo(), settings: buildDefaultSettings(), categories: [], services: [], employees: [], revenues: [], expenses: [], cashSessions: [], cashMovements: [], advances: [], bonuses: [], salaryPayments: [], products: [], stockMovements: [], budgets: [], correctionLogs: [] }
}
const product = (): ProductItem => ({ id: 'product-stock', name: 'Produit', sku: 'STOCK-01', categoryCode: 'other', quantity: 5, unit: 'unité', costPrice: 100, salePrice: 500, alertThreshold: 1, usageType: 'both', isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
function sale(id = 'sale-1', quantity = 2) {
 const next = payload(); Reflect.deleteProperty(next, 'salon'); Reflect.deleteProperty(next, 'settings'); const time = next.exportedAt
 next.products = [{ ...product(), quantity: 5 - quantity }]
 next.stockMovements = [{ id: `sm-${id}`, productId: 'product-stock', type: 'sale', quantityDelta: -quantity, quantityAfter: 999, unitCost: 999, reason: 'Vente', occurredAt: time, linkedRevenueId: id, createdAt: time }]
 next.revenues = [{ id, productId: 'product-stock', label: 'Vente produit', categoryCode: 'product_sale', quantity, unitPrice: 500, amount: quantity * 500, paymentMethod: 'wave', sourceModule: 'inventory_sale', linkedStockMovementId: `sm-${id}`, date: time, createdAt: time, updatedAt: time }]
 return next
}
async function setup() {
 const { pool } = createPostgresTestPool(); await ensureNeonSchema(pool)
 const tenant = await defaultTenantId(pool); const initial = payload(); initial.products = [product()]
 const baseline = await syncWithNeonDatabase(pool, { payload: initial }, tenant, 'manager')
 const read = () => withTenantClient(pool, tenant, async (db) => ({
  product: (await db.query<{ payload_json: ProductItem }>('SELECT payload_json FROM products')).rows[0].payload_json,
  movements: (await db.query<{ payload_json: StockMovement }>('SELECT payload_json FROM stock_movements')).rows,
  revenues: (await db.query('SELECT id FROM revenues')).rows,
 }))
 return { pool, tenant, baseline, read }
}
describe('Stock dérivé Caissier — transaction PostgreSQL', () => {
 it('déduit le stock et normalise coût/quantité après sans autoriser le catalogue', async () => {
  const { pool, tenant, baseline, read } = await setup(); const next = sale()
  // Keep catalog fields identical to the authoritative product, apart from the local quantity.
  next.products[0] = { ...(await read()).product, quantity: 3 }
  const result = await syncWithNeonDatabase(pool, { payload: next, cursor: baseline.cursor }, tenant, 'cashier')
  expect(result.rejected).toEqual([])
  const state = await read(); expect(state.product.quantity).toBe(3); expect(state.product.costPrice).toBe(100)
  expect(state.movements[0].payload_json.quantityAfter).toBe(3); expect(state.movements[0].payload_json.unitCost).toBe(100)
  expect(result.changes.products).toHaveLength(1)
  const again = await syncWithNeonDatabase(pool, { payload: next, cursor: result.cursor }, tenant, 'cashier')
  expect(again.rejected).toEqual([]); expect(again.cursor).toBe(result.cursor)
  expect((await read()).product.quantity).toBe(3); expect((await read()).movements).toHaveLength(1)
 })
 it('ne permet pas de modifier un prix ou le catalogue via un mouvement valide', async () => {
  const { pool, tenant, baseline, read } = await setup(); const next = sale()
  next.products[0] = { ...(await read()).product, quantity: 999, costPrice: 777, name: 'Catalogue forgé' }
  const result = await syncWithNeonDatabase(pool, { payload: next, cursor: baseline.cursor }, tenant, 'cashier')
  expect(result.rejected).toContainEqual({ table: 'products', id: 'product-stock', code: 'WRITE_FORBIDDEN_FOR_ROLE' })
  const state = await read(); expect(state.product.name).toBe('Produit'); expect(state.product.costPrice).toBe(100); expect(state.product.quantity).toBe(3)
 })
 it('refuse un stock insuffisant sur un second poste et annule aussi la recette', async () => {
  const { pool, tenant, baseline, read } = await setup()
  await syncWithNeonDatabase(pool, { payload: sale('first', 4), cursor: baseline.cursor }, tenant, 'cashier')
  await expect(syncWithNeonDatabase(pool, { payload: sale('second', 2), cursor: baseline.cursor }, tenant, 'cashier')).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' })
  const state = await read(); expect(state.product.quantity).toBe(1); expect(state.revenues).toHaveLength(1); expect(state.movements).toHaveLength(1)
 })
 it('annule tous les mouvements et la recette si un mouvement est orphelin', async () => {
  const { pool, tenant, baseline, read } = await setup(); const next = sale()
  next.stockMovements.push({ ...next.stockMovements[0], id: 'orphan', quantityDelta: -1 })
  await expect(syncWithNeonDatabase(pool, { payload: next, cursor: baseline.cursor }, tenant, 'cashier')).rejects.toMatchObject({ code: 'STOCK_LINK_MISSING' })
  expect((await read()).product.quantity).toBe(5); expect((await read()).revenues).toHaveLength(0)
 })
 it('refuse quantités positives, doublons, et recettes produit sans mouvement', async () => {
  const { pool, tenant, baseline, read } = await setup()
  const positive = sale(); positive.stockMovements[0].quantityDelta = 1
  await expect(syncWithNeonDatabase(pool, { payload: positive, cursor: baseline.cursor }, tenant, 'cashier')).rejects.toMatchObject({ code: 'STOCK_OPERATION_FORBIDDEN' })
  const duplicate = sale(); duplicate.stockMovements.push(duplicate.stockMovements[0])
  await expect(syncWithNeonDatabase(pool, { payload: duplicate, cursor: baseline.cursor }, tenant, 'cashier')).rejects.toMatchObject({ code: 'INVALID_STOCK_MOVEMENT' })
  const orphan = sale(); orphan.stockMovements = []
  await expect(syncWithNeonDatabase(pool, { payload: orphan, cursor: baseline.cursor }, tenant, 'cashier')).rejects.toMatchObject({ code: 'STOCK_LINK_MISSING' })
  expect((await read()).product.quantity).toBe(5)
 })
 it('accepte les consommables liés à une recette et refuse un autre salon', async () => {
  const { pool, tenant, baseline, read } = await setup(); const next = sale()
  next.stockMovements[0].type = 'use'; delete next.stockMovements[0].linkedRevenueId
  delete next.revenues[0].productId; delete next.revenues[0].linkedStockMovementId
  next.revenues[0].sourceModule = 'revenue'
  next.revenues[0].consumablesUsed = [{ productId: 'product-stock', productName: 'Produit', unit: 'unité', quantity: 2, stockMovementId: 'sm-sale-1' }]
  await syncWithNeonDatabase(pool, { payload: next, cursor: baseline.cursor }, tenant, 'cashier')
  expect((await read()).product.quantity).toBe(3)
  const other = (await pool.query<{ id: string }>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id', [tenant])).rows[0].id
  await expect(syncWithNeonDatabase(pool, { payload: sale('cross'), cursor: 0 }, other, 'cashier')).rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' })
  expect((await read()).product.quantity).toBe(3)
 })
 it('interdit de réutiliser un consommable ou de retirer le lien d’une recette déjà enregistrée', async () => {
  const { pool, tenant, baseline, read } = await setup(); const next = sale()
  next.stockMovements[0].type = 'use'; delete next.stockMovements[0].linkedRevenueId
  delete next.revenues[0].productId; delete next.revenues[0].linkedStockMovementId
  next.revenues[0].sourceModule = 'revenue'
  next.revenues[0].consumablesUsed = [{ productId: 'product-stock', productName: 'Produit', unit: 'unité', quantity: 2, stockMovementId: 'sm-sale-1' }]
  const saved = await syncWithNeonDatabase(pool, { payload: next, cursor: baseline.cursor }, tenant, 'cashier')
  const reused = structuredClone(next); reused.stockMovements = []; reused.products = []; reused.revenues[0].id = 'another-revenue'
  await expect(syncWithNeonDatabase(pool, { payload: reused, cursor: saved.cursor }, tenant, 'cashier')).rejects.toMatchObject({ code: 'STOCK_LINK_CONFLICT' })
  const unlinked = structuredClone(next); unlinked.stockMovements = []; unlinked.products = []; delete unlinked.revenues[0].consumablesUsed
  await expect(syncWithNeonDatabase(pool, { payload: unlinked, cursor: saved.cursor }, tenant, 'cashier')).rejects.toMatchObject({ code: 'STOCK_LINK_CONFLICT' })
  expect((await read()).revenues).toHaveLength(1); expect((await read()).product.quantity).toBe(3)
 })
 it('ne confond pas une normalisation serveur acquittée avec une saisie concurrente locale', async () => {
  const db = new SalonProDatabase(`stock-ack-${crypto.randomUUID()}`); const repo = new SalonRepositoryHub(db)
  try {
   await repo.ensureInitialized(); const sent = sale(); const movement = sent.stockMovements[0]
   await db.stockMovements.put(movement)
   const result = await repo.mergeCloudDelta({ cursor: 1, hasMore: false, changes: { stockMovements: [{ ...movement, unitCost: 100, quantityAfter: 3, createdAt: new Date(Date.now() + 1000).toISOString() }] } }, sent)
   expect(result.conflicts).toBe(0)
   expect((await db.stockMovements.get(movement.id))?.quantityAfter).toBe(3)
   expect((await repo.buildCloudDeltaEnvelope()).payload.stockMovements).toEqual([])
  } finally { await db.delete() }
 })
})
