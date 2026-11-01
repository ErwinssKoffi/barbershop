import { useRef, useState } from 'react'
import { useAuth } from '../../contexts/authContext'
import { workspaceKey } from '../../db/accountWorkspace'
import type { CheckoutHistoryDetail, CheckoutHistoryPage, CheckoutHistoryQuery } from '../../domain/checkoutHistory'
import { searchServerTickets, readServerTicket } from '../../lib/checkoutHistoryClient'
import { formatDateTimeFR, formatFCFA } from '../../utils/format'
import { CheckoutRefundPanel } from './CheckoutRefundPanel'
import { PrintableReceiptModal } from './PrintableReceiptModal'
import { Button } from '../ui/button'

/** Remote read-only history, never merged into local sale outbox or financial tables. */
export function CheckoutHistoryPanel() {
 const {currentUser}=useAuth()
 const [receipt,setReceipt]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('')
 const [page,setPage]=useState<{scope:string;value:CheckoutHistoryPage;query:CheckoutHistoryQuery}|null>(null)
 const [detail,setDetail]=useState<{scope:string;value:CheckoutHistoryDetail}|null>(null)
 const [notice,setNotice]=useState<{scope:string;message:string}|null>(null)
 const [print,setPrint]=useState(false);const [busy,setBusy]=useState(false);const flight=useRef(false)
 if(currentUser?.role!=='manager' || !currentUser.isActive || !currentUser.tenantId) return null
 const scope=workspaceKey(currentUser)
 const visible=page?.scope===scope ? page : null
 const selected=detail?.scope===scope ? detail.value : null
 const run=async (action:()=>Promise<void>) => {
  if(flight.current) return
  flight.current=true;setBusy(true);setNotice(null)
  try {await action()} catch(error) {setNotice({scope,message:error instanceof Error ? error.message : 'Consultation indisponible.'})}
  finally {flight.current=false;setBusy(false)}
 }
 const search=(query:CheckoutHistoryQuery) => run(async () => {
  setDetail(null);setPrint(false);setPage(null)
  const value=await searchServerTickets(currentUser,query)
  setPage({scope,value,query})
 })
 return <section aria-label="Tickets serveur du salon" className="border rounded p-3 space-y-2">
  <h3 className="font-semibold">Tickets serveur — tous les postes du salon</h3>
  <p>Ventes canoniques seulement, Gérant uniquement. Consultation en ligne, sans import dans les recettes ou la file locale. Les ventes historiques legacy ne figurent pas ici.</p>
  <div className="flex flex-wrap items-end gap-2">
   <label>Reçu SPC exact<input className="block border p-2 rounded" value={receipt} maxLength={24} onChange={(event) => setReceipt(event.target.value)} placeholder="SPC-…"/></label>
   <label>Du (UTC)<input className="block border p-2 rounded" type="date" value={from} onChange={(event) => setFrom(event.target.value)}/></label>
   <label>Au (UTC inclus)<input className="block border p-2 rounded" type="date" value={to} onChange={(event) => setTo(event.target.value)}/></label>
   <Button type="button" size="sm" disabled={busy} onClick={() => {
    if(Boolean(from)!==Boolean(to)) {setNotice({scope,message:'Renseignez les deux dates ou laissez-les vides.'});return}
    void search({...(receipt.trim() ? {receiptNumber:receipt.trim()} : {}),...(from && to ? {from,to} : {})})
   }}>Rechercher les tickets serveur</Button>
  </div>
  <p className="text-xs">Sans filtre : ventes les plus récemment enregistrées. Dates d’enregistrement serveur en UTC, période limitée à 366 jours. 20 résultats par page, sans total global.</p>
  {notice?.scope===scope && <p role="alert">{notice.message}</p>}
  {visible && <>
   {!visible.value.rows.length && <p>Aucun ticket canonique trouvé pour cette recherche.</p>}
   {visible.value.rows.map((row) => <div key={row.ticketId} className="border-t pt-2">
    <p>{row.receiptNumber} · {formatDateTimeFR(row.confirmedAt)} · {formatFCFA(row.total)}</p>
    <p>{row.refundStatus==='refunded' ? 'Déjà remboursé intégralement' : row.refundStatus==='unavailable' ? 'Suivi des remboursements indisponible (007 absente)' : 'Aucun remboursement enregistré au dernier contrôle'}</p>
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
     setDetail(null);setPrint(false)
     const value=await readServerTicket(currentUser,row.ticketId)
     setDetail({scope,value})
    })}>Consulter {row.receiptNumber}</Button>
   </div>)}
   {visible.value.nextCursor && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void search({...visible.query,cursor:visible.value.nextCursor!})}>Tickets suivants</Button>}
  </>}
  {selected && <div className="border rounded p-3 space-y-2">
   <h4 className="font-semibold">Ticket canonique {selected.result.receiptNumber}</h4>
   <p>Encaissé par le compte {selected.result.actorId} · {formatFCFA(selected.result.quote.total)}</p>
   {selected.result.records.revenues.map((row) => <p key={row.id}>{row.label} · {row.quantity ?? 1} unité(s) · {formatFCFA(row.amount)}</p>)}
   <p>État constaté à la consultation ; un remboursement concurrent reste possible et sera contrôlé au serveur.</p>
   <Button type="button" size="sm" variant="outline" onClick={() => setPrint(true)}>Reçu serveur {selected.result.receiptNumber}</Button>
   {selected.refundStatus==='not_refunded' ? <CheckoutRefundPanel key={`${scope}:${selected.result.ticketId}`} original={selected.result}/> : <p>{selected.refundStatus==='refunded' ? 'Ticket déjà remboursé : aucune nouvelle préparation. Le reçu de vente original reste inchangé.' : 'Remboursement non préparé : suivi serveur 007 indisponible.'}</p>}
   {print && <PrintableReceiptModal open receiptRefOrRevenueId={selected.result.receiptNumber} confirmedResult={selected.result} onClose={() => setPrint(false)}/>}
  </div>}
 </section>
}
