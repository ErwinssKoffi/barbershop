import type { CheckoutResult } from '../domain/checkout'
import type { CheckoutRefundCommand, CheckoutRefundResult, CheckoutRefundReview } from '../domain/checkoutRefund'
import type { PublicSalonUser } from '../domain/models'
import { stableCloudValue } from '../domain/cloudDelta'
import type { SalonProDatabase } from './database'
import { assertCheckoutScope } from './checkoutQueue'

export interface RefundIntent {
 scope:string; tenantId:string; actorId:string; originalReceiptNumber:string; total:number
 command:CheckoutRefundCommand
 state:'prepared'|'uncertain'|'not_found'|'refunded'
 verificationOnly?:boolean
 review?:CheckoutRefundReview
 result?:CheckoutRefundResult
 message?:string
}
const key=(ticketId:string) => `refundIntent:${ticketId}`
async function scope(db:SalonProDatabase,user:PublicSalonUser) {
 if(user.role!=='manager') throw new Error('Remboursement réservé au Gérant.')
 return assertCheckoutScope(db,user)
}
export async function readRefundIntent(db:SalonProDatabase,user:PublicSalonUser,ticketId:string):Promise<RefundIntent|null> {
 const account=await scope(db,user)
 const stored=await db.workspaceMeta.get(key(ticketId))
 if(!stored) return null
 const row=JSON.parse(stored.value) as RefundIntent
 if(row.scope!==account || row.actorId!==user.id || row.tenantId!==user.tenantId || row.command?.originalTicketId!==ticketId || !/^[a-zA-Z0-9:_-]{16,128}$/.test(row.command.idempotencyKey) || !['prepared','uncertain','not_found','refunded'].includes(row.state)) throw new Error('Intention incompatible : conserver cet espace et demander un contrôle manuel.')
 return row
}
/** Atomic one-intent-per-ticket preparation, including between tabs. No local financial projection. */
export async function prepareRefundIntent(db:SalonProDatabase,user:PublicSalonUser,original:CheckoutResult,input:Omit<CheckoutRefundCommand,'idempotencyKey'|'originalTicketId'>):Promise<RefundIntent> {
 return db.transaction('rw',db.workspaceMeta,async () => {
 const account=await scope(db,user)
 const existing=await readRefundIntent(db,user,original.ticketId)
 if(existing) return existing
 if(!original.confirmed || original.tenantId!==user.tenantId || !/^SPC-\d+$/.test(original.receiptNumber)) throw new Error('Ticket confirmé du salon requis.')
 if(!input.reason.trim() || input.reason.length>500) throw new Error('Motif requis (500 caractères maximum).')
 const returnLineIds=[...new Set(input.returnLineIds)].sort()
 if(returnLineIds.some((id) => !original.records.revenues.some((row) => row.id===id && row.productId))) throw new Error('Retour produit invalide.')
 const methods=original.command.payments.filter((row) => row.method!=='cash').map((row) => row.method).sort()
 const refs=input.paymentReferences.map((row) => ({method:row.method,reference:row.reference.trim()})).sort((a,b) => a.method.localeCompare(b.method))
 if(stableCloudValue(methods)!==stableCloudValue(refs.map((row) => row.method).sort()) || refs.some((row) => !row.reference || row.reference.length>200)) throw new Error('Référence attestant chaque remboursement externe requise.')
 const cash=original.command.payments.some((row) => row.method==='cash' && row.amount>0)
 if(cash && !input.cashSessionId) throw new Error('Sélectionnez une caisse ouverte pour les espèces.')
 const command:CheckoutRefundCommand={idempotencyKey:`refund-${crypto.randomUUID()}`,originalTicketId:original.ticketId,reason:input.reason.trim(),returnLineIds,paymentReferences:refs,...(cash ? {cashSessionId:input.cashSessionId} : {})}
 const intent:RefundIntent={scope:account,tenantId:user.tenantId!,actorId:user.id,originalReceiptNumber:original.receiptNumber,total:original.quote.total,command,state:'prepared'}
 await db.workspaceMeta.put({key:key(original.ticketId),value:JSON.stringify(intent)})
 return intent
 })
}
export interface RefundDelivery {status:number;body:Record<string,unknown>}
export type RefundTransport=(intent:RefundIntent,operation:'send'|'status'|'review'|'diagnostic')=>Promise<RefundDelivery>
function acknowledgement(row:RefundIntent,delivery:RefundDelivery):CheckoutRefundResult|undefined {
 const result=delivery.body.result as CheckoutRefundResult|undefined
 if(delivery.status!==200 || delivery.body.ok!==true || !result || result.status!=='refunded' || result.confirmed!==true || result.tenantId!==row.tenantId || result.actorId!==row.actorId || result.originalTicketId!==row.command.originalTicketId || result.originalReceiptNumber!==row.originalReceiptNumber || result.total!==row.total || !/^SPR-\d+$/.test(result.receiptNumber) || !result.ticketId || stableCloudValue(result.command)!==stableCloudValue(row.command) || !Array.isArray(result.records?.revenues) || !Array.isArray(result.records?.stockMovements) || !Array.isArray(result.records?.cashMovements) || !Array.isArray(result.records?.products)) return undefined
 return result
}
/** Explicit manual recovery only. Persist uncertainty BEFORE network; never rekey or apply stale snapshots. */
export async function operateRefundIntent(db:SalonProDatabase,user:PublicSalonUser,ticketId:string,operation:'send'|'status',transport:RefundTransport):Promise<void> {
 const row=await db.transaction('rw',db.workspaceMeta,async () => {
 const saved=await readRefundIntent(db,user,ticketId)
 if(!saved) throw new Error('Préparez et enregistrez la commande avant envoi.')
 if(saved.state==='refunded') return saved
 if(operation==='send' && saved.verificationOnly && !validRefundReview(saved,saved.review)) throw new Error('Intention restaurée : vérification seule. Un contrôle du ticket canonique est requis avant toute nouvelle exécution.')
 if(operation==='send' && !['prepared','not_found'].includes(saved.state)) throw new Error('Vérifiez le statut au serveur avant tout nouvel envoi.')
 const next={...saved,...(operation==='status' ? {review:undefined} : {}),state:'uncertain' as const,message:'Vérification nécessaire ; ne recréez pas ce remboursement.'}
 await db.workspaceMeta.put({key:key(ticketId),value:JSON.stringify(next)})
 return next
 })
 if(row.state==='refunded') return
 let delivery:RefundDelivery
 try {delivery=await transport(row,operation)} catch {return} // durable uncertainty survives network loss/reload
 await db.transaction('rw',db.workspaceMeta,async () => {
 const current=await readRefundIntent(db,user,ticketId)
 if(!current || current.state==='refunded' || stableCloudValue(current.command)!==stableCloudValue(row.command)) return
 const result=acknowledgement(row,delivery)
 const absent=operation==='status' && delivery.status===200 && delivery.body.ok===true && delivery.body.status==='not_found' && delivery.body.idempotencyKey===row.command.idempotencyKey && delivery.body.tenantId===row.tenantId && delivery.body.actorId===row.actorId
 const next:RefundIntent=result ? {...current,state:'refunded',result,message:'Remboursement confirmé au serveur. Chargez les écritures Cloud pour actualiser les indicateurs.'} : absent ? {...current,state:'not_found',message:'Non trouvé au serveur. Reprise explicite possible avec la même clé ; vérifiez les remboursements externes réels.'} : {...current,state:'uncertain',message:typeof delivery.body.code==='string' ? `Contrôle requis (${delivery.body.code}). Commande conservée sans changement de clé.` : 'Réponse non concluante. Vérifiez le statut ; aucune confirmation locale.'}
 await db.workspaceMeta.put({key:key(ticketId),value:JSON.stringify(next)})
 })
}


function validRefundReview(row:RefundIntent,value:unknown):value is CheckoutRefundReview {
 try {
 const review=value as CheckoutRefundReview
 if(!review || review.status!=='reviewed' || review.actorId!==row.actorId || review.tenantId!==row.tenantId || review.originalTicketId!==row.command.originalTicketId || review.originalReceiptNumber!==row.originalReceiptNumber || review.total!==row.total || stableCloudValue(review.command)!==stableCloudValue(row.command) || review.precondition?.total!==row.total || review.precondition.originalReceiptNumber!==row.originalReceiptNumber || !/^[a-f0-9]{64}$/.test(review.precondition.fingerprint)) return false
 if(!Array.isArray(review.lines) || !review.lines.length || new Set(review.lines.map((line) => line.id)).size!==review.lines.length || !Array.isArray(review.payments) || new Set(review.payments.map((payment) => payment.method)).size!==review.payments.length) return false
 if(review.lines.some((line) => !line.id || typeof line.label!=='string' || !Number.isSafeInteger(line.amount) || line.amount<0 || !Number.isSafeInteger(line.quantity) || line.quantity<=0 || line.returned!==row.command.returnLineIds.includes(line.id) || (line.returned && !line.productId))) return false
 if(review.payments.some((payment) => typeof payment.method!=='string' || !Number.isSafeInteger(payment.amount) || payment.amount<0)) return false
 const external=review.payments.filter((payment) => payment.method!=='cash')
 if(external.length!==row.command.paymentReferences.length || external.some((payment) => !row.command.paymentReferences.some((ref) => ref.method===payment.method))) return false
 if(review.payments.some((payment) => payment.method==='cash' && payment.amount>0) ? !row.command.cashSessionId : Boolean(row.command.cashSessionId)) return false
 return review.lines.reduce((sum,line) => sum+BigInt(line.amount),0n)===BigInt(row.total) && review.payments.reduce((sum,payment) => sum+BigInt(payment.amount),0n)===BigInt(row.total) && row.command.returnLineIds.every((id) => review.lines.some((line) => line.id===id && line.productId))
 } catch {return false}
}
/** Only a fresh read-only absence check permits canonical review. It never sends a refund. */
export async function reviewRestoredRefund(db:SalonProDatabase,user:PublicSalonUser,ticketId:string,transport:RefundTransport):Promise<void> {
 const row=await db.transaction('rw',db.workspaceMeta,async () => {
  const saved=await readRefundIntent(db,user,ticketId)
  if(!saved?.verificationOnly || saved.state!=='not_found') throw new Error('Vérifiez d’abord le statut serveur de cette intention importée.')
  const next={...saved,review:undefined}
  await db.workspaceMeta.put({key:key(ticketId),value:JSON.stringify(next)})
  return next
 })
 const delivery=await transport(row,'review')
 if(delivery.status!==200 || delivery.body.ok!==true || !validRefundReview(row,delivery.body.review)) throw new Error('Contrôle canonique refusé ou incohérent. Aucun envoi autorisé ; conservez la clé et le fichier.')
 await db.transaction('rw',db.workspaceMeta,async () => {
  const current=await readRefundIntent(db,user,ticketId)
  if(!current?.verificationOnly || current.state!=='not_found' || stableCloudValue(current.command)!==stableCloudValue(row.command)) throw new Error('État modifié pendant le contrôle ; vérifiez de nouveau le statut.')
  await db.workspaceMeta.put({key:key(ticketId),value:JSON.stringify({...current,review:delivery.body.review,message:'Ticket canonique contrôlé. Vérifiez les détails et paiements externes avant toute reprise explicite avec préconditions.'})})
 })
}
