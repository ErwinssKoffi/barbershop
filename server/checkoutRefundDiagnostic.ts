import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import { lockSyncState } from './syncProtocol.ts'
import { reviewRefund, assertRefundManager } from './checkoutRefund.ts'
import type { SqlPoolLike } from './neonClient.ts'
import type { CheckoutRefundDiagnostic } from '../src/domain/checkoutRefund.ts'
import type { CheckoutResult } from '../src/domain/checkout.ts'
import type { CashSession, ProductItem } from '../src/domain/models/index.ts'

/** Advisory only: authoritative journal read, no reconciliation writes, corrections or authorization. */
export async function diagnoseRefund(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown):Promise<CheckoutRefundDiagnostic> {
 const review=await reviewRefund(pool,tenantId,actorId,input)
 return withTenantClient(pool,tenantId,async (db) => {
  await lockSyncState(db);await assertRefundManager(db,tenantId,actorId)
  if((await db.query('SELECT idempotency_key FROM checkout_refunds WHERE idempotency_key=$1 OR original_ticket_id=$2',[review.command.idempotencyKey,review.command.originalTicketId])).rows.length) throw new AuthApiError(409,'REFUND_ALREADY_CONFIRMED','Un remboursement a été confirmé : vérifiez le statut sans renvoyer.')
  const original=(await db.query<{result_json:CheckoutResult}>('SELECT result_json FROM checkout_commands WHERE ticket_id=$1',[review.originalTicketId])).rows[0]?.result_json
  if(!original) throw new AuthApiError(404,'REFUND_TICKET_UNAVAILABLE','Ticket canonique absent.')
  const cashRequired=review.payments.find((payment) => payment.method==='cash')?.amount ?? 0
  const diagnostic:CheckoutRefundDiagnostic={status:'diagnosed',tenantId,actorId,checkedAt:new Date().toISOString(),command:review.command,originalReceiptNumber:review.originalReceiptNumber,total:review.total,cashRequired,cashBalance:null,blockers:[]}
  const block=(code:CheckoutRefundDiagnostic['blockers'][number]['code'],message:string,entityId:string) => diagnostic.blockers.push({code,message,entityId})
  const safe=(value:number) => Number.isSafeInteger(value) && value>=0
  if(cashRequired) {
   const id=review.command.cashSessionId!
   const session=(await db.query<{payload_json:CashSession}>('SELECT payload_json FROM cash_sessions WHERE id=$1',[id])).rows[0]?.payload_json
   if(!session) block('CASH_SESSION_MISSING','Caisse conservée absente ; aucune autre caisse sélectionnée automatiquement.',id)
   else {
    if(session.status!=='open') block('CASH_SESSION_CLOSED','Caisse conservée clôturée ; un changement de caisse doit être supervisé.',id)
    const movements=(await db.query<{type:string;amount:string|number}>('SELECT type,amount FROM cash_movements WHERE session_id=$1',[id])).rows
    let valid=safe(session.openingBalance);let balance=valid ? BigInt(session.openingBalance) : 0n
    for(const row of movements) {
     const amount=Number(row.amount)
     if(!safe(amount) || !['in','correction_in','out','correction_out'].includes(row.type)) {valid=false;continue}
     balance+=BigInt(amount)*(['in','correction_in'].includes(row.type) ? 1n : -1n)
    }
    if(!valid || balance>BigInt(Number.MAX_SAFE_INTEGER) || balance<BigInt(Number.MIN_SAFE_INTEGER)) block('CASH_DATA_INVALID','Journal de caisse incohérent ou hors limite ; contrôle manuel requis.',id)
    else {diagnostic.cashBalance=Number(balance);if(balance<BigInt(cashRequired)) block('CASH_INSUFFICIENT','Solde du journal insuffisant pour la sortie d’espèces.',id)}
   }
  }
  const quantities=new Map<string,number>()
  for(const id of review.command.returnLineIds) {
   const line=original.records.revenues.find((row) => row.id===id)!
   const movement=original.records.stockMovements.find((row) => row.id===line.linkedStockMovementId && row.type==='sale' && row.productId===line.productId)
   if(!movement) {block('STOCK_SNAPSHOT_MISSING','Sortie produit canonique absente ; aucun retour de stock autorisé.',id);continue}
   const product=(await db.query<{payload_json:ProductItem}>('SELECT payload_json FROM products WHERE id=$1',[movement.productId])).rows[0]?.payload_json
   if(!product) {block('PRODUCT_UNAVAILABLE','Produit absent ; aucune recréation automatique.',movement.productId);continue}
   const quantity=-movement.quantityDelta
   if(!safe(product.quantity) || !safe(product.costPrice) || !safe(movement.unitCost) || !safe(quantity) || !quantity) {block('STOCK_DATA_INVALID','Quantité ou coût produit incohérent ; contrôle manuel requis.',movement.productId);continue}
   const next=(quantities.get(product.id) ?? product.quantity)+quantity
   quantities.set(product.id,next)
   if(!Number.isSafeInteger(next) || next>2147483647) block('RETURN_QUANTITY_OVERFLOW','Le retour dépasserait la limite de stock.',product.id)
  }
  return diagnostic
 })
}
