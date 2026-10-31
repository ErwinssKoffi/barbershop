import { AuthApiError } from './authEngine.ts'
import type { SqlQueryable } from './neonClient.ts'
import type { CloudSyncEnvelope } from './syncEngine.ts'
import type { ProductItem, RevenueEntry, StockMovement } from '../src/domain/models/index.ts'
import { isLegacyMockRecord } from '../src/domain/mockPurge.ts'

function fail(code: string, message: string): never { throw new AuthApiError(409, code, message) }
function ordered(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(ordered)
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]))
 return value
}
function stable(value: unknown): string { return JSON.stringify(ordered(value)) }
function without(value: object, fields: string[]): string {
 return stable(Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key))))
}
export interface CashierStockPlan {
 incoming: CloudSyncEnvelope
 products: ProductItem[]
 movements: StockMovement[]
 originals: Map<string, StockMovement>
}

/** Caller holds the tenant revision lock, in the same transaction as every business write. */
export async function planCashierStock(db: SqlQueryable, incoming: CloudSyncEnvelope, now: string): Promise<CashierStockPlan> {
 const products = new Map<string, ProductItem>()
 const originals = new Map<string, StockMovement>()
 const normalized: StockMovement[] = []
 const seen = new Set<string>()
 const revenues = incoming.payload.revenues ?? []
 if (!Array.isArray(revenues)) fail('STOCK_LINK_CONFLICT', 'Liste de recettes invalide.')
 const revenueIds = new Set<string>()
 for (const revenue of revenues) {
  if (!revenue || typeof revenue.id !== 'string' || revenueIds.has(revenue.id)) fail('STOCK_LINK_CONFLICT', 'Recette invalide ou dupliquée.')
  revenueIds.add(revenue.id)
  if (Array.isArray(revenue.consumablesUsed) && new Set(revenue.consumablesUsed.map((item) => item?.stockMovementId)).size !== revenue.consumablesUsed.length) fail('STOCK_LINK_CONFLICT', 'Consommable dupliqué dans une recette.')
  if (revenue.consumablesUsed !== undefined && (!Array.isArray(revenue.consumablesUsed) || revenue.consumablesUsed.some((item) => !item || typeof item.stockMovementId !== 'string' || typeof item.productId !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity <= 0))) fail('STOCK_LINK_CONFLICT', 'Références de consommables invalides.')
 }
 const rows = incoming.payload.stockMovements ?? []
 if (!Array.isArray(rows)) fail('INVALID_STOCK_MOVEMENT', 'Liste de mouvements invalide.')
 for (const movement of rows) {
  if (!movement || typeof movement.id !== 'string' || !movement.id || seen.has(movement.id) || isLegacyMockRecord(movement)) fail('INVALID_STOCK_MOVEMENT', 'Mouvement de stock invalide ou dupliqué.')
  seen.add(movement.id)
  const existing = await db.query<{ payload_json: StockMovement }>('SELECT payload_json FROM stock_movements WHERE id = $1', [movement.id])
  if (existing.rows[0]) {
   const current = existing.rows[0].payload_json
   if (without(current, ['quantityAfter', 'unitCost', 'createdAt']) !== without(movement, ['quantityAfter', 'unitCost', 'createdAt'])) fail('IMMUTABLE_STOCK_MOVEMENT', 'Un mouvement enregistré ne peut pas être modifié.')
   normalized.push(current); originals.set(current.id, current)
   continue
  }
  if (!['use', 'sale'].includes(movement.type) || !Number.isSafeInteger(movement.quantityDelta) || movement.quantityDelta >= 0) fail('STOCK_OPERATION_FORBIDDEN', 'Le Caissier peut uniquement enregistrer une consommation ou une vente de quantité entière positive.')
  let product = products.get(movement.productId)
  if (!product) {
   const result = await db.query<{ payload_json: ProductItem }>('SELECT payload_json FROM products WHERE id = $1', [movement.productId])
   product = result.rows[0]?.payload_json
   if (!product || !product.isActive || isLegacyMockRecord(product)) fail('PRODUCT_UNAVAILABLE', 'Produit indisponible dans ce salon.')
   product = { ...product }; products.set(product.id, product)
  }
  if ((movement.type === 'sale' && product.usageType === 'consumable') || (movement.type === 'use' && product.usageType === 'resale')) fail('STOCK_USAGE_MISMATCH', 'Usage du produit incompatible avec ce mouvement.')
  const quantity = product.quantity + movement.quantityDelta
  if (!Number.isSafeInteger(quantity) || quantity < 0) fail('INSUFFICIENT_STOCK', `Stock insuffisant pour « ${product.name} ». Aucune écriture de cet envoi n’a été enregistrée.`)
  product.quantity = quantity; product.updatedAt = now
  normalized.push({ ...movement, quantityAfter: quantity, unitCost: product.costPrice, createdAt: now })
 }
 // A product snapshot accompanying a stock operation is only a local projection.
 // Ignore quantity/timestamp only, never accept changes to catalog fields.
 const snapshots = incoming.payload.products ?? []
 if (!Array.isArray(snapshots)) fail('INVALID_STOCK_MOVEMENT', 'Liste de produits invalide.')
 const retained: ProductItem[] = []
 for (const snapshot of snapshots) {
  if (!snapshot || typeof snapshot.id !== 'string') fail('INVALID_STOCK_MOVEMENT', 'Produit invalide.')
  const matchesMovement = normalized.some((movement) => movement.productId === snapshot.id)
  const current = matchesMovement ? await db.query<{ payload_json: ProductItem }>('SELECT payload_json FROM products WHERE id = $1', [snapshot.id]) : undefined
  if (!current?.rows[0] || without(current.rows[0].payload_json, ['quantity', 'updatedAt']) !== without(snapshot, ['quantity', 'updatedAt'])) retained.push(snapshot)
 }
 return { incoming: { ...incoming, payload: { ...incoming.payload, products: retained, stockMovements: normalized } }, products: [...products.values()], movements: normalized, originals }
}

export async function validateCashierStockLinks(db: SqlQueryable, plan: CashierStockPlan, accepted: RevenueEntry[], rejected: { table: string; id: string }[]): Promise<void> {
 const incoming = plan.incoming.payload.revenues ?? []
 const rejectedRevenue = new Set(rejected.filter((item) => item.table === 'revenues').map((item) => item.id))
 const byId = async (id: string): Promise<RevenueEntry | undefined> => {
  if (rejectedRevenue.has(id)) fail('STOCK_LINK_CONFLICT', 'Une recette liée au stock a été refusée. Envoi annulé.')
  const row = accepted.find((revenue) => revenue.id === id)
  if (row) return row
  return (await db.query<{ payload_json: RevenueEntry }>('SELECT payload_json FROM revenues WHERE id = $1', [id])).rows[0]?.payload_json
 }
 const matches = (movement: StockMovement, revenue: RevenueEntry) => ['use', 'sale'].includes(movement.type) && movement.quantityDelta < 0 && !revenue.isArchived && (movement.type === 'sale'
  ? revenue.id === movement.linkedRevenueId && revenue.linkedStockMovementId === movement.id && revenue.productId === movement.productId && (revenue.quantity ?? 1) === -movement.quantityDelta
  : revenue.consumablesUsed?.some((item) => item.stockMovementId === movement.id && item.productId === movement.productId && item.quantity === -movement.quantityDelta))
 for (const movement of plan.movements) {
  if (plan.originals.has(movement.id)) continue
  let revenue: RevenueEntry | undefined
  if (movement.type === 'sale' && typeof movement.linkedRevenueId === 'string') revenue = await byId(movement.linkedRevenueId)
  if (movement.type === 'use') {
   const references = incoming.filter((row) => row.consumablesUsed?.some((item) => item.stockMovementId === movement.id))
   if (references.length > 1) fail('STOCK_LINK_CONFLICT', 'Un consommable ne peut pas être lié à plusieurs recettes.')
   if (references[0]) revenue = await byId(references[0].id)
   else {
    const found = await db.query<{ payload_json: RevenueEntry }>("SELECT payload_json FROM revenues WHERE payload_json->'consumablesUsed' @> $1::jsonb", [JSON.stringify([{ stockMovementId: movement.id }])])
    if (found.rows.length === 1) revenue = found.rows[0].payload_json
   }
  }
  if (!revenue || !matches(movement, revenue)) fail('STOCK_LINK_MISSING', 'Mouvement sans recette concordante. Envoi annulé.')
 }
 // Reject orphan revenue links too; otherwise a rejected stock row could leave a ticket accepted alone.
 const claimants = new Map<string, string>()
 for (const revenue of accepted) {
  const prior = (await db.query<{ payload_json: RevenueEntry }>('SELECT payload_json FROM revenues WHERE id = $1', [revenue.id])).rows[0]?.payload_json
  const stockFields = (row: RevenueEntry) => stable({ productId: row.productId, quantity: row.quantity, linkedStockMovementId: row.linkedStockMovementId, consumablesUsed: row.consumablesUsed, isArchived: Boolean(row.isArchived) })
  if (prior && (prior.linkedStockMovementId || prior.consumablesUsed?.length) && stockFields(prior) !== stockFields(revenue)) fail('STOCK_LINK_CONFLICT', 'Les effets de stock d’une recette enregistrée nécessitent une correction par le Gérant.')
  const refs = [...(revenue.consumablesUsed?.map((item) => item.stockMovementId) ?? []), ...(revenue.linkedStockMovementId ? [revenue.linkedStockMovementId] : [])]
  if (revenue.productId && !revenue.linkedStockMovementId) fail('STOCK_LINK_MISSING', 'Une vente de produit doit référencer son mouvement de stock.')
  for (const id of refs) {
   if (typeof id !== 'string' || !id) fail('STOCK_LINK_MISSING', 'Référence de mouvement invalide.')
   let movement = plan.movements.find((row) => row.id === id)
   if (!movement) movement = (await db.query<{ payload_json: StockMovement }>('SELECT payload_json FROM stock_movements WHERE id = $1', [id])).rows[0]?.payload_json
   if (!movement || !matches(movement, revenue)) fail('STOCK_LINK_MISSING', 'Recette sans mouvement concordant. Envoi annulé.')
   if (claimants.has(id) && claimants.get(id) !== revenue.id) fail('STOCK_LINK_CONFLICT', 'Un mouvement ne peut pas être réutilisé pour une autre recette.')
   claimants.set(id, revenue.id)
   if (movement.type === 'use') {
    const claimed = await db.query("SELECT row_id FROM sync_changes WHERE table_name = $1 AND row_id <> $2 AND payload_json->'consumablesUsed' @> $3::jsonb LIMIT 1", ['revenues', revenue.id, JSON.stringify([{ stockMovementId: id }])])
    if (claimed.rows.length) fail('STOCK_LINK_CONFLICT', 'Ce mouvement de consommable est déjà attribué à une autre recette.')
   }
  }
 }
}
