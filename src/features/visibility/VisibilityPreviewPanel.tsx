import { useEffect,useRef,useState } from 'react'
import { useAuth } from '../../contexts/authContext'
import { visibilityPreviewRequest } from '../../lib/visibilityClient'
import type { VisibilityPreview } from '../../domain/visibilityPreview'
import { windowText } from '../../domain/visibilityConfig'
const days=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche']
export function VisibilityPreviewPanel() {
 const {currentUser:user}=useAuth()
 const [preview,setPreview]=useState<VisibilityPreview|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const alive=useRef(true),flight=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const load=async()=>{
  if(!user || flight.current)return
  flight.current=true;setBusy(true);setPreview(null);setNotice('')
  try{const value=await visibilityPreviewRequest(user);if(alive.current)setPreview(value)}
  catch(error){if(alive.current)setNotice(error instanceof Error?error.message:'Aperçu indisponible. Rechargez.')}
  finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 return <section aria-label="Aperçu complet enregistré" className="rounded-xl border p-5 space-y-3">
  <h2>Aperçu complet enregistré</h2>
  <p>Copie privée des données enregistrées sur le serveur, pas des modifications non sauvegardées. Aucun lien public ni réservation créé.</p>
  <button type="button" disabled={busy||!user?.tenantId} onClick={()=>void load()}>Charger l’aperçu complet</button>
  {notice&&<p role="alert">{notice}</p>}
  {preview&&<article className="space-y-3">
   <p>Version {preview.version} — relevé du {preview.capturedAt} — non publié.</p>
   <h3>{preview.profile.displayName||'Nom public non renseigné'}</h3>
   {preview.profile.details?.slogan&&<p>{preview.profile.details.slogan}</p>}
   <p className="whitespace-pre-wrap">{preview.profile.description}</p>
   <p>{[preview.profile.city,preview.profile.commune,preview.profile.details?.publicAddress].filter(Boolean).join(' — ')}</p>
   {preview.profile.details?.category&&<p>{preview.profile.details.category}</p>}
   {preview.profile.publicPhone&&<p>Téléphone : {preview.profile.publicPhone}</p>}
   {(['whatsapp','publicEmail','website','facebook','instagram','tiktok'] as const).map(key=>preview.profile.details?.[key]?<p key={key}>{key} : {preview.profile.details[key]}</p>:null)}
   <h3>Prestations sélectionnées ({preview.selectedServiceCount})</h3>
   {preview.warnings.length>0&&<p role="alert">Certaines prestations sélectionnées sont indisponibles et ne sont pas affichées. Rechargez et corrigez la sélection avant publication.</p>}
   {preview.services.length===0?<p>Aucune prestation disponible dans cette sélection.</p>:<ul>{preview.services.map(s=><li key={s.id}><strong>{s.displayName}</strong> — {s.priceXof.toLocaleString('fr-FR')} XOF — {s.durationMinutes===null?'Durée non renseignée':`${s.durationMinutes} min`}<p className="whitespace-pre-wrap">{s.description}</p></li>)}</ul>}
   <h3>Horaires — {preview.timezone}</h3>
   <ul>{preview.weekly.map(d=><li key={d.isoWeekday}>{days[d.isoWeekday-1]} : {windowText(d.windows)||'Fermé'}</li>)}</ul>
   <h3>Exceptions datées</h3>
   {preview.exceptions.length===0?<p>Aucune exception enregistrée.</p>:<ul>{preview.exceptions.map(d=><li key={d.localDate}>{d.localDate} : {windowText(d.windows)||'Fermé'}</li>)}</ul>}
   <p>Horaires indicatifs, pas des créneaux disponibles. Rendez-vous soumis à confirmation ; aucune réservation automatique.</p>
   <p>Photos non raccordées : aucun média fictif affiché. La validité de l’abonnement et les quotas seront revérifiés lors de la publication ; cet aperçu n’autorise pas sa mise en ligne.</p>
  </article>}
 </section>
}
