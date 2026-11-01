import { useEffect,useRef,useState } from 'react'
import { useAuth } from '../../contexts/authContext'
import { visibilityConfigRequest } from '../../lib/visibilityClient'
import { parseVisibilityConfig,parseWindowText,windowText,type VisibilityConfigView,type ServiceChoice } from '../../domain/visibilityConfig'
const days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche']
const key=(s:ServiceChoice)=>JSON.stringify([s.serviceId,s.variantId])
export function VisibilityConfigEditor({onSaved}:{onSaved:()=>void}) {
  const {currentUser:user}=useAuth()
  const [view,setView]=useState<VisibilityConfigView|null>(null),[selected,setSelected]=useState<ServiceChoice[]>([]),[week,setWeek]=useState<string[]>(Array(7).fill(''))
  const [exceptions,setExceptions]=useState<{date:string;text:string}[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[notice,setNotice]=useState('')
  const alive=useRef(true),flight=useRef(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const run=async(action:'read'|'save')=>{
    if(!user || flight.current)return
    let input:unknown={}
    if(action==='save') {
      try {input=parseVisibilityConfig({expectedVersion:view?.expectedVersion,services:selected,weekly:week.map((text,i)=>({isoWeekday:i+1,windows:parseWindowText(text)})),exceptions:exceptions.map(x=>({localDate:x.date,windows:parseWindowText(x.text)}))})}
      catch {setNotice('Corrigez les horaires, dates ou doublons avant d’enregistrer.');return}
    }
    flight.current=true;setBusy(true);setNotice('')
    try {
      const result=await visibilityConfigRequest(user,action,input)
      if(alive.current){setView(result);setSelected(result.services);setWeek(result.weekly.map(x=>windowText(x.windows)));setExceptions(result.exceptions.map(x=>({date:x.localDate,text:windowText(x.windows)})));setLoaded(true);setNotice(action==='save'?'Prestations et horaires enregistrés en brouillon. Rechargez le profil avant une autre modification.':'Configuration chargée.');if(action==='save')onSaved()}
    } catch(error){if(alive.current){setLoaded(false);setNotice(error instanceof Error?error.message:'Rechargement requis.')}}
    finally {flight.current=false;if(alive.current)setBusy(false)}
  }
  return <section className="space-y-4 rounded-xl border p-5" aria-label="Prestations et horaires">
    <h2>Prestations et horaires du brouillon</h2><p>Enregistrez d’abord le profil. Chaque éditeur utilise sa version : rechargez après une sauvegarde dans l’autre éditeur.</p>
    <button type="button" disabled={busy} onClick={()=>void run('read')}>Charger prestations et horaires</button>
    {notice&&<p role="status">{notice}</p>}
    <fieldset disabled={!loaded||busy} className="space-y-4">
      <legend>Prestations à présenter</legend>
      {view?.offers.length===0&&<p>Aucune prestation active et valide dans le catalogue ERP.</p>}
      {view?.offers.map(offer=><label className="block" key={key(offer)}><input type="checkbox" checked={selected.some(x=>key(x)===key(offer))} onChange={event=>setSelected(event.target.checked?[...selected,{serviceId:offer.serviceId,variantId:offer.variantId}]:selected.filter(x=>key(x)!==key(offer)))}/>{offer.label} — {offer.priceXof.toLocaleString('fr-FR')} XOF — {offer.durationMinutes===null?'durée non renseignée':`${offer.durationMinutes} min`}</label>)}
      {selected.filter(s=>!view?.offers.some(o=>key(o)===key(s))).map(s=><p key={key(s)}>Sélection indisponible : {s.serviceId}{s.variantId?` / ${s.variantId}`:''} <button type="button" onClick={()=>setSelected(selected.filter(x=>key(x)!==key(s)))}>Retirer cette sélection</button></p>)}
      <h3>Semaine d’ouverture — fuseau du salon : {view?.timezone??'non chargé'}</h3>
      <p>Format : 09:00-12:00,14:00-18:00. Vide = fermé. Fin de journée possible : 24:00. Ces horaires ne créent pas de créneaux réservables.</p>
      {days.map((day,i)=><label key={day} className="block">{day}<input className="input" value={week[i]} onChange={event=>setWeek(week.map((x,j)=>j===i?event.target.value:x))}/></label>)}
      <h3>Exceptions datées</h3><p>Une exception remplace toute la journée ; vide = fermeture exceptionnelle. Retirer une exception rétablit la semaine type.</p>
      {exceptions.map((x,i)=><div key={i} className="flex gap-2"><label>Date exceptionnelle<input type="date" value={x.date} onChange={event=>setExceptions(exceptions.map((v,j)=>j===i?{...v,date:event.target.value}:v))}/></label><label>Horaires exceptionnels<input value={x.text} onChange={event=>setExceptions(exceptions.map((v,j)=>j===i?{...v,text:event.target.value}:v))}/></label><button type="button" onClick={()=>setExceptions(exceptions.filter((_,j)=>j!==i))}>Retirer l’exception</button></div>)}
      <button type="button" disabled={exceptions.length>=366} onClick={()=>setExceptions([...exceptions,{date:'',text:''}])}>Ajouter une exception</button>
      <button type="button" onClick={()=>void run('save')}>Enregistrer prestations et horaires</button>
    </fieldset>
    <p>Sélection du brouillon uniquement : aucun tarif ERP modifié, aucune réservation ou publication créée. Les notes privées d’exception ne sont pas exposées dans cet éditeur.</p>
  </section>
}
