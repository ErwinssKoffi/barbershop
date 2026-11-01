import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import type { PublicSalonUser } from '../domain/models'
import { FinancialReconciliationPanel } from '../components/checkout/FinancialReconciliationPanel'
import { readFinancialReconciliation } from '../lib/financialReconciliationClient'
import { validateFinancialReconciliation } from '../domain/financialReconciliation'
import { storeAuthSession } from '../lib/sessionClient'

const user:PublicSalonUser={id:'finance-manager',tenantId:'finance-tenant',role:'manager',isActive:true,fullName:'Responsable',email:'finance@example.invalid',createdAt:'2026-11-01',updatedAt:'2026-11-01'}
const report=() => ({tenantId:user.tenantId,checkedAt:'2026-11-01T12:00:00Z',status:'balanced',refundsAvailable:true,readOnly:true,documentsChecked:2,cashSessionsChecked:1,checks:{documentTotals:0,canonicalRecords:0,recordOwnership:0,cashSessionBalances:0,orphanCashMovements:0,invalidCashMovements:0}})
function session(account=user) {const token=`e30.${btoa(JSON.stringify({uid:account.id,tid:account.tenantId,sid:crypto.randomUUID(),exp:Date.now()+3600_000}))}.signature`;storeAuthSession(account,token,true);return token}
function panel(account=user) {return <AuthContext.Provider value={{currentUser:account} as AuthContextValue}><FinancialReconciliationPanel/></AuthContext.Provider>}
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();window.localStorage.clear();window.sessionStorage.clear()})
it('transport POST même origine, jeton capturé et corps sans tenant forgé',async () => {
 const token=session();const fetch=vi.fn(async () => new Response(JSON.stringify({ok:true,report:report()})));vi.stubGlobal('fetch',fetch)
 expect((await readFinancialReconciliation(user)).status).toBe('balanced')
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/checkout/reconciliation');expect(init.method).toBe('POST');expect(init.body).toBe('{}')
 expect(init.credentials).toBe('same-origin');expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`)
})
it('refuse un autre tenant, des compteurs invalides et un statut vert mensonger',() => {
 for(const value of [{...report(),tenantId:'other'},{...report(),documentsChecked:-1},{...report(),readOnly:false},{...report(),checks:{...report().checks,cashSessionBalances:1}},{...report(),refundsAvailable:false}]) expect(() => validateFinancialReconciliation(value,user.tenantId!)).toThrow('incohérent')
})
it('ne contacte pas le serveur pour un Caissier ou un autre compte local',async () => {
 session({...user,id:'other'});const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await expect(readFinancialReconciliation(user)).rejects.toThrow('Reconnectez')
 render(panel({...user,role:'cashier'}));expect(screen.queryByRole('button')).not.toBeInTheDocument()
 expect(fetch).not.toHaveBeenCalled()
})
it('ignore une réponse reçue après changement de session même pour le même compte',async () => {
 session();let finish!:(value:Response)=>void
 const fetch=vi.fn(() => new Promise<Response>((resolve) => {finish=resolve}));vi.stubGlobal('fetch',fetch)
 const pending=readFinancialReconciliation(user)
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
 session();finish(new Response(JSON.stringify({ok:true,report:report()})))
 await expect(pending).rejects.toThrow('Session modifiée')
})
it('affiche les écarts sans correction, puis efface le résultat si la nouvelle requête échoue',async () => {
 session();const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ok:true,report:{...report(),status:'discrepancies',checks:{...report().checks,cashSessionBalances:1}}}))).mockRejectedValueOnce(new Error('network'))
 vi.stubGlobal('fetch',fetch);render(panel())
 fireEvent.click(screen.getByRole('button',{name:'Vérifier les écritures Cloud'}))
 await screen.findByText('Écarts détectés — examen par le Gérant requis.')
 expect(screen.getByText('Soldes des sessions de caisse : 1 écart(s)')).toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:'Vérifier les écritures Cloud'}))
 await screen.findByRole('alert')
 expect(screen.queryByText('Écarts détectés — examen par le Gérant requis.')).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:/corriger/i})).not.toBeInTheDocument()
})
it('le changement de compte efface le rapport et ne déclenche aucune requête automatique',async () => {
 session();const fetch=vi.fn(async () => new Response(JSON.stringify({ok:true,report:report()})));vi.stubGlobal('fetch',fetch)
 const view=render(panel());fireEvent.click(screen.getByRole('button'))
 await screen.findByText('Aucun écart détecté sur le périmètre contrôlé.')
 view.rerender(panel({...user,id:'other'}))
 expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(fetch).toHaveBeenCalledTimes(1)
})
it('signale explicitement la couverture incomplète sans remboursement',async () => {
 session();vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({ok:true,report:{...report(),status:'incomplete',refundsAvailable:false}}))))
 render(panel());fireEvent.click(screen.getByRole('button'))
 await screen.findByText('Contrôle incomplet — migration des remboursements indisponible.')
 expect(screen.queryByText('Aucun écart détecté sur le périmètre contrôlé.')).not.toBeInTheDocument()
})
