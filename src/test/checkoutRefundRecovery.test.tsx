import { inspectRefundDiagnostic } from '../db/checkoutRefundDiagnostic'
import type { CheckoutRefundDiagnostic } from '../domain/checkoutRefund'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { prepareRefundIntent, readRefundIntent, operateRefundIntent, reviewRestoredRefund, type RefundIntent } from '../db/checkoutRefundQueue'
import { listRefundIntents, exportRefundIntents, restoreRefundIntents, REFUND_BACKUP_LIMIT } from '../db/checkoutRefundRecovery'
import { RefundRecoveryPanel } from '../components/checkout/RefundRecoveryPanel'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { useSalonStore } from '../hooks/salonStoreContext'
import { storeAuthSession } from '../lib/sessionClient'
import type { CheckoutRefundReview } from '../domain/checkoutRefund'
import type { CheckoutResult } from '../domain/checkout'
import type { PublicSalonUser } from '../domain/models'

const databases=new Set<SalonProDatabase>()
const user:PublicSalonUser={id:'recovery-refund-manager',tenantId:'recovery-refund-tenant',role:'manager',fullName:'Responsable',email:'refund-recovery@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
const original={confirmed:true,tenantId:user.tenantId,ticketId:'canonical-sale',receiptNumber:'SPC-0000000001',quote:{total:1000},command:{payments:[{method:'wave',amount:1000}]},records:{revenues:[{id:'old-product',productId:'product'}]}} as unknown as CheckoutResult
async function fixture() {
 const db=new SalonProDatabase(`refund-recovery-${crypto.randomUUID()}`);databases.add(db)
 const repo=new SalonRepositoryHub(db);await repo.ensureInitialized(false)
 await db.workspaceMeta.bulkPut([{key:'accountScope',value:workspaceKey(user)},{key:'cloudTenantId',value:user.tenantId!}])
 return {db,repo,prepare:()=>prepareRefundIntent(db,user,original,{reason:'Retour',returnLineIds:['old-product'],paymentReferences:[{method:'wave',reference:'external-reference'}]})}
}
function absence(row:RefundIntent) {return {status:200,body:{ok:true,status:'not_found',idempotencyKey:row.command.idempotencyKey,actorId:user.id,tenantId:user.tenantId}}}
function confirmation(row:RefundIntent) {
 return {status:200,body:{ok:true,result:{confirmed:true,status:'refunded',tenantId:user.tenantId,actorId:user.id,ticketId:'canonical-refund',receiptNumber:'SPR-0000000002',originalTicketId:row.command.originalTicketId,originalReceiptNumber:row.originalReceiptNumber,total:row.total,confirmedAt:'2026-10-31T12:00:00Z',command:row.command,payments:[{method:'wave',amount:1000}],paymentExecution:'cash_ledger_and_external_attestation',records:{revenues:[{id:'refund-line',label:'Remboursement — Produit',ticketId:'canonical-refund',receiptNumber:'SPR-0000000002',quantity:-1,amount:-1000,productId:'product',reversalOfRevenueId:'old-product',reversalOfTicketId:row.command.originalTicketId,paymentSplits:[{method:'wave',amount:-1000}]}],products:[],stockMovements:[],cashMovements:[]}}}}
}
function canonical(row:RefundIntent):CheckoutRefundReview {
 return {status:'reviewed',tenantId:row.tenantId,actorId:row.actorId,command:row.command,originalTicketId:row.command.originalTicketId,originalReceiptNumber:row.originalReceiptNumber,total:row.total,payments:[{method:'wave',amount:1000}],lines:[{id:'old-product',label:'Produit historique canonique',quantity:1,amount:1000,productId:'product',returned:true}],precondition:{total:row.total,originalReceiptNumber:row.originalReceiptNumber,fingerprint:'a'.repeat(64)}}
}
function diagnostic(row:RefundIntent):CheckoutRefundDiagnostic {
 return {status:'diagnosed',tenantId:row.tenantId,actorId:row.actorId,checkedAt:'2026-10-31T12:00:00Z',command:row.command,originalReceiptNumber:row.originalReceiptNumber,total:row.total,cashRequired:0,cashBalance:null,blockers:[{code:'PRODUCT_UNAVAILABLE',entityId:'product',message:'Produit absent ; aucun retour automatique.'}]}
}
function show(repo:SalonRepositoryHub,account=user) {
 function Ready(){const {ready}=useSalonStore();return ready ? <RefundRecoveryPanel/> : null}
 render(<AuthContext.Provider value={{currentUser:account} as AuthContextValue}><SalonStoreProvider repository={repo}><Ready/></SalonStoreProvider></AuthContext.Provider>)
}
function session() {storeAuthSession(user,`e30.${btoa(JSON.stringify({uid:user.id,tid:user.tenantId,sid:'recovery-session',exp:Date.now()+3600_000}))}.signature`,true)}
afterEach(async () => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();window.localStorage.clear();window.sessionStorage.clear();for(const db of databases) db.close();for(const db of databases) await db.delete();databases.clear()})
it('exporte toutes les intentions sans accusés, états, mouvements ou secrets et restaure seulement en contrôle',async () => {
 const source=await fixture();const row=await source.prepare()
 await operateRefundIntent(source.db,user,original.ticketId,'send',async (intent) => confirmation(intent))
 const json=await exportRefundIntents(source.db,user);const backup=JSON.parse(json)
 expect(backup.format).toBe('SALON_PRO_REFUND_INTENTS_V1');expect(backup.intents).toHaveLength(1)
 expect(backup.intents[0]).toEqual({originalReceiptNumber:row.originalReceiptNumber,total:1000,command:row.command})
 for(const field of ['result','confirmed','state','records','token','SPR-']) expect(json).not.toContain(field)
 const target=await fixture();expect(await restoreRefundIntents(target.db,user,json)).toEqual({added:1,existing:0})
 const restored=(await listRefundIntents(target.db,user))[0]
 expect(restored).toMatchObject({state:'uncertain',verificationOnly:true,command:row.command})
 expect(restored.result).toBeUndefined();expect(await target.db.revenues.count()).toBe(0);expect(await target.db.checkoutOutbox.count()).toBe(0)
})
it('récupère le vrai statut sans renvoi, ou reste bloqué à la reprise après not_found',async () => {
 const source=await fixture();await source.prepare();const target=await fixture()
 await restoreRefundIntents(target.db,user,await exportRefundIntents(source.db,user))
 await operateRefundIntent(target.db,user,original.ticketId,'status',async (row) => absence(row))
 expect((await readRefundIntent(target.db,user,original.ticketId))?.state).toBe('not_found')
 const network=vi.fn()
 await expect(operateRefundIntent(target.db,user,original.ticketId,'send',network)).rejects.toThrow('vérification seule')
 expect(network).not.toHaveBeenCalled()
 await operateRefundIntent(target.db,user,original.ticketId,'status',async (row,operation) => {expect(operation).toBe('status');return confirmation(row)})
 expect((await readRefundIntent(target.db,user,original.ticketId))?.state).toBe('refunded')
 expect(await target.db.cashMovements.count()).toBe(0)
})
it('préserve les états locaux et ne remplace pas un accusé déjà confirmé',async () => {
 const source=await fixture();await source.prepare();const json=await exportRefundIntents(source.db,user)
 await operateRefundIntent(source.db,user,original.ticketId,'send',async (row) => confirmation(row))
 const before=await source.db.workspaceMeta.toArray()
 expect(await restoreRefundIntents(source.db,user,json)).toEqual({added:0,existing:1})
 expect(await source.db.workspaceMeta.toArray()).toEqual(before)
})
it('détecte les conflits de ticket, contenu ou clé et annule toute la restauration',async () => {
 const source=await fixture();await source.prepare();const backup=JSON.parse(await exportRefundIntents(source.db,user))
 const fresh={...backup.intents[0],command:{...backup.intents[0].command,idempotencyKey:'refund-fresh-stable-key-0001',originalTicketId:'fresh-ticket'}}
 backup.intents=[fresh,{...backup.intents[0],command:{...backup.intents[0].command,reason:'Motif modifié'}}]
 await expect(restoreRefundIntents(source.db,user,JSON.stringify(backup))).rejects.toThrow('Conflit')
 expect(await readRefundIntent(source.db,user,'fresh-ticket')).toBeNull()
 backup.intents=[{...fresh,command:{...fresh.command,idempotencyKey:(await listRefundIntents(source.db,user))[0].command.idempotencyKey}}]
 await expect(restoreRefundIntents(source.db,user,JSON.stringify(backup))).rejects.toThrow('Conflit')
})
it.each(['tenant','actor','cashier','inactive'])('isole la restauration : %s',async (kind) => {
 const source=await fixture();await source.prepare();const json=await exportRefundIntents(source.db,user);const target=await fixture()
 const account={...user,...(kind==='tenant' ? {tenantId:'other'} : kind==='actor' ? {id:'other'} : kind==='cashier' ? {role:'cashier' as const} : {isActive:false})}
 await expect(restoreRefundIntents(target.db,account,json)).rejects.toThrow()
 expect((await listRefundIntents(target.db,user))).toHaveLength(0)
})
it.each(['format','date','result','state','amount','unknown-command','duplicate-ticket','duplicate-key','reference','returns'])('rejette le fichier invalide atomiquement : %s',async (kind) => {
 const source=await fixture();await source.prepare();const backup=JSON.parse(await exportRefundIntents(source.db,user));const row=backup.intents[0]
 if(kind==='format') backup.format='SALON_PRO_BACKUP_V1'
 if(kind==='date') backup.exportedAt='invalid'
 if(kind==='result') row.result={confirmed:true}
 if(kind==='state') row.state='refunded'
 if(kind==='amount') row.total=1.5
 if(kind==='unknown-command') row.command.total=1
 if(kind==='duplicate-ticket') backup.intents.push({...row,command:{...row.command,idempotencyKey:'refund-second-valid-key-0002'}})
 if(kind==='duplicate-key') backup.intents.push({...row,command:{...row.command,originalTicketId:'another-ticket'}})
 if(kind==='reference') row.command.paymentReferences=[{method:'cash',reference:'not external'}]
 if(kind==='returns') row.command.returnLineIds=['duplicate','duplicate']
 const target=await fixture()
 await expect(restoreRefundIntents(target.db,user,JSON.stringify(backup))).rejects.toThrow()
 expect(await listRefundIntents(target.db,user)).toHaveLength(0)
})
it('limite taille et nombre, sans tronquer ou créer de clés',async () => {
 const source=await fixture();await source.prepare();const backup=JSON.parse(await exportRefundIntents(source.db,user));const target=await fixture()
 await expect(restoreRefundIntents(target.db,user,' '.repeat(REFUND_BACKUP_LIMIT+1))).rejects.toThrow('5 Mo')
 backup.intents=Array.from({length:1001},() => backup.intents[0])
 await expect(restoreRefundIntents(target.db,user,JSON.stringify(backup))).rejects.toThrow()
 expect(await listRefundIntents(target.db,user)).toHaveLength(0)
})
it('UI : restaure sur espace sans ticket, vérifie seulement et ouvre l’avoir récupéré',async () => {
 const source=await fixture();const row=await source.prepare();const json=await exportRefundIntents(source.db,user)
 const target=await fixture();session()
 const fetch=vi.fn(async () => new Response(JSON.stringify(confirmation(row).body),{status:200}));vi.stubGlobal('fetch',fetch)
 show(target.repo)
 const upload=await screen.findByLabelText('Restaurer une sauvegarde remboursement (5 Mo max.)')
 const file=new File([json],'refund-intents.json',{type:'application/json'});Object.defineProperty(file,'text',{value:async()=>json})
 fireEvent.change(upload,{target:{files:[file]}})
 const inspect=await screen.findByRole('button',{name:'Contrôler sans renvoyer SPC-0000000001'})
 await waitFor(() => expect(inspect).toBeEnabled())
 expect(fetch).not.toHaveBeenCalled();expect(await target.db.checkoutOutbox.count()).toBe(0)
 expect(screen.queryByRole('button',{name:/Envoyer/})).not.toBeInTheDocument()
 fireEvent.click(inspect)
 const print=await screen.findByRole('button',{name:'Ouvrir l’avoir récupéré SPR-0000000002'})
 fireEvent.click(print)
 expect(screen.getByRole('article',{name:'Avoir de remboursement'})).toHaveTextContent('SPC-0000000001')
 expect(fetch).toHaveBeenCalledTimes(1)
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/checkout/refund/status');expect(JSON.parse(init.body as string)).toEqual({idempotencyKey:row.command.idempotencyKey})
 expect(await target.db.revenues.count()).toBe(0)
})
it('UI : masque la reprise au Caissier et pagine les intentions',async () => {
 const {db,repo}=await fixture()
 const rows=Array.from({length:11},(_,index) => ({key:`refundIntent:ticket-${index}`,value:JSON.stringify({scope:workspaceKey(user),tenantId:user.tenantId,actorId:user.id,originalReceiptNumber:`SPC-${index}`,total:0,state:'uncertain',command:{idempotencyKey:`refund-key-stable-${index}`,originalTicketId:`ticket-${index}`}})}))
 await db.workspaceMeta.bulkPut(rows);expect(await listRefundIntents(db,user)).toHaveLength(11);show(repo)
 await waitFor(() => expect(screen.getAllByRole('button',{name:/Contrôler sans renvoyer/})).toHaveLength(10))
 fireEvent.click(screen.getByRole('button',{name:'Remboursements suivants'}))
 expect(screen.getAllByRole('button',{name:/Contrôler sans renvoyer/})).toHaveLength(1)
 cleanup();show(repo,{...user,role:'cashier'})
 await act(async () => {await repo.readFullState()})
 expect(screen.queryByRole('button',{name:'Sauvegarder les intentions de remboursement'})).not.toBeInTheDocument()
})
it('refuse l’export au-delà de 1 000 intentions sans en omettre silencieusement',async () => {
 const {db}=await fixture()
 await db.workspaceMeta.bulkPut(Array.from({length:1001},(_,i) => ({key:`refundIntent:over-limit-${i}`,value:'{}'})))
 await expect(exportRefundIntents(db,user)).rejects.toThrow('1 000 intentions')
 expect(await db.workspaceMeta.where('key').startsWith('refundIntent:').count()).toBe(1001)
})
it('contrôle une intention restaurée seulement après absence puis exige les préconditions pour reprendre',async () => {
 const source=await fixture();await source.prepare();const target=await fixture()
 await restoreRefundIntents(target.db,user,await exportRefundIntents(source.db,user))
 const transport=vi.fn(async (row:RefundIntent) => ({status:200,body:{ok:true,review:canonical(row)}}))
 await expect(reviewRestoredRefund(target.db,user,original.ticketId,transport)).rejects.toThrow('statut')
 expect(transport).not.toHaveBeenCalled()
 await operateRefundIntent(target.db,user,original.ticketId,'status',async (row) => absence(row))
 await reviewRestoredRefund(target.db,user,original.ticketId,transport)
 const reviewed=await readRefundIntent(target.db,user,original.ticketId)
 expect(reviewed?.verificationOnly).toBe(true);expect(reviewed?.review?.precondition.fingerprint).toBe('a'.repeat(64))
 const json=await exportRefundIntents(target.db,user);expect(json).not.toContain('fingerprint');expect(json).not.toContain('precondition')
 await operateRefundIntent(target.db,user,original.ticketId,'send',async (row) => {expect(row.review).toEqual(reviewed?.review);return confirmation(row)})
 expect((await readRefundIntent(target.db,user,original.ticketId))?.state).toBe('refunded')
})
it.each(['scope','command','amount','lines','payment','fingerprint'])('rejette un contrôle incohérent sans autoriser une reprise : %s',async (kind) => {
 const source=await fixture();await source.prepare();const target=await fixture()
 await restoreRefundIntents(target.db,user,await exportRefundIntents(source.db,user))
 await operateRefundIntent(target.db,user,original.ticketId,'status',async (row) => absence(row))
 await expect(reviewRestoredRefund(target.db,user,original.ticketId,async (row) => {
  const review=canonical(row)
  if(kind==='scope') review.actorId='other'
  if(kind==='command') review.command={...review.command,reason:'different'}
  if(kind==='amount') review.total=1
  if(kind==='lines') review.lines[0].amount=1
  if(kind==='payment') review.payments[0].method='cash'
  if(kind==='fingerprint') review.precondition.fingerprint='wrong'
  return {status:200,body:{ok:true,review}}
 })).rejects.toThrow('incohérent')
 const network=vi.fn()
 await expect(operateRefundIntent(target.db,user,original.ticketId,'send',network)).rejects.toThrow('vérification seule')
 expect(network).not.toHaveBeenCalled()
})
it('une réponse perdue impose un nouveau statut et invalide le contrôle pour un éventuel renvoi',async () => {
 const source=await fixture();await source.prepare();const target=await fixture()
 await restoreRefundIntents(target.db,user,await exportRefundIntents(source.db,user))
 await operateRefundIntent(target.db,user,original.ticketId,'status',async (row) => absence(row))
 await reviewRestoredRefund(target.db,user,original.ticketId,async (row) => ({status:200,body:{ok:true,review:canonical(row)}}))
 await operateRefundIntent(target.db,user,original.ticketId,'send',async () => {throw new Error('lost')})
 expect((await readRefundIntent(target.db,user,original.ticketId))?.state).toBe('uncertain')
 const network=vi.fn()
 await expect(operateRefundIntent(target.db,user,original.ticketId,'send',network)).rejects.toThrow('statut')
 await operateRefundIntent(target.db,user,original.ticketId,'status',async (row) => absence(row))
 expect((await readRefundIntent(target.db,user,original.ticketId))?.review).toBeUndefined()
 await expect(operateRefundIntent(target.db,user,original.ticketId,'send',network)).rejects.toThrow('vérification seule')
 expect(network).not.toHaveBeenCalled()
})
it('UI : reprise sous confirmation explicite via review/resume, même clé et enveloppe protégée',async () => {
 vi.stubEnv('VITE_SERVER_CHECKOUT','true')
 const source=await fixture();const row=await source.prepare();const target=await fixture()
 await restoreRefundIntents(target.db,user,await exportRefundIntents(source.db,user));session()
 const fetch=vi.fn(async (url:string) => new Response(JSON.stringify(url.endsWith('/status') ? absence(row).body : url.endsWith('/review') ? {ok:true,review:canonical(row)} : confirmation(row).body),{status:200}));vi.stubGlobal('fetch',fetch)
 show(target.repo)
 fireEvent.click(await screen.findByRole('button',{name:'Contrôler sans renvoyer SPC-0000000001'}))
 fireEvent.click(await screen.findByRole('button',{name:'Contrôler le ticket canonique SPC-0000000001'}))
 const resume=await screen.findByRole('button',{name:'Reprendre avec préconditions SPC-0000000001'})
 expect(screen.getByText(/Produit historique canonique/)).toBeInTheDocument()
 expect(fetch).toHaveBeenCalledTimes(2)
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(resume)
 expect(fetch).toHaveBeenCalledTimes(2)
 confirm.mockReturnValue(true);fireEvent.click(resume)
 await screen.findByRole('button',{name:'Ouvrir l’avoir récupéré SPR-0000000002'})
 expect(fetch).toHaveBeenCalledTimes(3)
 const [path,init]=fetch.mock.calls[2] as unknown as [string,RequestInit]
 expect(path).toBe('/api/checkout/refund/resume')
 expect(JSON.parse(init.body as string)).toEqual({command:row.command,precondition:canonical(row).precondition})
 expect(await target.db.revenues.count()).toBe(0)
})
it('diagnostic ne change ni état, clé, commande ou autorisation d’une intention importée',async () => {
 const source=await fixture();await source.prepare();const target=await fixture()
 await restoreRefundIntents(target.db,user,await exportRefundIntents(source.db,user))
 const before=await target.db.workspaceMeta.get('refundIntent:canonical-sale')
 const result=await inspectRefundDiagnostic(target.db,user,original.ticketId,async (row,operation) => {
  expect(operation).toBe('diagnostic');return {status:200,body:{ok:true,diagnostic:diagnostic(row)}}
 })
 expect(result.blockers[0].code).toBe('PRODUCT_UNAVAILABLE')
 expect(await target.db.workspaceMeta.get('refundIntent:canonical-sale')).toEqual(before)
 const network=vi.fn()
 await expect(operateRefundIntent(target.db,user,original.ticketId,'send',network)).rejects.toThrow('vérification seule')
 expect(network).not.toHaveBeenCalled()
})
it.each(['actor','amount','command','code','balance'])('rejette le diagnostic incohérent : %s',async (kind) => {
 const {db,prepare}=await fixture();await prepare();const before=await db.workspaceMeta.get('refundIntent:canonical-sale')
 await expect(inspectRefundDiagnostic(db,user,original.ticketId,async (row) => {
  const result=diagnostic(row)
  if(kind==='actor') result.actorId='other'
  if(kind==='amount') result.total=1
  if(kind==='command') result.command={...result.command,reason:'Modifié'}
  if(kind==='code') result.blockers[0].code='FORGED' as typeof result.blockers[0]['code']
  if(kind==='balance') result.cashBalance=1.5
  return {status:200,body:{ok:true,diagnostic:result}}
 })).rejects.toThrow('incohérent')
 expect(await db.workspaceMeta.get('refundIntent:canonical-sale')).toEqual(before)
})
it('UI : diagnostic explicite sans renvoi, affiche le blocage sans libérer l’intention',async () => {
 const {db,repo,prepare}=await fixture();const row=await prepare();session()
 const fetch=vi.fn(async () => new Response(JSON.stringify({ok:true,diagnostic:diagnostic(row)}),{status:200}));vi.stubGlobal('fetch',fetch)
 const before=await db.workspaceMeta.get('refundIntent:canonical-sale')
 show(repo)
 fireEvent.click(await screen.findByRole('button',{name:'Diagnostiquer les blocages SPC-0000000001'}))
 const section=await screen.findByRole('region',{name:'Diagnostic SPC-0000000001'})
 expect(section).toHaveTextContent('PRODUCT_UNAVAILABLE');expect(section).toHaveTextContent('non disponible ici')
 expect(fetch).toHaveBeenCalledTimes(1)
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/checkout/refund/diagnostic');expect(JSON.parse(init.body as string)).toEqual({command:row.command,expectedTotal:1000,expectedOriginalReceiptNumber:row.originalReceiptNumber})
 expect(await db.workspaceMeta.get('refundIntent:canonical-sale')).toEqual(before)
 expect(screen.queryByRole('button',{name:/Reprendre avec préconditions/})).not.toBeInTheDocument()
 expect(await db.revenues.count()).toBe(0)
})
