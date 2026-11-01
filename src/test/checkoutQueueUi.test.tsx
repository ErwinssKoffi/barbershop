import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { useSalonStore } from '../hooks/salonStoreContext'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import { CashSessionContext } from '../contexts/cashSessionContext'
import { ToastProvider } from '../hooks/ToastProvider'
import { CheckoutTicketModal } from '../components/checkout/CheckoutTicketModal'
import { drainCheckoutQueue } from '../db/checkoutQueue'
import type { PublicSalonUser, UserRole } from '../domain/models'
import type { CheckoutResult } from '../domain/checkout'

let db: SalonProDatabase | undefined
afterEach(async () => {cleanup();vi.unstubAllEnvs();if(db) {db.close();await db.delete();db=undefined}})
it.each(['manager','cashier'] as UserRole[])('pilote %s : double soumission, attente durable puis reçu issu du ACK, sans vente locale', async (role) => {
 vi.stubEnv('VITE_SERVER_CHECKOUT','true')
 db = new SalonProDatabase(`queue-ui-${crypto.randomUUID()}`);const repo = new SalonRepositoryHub(db);await repo.ensureInitialized(false)
 const account: PublicSalonUser = {id:'queue-ui-user',tenantId:'queue-ui-tenant',role,fullName:'Compte Caisse',email:'queue-ui@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
 await db.workspaceMeta.bulkPut([{key:'accountScope',value:workspaceKey(account)},{key:'cloudTenantId',value:account.tenantId!}])
 const service = await repo.saveService({name:'Prestation Catalogue',categoryCode:'coupes',referencePrice:3000})
 const cash = await repo.openCashSession(0)
 const onClose = vi.fn();const onCreated = vi.fn()
 function Ready() {const {ready} = useSalonStore();return ready ? <CheckoutTicketModal open initialServiceId={service.id} onClose={onClose} onTicketCreated={onCreated}/> : null}
 render(<AuthContext.Provider value={{currentUser:account} as AuthContextValue}><SalonStoreProvider repository={repo}><CashSessionContext.Provider value={{openSession:cash,theoreticalBalance:0,isSessionStale:false,openQuickCashModal:() => {}}}><ToastProvider><Ready/></ToastProvider></CashSessionContext.Provider></SalonStoreProvider></AuthContext.Provider>)
 const submit = await screen.findByRole('button',{name:/Mettre en attente serveur/})
 expect(screen.getByLabelText('Date du ticket')).toBeDisabled()
 const form = submit.closest('form')!
 fireEvent.submit(form);fireEvent.submit(form)
 await waitFor(async () => expect(await db!.checkoutOutbox.count()).toBe(1))
 await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
 expect(onCreated).not.toHaveBeenCalled()
 expect(await db.revenues.count()).toBe(0);expect(await db.stockMovements.count()).toBe(0);expect(await db.cashMovements.count()).toBe(0)
 expect(await screen.findByText(/En attente — référence provisoire/)).toBeInTheDocument()
 expect(screen.queryByRole('button',{name:/Reçu confirmé/})).not.toBeInTheDocument()
 const job = (await db.checkoutOutbox.toArray())[0]
 const revenue = {id:'canonical-line',ticketId:'canonical-ticket',receiptNumber:'SPC-0000000001',date:'2026-10-31T12:00:00Z',label:'Prestation Catalogue',categoryCode:'hair_service',amount:3000,paymentMethod:'cash',sourceModule:'revenue' as const,createdAt:'2026-10-31',updatedAt:'2026-10-31',isArchived:false}
 const result: CheckoutResult = {tenantId:account.tenantId!,status:'confirmed',confirmed:true,ticketId:'canonical-ticket',receiptNumber:'SPC-0000000001',actorId:account.id,confirmedAt:'2026-10-31',command:job.command,quote:{status:'quoted',confirmed:false,currency:'XOF',idempotencyKey:job.idempotencyKey,quotedAt:'2026-10-31',lines:[],subtotal:3000,discount:0,total:3000,payments:job.command.payments,cashAmount:3000,change:0,stockRequired:[]},records:{revenues:[revenue],products:[],stockMovements:[],cashMovements:[]}}
 await drainCheckoutQueue(db,account,async () => ({status:200,body:{ok:true,result}}))
 const print = await screen.findByRole('button',{name:'Reçu confirmé SPC-0000000001'})
 await userEvent.click(print)
 expect(await screen.findByText('Numéro serveur :')).toBeInTheDocument()
 expect(screen.getByText(/Encaissement confirmé par le serveur/)).toBeInTheDocument()
 expect(await db.revenues.count()).toBe(0) // receipt from canonical ACK even before pull
})
