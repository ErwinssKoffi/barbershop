import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { useSalonStore } from '../hooks/salonStoreContext'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import { CheckoutHistoryPanel } from '../components/checkout/CheckoutHistoryPanel'
import { searchServerTickets, readServerTicket } from '../lib/checkoutHistoryClient'
import { storeAuthSession } from '../lib/sessionClient'
import type { PublicSalonUser } from '../domain/models'
import type { CheckoutResult } from '../domain/checkout'
const user:PublicSalonUser={id:'history-manager',tenantId:'history-tenant',role:'manager',isActive:true,fullName:'Responsable',email:'history@example.invalid',createdAt:'2026-10-31',updatedAt:'2026-10-31'}
const original={tenantId:user.tenantId,actorId:'another-cashier',confirmed:true,status:'confirmed',ticketId:'remote-ticket',receiptNumber:'SPC-0000000001',confirmedAt:'2026-10-31T12:00:00Z',command:{idempotencyKey:'canonical-remote-key-0001',payments:[{method:'wave',amount:1000}],lines:[{kind:'product',catalogId:'product',quantity:1}]},quote:{total:1000},records:{revenues:[{id:'original-revenue',ticketId:'remote-ticket',receiptNumber:'SPC-0000000001',date:'2026-10-31T12:00:00Z',label:'Produit historique',quantity:1,productId:'product',categoryCode:'other',amount:1000,paymentMethod:'wave'}],products:[],stockMovements:[],cashMovements:[]}} as unknown as CheckoutResult
const summary={ticketId:original.ticketId,receiptNumber:original.receiptNumber,confirmedAt:original.confirmedAt,actorId:original.actorId,total:1000,refundStatus:'not_refunded'}
const page=() => ({ok:true,tenantId:user.tenantId,rows:[summary],nextCursor:null})
const detail=(status='not_refunded') => ({ok:true,tenantId:user.tenantId,result:original,refundStatus:status})
const databases=new Set<SalonProDatabase>()
function session(account=user) {const token=`e30.${btoa(JSON.stringify({uid:account.id,tid:account.tenantId,sid:'history-session',exp:Date.now()+3600_000}))}.signature`;storeAuthSession(account,token,true);return token}
async function fixture(account=user) {
 const db=new SalonProDatabase(`history-ui-${crypto.randomUUID()}`);databases.add(db);const repo=new SalonRepositoryHub(db);await repo.ensureInitialized(false)
 await db.workspaceMeta.bulkPut([{key:'accountScope',value:workspaceKey(account)},{key:'cloudTenantId',value:account.tenantId!}])
 function Ready(){const {ready}=useSalonStore();return ready ? <CheckoutHistoryPanel/> : null}
 render(<AuthContext.Provider value={{currentUser:account} as AuthContextValue}><SalonStoreProvider repository={repo}><Ready/></SalonStoreProvider></AuthContext.Provider>)
 return {db,repo}
}
afterEach(async () => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();window.localStorage.clear();window.sessionStorage.clear();for(const db of databases) db.close();for(const db of databases) await db.delete();databases.clear()})
it('transport même origine/token capturé et conservation exacte du curseur microseconde',async () => {
 const token=session();const fetch=vi.fn(async () => new Response(JSON.stringify(page()),{status:200}));vi.stubGlobal('fetch',fetch)
 const query={receiptNumber:original.receiptNumber,cursor:{createdAt:'2026-10-31T12:00:00.123456Z',ticketId:'previous'}}
 await searchServerTickets(user,query)
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/checkout/history/search');expect(JSON.parse(init.body as string)).toEqual(query);expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`)
})
it('rejette les réponses d’un autre tenant et les détails dont les totaux divergent',async () => {
 session();const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({...page(),tenantId:'other'}))).mockResolvedValueOnce(new Response(JSON.stringify({...detail(),result:{...original,quote:{total:1}}})));vi.stubGlobal('fetch',fetch)
 await expect(searchServerTickets(user,{})).rejects.toThrow('refusée')
 await expect(readServerTicket(user,original.ticketId)).rejects.toThrow('incohérent')
})
it('bloque avant envoi un mauvais compte et ignore une réponse reçue après changement de session',async () => {
 session({...user,id:'other'});const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await expect(searchServerTickets(user,{})).rejects.toThrow('Reconnectez');expect(fetch).not.toHaveBeenCalled()
 session();let resolve!:(value:Response)=>void
 fetch.mockImplementation(() => new Promise<Response>((done) => {resolve=done}))
 const pending=searchServerTickets(user,{})
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
 session({...user,id:'other'})
 resolve(new Response(JSON.stringify(page()),{status:200}))
 await expect(pending).rejects.toThrow('Compte modifié')
})
it('UI : consulte un ticket distant et prépare un remboursement sans importer la vente ni envoyer',async () => {
 vi.stubEnv('VITE_SERVER_CHECKOUT','true');session()
 const fetch=vi.fn(async (url:string) => new Response(JSON.stringify(url.endsWith('/search') ? page() : detail()),{status:200}));vi.stubGlobal('fetch',fetch)
 const {db}=await fixture()
 fireEvent.click(await screen.findByRole('button',{name:'Rechercher les tickets serveur'}))
 fireEvent.click(await screen.findByRole('button',{name:'Consulter SPC-0000000001'}))
 expect(await screen.findByText('Ticket canonique SPC-0000000001')).toBeInTheDocument()
 expect(screen.getByText(/Encaissé par le compte another-cashier/)).toBeInTheDocument()
 fireEvent.change(await screen.findByLabelText('Motif obligatoire'),{target:{value:'Retour validé'}})
 fireEvent.change(screen.getByLabelText(/Référence du remboursement externe effectué/),{target:{value:'attestation réelle à contrôler'}})
 fireEvent.click(screen.getByRole('button',{name:'Enregistrer la commande sans envoyer'}))
 await screen.findByRole('button',{name:'Envoyer le remboursement avec la même clé'})
 expect(await db.checkoutOutbox.count()).toBe(0);expect(await db.revenues.count()).toBe(0);expect(await db.cashMovements.count()).toBe(0)
 expect((await db.workspaceMeta.get('refundIntent:remote-ticket'))?.value).toContain('Retour validé')
 expect(fetch).toHaveBeenCalledTimes(2)
})
it.each(['refunded','unavailable'])('UI : aucune nouvelle préparation si le suivi est %s',async (status) => {
 session();vi.stubGlobal('fetch',vi.fn(async (url:string) => new Response(JSON.stringify(url.endsWith('/search') ? page() : detail(status)),{status:200})))
 await fixture();fireEvent.click(await screen.findByRole('button',{name:'Rechercher les tickets serveur'}))
 fireEvent.click(await screen.findByRole('button',{name:'Consulter SPC-0000000001'}))
 await screen.findByText('Ticket canonique SPC-0000000001')
 expect(screen.queryByLabelText('Motif obligatoire')).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'Enregistrer la commande sans envoyer'})).not.toBeInTheDocument()
})
it('UI : aucune consultation exposée au Caissier et aucune recherche automatique',async () => {
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 const {repo}=await fixture({...user,role:'cashier'})
 await act(async () => {await repo.readFullState()})
 expect(screen.queryByRole('button',{name:'Rechercher les tickets serveur'})).not.toBeInTheDocument();expect(fetch).not.toHaveBeenCalled()
})
