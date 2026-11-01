import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AuthContext, type AuthContextValue } from '../contexts/authContext'
import { SalonStoreContext, type SalonStoreContextValue } from '../hooks/salonStoreContext'
import { BookingPage } from '../features/booking/BookingPage'
import { readBookings, sendBooking } from '../lib/bookingClient'
import { storeAuthSession } from '../lib/sessionClient'
import type { PublicSalonUser } from '../domain/models'
import type { Booking } from '../domain/booking'
const user:PublicSalonUser={id:'booking-manager',tenantId:'booking-tenant',role:'manager',isActive:true,fullName:'Responsable',email:'booking@example.invalid',createdAt:'2026-11-01',updatedAt:'2026-11-01'}
const booking:Booking={id:'booking-one',tenantId:user.tenantId!,kind:'appointment',employeeId:'employee-one',employeeName:'Employé',serviceId:'service-one',serviceName:'Prestation',customerName:'Client réservé',customerContact:'',note:'',startAt:'2026-11-05T10:00:00.000Z',endAt:'2026-11-05T10:30:00.000Z',status:'planned',version:1,createdAt:'2026-11-01T10:00:00.000Z',updatedAt:'2026-11-01T10:00:00.000Z'}
const period={from:'2026-11-05T00:00:00.000Z',to:'2026-11-06T00:00:00.000Z'}
const body=() => ({ok:true,tenantId:user.tenantId,bookings:[booking],truncated:false})
function session(account=user) {const token=`e30.${btoa(JSON.stringify({uid:account.id,tid:account.tenantId,sid:crypto.randomUUID(),exp:Date.now()+3600_000}))}.signature`;storeAuthSession(account,token,true);return token}
const state={employees:[{id:'employee-one',fullName:'Employé',isActive:true}],services:[{id:'service-one',name:'Prestation',isActive:true}]} as SalonStoreContextValue['state']
function panel(account=user) {return <AuthContext.Provider value={{currentUser:account} as AuthContextValue}><SalonStoreContext.Provider value={{state} as SalonStoreContextValue}><BookingPage/></SalonStoreContext.Provider></AuthContext.Provider>}
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();window.localStorage.clear();window.sessionStorage.clear()})
it('désactivé par défaut, aucun appel réseau ni formulaire',() => {
 vi.stubEnv('VITE_BOOKING_ENABLED','false');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(panel())
 expect(screen.getByText(/Module rendez-vous désactivé/)).toBeInTheDocument();expect(fetch).not.toHaveBeenCalled()
 expect(screen.queryByRole('form')).not.toBeInTheDocument()
})
it('transport même origine sous le jeton capturé, sans tenant forgé',async () => {
 vi.stubEnv('VITE_BOOKING_ENABLED','true');const token=session();const fetch=vi.fn(async () => new Response(JSON.stringify(body())));vi.stubGlobal('fetch',fetch)
 expect((await readBookings(user,period)).bookings).toHaveLength(1)
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/booking/list');expect(init.method).toBe('POST');expect(init.credentials).toBe('same-origin')
 expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`);expect(JSON.parse(init.body as string)).toEqual(period)
})
it('refuse un autre tenant ou une ancienne session même pour le même compte',async () => {
 vi.stubEnv('VITE_BOOKING_ENABLED','true');session();vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({...body(),tenantId:'other'}))))
 await expect(readBookings(user,period)).rejects.toThrow('refusée')
 let finish!:(value:Response)=>void;const fetch=vi.fn(() => new Promise<Response>((resolve) => {finish=resolve}));vi.stubGlobal('fetch',fetch)
 const pending=readBookings(user,period);await waitFor(() => expect(fetch).toHaveBeenCalled())
 session();finish(new Response(JSON.stringify(body())))
 await expect(pending).rejects.toThrow('Session modifiée')
})
it('affiche l’agenda seulement sur demande et retire les résultats au changement de jour',async () => {
 vi.stubEnv('VITE_BOOKING_ENABLED','true');session();const fetch=vi.fn(async () => new Response(JSON.stringify(body())));vi.stubGlobal('fetch',fetch)
 render(panel());expect(fetch).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Charger l’agenda'}))
 await screen.findByText('Client réservé — Employé')
 expect(screen.getByText('Prestation',{selector:'p'})).toBeInTheDocument()
 fireEvent.change(screen.getByLabelText('Jour'),{target:{value:'2026-11-06'}})
 expect(screen.queryByText('Client réservé — Employé')).not.toBeInTheDocument()
})
it('Caissier peut consulter mais ne voit ni création ni actions d’édition',async () => {
 vi.stubEnv('VITE_BOOKING_ENABLED','true');const cashier={...user,role:'cashier' as const};session(cashier)
 vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify(body()))))
 render(panel(cashier));fireEvent.click(screen.getByRole('button',{name:'Charger l’agenda'}))
 await screen.findByText('Client réservé — Employé')
 expect(screen.queryByRole('form',{name:'Nouveau rendez-vous'})).not.toBeInTheDocument()
 expect(screen.queryByRole('button',{name:'Annulé'})).not.toBeInTheDocument()
 await expect(sendBooking(cashier,{} as never)).rejects.toThrow('autorisé')
})
it('soumet une vraie saisie, sans encaissement, et conserve la même clé après une erreur réseau',async () => {
 vi.stubEnv('VITE_BOOKING_ENABLED','true');session();const fetch=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(new Response(JSON.stringify({ok:true,tenantId:user.tenantId,booking}))).mockResolvedValueOnce(new Response(JSON.stringify(body())))
 vi.stubGlobal('fetch',fetch);render(panel())
 fireEvent.change(screen.getByLabelText('Employé du rendez-vous'),{target:{value:'employee-one'}})
 fireEvent.change(screen.getByLabelText('Prestation'),{target:{value:'service-one'}})
 fireEvent.change(screen.getByLabelText('Client'),{target:{value:'Client réservé'}})
 fireEvent.change(screen.getByLabelText('Début'),{target:{value:'2026-11-05T10:00'}})
 fireEvent.submit(screen.getByRole('form',{name:'Nouveau rendez-vous'}))
 await screen.findByRole('status')
 const initial=JSON.parse((fetch.mock.calls[0] as unknown as [string,RequestInit])[1].body as string)
 fireEvent.submit(screen.getByRole('form',{name:'Nouveau rendez-vous'}))
 await screen.findByText('Enregistré sur le serveur. Aucun encaissement créé.')
 const retry=JSON.parse((fetch.mock.calls[1] as unknown as [string,RequestInit])[1].body as string)
 expect(retry).toEqual(initial)
 expect(fetch.mock.calls.map((call) => call[0])).toEqual(['/api/booking/create','/api/booking/create','/api/booking/list'])
})
it('un changement de compte efface l’agenda',async () => {
 vi.stubEnv('VITE_BOOKING_ENABLED','true');session();vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify(body()))))
 const view=render(panel());fireEvent.click(screen.getByRole('button',{name:'Charger l’agenda'}));await screen.findByText('Client réservé — Employé')
 view.rerender(panel({...user,id:'other'}));expect(screen.queryByText('Client réservé — Employé')).not.toBeInTheDocument()
})

it('sans catalogue réel le formulaire reste vide et la création est désactivée',() => {
 vi.stubEnv('VITE_BOOKING_ENABLED','true');session()
 render(<AuthContext.Provider value={{currentUser:user} as AuthContextValue}><SalonStoreContext.Provider value={{state:{employees:[],services:[]}} as unknown as SalonStoreContextValue}><BookingPage/></SalonStoreContext.Provider></AuthContext.Provider>)
 expect(screen.getByRole('button',{name:'Enregistrer sur le serveur'})).toBeDisabled()
 expect(screen.getByLabelText('Client')).toHaveValue('')
 expect(screen.getByLabelText('Employé du rendez-vous').querySelectorAll('option')).toHaveLength(1)
})
