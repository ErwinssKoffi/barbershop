import { CheckoutHistoryPanel } from './CheckoutHistoryPanel'
import { RefundRecoveryPanel } from './RefundRecoveryPanel'
import { CheckoutRefundPanel } from './CheckoutRefundPanel'
import type { CheckoutCutoverReport } from '../../domain/checkoutCutover'
import { workspaceKey } from '../../db/accountWorkspace'
import { PrintableReceiptModal } from './PrintableReceiptModal'
import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { useAuth } from '../../contexts/authContext'
import { useCloudSync } from '../../contexts/cloudSyncContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { assertCheckoutScope } from '../../db/checkoutQueue'
import { CHECKOUT_BACKUP_LIMIT, exportCheckoutIntents, restoreCheckoutIntents, reviewCheckout, resumeCheckout } from '../../db/checkoutRecovery'
import type { QueuedCheckout } from '../../domain/checkoutQueue'
import { inspectCheckout, serverCheckoutEnabled } from '../../lib/checkoutClient'
import { Button } from '../ui/button'

/** Local supervision. Only a checked server result permits a confirmed receipt. */
export function CheckoutQueuePanel() {
 const {currentUser} = useAuth()
 const {syncWithRepo,mutate} = useSalonStore()
 const {syncNow} = useCloudSync()
 const [cutover,setCutover] = useState<(CheckoutCutoverReport & {scope:string;checkedAt:string}) | null>(null)
 const [rows,setRows] = useState<QueuedCheckout[]>([])
 const [refundKey,setRefundKey] = useState<string | null>(null)
 const [selectedKey,setSelectedKey] = useState<string | null>(null)
 const [filter,setFilter] = useState('all')
 const [page,setPage] = useState(0)
 const [busy,setBusy] = useState(false)
 const [notice,setNotice] = useState<{scope:string;message:string} | null>(null)
 useEffect(() => {
  if (!currentUser?.tenantId) return
  let active = true
  let unsubscribe = () => {}
  void syncWithRepo(async (repo) => repo.database).then((database) => {
   if (!active) return
   const subscription = liveQuery(async () => {
    const scope = await assertCheckoutScope(database,currentUser)
    const raw=await database.workspaceMeta.get('checkoutCutoverReport')
    let diagnosis=null
    try {diagnosis=raw ? JSON.parse(raw.value) : null} catch { /* A malformed diagnostic must not hide the outbox. */ }
    const rows=(await database.checkoutOutbox.toArray()).filter((row) => row.scope === scope).sort((a,b) => b.createdAt-a.createdAt)
    return {rows,diagnosis}
   }).subscribe({next:(value) => {if (active) {setRows(value.rows);setCutover(value.diagnosis)}},error:() => {if (active) setRows([])}})
   unsubscribe = () => subscription.unsubscribe()
  }).catch(() => {if (active) setRows([])})
  return () => {active=false;unsubscribe()}
 },[currentUser,syncWithRepo])
 if (!currentUser?.tenantId) return null
 const scope = workspaceKey(currentUser)
 const visibleRows = rows.filter((row) => row.scope === scope)
 const filtered = visibleRows.filter((row) => filter === 'all' || (filter === 'paused' ? row.paused && row.state !== 'confirmed' : row.state === filter))
 const currentPage = Math.min(page,Math.max(0,Math.ceil(filtered.length/10)-1))
 const selected = visibleRows.find((row) => row.idempotencyKey === selectedKey && row.state === 'confirmed')?.result
 const run = async (action:()=>Promise<string>) => {
  if (busy) return
  setBusy(true)
  try {setNotice({scope,message:await action()})}
  catch (error) {setNotice({scope,message:error instanceof Error ? error.message : 'Opération indisponible ; aucune nouvelle vente créée.'})}
  finally {setBusy(false)}
 }
 const backup = async () => {
  const json = await syncWithRepo((repo) => exportCheckoutIntents(repo.database,currentUser))
  const url = URL.createObjectURL(new Blob([json],{type:'application/json'}))
  try {const link=document.createElement('a');link.href=url;link.download=`salon-pro-intentions-${new Date().toISOString().slice(0,10)}.json`;link.click()}
  finally {window.setTimeout(() => URL.revokeObjectURL(url),1000)}
  return 'Sauvegarde des intentions non confirmées téléchargée. Fichier privé non chiffré ; conservez-le en lieu sûr.'
 }
 return <section aria-label="File d’encaissement serveur" className="rounded-lg border p-3 text-sm space-y-2">
  {cutover?.scope === scope && <details className="border rounded p-2 text-xs">
   <summary>Dernier prévol de bascule : {cutover.mode} · {cutover.blockedCount} blocage(s)</summary>
   <p>Diagnostic de cet appareil seulement, pas une validation de tous les postes. Conservez les écritures locales ; aucune conversion automatique en nouvelle commande.</p>
   <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(cutover,null,2)}</pre>
  </details>}
  <strong>File d’encaissement — {visibleRows.filter((row) => row.state === 'pending').length} en attente</strong>
  <p className="text-xs text-muted-foreground">Ne recréez pas un ticket en attente. Aucun stock n’est réservé avant confirmation. Les indicateurs métier attendent aussi le chargement des écritures Cloud.</p>
  <p className="text-xs">{visibleRows.filter((row) => row.state === 'confirmed').length} confirmé(s) · {visibleRows.filter((row) => row.state === 'rejected').length} rejeté(s) · {visibleRows.filter((row) => row.paused && row.state !== 'confirmed').length} suspendu(s)</p>
  {!serverCheckoutEnabled() && <p>Le pilote serveur est désactivé : la file est conservée, sans nouvel envoi. La vérification seule reste disponible.</p>}
  <div className="flex flex-wrap items-center gap-2">
   <Button type="button" size="sm" disabled={busy} onClick={() => void run(backup)}>Sauvegarder les intentions non confirmées</Button>
   <label className="text-xs">Restaurer une sauvegarde de file (5 Mo max.)
    <input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
     const file=event.target.files?.[0];event.target.value=''
     if (!file) return
     void run(async () => {
      if (file.size>CHECKOUT_BACKUP_LIMIT) throw new Error('Sauvegarde limitée à 5 Mo.')
      const json=await file.text()
      const restored=await mutate((repo) => restoreCheckoutIntents(repo.database,currentUser,json))
      return `${restored.added} intention(s) restaurée(s) et suspendue(s), ${restored.existing} déjà présente(s). Vérifiez chacune au serveur avant toute reprise.`
     })
    }}/>
   </label>
   <label className="text-xs">Filtrer la file
    <select value={filter} onChange={(event) => {setFilter(event.target.value);setPage(0)}}>
     <option value="all">Toutes</option><option value="pending">En attente</option><option value="paused">Suspendues</option><option value="confirmed">Confirmées</option><option value="rejected">Rejetées</option>
    </select>
   </label>
  </div>
  <p className="text-xs text-muted-foreground">Restaurer ne confirme rien et n’envoie rien. Une absence au serveur n’est ni une annulation ni une preuve d’absence de paiement externe. Les rejets existants ne sont pas réactivés automatiquement.</p>
  {notice?.scope === scope && <p role="status">{notice.message}</p>}
  {filtered.slice(currentPage*10,(currentPage+1)*10).map((row) => <div key={row.idempotencyKey} className="border-t pt-2 space-y-1">
   <p>{row.state === 'confirmed' ? `Confirmé — ${row.result?.receiptNumber}` : row.state === 'rejected' ? 'Rejeté — aucune confirmation pour cette intention' : row.paused ? 'Suspendu — vérification et reprise explicites requises' : 'En attente — référence provisoire'}</p>
   <code className="text-xs break-all">{row.idempotencyKey}</code>
   <p className="text-xs">{row.attempts} tentative(s) · {row.reviewHistory?.length ?? 0} action(s) de contrôle/reprise</p>
   {row.state === 'confirmed' ? <><Button type="button" size="sm" variant="outline" onClick={() => setSelectedKey(row.idempotencyKey)}>Reçu confirmé {row.result?.receiptNumber}</Button>
    {currentUser.role==='manager' && row.result && <Button type="button" size="sm" variant="outline" onClick={() => setRefundKey(refundKey===row.idempotencyKey ? null : row.idempotencyKey)}>Gérer le remboursement {row.result.receiptNumber}</Button>}
    {currentUser.role==='manager' && refundKey===row.idempotencyKey && row.result && <CheckoutRefundPanel key={`${scope}:${row.idempotencyKey}`} original={row.result}/>}
   </> : <>
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => {
     const outcome=await syncWithRepo((repo) => reviewCheckout(repo.database,currentUser,row.idempotencyKey,inspectCheckout))
     return outcome === 'confirmed' ? 'Confirmation serveur récupérée, sans nouvelle vente.' : outcome === 'not_found' ? 'Aucune confirmation trouvée. La commande reste suspendue, sans renvoi.' : 'Vérification non concluante. La commande reste suspendue.'
    })}>Vérifier au serveur sans renvoyer</Button>
    {row.state === 'pending' && row.paused && row.reviewHistory?.at(-1)?.outcome === 'not_found' && <Button type="button" size="sm" disabled={busy || !serverCheckoutEnabled()} onClick={() => void run(async () => {
     if (!window.confirm('Autoriser une tentative de finalisation avec la même commande et la même clé ? Vérifiez auparavant les paiements réels ; une vente pourra être créée si elle n’existe pas encore.')) return 'Reprise non autorisée ; intention conservée suspendue.'
     await mutate((repo) => resumeCheckout(repo.database,currentUser,row.idempotencyKey))
     return 'Reprise autorisée avec la même clé, sans vente de remplacement. Le prochain passage de synchronisation tentera la finalisation.'
    })}>Autoriser la reprise avec la même clé</Button>}
   </>}
   {row.error && <p className="text-xs">{row.error.message}</p>}
  </div>)}
  {!filtered.length && <p>Aucune intention dans ce filtre.</p>}
  <div className="flex flex-wrap items-center gap-2">
   <Button type="button" size="sm" variant="outline" disabled={currentPage===0} onClick={() => setPage(currentPage-1)}>Page précédente</Button>
   <span>Page {currentPage+1} / {Math.max(1,Math.ceil(filtered.length/10))} · {filtered.length} intention(s)</span>
   <Button type="button" size="sm" variant="outline" disabled={(currentPage+1)*10>=filtered.length} onClick={() => setPage(currentPage+1)}>Page suivante</Button>
   <Button type="button" size="sm" disabled={busy || !serverCheckoutEnabled()} onClick={() => void run(async () => await syncNow() ? 'Synchronisation terminée ; consultez les états de la file.' : 'Synchronisation non terminée ; les intentions sont conservées.')}>Synchroniser et réessayer la file</Button>
  </div>
  {currentUser.role==='manager' && <CheckoutHistoryPanel key={`history:${scope}`}/>}
  {currentUser.role==='manager' && <RefundRecoveryPanel key={scope}/>}
  {selected && <PrintableReceiptModal open receiptRefOrRevenueId={selected.receiptNumber} confirmedResult={selected} onClose={() => setSelectedKey(null)} />}
 </section>
}
