import { validateCheckoutCommand } from '../domain/checkoutValidation'
import type { SalonProDatabase } from './database'
import type { CheckoutCommand, CheckoutResult } from '../domain/checkout'
import type { QueuedCheckout } from '../domain/checkoutQueue'
import type { PublicSalonUser } from '../domain/models'
import { workspaceKey } from './accountWorkspace'
import { stableCloudValue } from '../domain/cloudDelta'

export async function assertCheckoutScope(db: SalonProDatabase, user: PublicSalonUser): Promise<string> {
 const scope = workspaceKey(user)
 const binding = await db.workspaceMeta.get('cloudTenantId')
 const account = await db.workspaceMeta.get('accountScope')
 if (!user.isActive || !user.tenantId || binding?.value !== user.tenantId || account?.value !== scope) throw new Error('Reconnectez-vous à l’espace Cloud de ce compte avant de préparer un encaissement.')
 return scope
}

/** No business projection, stock reservation or receipt is created before server acknowledgement. */
export async function enqueueCheckout(db: SalonProDatabase, user: PublicSalonUser, input: CheckoutCommand): Promise<QueuedCheckout> {
 const command = validateCheckoutCommand(input)
 if (!/^[a-zA-Z0-9:_-]{16,128}$/.test(command.idempotencyKey)) throw new Error('Clé de commande invalide.')
 return db.transaction('rw',[db.workspaceMeta,db.checkoutOutbox,db.cashSessions],async () => {
  const scope = await assertCheckoutScope(db,user)
  const existing = await db.checkoutOutbox.get(command.idempotencyKey)
  if (existing) {
   if (existing.scope !== scope || stableCloudValue(existing.command) !== stableCloudValue(command)) throw new Error('Cette intention existe déjà avec un autre contenu. Ne réutilisez pas sa clé.')
   return existing
  }
  if (command.cashSessionId && (await db.cashSessions.get(command.cashSessionId))?.status !== 'open') throw new Error('Ouvrez une caisse avant de préparer ce ticket espèces.')
  const now = Date.now()
  const row: QueuedCheckout = {idempotencyKey:command.idempotencyKey,tenantId:user.tenantId!,actorId:user.id,scope,command,state:'pending',createdAt:now,updatedAt:now,attempts:0,nextAttemptAt:now}
  await db.checkoutOutbox.add(row)
  return row
 })
}

export interface CheckoutDelivery {
 status: number
 body: { status?: string; idempotencyKey?: string; tenantId?: string; actorId?: string; ok?: boolean; code?: string; message?: string; result?: CheckoutResult }
 retryAfterMs?: number
}
const businessRefusals = new Set(['INVALID_CHECKOUT','INVALID_CHECKOUT_PAYMENT','INVALID_CHECKOUT_AMOUNT','CHECKOUT_PAYMENT_MISMATCH','INVALID_CASH_TENDER','CHECKOUT_PRICE_CHANGED','CATALOG_ITEM_UNAVAILABLE','PRODUCT_UNAVAILABLE','VARIANT_UNAVAILABLE','EMPLOYEE_UNAVAILABLE','PAYMENT_METHOD_UNAVAILABLE','CASH_SESSION_REQUIRED','CASH_SESSION_UNAVAILABLE','INSUFFICIENT_STOCK','STOCK_USAGE_MISMATCH','DISCOUNT_FORBIDDEN','IDEMPOTENCY_CONFLICT','CHECKOUT_ACTOR_CONFLICT'])

export function isCheckoutAcknowledgement(job: QueuedCheckout, delivery: CheckoutDelivery): boolean {
 const result = delivery.body.result
 return Boolean( delivery.status === 200 && delivery.body.ok === true && result?.confirmed === true && result.status === 'confirmed' && result.actorId === job.actorId && result.tenantId === job.tenantId && result.ticketId && /^SPC-\d+$/.test(result.receiptNumber) && stableCloudValue(result.command) === stableCloudValue(job.command) && result.quote?.idempotencyKey === job.idempotencyKey && Array.isArray(result.records?.revenues) && Array.isArray(result.records?.stockMovements) && Array.isArray(result.records?.cashMovements) && Array.isArray(result.records?.products))
}

/** A durable lease serializes tabs; server idempotence also covers crashes and lease expiry. */
export async function drainCheckoutQueue(db: SalonProDatabase, user: PublicSalonUser, send: (row: QueuedCheckout) => Promise<CheckoutDelivery>, options: {now?: () => number; limit?: number} = {}): Promise<{confirmed:number;rejected:number;pending:number}> {
 const clock = options.now ?? Date.now
 const scope = await assertCheckoutScope(db,user)
 const stats = {confirmed:0,rejected:0,pending:0}
 for (let index=0; index<(options.limit ?? 20); index++) {
  const job = await db.transaction('rw',[db.workspaceMeta,db.checkoutOutbox],async () => {
   await assertCheckoutScope(db,user)
   const rows = (await db.checkoutOutbox.where('state').equals('pending').toArray()).filter((row) => row.scope === scope && !row.paused).sort((a,b) => a.createdAt-b.createdAt || a.idempotencyKey.localeCompare(b.idempotencyKey))
   const row = rows[0]; const now = clock()
   if (!row || row.nextAttemptAt>now || (row.leaseUntil ?? 0)>now) return undefined
   const claimed = {...row,attempts:row.attempts+1,updatedAt:now,leaseToken:crypto.randomUUID(),leaseUntil:now+120_000}
   await db.checkoutOutbox.put(claimed)
   return claimed
  })
  if (!job) break
  let delivery: CheckoutDelivery
  try { delivery = await send(job) }
  catch { delivery = {status:0,body:{code:'NETWORK_OR_SESSION_UNAVAILABLE',message:'En attente du réseau ou de la session de ce compte. Ne recréez pas ce ticket.'}} }
  const result = delivery.body.result
  const accepted = isCheckoutAcknowledgement(job,delivery)
  const refused = [400,403,409,422].includes(delivery.status) && businessRefusals.has(delivery.body.code ?? '')
  const applied = await db.transaction('rw',[db.workspaceMeta,db.checkoutOutbox],async () => {
   await assertCheckoutScope(db,user)
   const current = await db.checkoutOutbox.get(job.idempotencyKey)
   if (!current || current.state !== 'pending' || current.leaseToken !== job.leaseToken) return false
   const now = clock()
   const next: QueuedCheckout = {...current,updatedAt:now,leaseToken:undefined,leaseUntil:undefined}
   if (accepted) {
    next.state = 'confirmed'; next.result = result; next.error = undefined
   } else if (refused) {
    next.state = 'rejected'; next.error = {code:delivery.body.code!,message:delivery.body.message ?? 'Commande refusée par le serveur.'}
   } else {
    next.nextAttemptAt = now + Math.max(1000,Math.min(3_600_000,delivery.retryAfterMs ?? 2000 * 2 ** Math.min(current.attempts,8)))
    next.error = {code:delivery.body.code ?? 'ACK_UNAVAILABLE',message:delivery.body.message ?? 'Confirmation indisponible. La même clé sera réessayée, sans recréer le ticket.'}
   }
   // Only the acknowledgement changes: historical result snapshots must never overwrite newer stock/cache.
   await db.checkoutOutbox.put(next)
   return true
  })
  if (!applied) break
  if (accepted) stats.confirmed++
  else if (refused) stats.rejected++
  else { stats.pending++; break }
 }
 return stats
}
