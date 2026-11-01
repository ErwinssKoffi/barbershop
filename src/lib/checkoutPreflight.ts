import { fetchWithCapturedSession } from './scopedSyncClient'
import { serverCheckoutEnabled } from './checkoutClient'
import type { CheckoutCutoverReport } from '../domain/checkoutCutover'

/** Must run before any pull/merge: never normalize away an unsent legacy sale during cutover. */
export async function checkCheckoutPreflight(envelope:unknown, expectedToken:string, onReport?:(report:CheckoutCutoverReport)=>Promise<void>):Promise<CheckoutCutoverReport> {
 const response=await fetchWithCapturedSession('/api/checkout/preflight',expectedToken,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(envelope)})
 const data=await response.json() as {ok?:boolean;message?:string;report?:CheckoutCutoverReport}
 const report=data.report
 if(!response.ok || !data.ok || !report || !['legacy','enforced'].includes(report.mode) || typeof report.canSync !== 'boolean' || !Number.isSafeInteger(report.blockedCount) || report.blockedCount<0 || !Array.isArray(report.blockers)) throw new Error(data.message ?? 'Prévol de bascule indisponible. Aucune synchronisation appliquée ; mettez le serveur et le client à jour ensemble.')
 await onReport?.(report)
 if(report.mode === 'enforced') {
  if(!report.checkoutSchemaReady || !report.activationApproved) throw new Error('Bascule serveur non prête : migration 006 et approbation opérateur requises. Données locales conservées.')
  if(report.blockedCount || !report.canSync) throw new Error(`${report.blockedCount} opération(s) de vente historique attendent un rapprochement. Aucun pull/push appliqué. Sauvegardez les données métier ; ne convertissez pas ces ventes automatiquement en nouvelles commandes.`)
  if(!serverCheckoutEnabled()) throw new Error('Le serveur exige la caisse autoritaire. Ce client n’a pas le pilote activé : mettez-le à jour avant de poursuivre. Données locales conservées.')
 }
 return report
}
