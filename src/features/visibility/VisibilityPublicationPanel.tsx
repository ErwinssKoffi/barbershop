import { useEffect,useRef,useState } from 'react'
import { useAuth } from '../../contexts/authContext'
import { visibilityPublicationRequest,unpublishVisibilityRequest } from '../../lib/visibilityClient'
import type { VisibilityPublicationStatus } from '../../domain/visibilityPublication'
export function VisibilityPublicationPanel({onChanged}:{onChanged:()=>void}) {
  const {currentUser:user}=useAuth()
  const [status,setStatus]=useState<VisibilityPublicationStatus|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirmed,setConfirmed]=useState(false)
  const alive=useRef(true),flight=useRef(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const run=async(unpublish=false)=>{
    if(!user || flight.current || (unpublish && (!confirmed || !status?.version || !status.publicationRequested)))return
    flight.current=true;setBusy(true);setNotice('')
    try {
      if(unpublish){await unpublishVisibilityRequest(user,status!.version!);if(alive.current)onChanged()}
      const next=await visibilityPublicationRequest(user)
      if(alive.current){setStatus(next);setConfirmed(false);setNotice(unpublish?'Dépublication enregistrée. Rechargez les éditeurs avant toute modification.':'État relu sur le serveur.')}
    } catch(error){if(alive.current){setStatus(null);setConfirmed(false);setNotice(error instanceof Error?error.message:'Résultat incertain : rechargez l’état.')}}
    finally{flight.current=false;if(alive.current)setBusy(false)}
  }
  return <section aria-label="Contrôle de publication" className="rounded-xl border p-5 space-y-3">
    <h2>État et contrôles préliminaires de publication</h2>
    <button type="button" disabled={busy} onClick={()=>void run()}>Vérifier l’état de publication</button>
    {notice&&<p role="status">{notice}</p>}
    {status&&<><p>{status.visibility==='visible'?'Fiche actuellement visible selon le gate serveur.':'Fiche non visible selon le gate serveur.'}</p>
      <p>Version du brouillon : {status.version??'absent'} ; révision de la copie publiée : {status.publishedRevision??'absente'}.</p>
      <ul>{status.blockers.map(b=><li key={b.code}>{b.message}</li>)}</ul></>}
    <button type="button" disabled>Publier des photos — stockage sécurisé non raccordé</button>
    <label className="block"><input type="checkbox" checked={confirmed} disabled={busy||!status?.publicationRequested} onChange={event=>setConfirmed(event.target.checked)}/>Je confirme le retrait de la fiche de la visibilité publique.</label>
    <button type="button" disabled={busy||!confirmed||!status?.publicationRequested} onClick={()=>void run(true)}>Dépublier la fiche</button>
    <p>La dépublication conserve brouillon, photos privées et historique ; elle ne supprime ni rendez-vous ni écriture financière. Cette checklist est préliminaire, pas une validation complète des médias ou des droits.</p>
  </section>
}
