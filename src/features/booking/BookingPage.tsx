import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAuth } from '../../contexts/authContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { workspaceKey } from '../../db/accountWorkspace'
import { BOOKING_LABELS, bookingTransitions, type Booking, type CreateBooking } from '../../domain/booking'
import { bookingEnabled, readBookings, sendBooking, changeBooking } from '../../lib/bookingClient'
import { Button } from '../../components/ui/button'
import { formatDateTimeFR } from '../../utils/format'

function Agenda() {
 const {currentUser:user}=useAuth();const {state}=useSalonStore()
 const [date,setDate]=useState(() => {const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`})
 const [filter,setFilter]=useState('');const [rows,setRows]=useState<Booking[]>([]);const [loaded,setLoaded]=useState(false);const [truncated,setTruncated]=useState(false)
 const [kind,setKind]=useState<CreateBooking['kind']>('appointment');const [employeeId,setEmployee]=useState('');const [serviceId,setService]=useState('')
 const [name,setName]=useState('');const [contact,setContact]=useState('');const [note,setNote]=useState('');const [start,setStart]=useState('');const [duration,setDuration]=useState(30)
 const [key,setKey]=useState(() => crypto.randomUUID());const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('')
 const [move,setMove]=useState<Booking|null>(null);const [moveStart,setMoveStart]=useState('');const [moveDuration,setMoveDuration]=useState(30)
 const flight=useRef(false);const alive=useRef(true)
 useEffect(() => {alive.current=true;return () => {alive.current=false}},[])
 if(!user?.tenantId) return <p>Connexion Cloud avec salon identifié requise. Aucun agenda local de remplacement.</p>
 const staff=state.employees.filter((e) => e.isActive);const services=state.services.filter((s) => s.isActive)
 const load=async () => {
  const from=new Date(`${date}T00:00:00`);const to=new Date(from);to.setDate(to.getDate()+1)
  const result=await readBookings(user,{from:from.toISOString(),to:to.toISOString(),...(filter ? {employeeId:filter} : {})})
  if(alive.current) {setRows(result.bookings);setTruncated(result.truncated);setLoaded(true)}
 }
 const run=async (action:()=>Promise<void>) => {
  if(flight.current) return
  flight.current=true;setBusy(true);setNotice('');setRows([]);setLoaded(false)
  try {await action()} catch(error) {if(alive.current) setNotice(error instanceof Error ? error.message : 'Opération indisponible. Consultez l’agenda avant de réessayer.')}
  finally {flight.current=false;if(alive.current) setBusy(false)}
 }
 const interval=(value:string,minutes:number) => {const startAt=new Date(value).toISOString();return {startAt,endAt:new Date(Date.parse(startAt)+minutes*60000).toISOString()}}
 const create=(event:FormEvent) => {event.preventDefault();void run(async () => {
  await sendBooking(user,{idempotencyKey:key,kind,employeeId,...(kind==='appointment' ? {serviceId} : {}),customerName:kind==='appointment' ? name : '',customerContact:kind==='appointment' ? contact : '',note,...interval(start,duration)})
  if(alive.current) {setKey(crypto.randomUUID());setName('');setContact('');setNote('');setNotice('Enregistré sur le serveur. Aucun encaissement créé.')}
  await load()
 })}
 return <div className="space-y-5">
  <header><h1 className="page-title">Agenda des rendez-vous</h1><p>Horaires affichés dans le fuseau de cet appareil : {Intl.DateTimeFormat().resolvedOptions().timeZone}. Durée saisie manuellement, sans horaires d’ouverture automatiques.</p></header>
  <section className="rounded-lg border p-4 space-y-3" aria-label="Consulter l’agenda">
   <label>Jour <input aria-label="Jour" type="date" required value={date} disabled={busy} onChange={(e) => {setDate(e.target.value);setRows([]);setLoaded(false);setTruncated(false)}}/></label>
   <label>Employé <select aria-label="Filtrer par employé" value={filter} disabled={busy} onChange={(e) => {setFilter(e.target.value);setRows([]);setLoaded(false);setTruncated(false)}}><option value="">Tous</option>{staff.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</select></label>
   <Button disabled={busy || !date} onClick={() => void run(load)}>Charger l’agenda</Button>
   {loaded && !rows.length && <p>Aucun rendez-vous sur cette période.</p>}
   {truncated && <p role="alert">Liste limitée à 200 éléments. Filtrez par employé ; l’absence d’un créneau dans cette liste ne garantit pas sa disponibilité.</p>}
   <ul className="space-y-3">{rows.map((row) => <li key={row.id} className="rounded border p-3 space-y-2">
    <p className="font-semibold">{row.kind==='unavailable' ? 'Indisponibilité' : row.customerName} — {row.employeeName}</p>
    <p>{formatDateTimeFR(row.startAt)} → {formatDateTimeFR(row.endAt)} · {BOOKING_LABELS[row.status]}</p>
    {row.serviceName && <p>{row.serviceName}</p>}{row.customerContact && <p>{row.customerContact}</p>}{row.note && <p>{row.note}</p>}
    {user.role==='manager' && <div className="flex flex-wrap gap-2">{bookingTransitions(row).map((status) => <Button key={status} disabled={busy} variant="outline" onClick={() => {
     if(status==='cancelled' && !window.confirm('Annuler ce rendez-vous ? Son historique sera conservé.')) return
     void run(async () => {await changeBooking(user,{id:row.id,expectedVersion:row.version,status});await load()})
    }}>{BOOKING_LABELS[status]}</Button>)}
     {['planned','confirmed'].includes(row.status) && <Button disabled={busy} variant="outline" onClick={() => {setMove(row);setMoveStart('');setMoveDuration(Math.round((Date.parse(row.endAt)-Date.parse(row.startAt))/60000))}}>Déplacer</Button>}
    </div>}
   </li>)}</ul>
  </section>
  {user.role==='manager' && <form aria-label="Nouveau rendez-vous" onSubmit={create} className="rounded-lg border p-4 space-y-3">
   <h2 className="font-semibold">Nouveau rendez-vous ou indisponibilité</h2>
   <label>Type <select aria-label="Type" value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as CreateBooking['kind'])}><option value="appointment">Rendez-vous</option><option value="unavailable">Pause / absence / indisponibilité</option></select></label>
   <label>Employé <select aria-label="Employé du rendez-vous" required value={employeeId} disabled={busy} onChange={(e) => setEmployee(e.target.value)}><option value="">Choisir</option>{staff.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</select></label>
   {kind==='appointment' && <><label>Prestation <select aria-label="Prestation" required value={serviceId} disabled={busy} onChange={(e) => setService(e.target.value)}><option value="">Choisir</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>Client <input aria-label="Client" required maxLength={160} value={name} disabled={busy} onChange={(e) => setName(e.target.value)}/></label>
    <label>Contact (facultatif) <input aria-label="Contact" maxLength={100} value={contact} disabled={busy} onChange={(e) => setContact(e.target.value)}/></label></>}
   <label>Début <input aria-label="Début" type="datetime-local" required value={start} disabled={busy} onChange={(e) => setStart(e.target.value)}/></label>
   <label>Durée (minutes) <input aria-label="Durée" type="number" min={5} max={480} step={1} required value={duration} disabled={busy} onChange={(e) => setDuration(Number(e.target.value))}/></label>
   <label>Note <textarea aria-label="Note" maxLength={1000} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)}/></label>
   <Button type="submit" disabled={busy || !staff.length || (kind==='appointment' && !services.length)}>Enregistrer sur le serveur</Button>
   <p className="text-sm">En cas de réponse perdue : rechargez l’agenda avant de réessayer. La clé de création est conservée après un échec ; modifier les champs ne crée pas une nouvelle clé. Aucun paiement ni vente n’est créé ici.</p>
  </form>}
  {move && user.role==='manager' && <form aria-label="Déplacer un rendez-vous" className="rounded-lg border p-4 space-y-3" onSubmit={(e) => {e.preventDefault();void run(async () => {
   await changeBooking(user,{id:move.id,expectedVersion:move.version,status:move.status,...interval(moveStart,moveDuration)});if(alive.current) setMove(null);await load()
  })}}><h2>Déplacer le rendez-vous sélectionné</h2><label>Nouveau début <input aria-label="Nouveau début" type="datetime-local" required value={moveStart} disabled={busy} onChange={(e) => setMoveStart(e.target.value)}/></label>
   <label>Nouvelle durée <input aria-label="Nouvelle durée" type="number" required min={5} max={480} value={moveDuration} disabled={busy} onChange={(e) => setMoveDuration(Number(e.target.value))}/></label>
   <Button disabled={busy}>Confirmer le déplacement</Button><Button type="button" disabled={busy} variant="outline" onClick={() => setMove(null)}>Fermer</Button></form>}
  {notice && <p role="status">{notice}</p>}
 </div>
}
export function BookingPage() {
 const {currentUser}=useAuth()
 if(!bookingEnabled()) return <p>Module rendez-vous désactivé. La caisse reste disponible indépendamment.</p>
 if(!currentUser?.isActive) return <p>Connexion requise.</p>
 return <Agenda key={workspaceKey(currentUser)}/>
}
