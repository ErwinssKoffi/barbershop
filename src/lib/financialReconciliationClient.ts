import type { PublicSalonUser } from '../domain/models'
import { validateFinancialReconciliation } from '../domain/financialReconciliation'
import { workspaceKey } from '../db/accountWorkspace'
import { accessClaims, currentAccessToken, readStoredSession } from './sessionClient'
import { fetchWithCapturedSession } from './scopedSyncClient'

export async function readFinancialReconciliation(user:PublicSalonUser) {
 const token=await currentAccessToken();const session=readStoredSession();const claims=accessClaims(token)
 if(!user.isActive || user.role!=='manager' || !user.tenantId || !session.user || workspaceKey(session.user)!==workspaceKey(user) || !token || claims?.uid!==user.id || claims.tid!==user.tenantId) throw new Error('Reconnectez le Gérant de cet espace pour contrôler les finances.')
 const controller=new AbortController();const timeout=window.setTimeout(() => controller.abort(),20_000)
 try {
  const response=await fetchWithCapturedSession('/api/checkout/reconciliation',token,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:'{}'})
  const body=await response.json()
  const latest=readStoredSession()
  if(!latest.user?.isActive || latest.user.role!=='manager' || workspaceKey(latest.user)!==workspaceKey(user) || latest.token!==token) throw new Error('Session modifiée : résultat non affiché.')
  if(!response.ok || body?.ok!==true) throw new Error('Rapprochement Cloud indisponible ou refusé. Aucun bilan local de remplacement.')
  return validateFinancialReconciliation(body.report,user.tenantId)
 } finally {window.clearTimeout(timeout)}
}
