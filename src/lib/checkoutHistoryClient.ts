import type { PublicSalonUser } from '../domain/models'
import type { CheckoutHistoryDetail, CheckoutHistoryPage, CheckoutHistoryQuery } from '../domain/checkoutHistory'
import { workspaceKey } from '../db/accountWorkspace'
import { accessClaims, currentAccessToken, readStoredSession } from './sessionClient'
import { fetchWithCapturedSession } from './scopedSyncClient'

async function request(user:PublicSalonUser,path:string,input:unknown):Promise<Record<string,unknown>> {
 const token=await currentAccessToken();const session=readStoredSession();const claims=accessClaims(token)
 if(!user.isActive || user.role!=='manager' || !user.tenantId || !session.user || workspaceKey(session.user)!==workspaceKey(user) || !token || claims?.uid!==user.id || claims.tid!==user.tenantId) throw new Error('Reconnectez le Gérant de cet espace pour consulter les tickets.')
 const controller=new AbortController();const timeout=window.setTimeout(() => controller.abort(),20_000)
 try {
  const response=await fetchWithCapturedSession(path,token,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
  const body=await response.json()
  const latest=readStoredSession()
  if(!latest.user || !latest.user.isActive || workspaceKey(latest.user)!==workspaceKey(user)) throw new Error('Compte modifié : résultat non affiché.')
  if(!response.ok || body?.ok!==true || body.tenantId!==user.tenantId) throw new Error('Consultation serveur indisponible ou refusée. Aucun ticket local de remplacement.')
  return body
 } finally {window.clearTimeout(timeout)}
}
const refundStatus=(value:unknown) => ['refunded','not_refunded','unavailable'].includes(String(value))
export async function searchServerTickets(user:PublicSalonUser,input:CheckoutHistoryQuery):Promise<CheckoutHistoryPage> {
 const body=await request(user,'/api/checkout/history/search',input)
 const page=body as unknown as CheckoutHistoryPage
 if(!Array.isArray(page.rows) || page.rows.length>20 || page.rows.some((row) => !row.ticketId || !/^SPC-\d+$/.test(row.receiptNumber) || !Number.isSafeInteger(row.total) || row.total<0 || !row.actorId || !Number.isFinite(Date.parse(row.confirmedAt)) || !refundStatus(row.refundStatus)) || (page.nextCursor!==null && (!page.nextCursor?.ticketId || !Number.isFinite(Date.parse(page.nextCursor.createdAt))))) throw new Error('Page de tickets incohérente.')
 return page
}
export async function readServerTicket(user:PublicSalonUser,ticketId:string):Promise<CheckoutHistoryDetail> {
 const body=await request(user,'/api/checkout/history/detail',{ticketId})
 const detail=body as unknown as CheckoutHistoryDetail;const result=detail.result
 if(!refundStatus(detail.refundStatus) || !result || result.ticketId!==ticketId || result.tenantId!==user.tenantId || result.status!=='confirmed' || result.confirmed!==true || !/^SPC-\d+$/.test(result.receiptNumber) || !Number.isSafeInteger(result.quote?.total) || result.quote.total<0 || !Array.isArray(result.records?.revenues) || !result.records.revenues.length || result.records.revenues.some((row) => !Number.isSafeInteger(row.amount) || row.amount<0 || row.ticketId!==ticketId || row.receiptNumber!==result.receiptNumber) || result.records.revenues.reduce((sum,row) => sum+BigInt(row.amount),0n)!==BigInt(result.quote.total) || !Array.isArray(result.command?.payments) || result.command.payments.some((row) => !row.method || !Number.isSafeInteger(row.amount) || row.amount<0) || result.command.payments.reduce((sum,row) => sum+BigInt(row.amount),0n)!==BigInt(result.quote.total)) throw new Error('Détail canonique incohérent ; aucun remboursement préparé.')
 return detail
}
