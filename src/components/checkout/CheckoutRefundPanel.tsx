import { PrintableRefundModal } from './PrintableRefundModal'
import { printableRefund } from '../../lib/refundReceipt'
import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import type { CheckoutResult } from '../../domain/checkout'
import { useAuth } from '../../contexts/authContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { workspaceKey } from '../../db/accountWorkspace'
import { operateRefundIntent, prepareRefundIntent, readRefundIntent, type RefundIntent } from '../../db/checkoutRefundQueue'
import { requestRefund } from '../../lib/checkoutRefundClient'
import { serverCheckoutEnabled } from '../../lib/checkoutClient'
import { formatFCFA } from '../../utils/format'
import { Button } from '../ui/button'

/** Only confirmed local outbox tickets are eligible in this first UI. Server authorizes everything again. */
export function CheckoutRefundPanel({original}:{original:CheckoutResult}) {
 const {currentUser}=useAuth();const {state,syncWithRepo}=useSalonStore()
 const [printOpen,setPrintOpen]=useState(false)
 const [intent,setIntent]=useState<RefundIntent|null>(null)
 const [loaded,setLoaded]=useState(false);const [error,setError]=useState('')
 const [busy,setBusy]=useState(false);const flight=useRef(false)
 const [reason,setReason]=useState('');const [returns,setReturns]=useState<string[]>([])
 const [cashSessionId,setCashSessionId]=useState('');const [references,setReferences]=useState<Record<string,string>>({})
 const scope=currentUser ? workspaceKey(currentUser) : ''
 useEffect(() => {
  let active=true;let unsubscribe=() => {}
  if(currentUser?.role==='manager' && original.tenantId===currentUser.tenantId) {
   void syncWithRepo(async (repo) => repo.database).then((db) => {
    if(!active) return
    const sub=liveQuery(() => readRefundIntent(db,currentUser,original.ticketId)).subscribe({next:(row) => {if(active){setIntent(row);setLoaded(true)}},error:() => {if(active) setError('Lecture du suivi impossible ; aucun envoi autorisé.')}})
    unsubscribe=() => sub.unsubscribe()
   }).catch(() => {if(active) setError('Espace de remboursement indisponible.')})
  }
  return () => {active=false;unsubscribe()}
 },[currentUser,original.ticketId,original.tenantId,syncWithRepo])
 if(currentUser?.role!=='manager' || !currentUser.isActive || original.tenantId!==currentUser.tenantId) return null
 const visible=intent?.scope===scope ? intent : null
 const external=original.command.payments.filter((payment) => payment.method!=='cash')
 const cash=original.command.payments.some((payment) => payment.method==='cash' && payment.amount>0)
 const run=async (action:()=>Promise<unknown>) => {
  if(flight.current) return
  flight.current=true;setBusy(true);setError('')
  try {await action();const latest=await syncWithRepo((repo) => readRefundIntent(repo.database,currentUser,original.ticketId));setIntent(latest)} catch(e) {setError(e instanceof Error ? e.message : 'Opération indisponible.')}
  finally {flight.current=false;setBusy(false)}
 }
 return <section aria-label={`Remboursement ${original.receiptNumber}`} className="mt-3 border rounded p-3 space-y-2">
  <h3 className="font-semibold">Remboursement intégral — {original.receiptNumber} · {formatFCFA(original.quote.total)}</h3>
  <p>Gérant uniquement. Aucun paiement externe n’est exécuté par cette application. Ne remboursez pas deux fois chez le prestataire en cas de réponse perdue.</p>
  {!serverCheckoutEnabled() && <p>Pilote désactivé : conservation et vérification seulement, aucun nouvel envoi.</p>}
  {error && <p role="alert">{error}</p>}
  {!loaded && <p>Vérification du suivi local…</p>}
  {loaded && !visible && <fieldset disabled={busy || !serverCheckoutEnabled()} className="space-y-2">
   <label className="block">Motif obligatoire<textarea className="block border rounded p-2 w-full" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label>
   {original.records.revenues.filter((row) => row.productId).map((row) => <label className="block" key={row.id}><input type="checkbox" checked={returns.includes(row.id)} onChange={(event) => setReturns(event.target.checked ? [...returns,row.id] : returns.filter((id) => id!==row.id))}/> Remettre en stock : {row.label} · {row.quantity} unité(s)</label>)}
   <p>Aucun produit coché = aucun retour. Les consommables des prestations ne sont jamais restaurés.</p>
   {cash && <label className="block">Caisse ouverte pour la sortie d’espèces<select className="block border p-2" value={cashSessionId} onChange={(event) => setCashSessionId(event.target.value)}><option value="">Sélectionner</option>{state.cashSessions.filter((row) => row.status==='open').map((row) => <option key={row.id} value={row.id}>{row.id} · solde indicatif {formatFCFA(row.theoreticalClosingBalance)}</option>)}</select></label>}
   {external.map((payment) => <label className="block" key={payment.method}>Référence du remboursement externe effectué — {payment.method} · {formatFCFA(payment.amount)}<input className="block border rounded p-2 w-full" maxLength={200} value={references[payment.method] ?? ''} onChange={(event) => setReferences({...references,[payment.method]:event.target.value})}/></label>)}
   <Button type="button" onClick={() => void run(() => syncWithRepo((repo) => prepareRefundIntent(repo.database,currentUser,original,{reason,returnLineIds:returns,paymentReferences:external.map((payment) => ({method:payment.method,reference:references[payment.method] ?? ''})),...(cash ? {cashSessionId} : {})})))}>Enregistrer la commande sans envoyer</Button>
  </fieldset>}
  {visible && <div className="space-y-2">
   <p role="status">{visible.state==='refunded' ? `Confirmé — ${visible.result?.receiptNumber}` : visible.state==='prepared' ? 'Préparé, non confirmé' : visible.state==='not_found' ? 'Non trouvé au dernier contrôle' : 'Issue incertaine — contrôle serveur requis'}</p>
   <p>{visible.message}</p><code className="break-all text-xs">{visible.command.idempotencyKey}</code>
   <p>Motif : {visible.command.reason} · {visible.command.returnLineIds.length} ligne(s) produit à retourner. Commande conservée, non modifiable.</p>
   {visible.state==='refunded' && (printableRefund(visible,currentUser) ? <>
    <Button type="button" variant="outline" onClick={() => setPrintOpen(true)}>Avoir confirmé {visible.result?.receiptNumber}</Button>
    <PrintableRefundModal intent={visible} open={printOpen} onClose={() => setPrintOpen(false)}/>
   </> : <p role="alert">Avoir indisponible : confirmation conservée incohérente ou incomplète. Aucun document provisoire ne peut être imprimé.</p>)}
   {visible.state!=='refunded' && <>
    <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => syncWithRepo((repo) => operateRefundIntent(repo.database,currentUser,original.ticketId,'status',requestRefund)))}>Vérifier le remboursement sans renvoyer</Button>
    {!visible.verificationOnly && ['prepared','not_found'].includes(visible.state) && <Button type="button" disabled={busy || !serverCheckoutEnabled()} onClick={() => {
     if(!window.confirm(`Confirmer le remboursement intégral de ${formatFCFA(visible.total)} ? Vérifiez les références externes. La même clé sera conservée.`)) return
     void run(() => syncWithRepo((repo) => operateRefundIntent(repo.database,currentUser,original.ticketId,'send',requestRefund)))
    }}>Envoyer le remboursement avec la même clé</Button>}
   </>}
  </div>}
 </section>
}
