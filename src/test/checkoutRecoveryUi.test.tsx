import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { enqueueCheckout } from '../db/checkoutQueue'
import { exportCheckoutIntents } from '../db/checkoutRecovery'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { useSalonStore } from '../hooks/salonStoreContext'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import { storeAuthSession } from '../lib/sessionClient'
import { CheckoutQueuePanel } from '../components/checkout/CheckoutQueuePanel'
import type { PublicSalonUser } from '../domain/models'

const databases=new Set<SalonProDatabase>()
afterEach(async () => {cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();window.localStorage.clear();window.sessionStorage.clear();for(const db of databases) db.close();for(const db of databases) await db.delete();databases.clear()})
const account:PublicSalonUser={id:'recovery-ui-user',tenantId:'recovery-ui-tenant',role:'manager',fullName:'Responsable',email:'recovery-ui@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
const command=() => ({idempotencyKey:`checkout-${crypto.randomUUID()}`,lines:[{kind:'service' as const,catalogId:'catalog',quantity:1}],payments:[{method:'wave',amount:1000}]})
async function fixture() {
 const db=new SalonProDatabase(`recovery-ui-${crypto.randomUUID()}`);databases.add(db)
 const repo=new SalonRepositoryHub(db);await repo.ensureInitialized(false)
 await db.workspaceMeta.bulkPut([{key:'cloudTenantId',value:account.tenantId!},{key:'accountScope',value:workspaceKey(account)}])
 return {db,repo}
}
function show(repo:SalonRepositoryHub) {
 function Ready(){const {ready}=useSalonStore();return ready ? <CheckoutQueuePanel/> : null}
 render(<AuthContext.Provider value={{currentUser:account} as AuthContextValue}><SalonStoreProvider repository={repo}><Ready/></SalonStoreProvider></AuthContext.Provider>)
}
it('restaure depuis une file vide, vérifie sans envoi et demande une autorisation avant reprise',async () => {
 vi.stubEnv('VITE_SERVER_CHECKOUT','true')
 const source=await fixture();const job=await enqueueCheckout(source.db,account,command())
 const json=await exportCheckoutIntents(source.db,account)
 const {db,repo}=await fixture();show(repo)
 const upload=await screen.findByLabelText(/Restaurer une sauvegarde de file/)
 const file=new File([json],'intentions.json',{type:'application/json'})
 Object.defineProperty(file,'text',{value:async () => json})
 const fetch=vi.fn(async () => new Response(JSON.stringify({ok:true,status:'not_found',idempotencyKey:job.idempotencyKey,tenantId:account.tenantId,actorId:account.id}),{status:200,headers:{'Content-Type':'application/json'}}))
 vi.stubGlobal('fetch',fetch)
 await act(async () => {fireEvent.change(upload,{target:{files:[file]}});await vi.waitFor(async () => expect(await db.checkoutOutbox.count()).toBe(1));await repo.readFullState()})
 expect(await screen.findByText(/1 intention.*restaurée.*suspendue/)).toBeInTheDocument()
 expect(await db.checkoutOutbox.get(job.idempotencyKey)).toMatchObject({paused:true,state:'pending'})
 expect(fetch).not.toHaveBeenCalled()
 const token=`header.${btoa(JSON.stringify({uid:account.id,tid:account.tenantId,sid:'session',exp:Date.now()+3600000}))}.signature`
 storeAuthSession(account,token,false)
 await act(async () => {fireEvent.click(screen.getByRole('button',{name:'Vérifier au serveur sans renvoyer'}));await vi.waitFor(async () => expect((await db.checkoutOutbox.get(job.idempotencyKey))?.reviewHistory).toHaveLength(1));await repo.readFullState()})
 const resume=await screen.findByRole('button',{name:'Autoriser la reprise avec la même clé'})
 expect(fetch).toHaveBeenCalledTimes(1)
 expect((fetch.mock.calls[0] as unknown as [string,RequestInit])[0]).toBe('/api/checkout/status')
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false)
 await act(async () => {fireEvent.click(resume);await repo.readFullState()})
 expect((await db.checkoutOutbox.get(job.idempotencyKey))?.paused).toBe(true)
 confirm.mockReturnValue(true)
 await act(async () => {fireEvent.click(resume);await repo.readFullState()})
 await waitFor(async () => expect((await db.checkoutOutbox.get(job.idempotencyKey))?.paused).toBe(false))
 expect(await db.checkoutOutbox.count()).toBe(1);expect(await db.revenues.count()).toBe(0)
 expect(fetch).toHaveBeenCalledTimes(1) // no direct commit, even after authorizing retry
})
it('pagine et filtre les intentions sans montrer celles d’un autre scope',async () => {
 const {db,repo}=await fixture();const keys:string[]=[]
 for(let i=0;i<11;i++) {const job=await enqueueCheckout(db,account,command());keys.push(job.idempotencyKey);await db.checkoutOutbox.update(job.idempotencyKey,{createdAt:i})}
 const first=(await db.checkoutOutbox.toArray())[0]
 await db.checkoutOutbox.put({...first,idempotencyKey:'checkout-private-other',scope:workspaceKey({...account,id:'other'})})
 show(repo)
 expect(await screen.findByText('File d’encaissement — 11 en attente')).toBeInTheDocument()
 expect(screen.queryByText('checkout-private-other')).not.toBeInTheDocument()
 expect(screen.queryByText(keys[0])).not.toBeInTheDocument()
 await userEvent.click(screen.getByRole('button',{name:'Page suivante'}))
 expect(await screen.findByText(keys[0])).toBeInTheDocument()
 await userEvent.selectOptions(screen.getByLabelText('Filtrer la file'),'confirmed')
 expect(screen.getByText('Aucune intention dans ce filtre.')).toBeInTheDocument()
 expect(screen.queryByText(keys[0])).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Synchroniser et réessayer la file'})).toBeDisabled()
 expect(screen.getByRole('button',{name:'Sauvegarder les intentions non confirmées'})).toBeEnabled()
})
