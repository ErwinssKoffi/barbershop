import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import { lockSyncState } from './syncProtocol.ts'
import { hasCheckoutSchema } from './checkoutLedger.ts'
import type { SqlPoolLike } from './neonClient.ts'
import type { CheckoutResult } from '../src/domain/checkout.ts'

/** Read-only recovery: unlike a commit replay, a missing key NEVER creates a sale. */
export async function checkoutStatus(pool: SqlPoolLike, tenantId: string, actorId: string, input: unknown) {
 if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'idempotencyKey') || !('idempotencyKey' in input) || typeof input.idempotencyKey !== 'string' || !/^[a-zA-Z0-9:_-]{16,128}$/.test(input.idempotencyKey)) throw new AuthApiError(400,'INVALID_CHECKOUT','Clé de commande invalide ; seule idempotencyKey est acceptée.')
 const key = input.idempotencyKey
 if (!await hasCheckoutSchema(pool)) throw new AuthApiError(503,'CHECKOUT_MIGRATION_REQUIRED','Vérification indisponible : migration checkout non appliquée.')
 return withTenantClient(pool,tenantId,async (db) => {
  // Serializes with commits in this tenant. Does not advance a revision or consume a receipt/key.
  await lockSyncState(db)
  const membership = await db.query(`SELECT m.user_id FROM memberships m JOIN salon_users u ON u.id = m.user_id
   WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.is_active AND u.is_active`,[tenantId,actorId])
  if (!membership.rows.length) throw new AuthApiError(403,'TENANT_ACCESS_DENIED','Appartenance active requise.')
  const row = (await db.query<{actor_id:string;result_json:CheckoutResult}>('SELECT actor_id,result_json FROM checkout_commands WHERE idempotency_key = $1',[key])).rows[0]
  if (row && row.actor_id !== actorId) throw new AuthApiError(403,'CHECKOUT_ACTOR_CONFLICT','Cette intention appartient à un autre compte. Aucun détail financier n’est transmis.')
  return row ? {status:'confirmed' as const,result:row.result_json} : {status:'not_found' as const,idempotencyKey:key,tenantId,actorId}
 })
}
