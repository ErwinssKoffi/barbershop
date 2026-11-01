import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { prepareRefundIntent, readRefundIntent, operateRefundIntent, type RefundIntent, type RefundDelivery } from '../db/checkoutRefundQueue'
import { CheckoutRefundPanel } from '../components/checkout/CheckoutRefundPanel'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { useSalonStore } from '../hooks/salonStoreContext'
import { requestRefund } from '../lib/checkoutRefundClient'
import { storeAuthSession } from '../lib/sessionClient'
import type { CheckoutResult } from '../domain/checkout'
import type { CheckoutRefundResult } from '../domain/checkoutRefund'
import type { PublicSalonUser } from '../domain/models'

const databases=new Set<SalonProDatabase>()
afterEach(async () => {cleanup();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();window.localStorage.clear();window.sessionStorage.clear();for(const db of databases) db.close();for(const db of databases) await db.delete();databases.clear()})
const user:PublicSalonUser={id:'refund-ui-manager',tenantId:'refund-ui-tenant',role:'manager',fullName:'Responsable',email:'refund-ui@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
const original={tenantId:user.tenantId,actorId:'original-cashier',status:'confirmed',confirmed:true,ticketId:'canonical-original-ticket',receiptNumber:'SPC-0000000001',confirmedAt:'2026-10-31',command:{payments:[{method:'wave',amount:1000}]},quote:{total:1000},records:{revenues:[{id:'original-product-revenue',label:'Produit',productId:'product-id',quantity:2,amount:1000}],products:[],stockMovements:[],cashMovements:[]}} as unknown as CheckoutResult
const input=() => ({reason:'Retour intégral demandé',returnLineIds:['original-product-revenue'],paymentReferences:[{method:'wave',reference:'référence externe attestée'}]})
async function fixture() {
 const db=new SalonProDatabase(`refund-ui-${crypto.randomUUID()}`);databases.add(db)
 const repo=new SalonRepositoryHub(db);await repo.ensureInitialized(false)
 await db.workspaceMeta.bulkPut([{key:'cloudTenantId',value:user.tenantId!},{key:'accountScope',value:workspaceKey(user)}])
 return {db,repo,prepare:()=>prepareRefundIntent(db,user,original,input())}
}
function confirmed(row:RefundIntent):RefundDelivery {
 const result:CheckoutRefundResult={status:'refunded',confirmed:true,tenantId:row.tenantId,actorId:row.actorId,confirmedAt:'2026-10-31',ticketId:'refund-confirmed-id',receiptNumber:'SPR-0000000002',originalTicketId:row.command.originalTicketId,originalReceiptNumber:row.originalReceiptNumber,total:row.total,command:row.command,payments:original.command.payments,paymentExecution:'cash_ledger_and_external_attestation',records:{revenues:[{...original.records.revenues[0],id:'refund-line',label:'Remboursement — Produit',quantity:-2,amount:-1000,ticketId:'refund-confirmed-id',receiptNumber:'SPR-0000000002',reversalOfRevenueId:'original-product-revenue',reversalOfTicketId:row.command.originalTicketId,paymentSplits:[{method:'wave',amount:-1000}]}],products:[],stockMovements:[],cashMovements:[]}}
 return {status:200,body:{ok:true,result}}
}
const absent=(row:RefundIntent):RefundDelivery => ({status:200,body:{ok:true,status:'not_found',idempotencyKey:row.command.idempotencyKey,actorId:row.actorId,tenantId:row.tenantId}})
function show(repo:SalonRepositoryHub,account=user) {
 function Ready(){const {ready}=useSalonStore();return ready ? <CheckoutRefundPanel original={original}/> : null}
 return render(<AuthContext.Provider value={{currentUser:account} as AuthContextValue}><SalonStoreProvider repository={repo}><Ready/></SalonStoreProvider></AuthContext.Provider>)
}
function session(account=user) {
 const token=`e30.${btoa(JSON.stringify({uid:account.id,tid:account.tenantId,sid:'refund-test-session',exp:Date.now()+3600_000}))}.signature`
 storeAuthSession(account,token,true);return token
}
it('prépare atomiquement une seule clé par ticket entre onglets, sans projection financière',async () => {
 const {db,prepare}=await fixture()
 const [first,second]=await Promise.all([prepare(),prepare()])
 expect(second).toEqual(first);expect(first.state).toBe('prepared')
 expect((await prepareRefundIntent(db,user,original,{...input(),reason:'Une autre intention'})).command).toEqual(first.command)
 expect(await db.revenues.count()).toBe(0);expect(await db.cashMovements.count()).toBe(0);expect(await db.stockMovements.count()).toBe(0)
})
it('persiste l’incertitude avant réseau, recharge la même clé et interdit le renvoi sans contrôle',async () => {
 const {db,prepare}=await fixture();const row=await prepare()
 const network=vi.fn(async () => {expect((await readRefundIntent(db,user,original.ticketId))?.state).toBe('uncertain');throw new Error('connection lost')})
 await operateRefundIntent(db,user,original.ticketId,'send',network)
 db.close();await db.open()
 expect((await readRefundIntent(db,user,original.ticketId))?.command.idempotencyKey).toBe(row.command.idempotencyKey)
 await expect(operateRefundIntent(db,user,original.ticketId,'send',network)).rejects.toThrow('Vérifiez le statut')
 expect(network).toHaveBeenCalledTimes(1)
})
it('récupère une confirmation perdue par statut sans renvoyer ni projeter les snapshots',async () => {
 const {db,prepare}=await fixture();await prepare()
 await operateRefundIntent(db,user,original.ticketId,'send',async () => {throw new Error('timeout')})
 const transport=vi.fn(async (row:RefundIntent,operation:string) => {expect(operation).toBe('status');return confirmed(row)})
 await operateRefundIntent(db,user,original.ticketId,'status',transport)
 expect((await readRefundIntent(db,user,original.ticketId))?.state).toBe('refunded')
 await operateRefundIntent(db,user,original.ticketId,'send',transport)
 expect(transport).toHaveBeenCalledTimes(1);expect(await db.revenues.count()).toBe(0)
})
it('ne reprend explicitement que la même commande après not_found',async () => {
 const {db,prepare}=await fixture();const initial=await prepare()
 await operateRefundIntent(db,user,original.ticketId,'status',async (row) => absent(row))
 expect((await readRefundIntent(db,user,original.ticketId))?.state).toBe('not_found')
 await operateRefundIntent(db,user,original.ticketId,'send',async (row) => {expect(row.command).toEqual(initial.command);return confirmed(row)})
 expect((await readRefundIntent(db,user,original.ticketId))?.result?.receiptNumber).toBe('SPR-0000000002')
})
it('refuse les faux accusés et statuts provenant d’un autre salon, acteur ou contenu',async () => {
 const {db,prepare}=await fixture();await prepare()
 for(const patch of [{tenantId:'other'},{actorId:'other'},{total:1},{command:{idempotencyKey:'other'}}]) {
  await operateRefundIntent(db,user,original.ticketId,'status',async (row) => {const answer=confirmed(row);answer.body.result={...(answer.body.result as object),...patch};return answer})
  expect((await readRefundIntent(db,user,original.ticketId))?.state).toBe('uncertain')
 }
 await operateRefundIntent(db,user,original.ticketId,'status',async (row) => ({status:200,body:{...absent(row).body,tenantId:'other'}}))
 expect((await readRefundIntent(db,user,original.ticketId))?.state).toBe('uncertain')
})
it('ne contacte jamais le réseau si le stockage échoue ; isole les rôles et espaces',async () => {
 const {db,prepare}=await fixture();await prepare();const network=vi.fn()
 await expect(readRefundIntent(db,{...user,id:'other'},original.ticketId)).rejects.toThrow()
 await expect(readRefundIntent(db,{...user,role:'cashier'},original.ticketId)).rejects.toThrow('Gérant')
 vi.spyOn(db.workspaceMeta,'put').mockRejectedValue(new Error('QuotaExceededError'))
 await expect(operateRefundIntent(db,user,original.ticketId,'send',network)).rejects.toThrow('QuotaExceededError')
 expect(network).not.toHaveBeenCalled()
})
it('valide motif, retour produit et référence externe avant préparation',async () => {
 const {db}=await fixture()
 for(const invalid of [{...input(),reason:''},{...input(),returnLineIds:['consumable']},{...input(),paymentReferences:[]}]) await expect(prepareRefundIntent(db,user,original,invalid)).rejects.toThrow()
 expect(await readRefundIntent(db,user,original.ticketId)).toBeNull()
})
it('transport : route relative, token capturé et commande identique ; statut sans renvoi',async () => {
 const {prepare}=await fixture();const row=await prepare();const token=session();vi.stubEnv('VITE_SERVER_CHECKOUT','true')
 const fetch=vi.fn(async () => new Response(JSON.stringify(confirmed(row).body),{status:200}));vi.stubGlobal('fetch',fetch)
 await requestRefund(row,'send')
 expect(fetch.mock.calls[0]).toBeDefined()
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/checkout/refund');expect(JSON.parse(init.body as string)).toEqual(row.command)
 expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`)
 await requestRefund(row,'status')
 const [statusUrl,statusInit]=fetch.mock.calls[1] as unknown as [string,RequestInit]
 expect(statusUrl).toBe('/api/checkout/refund/status');expect(JSON.parse(statusInit.body as string)).toEqual({idempotencyKey:row.command.idempotencyKey})
})
it('transport : pilote désactivé ou compte changé bloque tout envoi',async () => {
 const {prepare}=await fixture();const row=await prepare();session();const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 vi.stubEnv('VITE_SERVER_CHECKOUT','false');await expect(requestRefund(row,'send')).rejects.toThrow('désactivé')
 vi.stubEnv('VITE_SERVER_CHECKOUT','true');session({...user,id:'other'})
 await expect(requestRefund(row,'send')).rejects.toThrow('Gérant');expect(fetch).not.toHaveBeenCalled()
})
it('UI : préparation persistante sans réseau, confirmation annulée sans envoi',async () => {
 vi.stubEnv('VITE_SERVER_CHECKOUT','true');const {db,repo}=await fixture();const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 show(repo)
 const reason=await screen.findByLabelText('Motif obligatoire')
 fireEvent.change(reason,{target:{value:'Retour autorisé'}})
 fireEvent.change(screen.getByLabelText(/Référence du remboursement externe effectué/),{target:{value:'référence opérateur'}})
 fireEvent.click(screen.getByRole('button',{name:'Enregistrer la commande sans envoyer'}))
 const send=await screen.findByRole('button',{name:'Envoyer le remboursement avec la même clé'})
 expect(await readRefundIntent(db,user,original.ticketId)).not.toBeNull();expect(fetch).not.toHaveBeenCalled()
 vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(send)
 expect(fetch).not.toHaveBeenCalled();expect(screen.getByText('Préparé, non confirmé')).toBeInTheDocument()
})
it('UI : après réponse perdue le rechargement impose la vérification seule',async () => {
 vi.stubEnv('VITE_SERVER_CHECKOUT','true');const {db,repo,prepare}=await fixture();await prepare()
 await operateRefundIntent(db,user,original.ticketId,'send',async () => {throw new Error('lost')})
 session();const fetch=vi.fn(async () => new Response(JSON.stringify(confirmed((await readRefundIntent(db,user,original.ticketId))!).body),{status:200}));vi.stubGlobal('fetch',fetch)
 show(repo)
 const review=await screen.findByRole('button',{name:'Vérifier le remboursement sans renvoyer'})
 expect(screen.queryByRole('button',{name:'Envoyer le remboursement avec la même clé'})).not.toBeInTheDocument()
 await act(async () => {fireEvent.click(review)})
 await waitFor(() => expect(screen.getByText('Confirmé — SPR-0000000002')).toBeInTheDocument())
 fireEvent.click(screen.getByRole('button',{name:'Avoir confirmé SPR-0000000002'}))
 expect(screen.getByRole('article',{name:'Avoir de remboursement'})).toHaveTextContent('SPC-0000000001')
 expect(fetch).toHaveBeenCalledTimes(1);expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe('/api/checkout/refund/status')
 expect(await db.revenues.count()).toBe(0)
})
it('UI : aucun contrôle de remboursement pour le Caissier',async () => {
 const {repo}=await fixture();show(repo,{...user,role:'cashier'})
 await act(async () => {await repo.readFullState()})
 expect(screen.queryByText(/Remboursement intégral/)).not.toBeInTheDocument()
})
