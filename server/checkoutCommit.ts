import { createHash, randomUUID } from 'node:crypto'
import { AuthApiError } from './authEngine.ts'
import { parseCheckoutCommand, calculateCheckoutQuote } from './checkoutQuote.ts'
import { withTenantClient } from './tenantContext.ts'
import { lockSyncState } from './syncProtocol.ts'
import { hasCheckoutSchema, reconcileCheckoutCash } from './checkoutLedger.ts'
import type { SqlPoolLike } from './neonClient.ts'
import type { CheckoutResult } from '../src/domain/checkout.ts'
import type { ProductItem, RevenueEntry, ServiceCatalogItem, StockMovement, TicketPaymentSplit } from '../src/domain/models/index.ts'

function problem(code: string, message: string, status = 409): never { throw new AuthApiError(status, code, message) }
function amount(value: number): number {
 if (!Number.isSafeInteger(value) || value < 0) problem('INVALID_CHECKOUT_AMOUNT', 'Montant ou quantité hors limites sûres.')
 return value
}
function canonical(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
 if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
 return JSON.stringify(value)
}

/** One transaction and tenant revision lock for both roles; replay never recalculates historical prices. */
export async function commitCheckout(pool: SqlPoolLike, tenantId: string, actorId: string, input: unknown): Promise<{ result: CheckoutResult; replayed: boolean }> {
 const command = parseCheckoutCommand(input)
 if (!await hasCheckoutSchema(pool)) problem('CHECKOUT_MIGRATION_REQUIRED', 'Finalisation indisponible : migration checkout non approuvée/appliquée.', 503)
 const hash = createHash('sha256').update(canonical(command)).digest('hex')
 return withTenantClient(pool, tenantId, async (db) => {
  await lockSyncState(db)
  const membership = await db.query<{ role: 'manager' | 'cashier' }>(`SELECT m.role FROM memberships m JOIN salon_users u ON u.id = m.user_id
    WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.is_active AND u.is_active FOR SHARE OF m, u`, [tenantId, actorId])
  const role = membership.rows[0]?.role
  if (!role) problem('TENANT_ACCESS_DENIED', 'Compte sans appartenance active à cet établissement.', 403)
  const existing = await db.query<{ request_hash: string; result_json: CheckoutResult }>('SELECT request_hash, result_json FROM checkout_commands WHERE idempotency_key = $1', [command.idempotencyKey])
  if (existing.rows[0]) {
   if (existing.rows[0].result_json.actorId !== actorId) problem('CHECKOUT_ACTOR_CONFLICT', 'Cette clé appartient à un autre compte.')
   if (existing.rows[0].request_hash !== hash) problem('IDEMPOTENCY_CONFLICT', 'Cette clé a déjà été utilisée pour un autre ticket.')
   return { result: existing.rows[0].result_json, replayed: true }
  }
  const quote = await calculateCheckoutQuote(db, command, role)
  const now = new Date().toISOString(); const ticketId = `checkout-${randomUUID()}`
  const counter = await db.query<{ last_receipt: string | number }>(`INSERT INTO checkout_counters(tenant_id, last_receipt) VALUES ($1, 1)
    ON CONFLICT(tenant_id) DO UPDATE SET last_receipt = checkout_counters.last_receipt + 1 RETURNING last_receipt`, [tenantId])
  const number = amount(Number(counter.rows[0].last_receipt))
  const receiptNumber = `SPC-${String(number).padStart(10, '0')}`
  const records: CheckoutResult['records'] = { revenues: [], products: [], stockMovements: [], cashMovements: [] }
  const products = new Map<string, ProductItem>()
  const take = async (id: string, quantity: number, type: 'sale' | 'use', revenueId: string): Promise<StockMovement> => {
   if (!products.has(id)) {
    const row = (await db.query<{ payload_json: ProductItem }>('SELECT payload_json FROM products WHERE id = $1 FOR UPDATE', [id])).rows[0]?.payload_json
    if (!row?.isActive) problem('PRODUCT_UNAVAILABLE', 'Produit absent ou désactivé.')
    products.set(id, { ...row })
   }
   const product = products.get(id)!
   product.quantity = amount(product.quantity - quantity); product.updatedAt = now
   const movement: StockMovement = { id: `sm-${randomUUID()}`, productId: id, type, quantityDelta: -quantity, quantityAfter: product.quantity,
    unitCost: amount(product.costPrice), reason: `Ticket ${receiptNumber}`, occurredAt: now, createdAt: now, linkedRevenueId: revenueId }
   records.stockMovements.push(movement)
   return movement
  }
  const poolPayments = command.payments.map((payment) => ({ ...payment }))
  for (const line of quote.lines) {
   const id = `rev-${randomUUID()}`; let due = line.net
   const splits: TicketPaymentSplit[] = []
   for (const payment of poolPayments) {
    const paid = Math.min(payment.amount, due)
    if (paid) { splits.push({ method: payment.method, amount: paid }); payment.amount -= paid; due -= paid }
   }
   if (due) problem('CHECKOUT_PAYMENT_MISMATCH', 'Répartition des paiements incomplète.')
   const revenue: RevenueEntry = { id, ticketId, receiptNumber, date: now, label: line.variantLabel ? `${line.label} — ${line.variantLabel}` : line.label,
    categoryCode: line.categoryCode, employeeId: line.employeeId, quantity: line.quantity, unitPrice: line.unitPrice, amount: line.net,
    paymentMethod: splits[0]?.method ?? 'other', paymentSplits: splits, clientName: command.clientName,
    sourceModule: line.kind === 'product' ? 'inventory_sale' : 'revenue', isArchived: false, createdAt: now, updatedAt: now }
   if (line.kind === 'product') {
    revenue.productId = line.catalogId
    const movement = await take(line.catalogId, line.quantity, 'sale', id)
    movement.unitSalePrice = line.unitPrice
    revenue.linkedStockMovementId = movement.id
   } else {
    revenue.serviceId = line.catalogId; revenue.serviceVariantId = line.variantId; revenue.serviceVariantLabel = line.variantLabel
    const service = (await db.query<{ payload_json: ServiceCatalogItem }>('SELECT payload_json FROM services_catalog WHERE id = $1', [line.catalogId])).rows[0].payload_json
    for (const consumable of service.defaultConsumables ?? []) {
     const quantity = amount(consumable.quantity * line.quantity)
     const movement = await take(consumable.productId, quantity, 'use', id)
     const product = products.get(consumable.productId)!
     ;(revenue.consumablesUsed ??= []).push({ productId: product.id, productName: product.name, quantity, unit: product.unit, stockMovementId: movement.id })
    }
   }
   const cash = splits.find((payment) => payment.method === 'cash')?.amount ?? 0
   if (cash) {
    const movementId = `cm-${randomUUID()}`
    records.cashMovements.push({ id: movementId, sessionId: command.cashSessionId!, type: 'in', amount: cash, reason: revenue.label,
     categoryCode: revenue.categoryCode, paymentMethod: 'cash', occurredAt: now, linkedRevenueId: id, createdAt: now, updatedAt: now })
    revenue.cashMovementId = movementId
    const split = splits.find((payment) => payment.method === 'cash')!; split.cashMovementId = movementId
   }
   records.revenues.push(revenue)
  }
  if (poolPayments.some((payment) => payment.amount)) problem('CHECKOUT_PAYMENT_MISMATCH', 'Répartition excédentaire.')
  records.products = [...products.values()]
  for (const product of records.products) await db.query('UPDATE products SET quantity = $2, updated_at = $3, payload_json = $4::jsonb WHERE id = $1', [product.id, product.quantity, now, JSON.stringify(product)])
  for (const movement of records.stockMovements) await db.query(`INSERT INTO stock_movements(id,product_id,type,quantity_delta,quantity_after,unit_cost,occurred_at,created_at,payload_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [movement.id,movement.productId,movement.type,movement.quantityDelta,movement.quantityAfter,movement.unitCost,now,now,JSON.stringify(movement)])
  for (const revenue of records.revenues) await db.query(`INSERT INTO revenues(id,ticket_id,receipt_number,date,label,category_code,employee_id,amount,payment_method,is_archived,updated_at,payload_json)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$4,$10::jsonb)`, [revenue.id,ticketId,receiptNumber,now,revenue.label,revenue.categoryCode,revenue.employeeId ?? null,revenue.amount,revenue.paymentMethod,JSON.stringify(revenue)])
  for (const movement of records.cashMovements) await db.query(`INSERT INTO cash_movements(id,session_id,type,amount,occurred_at,updated_at,payload_json)
    VALUES($1,$2,$3,$4,$5,$5,$6::jsonb)`, [movement.id,movement.sessionId,movement.type,movement.amount,now,JSON.stringify(movement)])
  if (quote.cashAmount) records.cashSession = await reconcileCheckoutCash(db, command.cashSessionId!, now)
  const result: CheckoutResult = { tenantId, status: 'confirmed', confirmed: true, ticketId, receiptNumber, actorId, confirmedAt: now, command, quote, records }
  await db.query('INSERT INTO checkout_commands(tenant_id,idempotency_key,request_hash,actor_id,ticket_id,receipt_number,result_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [tenantId,command.idempotencyKey,hash,actorId,ticketId,receiptNumber,JSON.stringify(result)])
  for (const [table, rows] of [['revenues',records.revenues],['stock_movements',records.stockMovements],['cash_movements',records.cashMovements]] as const) {
   for (const row of rows) await db.query('INSERT INTO checkout_records(tenant_id,table_name,row_id,ticket_id) VALUES($1,$2,$3,$4)', [tenantId,table,row.id,ticketId])
  }
  // JSON normalization makes first response and a replay structurally identical (no undefined fields).
  return { result: JSON.parse(JSON.stringify(result)) as CheckoutResult, replayed: false }
 })
}
