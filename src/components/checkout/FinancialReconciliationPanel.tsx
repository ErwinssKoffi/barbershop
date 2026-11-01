import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/authContext'
import { workspaceKey } from '../../db/accountWorkspace'
import type { PublicSalonUser } from '../../domain/models'
import { RECONCILIATION_CHECKS, type FinancialReconciliation, type ReconciliationCheck } from '../../domain/financialReconciliation'
import { readFinancialReconciliation } from '../../lib/financialReconciliationClient'
import { formatDateTimeFR } from '../../utils/format'
import { Button } from '../ui/button'

const labels:Record<ReconciliationCheck,string>={
 documentTotals:'Totaux des tickets et paiements',canonicalRecords:'Écritures canoniques et projections',recordOwnership:'Rattachement des écritures aux tickets',cashSessionBalances:'Soldes des sessions de caisse',orphanCashMovements:'Mouvements de caisse sans session',invalidCashMovements:'Mouvements de caisse invalides',
}
function ManagerPanel({user}:{user:PublicSalonUser}) {
 const [report,setReport]=useState<FinancialReconciliation|null>(null)
 const [error,setError]=useState('');const [busy,setBusy]=useState(false)
 const flight=useRef(false);const alive=useRef(true)
 useEffect(() => {alive.current=true;return () => {alive.current=false}},[])
 const inspect=async () => {
  if(flight.current) return
  flight.current=true;setBusy(true);setReport(null);setError('')
  try {const value=await readFinancialReconciliation(user);if(alive.current) setReport(value)}
  catch {if(alive.current) setError('Contrôle Cloud indisponible ou refusé. Vérifiez la connexion, la session Gérant et les migrations. Aucun résultat local substitué.')}
  finally {flight.current=false;if(alive.current) setBusy(false)}
 }
 return <section aria-label="Rapprochement financier Cloud" className="rounded-lg border p-4 space-y-3 mb-4">
  <h3 className="font-semibold">Contrôle financier — lecture seule</h3>
  <p className="text-sm">Compare les tickets serveur confirmés à leurs écritures et les sessions de caisse à leur journal. Ne modifie aucun montant, stock ou paiement.</p>
  <Button type="button" variant="outline" disabled={busy} onClick={() => void inspect()}>{busy ? 'Contrôle en cours…' : 'Vérifier les écritures Cloud'}</Button>
  {error && <p role="alert">{error}</p>}
  {report && <div role="status" className="space-y-2">
   <p className="font-medium">{report.status==='balanced' ? 'Aucun écart détecté sur le périmètre contrôlé.' : report.status==='discrepancies' ? 'Écarts détectés — examen par le Gérant requis.' : 'Contrôle incomplet — migration des remboursements indisponible.'}</p>
   <p className="text-sm">Instantané du {formatDateTimeFR(report.checkedAt)} · {report.documentsChecked} ticket(s) · {report.cashSessionsChecked} session(s) de caisse.</p>
   {!report.refundsAvailable && <p>Les remboursements ne sont pas couverts : migration 007 requise, à appliquer uniquement après les sauvegardes et validations prévues.</p>}
   <ul className="text-sm space-y-1">{RECONCILIATION_CHECKS.map((key) => <li key={key}>{labels[key]} : {report.checks[key]} écart(s)</li>)}</ul>
   <p className="text-sm">Résultat ponctuel, pas une surveillance en temps réel ni une autorisation de production. Ne couvre pas les ventes locales en attente, un inventaire physique ou les transferts externes. Aucune correction automatique.</p>
  </div>}
 </section>
}
export function FinancialReconciliationPanel() {
 const {currentUser}=useAuth()
 if(!currentUser?.isActive || currentUser.role!=='manager' || !currentUser.tenantId) return null
 return <ManagerPanel key={workspaceKey(currentUser)} user={currentUser}/>
}
