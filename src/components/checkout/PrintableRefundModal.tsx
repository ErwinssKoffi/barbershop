import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RefundIntent } from '../../db/checkoutRefundQueue'
import type { ReceiptFormat } from '../../domain/models'
import { useAuth } from '../../contexts/authContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { printableRefund } from '../../lib/refundReceipt'
import { formatDateTimeFR, formatFCFA } from '../../utils/format'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/button'

/** Dedicated refund document: no legacy fallback, catalog repricing, or original-sale tender/change. */
export function PrintableRefundModal({intent,open,onClose}:{intent:RefundIntent;open:boolean;onClose:()=>void}) {
 const {currentUser}=useAuth();const {state,categoryLabel}=useSalonStore()
 const result=printableRefund(intent,currentUser)
 const [format,setFormat]=useState<ReceiptFormat>(state.settings.receiptFormat ?? 'thermal_80mm')
 const [error,setError]=useState('')
 useEffect(() => {
  const reset=() => document.body.classList.remove('printing-refund-only')
  window.addEventListener('afterprint',reset)
  return () => {window.removeEventListener('afterprint',reset);reset()}
 },[open,currentUser?.id,currentUser?.tenantId,currentUser?.role,currentUser?.isActive,result?.receiptNumber])
 if(!open || !result) return null
 const print=() => {
  setError('');document.body.classList.add('printing-refund-only')
  try {window.print()} catch {document.body.classList.remove('printing-refund-only');setError('Impression indisponible. Le remboursement confirmé est conservé ; aucun nouvel envoi.')}
 }
 return createPortal(<div id="salon-refund-print-root" data-format={format}>
  <Modal open title={`Avoir · ${result.receiptNumber}`} subtitle="Remboursement intégral confirmé — aperçu réimprimable" onClose={onClose} maxWidth={format==='a5_sheet' ? 620 : 450}>
   <div className="refund-receipt-content space-y-3">
    <div className="no-print space-y-2">
     <p>Document issu de la confirmation serveur conservée sur cet appareil. Ce document ne prouve pas l’exécution d’un remboursement chez un prestataire externe.</p>
     <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant={format==='thermal_80mm' ? 'default' : 'outline'} onClick={() => setFormat('thermal_80mm')}>Ticket 80 mm</Button>
      <Button type="button" size="sm" variant={format==='a5_sheet' ? 'default' : 'outline'} onClick={() => setFormat('a5_sheet')}>Fiche A5</Button>
      <Button type="button" size="sm" onClick={print}>Imprimer l’avoir</Button>
     </div>
     {error && <p role="alert">{error}</p>}
    </div>
    <article aria-label="Avoir de remboursement" className="refund-print-sheet" style={{padding:16,margin:'0 auto',maxWidth:format==='thermal_80mm' ? 330 : 560,overflowWrap:'anywhere'}}>
     <header className="space-y-1 border-b pb-3">
      {state.salon.name && <strong className="block">{state.salon.name}</strong>}
      {state.salon.address && <p>{state.salon.address}</p>}
      {state.salon.phone && <p>Tél. : {state.salon.phone}</p>}
      <p className="text-xs">Identité du salon : configuration actuelle de cet appareil.</p>
      <h3 className="font-bold text-lg">AVOIR — REMBOURSEMENT INTÉGRAL</h3>
      <p>Numéro serveur : <strong>{result.receiptNumber}</strong></p>
      <p>Ticket d’origine : <strong>{result.originalReceiptNumber}</strong></p>
      <p>Confirmé le {formatDateTimeFR(result.confirmedAt)}</p>
      <p>Gérant (identifiant) : {result.actorId}</p>
      <p>Motif : {result.command.reason}</p>
     </header>
     <div className="py-3 space-y-2">
      {result.records.revenues.map((line) => <div className="border-b pb-2" key={line.id}>
       <p className="font-semibold">{line.label}</p>
       <p>{Math.abs(line.quantity!)} unité(s) annulée(s) · {formatFCFA(line.amount)}</p>
       {line.productId && <p>{result.command.returnLineIds.includes(line.reversalOfRevenueId!) ? 'Produit remis en stock' : 'Produit non remis en stock'}</p>}
      </div>)}
     </div>
     <p className="font-bold">TOTAL REMBOURSÉ : {formatFCFA(result.total)}</p>
     <p className="text-xs">Contrepassation des recettes : {formatFCFA(-result.total)}. Devise : XOF.</p>
     <section aria-label="Modes de remboursement" className="py-3 space-y-2">
      {result.payments.map((payment) => <div key={payment.method}>
       <p>{categoryLabel('payment_method',payment.method)} : {formatFCFA(payment.amount)}</p>
       {payment.method==='cash' ? <p>Sortie d’espèces enregistrée en caisse.</p> : <p>Remboursement externe attesté par le Gérant — référence : {result.command.paymentReferences.find((ref) => ref.method===payment.method)?.reference}</p>}
      </div>)}
     </section>
     <footer className="border-t pt-3 text-xs space-y-1">
      <p>Le ticket d’origine reste inchangé. Les consommables utilisés ne sont pas remis en stock.</p>
      <p>Aucun paiement externe n’est exécuté ou vérifié par cette application. Les références sont des attestations du Gérant.</p>
      <p>Réimprimer cet avoir ne crée aucune nouvelle opération financière. Document de gestion ; aucune certification fiscale revendiquée.</p>
     </footer>
    </article>
   </div>
  </Modal>
 </div>,document.body)
}
