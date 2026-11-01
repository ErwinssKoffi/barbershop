import { TextPublicationPanel } from './TextPublicationPanel'
import { VisibilityPreviewPanel } from './VisibilityPreviewPanel'
import { SubscriptionPanel } from './SubscriptionPanel'
import { VisibilityPublicationPanel } from './VisibilityPublicationPanel'
import { VisibilityConfigEditor } from './VisibilityConfigEditor'
import { emptyProfileDetails } from '../../domain/profileDetails'
import { useEffect,useRef,useState,type FormEvent } from 'react'
import { useAuth } from '../../contexts/authContext'
import { workspaceKey } from '../../db/accountWorkspace'
import type { VisibilityDraftFields } from '../../domain/visibility'
import { visibilityRequest } from '../../lib/visibilityClient'
const empty:VisibilityDraftFields={displayName:'',description:'',city:'',commune:'',publicPhone:null,details:emptyProfileDetails()}
function Editor() {
  const {currentUser:user}=useAuth()
  const [form,setForm]=useState<VisibilityDraftFields>(empty),[version,setVersion]=useState(0),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[previewEpoch,setPreviewEpoch]=useState(0)
  const alive=useRef(true),flight=useRef(false)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  if(!user?.tenantId) return <p>Connexion Cloud avec salon identifié requise. Aucun brouillon local de remplacement.</p>
  const run=async(action:'read'|'save')=>{
    if(flight.current) return
    flight.current=true;setBusy(true);setNotice('')
    try {
      const result=await visibilityRequest(user,action,action==='read'?{}:{...form,expectedVersion:version})
      if(alive.current) {setForm(result?{displayName:result.displayName,description:result.description,city:result.city,commune:result.commune,publicPhone:result.publicPhone,details:result.details??emptyProfileDetails()}:empty);setVersion(result?.version??0);setLoaded(true);setNotice(action==='save'?'Brouillon enregistré sur le serveur. Aucune publication effectuée.':'Brouillon chargé depuis le serveur.')}
    } catch(error) {if(alive.current){setLoaded(false);setNotice(error instanceof Error?error.message:'Opération indisponible. Rechargez avant de réessayer.')}}
    finally {flight.current=false;if(alive.current)setBusy(false)}
  }
  const submit=(event:FormEvent)=>{event.preventDefault();if(loaded)void run('save')}
  return <section className="space-y-6">
    <header><h1 className="page-title">Visibilité en ligne</h1><p>Édition du brouillon privé. Cet écran ne modifie pas la fiche publiée.</p></header>
    <button type="button" disabled={busy} onClick={()=>void run('read')}>Charger / recharger le brouillon</button>
    {notice&&<p role="status">{notice}</p>}
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={!loaded||busy} className="space-y-4">
        {([['displayName','Nom public',160],['city','Ville',120],['commune','Commune / quartier',120],['publicPhone','Téléphone public (facultatif)',80]] as const).map(([key,label,max])=><label key={key} className="block">{label}<input className="input" value={form[key]??''} maxLength={max} onChange={event=>setForm({...form,[key]:event.target.value})}/></label>)}
        <label className="block">Description<textarea className="input" value={form.description} maxLength={4000} onChange={event=>setForm({...form,description:event.target.value})}/></label>
        <h2>Informations publiques complémentaires</h2>
        {([
          ['slogan','Slogan',160,'text'],['category','Catégorie du salon',120,'text'],['publicAddress','Adresse publique',500,'text'],
          ['whatsapp','WhatsApp (format international +…)',80,'tel'],['publicEmail','Email public',254,'email'],
          ['website','Site web (HTTPS)',2048,'url'],['facebook','Facebook (HTTPS)',2048,'url'],['instagram','Instagram (HTTPS)',2048,'url'],['tiktok','TikTok (HTTPS)',2048,'url'],
        ] as const).map(([key,label,max,type])=><label key={key} className="block">{label}<input className="input" type={type} maxLength={max} value={form.details?.[key]??''} onChange={event=>setForm({...form,details:{...(form.details??emptyProfileDetails()),[key]:event.target.value}})}/></label>)}
        <p>Champs facultatifs. Ne renseignez ici que les contacts et l’adresse destinés à une future publication. Aucun lien n’est vérifié ou contacté automatiquement.</p>
        <button type="submit">Enregistrer le brouillon</button>
      </fieldset>
    </form>
    <article aria-label="Aperçu du brouillon" className="rounded-xl border p-6 space-y-3">
      <h2>Aperçu non publié</h2><h3>{form.displayName||'Nom public non renseigné'}</h3>
      <p className="whitespace-pre-wrap">{form.description||'Description non renseignée'}</p><p>{[form.city,form.commune].filter(Boolean).join(' — ')||'Localisation non renseignée'}</p>
      {form.details?.slogan&&<p>{form.details.slogan}</p>}
      {form.details?.category&&<p>{form.details.category}</p>}
      {form.details?.publicAddress&&<p>{form.details.publicAddress}</p>}
      {(['whatsapp','publicEmail','website','facebook','instagram','tiktok'] as const).map(key=>form.details?.[key]?<p key={key}>{key} : {form.details[key]}</p>:null)}
      {form.publicPhone&&<p>{form.publicPhone}</p>}
    </article>
    <VisibilityConfigEditor onSaved={()=>{setLoaded(false);setPreviewEpoch(n=>n+1)}}/>
    <VisibilityPreviewPanel key={`${version}:${previewEpoch}`}/>
    <SubscriptionPanel/>
    <TextPublicationPanel onChanged={()=>{setLoaded(false);setPreviewEpoch(n=>n+1)}}/>
    <VisibilityPublicationPanel onChanged={()=>{setLoaded(false);setPreviewEpoch(n=>n+1)}}/>
    <p>Publication textuelle sous contrôle serveur ; photos et portail restent non raccordés. Aucun upload fictif.</p>
  </section>
}
export function VisibilityPage() {
  const {currentUser}=useAuth()
  if(currentUser?.role!=='manager') return <p>Module réservé au Gérant.</p>
  return <Editor key={workspaceKey(currentUser)}/>
}
