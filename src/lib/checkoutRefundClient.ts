import { workspaceKey } from '../db/accountWorkspace'
import type { RefundTransport } from '../db/checkoutRefundQueue'
import { accessClaims, currentAccessToken, readStoredSession } from './sessionClient'
import { fetchWithCapturedSession } from './scopedSyncClient'
import { serverCheckoutEnabled } from './checkoutClient'

export const requestRefund:RefundTransport=async (intent,operation) => {
 if(operation==='send' && !serverCheckoutEnabled()) throw new Error('Pilote serveur désactivé ; aucun remboursement envoyé.')
 const token=await currentAccessToken();const session=readStoredSession();const claims=accessClaims(token)
 if(!token || !session.user || session.user.role!=='manager' || workspaceKey(session.user)!==intent.scope || claims?.uid!==intent.actorId || claims.tid!==intent.tenantId) throw new Error('Reconnectez le Gérant de cette intention.')
 const controller=new AbortController();const timeout=window.setTimeout(() => controller.abort(),20_000)
 try {
 if(operation==='send' && intent.verificationOnly && !intent.review) throw new Error('Contrôle canonique requis avant reprise.')
 const path=operation==='diagnostic' ? '/api/checkout/refund/diagnostic' : operation==='review' ? '/api/checkout/refund/review' : operation==='status' ? '/api/checkout/refund/status' : intent.verificationOnly ? '/api/checkout/refund/resume' : '/api/checkout/refund'
 const input=(operation==='review' || operation==='diagnostic') ? {command:intent.command,expectedTotal:intent.total,expectedOriginalReceiptNumber:intent.originalReceiptNumber} : operation==='status' ? {idempotencyKey:intent.command.idempotencyKey} : intent.verificationOnly ? {command:intent.command,precondition:intent.review!.precondition} : intent.command
 const response=await fetchWithCapturedSession(path,token,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
 const body=await response.json()
 const latest=readStoredSession()
 if(!latest.user || workspaceKey(latest.user)!==intent.scope) throw new Error('Compte modifié : confirmation non appliquée.')
 if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error('Réponse invalide.')
 return {status:response.status,body}
 } finally {window.clearTimeout(timeout)}
}
