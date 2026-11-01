import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { printableRefund } from '../lib/refundReceipt'
import { PrintableRefundModal } from '../components/checkout/PrintableRefundModal'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import { SalonStoreContext, type SalonStoreContextValue } from '../hooks/salonStoreContext'
import { workspaceKey } from '../db/accountWorkspace'
import { buildDefaultSalonInfo, buildDefaultSettings } from '../db/seed'
import type { RefundIntent } from '../db/checkoutRefundQueue'
import type { CheckoutRefundResult } from '../domain/checkoutRefund'
import type { PublicSalonUser, RevenueEntry } from '../domain/models'

const account:PublicSalonUser={id:'print-manager',tenantId:'print-tenant',role:'manager',isActive:true,fullName:'Responsable',email:'print@example.invalid',createdAt:'2026-10-31',updatedAt:'2026-10-31'}
function fixture():RefundIntent {
 const command={idempotencyKey:'refund-print-confirmed-0001',originalTicketId:'original-ticket',reason:'Retour autorisé',returnLineIds:['old-product'],cashSessionId:'open-drawer',paymentReferences:[{method:'wave',reference:'external-reference-attested'}]}
 const base={sourceModule:'revenue' as const,ticketId:'refund-ticket',receiptNumber:'SPR-0000000002',reversalOfTicketId:'original-ticket',date:'2026-10-31T12:00:00Z',createdAt:'2026-10-31T12:00:00Z',updatedAt:'2026-10-31T12:00:00Z',categoryCode:'other',isArchived:false,amountTendered:5000,changeGiven:1000}
 const revenues:RevenueEntry[]=[{...base,id:'reverse-service',reversalOfRevenueId:'old-service',label:'Remboursement — Prestation au prix historique',quantity:-2,amount:-9000,paymentMethod:'cash',paymentSplits:[{method:'cash',amount:-4000},{method:'wave',amount:-5000}]},{...base,id:'reverse-product',reversalOfRevenueId:'old-product',productId:'product',label:'Remboursement — Produit au prix historique',quantity:-2,amount:-1000,paymentMethod:'wave',paymentSplits:[{method:'wave',amount:-1000}]}]
 const result:CheckoutRefundResult={confirmed:true,status:'refunded',tenantId:account.tenantId!,actorId:account.id,confirmedAt:'2026-10-31T12:00:00Z',ticketId:'refund-ticket',receiptNumber:'SPR-0000000002',originalTicketId:'original-ticket',originalReceiptNumber:'SPC-0000000001',command,total:10000,payments:[{method:'cash',amount:4000},{method:'wave',amount:6000}],paymentExecution:'cash_ledger_and_external_attestation',records:{revenues,products:[],stockMovements:[],cashMovements:[]}}
 return {scope:workspaceKey(account),tenantId:account.tenantId!,actorId:account.id,originalReceiptNumber:'SPC-0000000001',total:10000,command,state:'refunded',result}
}
const mutate=vi.fn();const fetch=vi.fn()
function show(intent=fixture(),user=account,open=true) {
 const store={state:{salon:buildDefaultSalonInfo(),settings:buildDefaultSettings(),revenues:[],products:[{id:'product',salePrice:999999}],services:[],employees:[]},categoryLabel:(_scope:string,code:string)=>code,mutate,syncWithRepo:mutate} as unknown as SalonStoreContextValue
 const view=(next:PublicSalonUser) => <AuthContext.Provider value={{currentUser:next} as AuthContextValue}><SalonStoreContext.Provider value={store}><PrintableRefundModal intent={intent} open={open} onClose={vi.fn()}/></SalonStoreContext.Provider></AuthContext.Provider>
 const rendered=render(view(user));return {...rendered,asUser:(next:PublicSalonUser)=>rendered.rerender(view(next))}
}
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();mutate.mockClear();fetch.mockClear();document.body.classList.remove('printing-refund-only')})
it('accepte le résultat cohérent et ses montants historiques sans dépendre du catalogue courant',() => {
 const intent=fixture();expect(printableRefund(intent,account)).toBe(intent.result)
 show(intent)
 const article=screen.getByRole('article',{name:'Avoir de remboursement'})
 expect(within(article).getByText('SPC-0000000001')).toBeInTheDocument()
 expect(within(article).getByText('SPR-0000000002')).toBeInTheDocument()
 expect(within(article).getByText('TOTAL REMBOURSÉ : 10 000 FCFA')).toBeInTheDocument()
 expect(within(article).getByText(/Contrepassation des recettes : -10 000 FCFA/)).toBeInTheDocument()
 expect(within(article).getAllByText(/2 unité\(s\) annulée\(s\)/)).toHaveLength(2)
 expect(within(article).getByText('Produit remis en stock')).toBeInTheDocument()
 expect(article).not.toHaveTextContent('999 999');expect(article).not.toHaveTextContent('Espèces reçues');expect(article).not.toHaveTextContent('Monnaie rendue');expect(article).not.toHaveTextContent('TOTAL PAYÉ')
 expect(within(article).getByText(/external-reference-attested/)).toBeInTheDocument()
 expect(within(article).getByText(/Aucun paiement externe n’est exécuté ou vérifié/)).toBeInTheDocument()
})
it.each(['prepared','uncertain','not_found'] as const)('aucun avoir ou impression pour une intention %s',state => {
 const intent={...fixture(),state};expect(printableRefund(intent,account)).toBeNull();show(intent)
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Imprimer l’avoir'})).not.toBeInTheDocument()
})
it.each([{...account,id:'other'},{...account,tenantId:'other'},{...account,role:'cashier' as const},{...account,isActive:false}])('refuse un autre acteur/salon, le Caissier et un compte inactif (%j)',user => {
 expect(printableRefund(fixture(),user)).toBeNull();show(fixture(),user);expect(screen.queryByRole('article')).not.toBeInTheDocument()
})
it.each(['amount','split','receipt','command','quantity','payment','reference','origin','duplicate','date'])('refuse une confirmation corrompue : %s',kind => {
 const intent=fixture();const result=intent.result!
 if(kind==='amount') result.records.revenues[0].amount=-1
 if(kind==='split') result.records.revenues[0].paymentSplits![0].amount=-1
 if(kind==='receipt') result.receiptNumber='SPC-0000000002'
 if(kind==='command') result.command={...result.command,reason:'Autre motif'}
 if(kind==='quantity') result.records.revenues[0].quantity=2
 if(kind==='payment') result.payments[0].amount=1
 if(kind==='reference') result.command={...result.command,paymentReferences:[]}
 if(kind==='origin') result.records.revenues[0].reversalOfTicketId='wrong'
 if(kind==='duplicate') result.records.revenues.push(result.records.revenues[0])
 if(kind==='date') result.confirmedAt='bad date'
 expect(printableRefund(intent,account)).toBeNull();show(intent);expect(screen.queryByRole('article')).not.toBeInTheDocument()
})
it('imprime et réimprime depuis un portail isolé, nettoie après impression, sans mutation ni réseau',() => {
 vi.stubGlobal('fetch',fetch);const print=vi.spyOn(window,'print').mockImplementation(() => {})
 const intent=fixture();const before=JSON.stringify(intent);const {unmount}=show(intent)
 expect(document.getElementById('salon-refund-print-root')?.parentElement).toBe(document.body)
 fireEvent.click(screen.getByRole('button',{name:'Fiche A5'}))
 expect(document.getElementById('salon-refund-print-root')).toHaveAttribute('data-format','a5_sheet')
 fireEvent.click(screen.getByRole('button',{name:'Imprimer l’avoir'}))
 expect(document.body).toHaveClass('printing-refund-only');expect(print).toHaveBeenCalledTimes(1)
 act(() => window.dispatchEvent(new Event('afterprint')))
 expect(document.body).not.toHaveClass('printing-refund-only')
 fireEvent.click(screen.getByRole('button',{name:'Ticket 80 mm'}))
 fireEvent.click(screen.getByRole('button',{name:'Imprimer l’avoir'}))
 expect(print).toHaveBeenCalledTimes(2);expect(document.getElementById('salon-refund-print-root')).toHaveAttribute('data-format','thermal_80mm')
 unmount();expect(document.body).not.toHaveClass('printing-refund-only');expect(document.getElementById('salon-refund-print-root')).toBeNull()
 expect(mutate).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(JSON.stringify(intent)).toBe(before)
})
it('un échec d’impression conserve le résultat et nettoie le mode impression',() => {
 const intent=fixture();vi.spyOn(window,'print').mockImplementation(() => {throw new Error('blocked')});show(intent)
 fireEvent.click(screen.getByRole('button',{name:'Imprimer l’avoir'}))
 expect(screen.getByRole('alert')).toHaveTextContent('aucun nouvel envoi')
 expect(document.body).not.toHaveClass('printing-refund-only');expect(intent.state).toBe('refunded')
})
it('retire l’avoir et nettoie l’impression quand le compte change',() => {
 vi.spyOn(window,'print').mockImplementation(() => {});const view=show()
 fireEvent.click(screen.getByRole('button',{name:'Imprimer l’avoir'}))
 expect(document.body).toHaveClass('printing-refund-only')
 view.asUser({...account,id:'other'})
 expect(screen.queryByRole('article')).not.toBeInTheDocument();expect(document.body).not.toHaveClass('printing-refund-only')
})
it('ne montre ni document ni identité inventée lorsque la fenêtre est fermée',() => {
 show(fixture(),account,false);expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
