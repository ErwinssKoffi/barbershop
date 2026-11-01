import type { SalonProDatabase } from './database'
import type { PublicSalonUser } from '../domain/models'
import type { CheckoutRefundDiagnostic } from '../domain/checkoutRefund'
import { stableCloudValue } from '../domain/cloudDelta'
import { readRefundIntent, type RefundTransport } from './checkoutRefundQueue'

/** Display-only, never stores a result, releases a held intention or changes a key. */
export async function inspectRefundDiagnostic(db:SalonProDatabase,user:PublicSalonUser,ticketId:string,transport:RefundTransport):Promise<CheckoutRefundDiagnostic> {
 const row=await readRefundIntent(db,user,ticketId)
 if(!row || row.state==='refunded') throw new Error('Diagnostic réservé à une intention non confirmée de cet espace.')
 const delivery=await transport(row,'diagnostic')
 const result=delivery.body.diagnostic as CheckoutRefundDiagnostic|undefined
 const codes=['CASH_SESSION_MISSING','CASH_SESSION_CLOSED','CASH_DATA_INVALID','CASH_INSUFFICIENT','PRODUCT_UNAVAILABLE','STOCK_SNAPSHOT_MISSING','STOCK_DATA_INVALID','RETURN_QUANTITY_OVERFLOW']
 if(delivery.status!==200 || delivery.body.ok!==true || !result || result.status!=='diagnosed' || result.tenantId!==row.tenantId || result.actorId!==row.actorId || result.total!==row.total || result.originalReceiptNumber!==row.originalReceiptNumber || stableCloudValue(result.command)!==stableCloudValue(row.command) || !Number.isFinite(Date.parse(result.checkedAt)) || !Number.isSafeInteger(result.cashRequired) || result.cashRequired<0 || (result.cashBalance!==null && !Number.isSafeInteger(result.cashBalance)) || !Array.isArray(result.blockers) || result.blockers.length>201 || result.blockers.some((block) => !codes.includes(block.code) || typeof block.message!=='string' || typeof block.entityId!=='string')) throw new Error('Diagnostic refusé ou incohérent. Vérifiez le statut sans modifier la commande.')
 const current=await readRefundIntent(db,user,ticketId)
 if(!current || current.state==='refunded' || stableCloudValue(current.command)!==stableCloudValue(row.command)) throw new Error('Intention modifiée pendant le diagnostic ; rechargez son statut.')
 return result
}
