import { useEffect,useRef,useState } from 'react'
import { useAuth } from '../../contexts/authContext'
import { visibilityPublicationRequest,publishVisibilityTextRequest } from '../../lib/visibilityClient'
import type { VisibilityPublicationStatus } from '../../domain/visibilityPublication'
import type { TextPublicationCommand } from '../../domain/textPublication'
export function TextPublicationPanel({onChanged}:{onChanged:()=>void}) {
 const {currentUser:user}=useAuth()
 const [status,setStatus]=useState<VisibilityPublicationStatus|null>(null),[slug,setSlug]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[uncertain,setUncertain]=useState(false)
 const pending=useRef<TextPublicationCommand|null>(null),alive=useRef(true),flight=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const check=async()=>{
  if(!user || flight.current)return
  flight.current=true;setBusy(true);setStatus(null);setConfirmed(false)
  try{const next=await visibilityPublicationRequest(user);if(alive.current){setStatus(next);setNotice('État relu ; les contrôles seront répétés dans la transaction de publication.')}}
  catch(error){if(alive.current)setNotice(error instanceof Error?error.message:'État indisponible.')}
  finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 const publish=async()=>{
  if(!user || flight.current)return
  if(!pending.current){
   if(!status?.canPublish || !status.version || !confirmed || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length<3 || slug.length>100)return
   pending.current={idempotencyKey:crypto.randomUUID(),expectedVersion:status.version,slug,confirmedWithoutPhotos:true}
  }
  flight.current=true;setBusy(true)
  try{
   const result=await publishVisibilityTextRequest(user,pending.current)
   if(alive.current){pending.current=null;setUncertain(false);setStatus(null);setConfirmed(false);setNotice(`Publication textuelle enregistrée (${result.outcome}), révision ${result.revision}. Aucun portail ni photo activé par cette réponse. Relisez l’état.`);onChanged()}
  }catch(error){if(alive.current){setUncertain(true);setStatus(null);setNotice(`${error instanceof Error?error.message:'Résultat incertain.'} Conservez cette intention : la reprise utilise la même clé, version et adresse.`)}}
  finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 const validSlug=slug.length>=3 && slug.length<=100 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
 return <section aria-label="Publication textuelle sans photos" className="rounded-xl border p-5 space-y-3">
  <h2>Publication textuelle sans photos</h2>
  <p>Copie du profil enregistré, des contacts, des prestations et des horaires. Aucun média ni réservation automatique. Vérifiez l’aperçu complet avant confirmation.</p>
  <button type="button" disabled={busy} onClick={()=>void check()}>Contrôler la publication sans photos</button>
  {status&&<ul>{status.blockers.map(b=><li key={b.code}>{b.message}</li>)}</ul>}
  <label className="block">Identifiant public (minuscules, chiffres et tirets)<input className="input" maxLength={100} value={slug} disabled={busy||uncertain} onChange={e=>setSlug(e.target.value)}/></label>
  <label className="block"><input type="checkbox" checked={confirmed} disabled={busy||uncertain||!status?.canPublish} onChange={e=>setConfirmed(e.target.checked)}/>Je confirme la publication des informations enregistrées sans aucune photo.</label>
  <button type="button" disabled={busy||!confirmed||!validSlug||!status?.canPublish||uncertain} onClick={()=>void publish()}>Publier la fiche sans photos</button>
  {uncertain&&<button type="button" disabled={busy} onClick={()=>void publish()}>Reprendre la même publication</button>}
  {notice&&<p role="status">{notice}</p>}
  <p>Après une erreur, ne créez pas une nouvelle intention. Avant de fermer cette page, faites vérifier un résultat encore incertain ; la clé de reprise est conservée uniquement pendant cette session d’écran.</p>
 </section>
}
