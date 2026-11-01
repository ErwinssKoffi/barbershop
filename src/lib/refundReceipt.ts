import type { RefundIntent } from '../db/checkoutRefundQueue'
import { workspaceKey } from '../db/accountWorkspace'
import { stableCloudValue } from '../domain/cloudDelta'
import type { CheckoutRefundResult } from '../domain/checkoutRefund'
import type { PublicSalonUser } from '../domain/models'

/** A consistency gate for a stored API acknowledgement, NOT a cryptographic payment proof. */
export function printableRefund(intent:RefundIntent,user:PublicSalonUser|null):CheckoutRefundResult|null {
 try {
 const result=intent.result
 if(!user?.isActive || user.role!=='manager' || !user.tenantId || intent.scope!==workspaceKey(user) || intent.tenantId!==user.tenantId || intent.actorId!==user.id || intent.state!=='refunded' || !result) return null
 if(result.status!=='refunded' || result.confirmed!==true || result.actorId!==user.id || result.tenantId!==user.tenantId || !result.ticketId || !/^SPR-\d+$/.test(result.receiptNumber) || !/^SPC-\d+$/.test(result.originalReceiptNumber) || result.originalReceiptNumber!==intent.originalReceiptNumber || result.originalTicketId!==intent.command.originalTicketId || !Number.isFinite(Date.parse(result.confirmedAt)) || result.paymentExecution!=='cash_ledger_and_external_attestation') return null
 if(stableCloudValue(result.command)!==stableCloudValue(intent.command) || !result.command.reason.trim() || !Number.isSafeInteger(result.total) || result.total<0 || result.total!==intent.total) return null
 const lines=result.records.revenues
 if(!Array.isArray(lines) || !lines.length || new Set(lines.map((row) => row.id)).size!==lines.length || new Set(lines.map((row) => row.reversalOfRevenueId)).size!==lines.length) return null
 const byMethod=new Map<string,bigint>()
 let total=0n
 for(const line of lines) {
  if(!line.id || typeof line.label!=='string' || !line.reversalOfRevenueId || line.reversalOfTicketId!==result.originalTicketId || line.ticketId!==result.ticketId || line.receiptNumber!==result.receiptNumber || !Number.isSafeInteger(line.amount) || line.amount>0 || !Number.isSafeInteger(line.quantity) || (line.quantity ?? 0)>=0 || !Array.isArray(line.paymentSplits)) return null
  total+=BigInt(line.amount)
  let splitTotal=0n
  for(const split of line.paymentSplits) {
   if(!split.method || !Number.isSafeInteger(split.amount) || split.amount>0) return null
   splitTotal+=BigInt(split.amount)
   byMethod.set(split.method,(byMethod.get(split.method) ?? 0n)-BigInt(split.amount))
  }
  if(splitTotal!==BigInt(line.amount)) return null
 }
 if(total!==-BigInt(result.total) || !Array.isArray(result.payments) || new Set(result.payments.map((row) => row.method)).size!==result.payments.length) return null
 let paymentTotal=0n
 for(const payment of result.payments) {
  if(!Number.isSafeInteger(payment.amount) || payment.amount<0 || byMethod.get(payment.method)!==BigInt(payment.amount)) return null
  paymentTotal+=BigInt(payment.amount);byMethod.delete(payment.method)
 }
 if(paymentTotal!==BigInt(result.total) || [...byMethod.values()].some((amount) => amount!==0n)) return null
 const refs=result.command.paymentReferences
 const external=result.payments.filter((row) => row.method!=='cash')
 if(!Array.isArray(refs) || refs.length!==external.length || new Set(refs.map((row) => row.method)).size!==refs.length || refs.some((ref) => typeof ref.reference!=='string' || !ref.reference.trim() || !external.some((row) => row.method===ref.method))) return null
 if(!Array.isArray(result.command.returnLineIds) || result.command.returnLineIds.some((id) => !lines.some((line) => line.reversalOfRevenueId===id && line.productId))) return null
 return result
 } catch {return null}
}
