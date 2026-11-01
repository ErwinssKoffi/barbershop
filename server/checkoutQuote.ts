import { serviceRevenueCategory } from '../src/domain/revenueCategories.ts'
import { validateCheckoutCommand, CheckoutValidationError } from '../src/domain/checkoutValidation.ts'
import { AuthApiError } from './authEngine.ts'
import type { SqlPoolLike, SqlQueryable } from './neonClient.ts'
import { withTenantClient } from './tenantContext.ts'
import type { CheckoutCommand, CheckoutQuote } from '../src/domain/checkout.ts'
import type { ProductItem, ServiceCatalogItem, UserRole } from '../src/domain/models/index.ts'

function reject(code: string, message: string, status = 400): never { throw new AuthApiError(status, code, message) }
function integer(value: unknown, name: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) reject('INVALID_CHECKOUT_AMOUNT', `${name} doit être un entier positif ou nul, dans la limite des entiers sûrs.`)
  return value
}
function safe(value: number): number { return integer(value, 'Montant calculé') }

export function parseCheckoutCommand(input: unknown): CheckoutCommand {
 try { return validateCheckoutCommand(input) }
 catch (error) {
  if (error instanceof CheckoutValidationError) throw new AuthApiError(400,error.code,error.message)
  throw error
 }
}

/** Read-only quote, never a reservation or a confirmed financial transaction. Recalculate at commit. */
export async function calculateCheckoutQuote(db: SqlQueryable, command: CheckoutCommand, role: UserRole): Promise<CheckoutQuote> {
  const lines: CheckoutQuote['lines'] = []
  const stock = new Map<string, number>()
  const productCache = new Map<string, ProductItem>()
  const addStock = (id: string, quantity: number) => stock.set(id, safe((stock.get(id) ?? 0) + integer(quantity, 'Quantité de stock', 1)))
  const product = async (id: string) => {
    if (!productCache.has(id)) {
      const result = await db.query<{ payload_json: ProductItem }>('SELECT payload_json FROM products WHERE id = $1', [id])
      const row = result.rows[0]?.payload_json
      if (!row?.isActive) reject('CATALOG_ITEM_UNAVAILABLE', 'Produit absent ou désactivé dans ce salon.', 409)
      productCache.set(id, row)
    }
    return productCache.get(id)!
  }
  for (const line of command.lines) {
    let label: string; let categoryCode: string; let unitPrice: number; let variantLabel: string | undefined
    if (line.employeeId) {
      const result = await db.query<{ payload_json: { isActive: boolean } }>('SELECT payload_json FROM employees WHERE id = $1', [line.employeeId])
      if (!result.rows[0]?.payload_json.isActive) reject('EMPLOYEE_UNAVAILABLE', 'Employé absent ou inactif dans ce salon.', 409)
    }
    if (line.kind === 'service') {
      const result = await db.query<{ payload_json: ServiceCatalogItem }>('SELECT payload_json FROM services_catalog WHERE id = $1', [line.catalogId])
      const service = result.rows[0]?.payload_json
      if (!service?.isActive) reject('CATALOG_ITEM_UNAVAILABLE', 'Prestation absente ou désactivée dans ce salon.', 409)
      const variant = line.variantId ? service.variants?.find((item) => item.id === line.variantId) : undefined
      if (line.variantId && !variant) reject('VARIANT_UNAVAILABLE', 'Variante absente de cette prestation.', 409)
      label = service.name; categoryCode = serviceRevenueCategory(service.categoryCode); unitPrice = integer(variant?.price ?? service.referencePrice, 'Prix catalogue'); variantLabel = variant?.label
      for (const consumable of service.defaultConsumables ?? []) {
        const row = await product(consumable.productId)
        if (row.usageType === 'resale') reject('STOCK_USAGE_MISMATCH', 'Un produit de revente ne peut pas être un consommable cabine.', 409)
        addStock(row.id, safe(integer(consumable.quantity, 'Consommable standard', 1) * line.quantity))
      }
    } else {
      const row = await product(line.catalogId)
      if (row.usageType === 'consumable') reject('STOCK_USAGE_MISMATCH', 'Ce produit est réservé à la consommation cabine.', 409)
      label = row.name; categoryCode = 'product_sale'; unitPrice = integer(row.salePrice, 'Prix de vente catalogue')
      addStock(row.id, line.quantity)
    }
    if (line.expectedUnitPrice !== undefined && line.expectedUnitPrice !== unitPrice) reject('CHECKOUT_PRICE_CHANGED', 'Le prix attendu ne correspond plus au catalogue serveur.', 409)
    lines.push({ kind: line.kind, catalogId: line.catalogId, label, categoryCode, quantity: line.quantity, unitPrice,
      ...(line.variantId ? { variantId: line.variantId, variantLabel } : {}), ...(line.employeeId ? { employeeId: line.employeeId } : {}),
      gross: safe(unitPrice * line.quantity), discount: 0, net: 0 })
  }
  const subtotal = lines.reduce((sum, line) => safe(sum + line.gross), 0)
  const discount = command.discount?.amount ?? 0
  if (discount > 0 && role !== 'manager') reject('DISCOUNT_FORBIDDEN', 'Une remise nécessite le Gérant.', 403)
  if (discount > subtotal) reject('INVALID_CHECKOUT_AMOUNT', 'La remise ne peut pas dépasser le montant brut.')
  // Integer proportional allocation: no floating-point money and exact reconciliation.
  let remaining = discount
  for (const line of lines) {
    line.discount = subtotal ? Number(BigInt(line.gross) * BigInt(discount) / BigInt(subtotal)) : 0
    remaining -= line.discount
  }
  for (const line of lines) if (remaining && line.discount < line.gross) { line.discount++; remaining-- }
  for (const line of lines) line.net = line.gross - line.discount
  const total = subtotal - discount
  if (command.expectedTotal !== undefined && command.expectedTotal !== total) reject('CHECKOUT_PRICE_CHANGED', 'Le total attendu ne correspond pas au total serveur.', 409)
  for (const payment of command.payments) {
    const result = await db.query<{ payload_json: { isArchived?: boolean } }>("SELECT payload_json FROM categories WHERE scope = 'payment_method' AND code = $1", [payment.method])
    if (!result.rows.length || result.rows[0].payload_json.isArchived) reject('PAYMENT_METHOD_UNAVAILABLE', 'Mode de paiement absent ou archivé dans ce salon.', 409)
  }
  if (command.payments.reduce((sum, payment) => safe(sum + payment.amount), 0) !== total) reject('CHECKOUT_PAYMENT_MISMATCH', 'La somme des paiements doit être exactement égale au net à payer.')
  const cashAmount = command.payments.find((payment) => payment.method === 'cash')?.amount ?? 0
  if (cashAmount && !command.cashSessionId) reject('CASH_SESSION_REQUIRED', 'Ouvrez une caisse avant d’encaisser des espèces.', 409)
  if (command.cashSessionId) {
    const result = await db.query<{ payload_json: { status: string } }>('SELECT payload_json FROM cash_sessions WHERE id = $1', [command.cashSessionId])
    if (result.rows[0]?.payload_json.status !== 'open') reject('CASH_SESSION_UNAVAILABLE', 'Session de caisse absente ou clôturée dans ce salon.', 409)
  }
  if (command.amountTendered !== undefined && (!cashAmount || command.amountTendered < cashAmount)) reject('INVALID_CASH_TENDER', 'Les espèces remises doivent couvrir uniquement la part espèces du paiement.')
  for (const [id, quantity] of stock) {
    const row = await product(id)
    if (integer(row.quantity, 'Quantité disponible') < quantity) reject('INSUFFICIENT_STOCK', 'Stock insuffisant pour les produits et consommables du ticket.', 409)
  }
  return { status: 'quoted', confirmed: false, currency: 'XOF', idempotencyKey: command.idempotencyKey,
    quotedAt: new Date().toISOString(), lines, subtotal, discount, total, payments: command.payments,
    cashAmount, change: cashAmount ? (command.amountTendered ?? cashAmount) - cashAmount : 0,
    stockRequired: [...stock].map(([productId, quantity]) => ({ productId, quantity })),
  }
}

export async function quoteCheckout(pool: SqlPoolLike, tenantId: string, role: UserRole, input: unknown): Promise<CheckoutQuote> {
  const command = parseCheckoutCommand(input)
  return withTenantClient(pool, tenantId, (db) => calculateCheckoutQuote(db, command, role))
}
