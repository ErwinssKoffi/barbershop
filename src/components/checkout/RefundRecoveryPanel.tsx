import { inspectRefundDiagnostic } from '../../db/checkoutRefundDiagnostic'
import type { CheckoutRefundDiagnostic } from '../../domain/checkoutRefund'
import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { useAuth } from '../../contexts/authContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { workspaceKey } from '../../db/accountWorkspace'
import { exportRefundIntents, restoreRefundIntents, listRefundIntents, REFUND_BACKUP_LIMIT } from '../../db/checkoutRefundRecovery'
import { operateRefundIntent, reviewRestoredRefund, type RefundIntent } from '../../db/checkoutRefundQueue'
import { requestRefund } from '../../lib/checkoutRefundClient'
import { serverCheckoutEnabled } from '../../lib/checkoutClient'
import { formatFCFA } from '../../utils/format'
import { printableRefund } from '../../lib/refundReceipt'
import { PrintableRefundModal } from './PrintableRefundModal'
import { Button } from '../ui/button'

/** Independent of the sale outbox: restored intentions must remain reachable on a fresh device. */
export function RefundRecoveryPanel() {
 const {currentUser}=useAuth();const {syncWithRepo}=useSalonStore()
 const [diagnostic,setDiagnostic]=useState<{scope:string;value:CheckoutRefundDiagnostic}|null>(null)
 const [rows,setRows]=useState<RefundIntent[]>([]);const [page,setPage]=useState(0)
 const [notice,setNotice]=useState<{scope:string;message:string}|null>(null)
 const [selected,setSelected]=useState<string|null>(null)
 const [busy,setBusy]=useState(false);const flight=useRef(false)
 useEffect(() => {
  let active=true;let unsubscribe=() => {}
  if(currentUser?.role==='manager' && currentUser.isActive) {
   void syncWithRepo(async (repo) => repo.database).then((db) => {
    if(!active) return
    const sub=liveQuery(() => listRefundIntents(db,currentUser)).subscribe({next:(value) => {if(active) setRows(value)},error:() => {if(active) setNotice({scope:workspaceKey(currentUser),message:'Lecture du suivi impossible ; conservez vos données et fichiers.'})}})
    unsubscribe=() => sub.unsubscribe()
   }).catch(() => {if(active) setNotice({scope:workspaceKey(currentUser),message:'Espace de reprise indisponible.'})})
  }
  return () => {active=false;unsubscribe()}
 },[currentUser,syncWithRepo])
 if(currentUser?.role!=='manager' || !currentUser.isActive || !currentUser.tenantId) return null
 const scope=workspaceKey(currentUser)
 const visible=rows.filter((row) => row.scope===scope)
 const currentPage=Math.min(page,Math.max(0,Math.ceil(visible.length/10)-1))
 const printed=visible.find((row) => row.command.idempotencyKey===selected)
 const run=async (action:()=>Promise<string>) => {
  if(flight.current) return
  flight.current=true;setBusy(true)
  try {
   const message=await action()
   const latest=await syncWithRepo((repo) => listRefundIntents(repo.database,currentUser))
   setRows(latest);setNotice({scope,message})
  } catch(e) {setNotice({scope,message:e instanceof Error ? e.message : 'Reprise indisponible ; ne recréez pas de commande.'})}
  finally {flight.current=false;setBusy(false)}
 }
 return <section aria-label="Sauvegarde et reprise des remboursements" className="border rounded p-3 space-y-2">
  <h3 className="font-semibold">Sauvegarde et reprise des remboursements</h3>
  <p>Fichier privé non chiffré : motifs et références externes inclus. Aucun secret de connexion ni accusé de confirmation exporté. Restauration réservée au même Gérant et salon.</p>
  <Button type="button" size="sm" disabled={busy} onClick={() => void run(async () => {
   const json=await syncWithRepo((repo) => exportRefundIntents(repo.database,currentUser))
   const url=URL.createObjectURL(new Blob([json],{type:'application/json'}))
   try {const link=document.createElement('a');link.href=url;link.download=`salon-pro-remboursements-${new Date().toISOString().slice(0,10)}.json`;link.click()}
   finally {window.setTimeout(() => URL.revokeObjectURL(url),1000)}
   return 'Sauvegarde des intentions de remboursement téléchargée. Conservez-la en lieu sûr ; ce fichier n’est pas une preuve de paiement.'
  })}>Sauvegarder les intentions de remboursement</Button>
  <label className="block">Restaurer une sauvegarde remboursement (5 Mo max.)
   <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
    const file=event.target.files?.[0];event.target.value=''
    if(!file) return
    void run(async () => {
     if(file.size>REFUND_BACKUP_LIMIT) throw new Error('Sauvegarde remboursement limitée à 5 Mo.')
     const json=await file.text()
     const result=await syncWithRepo((repo) => restoreRefundIntents(repo.database,currentUser,json))
     return `${result.added} intention(s) restaurée(s) en vérification seule ; ${result.existing} déjà présente(s). Aucune commande envoyée ou confirmation importée.`
    })
   }}/>
  </label>
  <p>Une restauration ne renvoie rien. Après « non trouvé », contrôlez le ticket canonique au serveur et les paiements externes réels. Seule une reprise explicitement confirmée avec préconditions peut exécuter la même commande. Ne supprimez pas la clé.</p>
  {notice?.scope===scope && <p role="status">{notice.message}</p>}
  {visible.slice(currentPage*10,(currentPage+1)*10).map((row) => <div className="border-t pt-2 space-y-1" key={row.command.idempotencyKey}>
   <p>{row.originalReceiptNumber} · {row.state==='refunded' ? `Confirmé — ${row.result?.receiptNumber}` : row.state==='not_found' ? 'Non trouvé au dernier contrôle' : row.state==='prepared' ? 'Préparé, non confirmé' : 'Issue incertaine — vérification requise'}</p>
   <code className="text-xs break-all">{row.command.idempotencyKey}</code>
   {row.verificationOnly && <p>Intention importée : contrôle canonique requis avant exécution.</p>}
   {row.state!=='refunded' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
    await syncWithRepo((repo) => operateRefundIntent(repo.database,currentUser,row.command.originalTicketId,'status',requestRefund))
    return 'Statut contrôlé sans renvoi. Consultez l’état de cette intention.'
   })}>Contrôler sans renvoyer {row.originalReceiptNumber}</Button>}
   {row.state!=='refunded' && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
    setDiagnostic(null)
    const value=await syncWithRepo((repo) => inspectRefundDiagnostic(repo.database,currentUser,row.command.originalTicketId,requestRefund))
    setDiagnostic({scope,value})
    return 'Diagnostic reçu sans correction ni autorisation de renvoi. La commande et sa clé sont conservées.'
   })}>Diagnostiquer les blocages {row.originalReceiptNumber}</Button>}
   {row.state!=='refunded' && diagnostic?.scope===scope && diagnostic.value.command.idempotencyKey===row.command.idempotencyKey && <div role="region" aria-label={`Diagnostic ${row.originalReceiptNumber}`} className="border rounded p-2 space-y-1">
    <p>Diagnostic du {diagnostic.value.checkedAt} — indicatif, sans réservation ni correction automatique.</p>
    <p>Espèces requises : {formatFCFA(diagnostic.value.cashRequired)} · solde du journal : {diagnostic.value.cashBalance===null ? 'non disponible / non requis' : formatFCFA(diagnostic.value.cashBalance)}</p>
    {diagnostic.value.blockers.map((block,index) => <p key={`${block.code}:${index}`}><strong>{block.code}</strong> : {block.message} ({block.entityId})</p>)}
    {!diagnostic.value.blockers.length && <p>Aucun blocage de caisse ou stock détecté à cet instant. Ce diagnostic n’autorise aucun envoi ; les contrôles à l’exécution restent obligatoires.</p>}
    <p>Ne recréez pas de clé et ne modifiez pas la commande. Un changement de caisse ou de contenu nécessite une correction supervisée dédiée, non disponible ici.</p>
   </div>}
   {row.verificationOnly && row.state==='not_found' && <>
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
     await syncWithRepo((repo) => reviewRestoredRefund(repo.database,currentUser,row.command.originalTicketId,requestRefund))
     return 'Contrôle canonique reçu, sans remboursement exécuté. Relisez les détails avant toute reprise.'
    })}>Contrôler le ticket canonique {row.originalReceiptNumber}</Button>
    {row.review && <div className="border rounded p-2 space-y-1">
     <strong>Contrôle serveur : {row.review.originalReceiptNumber} · {formatFCFA(row.review.total)}</strong>
     <p>Motif conservé : {row.command.reason}</p>
     {row.review.lines.map((line) => <p key={line.id}>{line.label} · {line.quantity} unité(s) · {formatFCFA(line.amount)}{line.productId ? line.returned ? ' · retour en stock' : ' · sans retour en stock' : ''}</p>)}
     {row.review.payments.map((payment) => <p key={payment.method}>{payment.method} : {formatFCFA(payment.amount)}</p>)}
     {row.command.cashSessionId && <p>Caisse conservée : {row.command.cashSessionId} — ouverture et fonds revalidés à l’exécution.</p>}
     {row.command.paymentReferences.map((reference) => <p key={reference.method}>Attestation externe {reference.method} : {reference.reference}</p>)}
     <p>Ce contrôle ne réserve ni fonds ni stock et n’exécute aucun paiement externe.</p>
     <Button type="button" size="sm" disabled={busy || !serverCheckoutEnabled()} onClick={() => {
      if(!window.confirm(`Autoriser la reprise du remboursement de ${formatFCFA(row.review!.total)} pour ${row.review!.originalReceiptNumber} ? Vérifiez les paiements externes déjà effectués. Même commande et même clé, avec préconditions serveur.`)) return
      void run(async () => {
       await syncWithRepo((repo) => operateRefundIntent(repo.database,currentUser,row.command.originalTicketId,'send',requestRefund))
       return 'Reprise avec préconditions tentée ; consultez le statut. Aucune clé de remplacement créée.'
      })
     }}>Reprendre avec préconditions {row.originalReceiptNumber}</Button>
    </div>}
   </>}
   {printableRefund(row,currentUser) && <Button type="button" size="sm" variant="outline" onClick={() => setSelected(row.command.idempotencyKey)}>Ouvrir l’avoir récupéré {row.result?.receiptNumber}</Button>}
  </div>)}
  {!visible.length && <p>Aucune intention de remboursement dans cet espace.</p>}
  <div className="flex flex-wrap items-center gap-2">
   <Button type="button" size="sm" variant="outline" disabled={currentPage===0} onClick={() => setPage(currentPage-1)}>Remboursements précédents</Button>
   <span>Page {currentPage+1} / {Math.max(1,Math.ceil(visible.length/10))} · {visible.length} intention(s)</span>
   <Button type="button" size="sm" variant="outline" disabled={(currentPage+1)*10>=visible.length} onClick={() => setPage(currentPage+1)}>Remboursements suivants</Button>
  </div>
  {printed && <PrintableRefundModal intent={printed} open onClose={() => setSelected(null)}/>}
 </section>
}
