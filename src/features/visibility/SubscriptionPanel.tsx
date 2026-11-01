import { useEffect,useRef,useState } from 'react'
import { useAuth } from '../../contexts/authContext'
import { subscriptionAccessRequest } from '../../lib/visibilityClient'
import { ESSENTIEL_V1 } from '../../domain/subscriptions'
const labels:Record<string,string>={absent:'Aucun abonnement enregistré',scheduled:'Période à venir',active:'Période active',grace:'Délai de grâce',expired:'Période expirée',revoked:'Autorisation révoquée',suspended:'Accès suspendu pour sécurité'}
export function SubscriptionPanel() {
 const {currentUser:user}=useAuth()
 const [state,setState]=useState<Awaited<ReturnType<typeof subscriptionAccessRequest>>|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const alive=useRef(true),flight=useRef(false)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
 const load=async()=>{
  if(!user || flight.current)return
  flight.current=true;setBusy(true);setState(null);setNotice('')
  try{const result=await subscriptionAccessRequest(user);if(alive.current)setState(result)}catch(error){if(alive.current)setNotice(error instanceof Error?error.message:'Lecture indisponible.')}
  finally{flight.current=false;if(alive.current)setBusy(false)}
 }
 return <section className="rounded-xl border p-5 space-y-3" aria-label="Abonnement du salon">
  <h2>Abonnement du salon</h2><p>Offre commerciale validée : {ESSENTIEL_V1.name}, {ESSENTIEL_V1.priceXof.toLocaleString('fr-FR')} XOF par mois glissant.</p>
  <p>1 établissement · 1 Gérant + 1 Caissier · 5 collaborateurs · 3 photos · 10 prestations visibles. Contacts téléphone/WhatsApp et demandes de rendez-vous à confirmer, sans réservation automatique.</p>
  <p>Ces informations ne constituent ni une souscription active ni une preuve de paiement. Les limites ne sont pas encore appliquées aux données ERP existantes.</p>
  <button type="button" disabled={busy} onClick={()=>void load()}>Consulter mon abonnement</button>
  {notice&&<p role="status">{notice}</p>}
  {state&&<div><p>{labels[state.state]}</p>{state.planName&&<p>{state.planName}</p>}{state.endsAt&&<p>Fin de période : {state.endsAt}</p>}{state.graceEndsAt&&<p>Fin de grâce : {state.graceEndsAt}</p>}</div>}
  <p>Grâce de 3 jours : fiche déjà publiée maintenue ; nouvelles publications, photos et demandes publiques refusées. Cette politique sera raccordée au parcours public avant sa mise en service.</p>
  <p>Activation réservée à un futur contrôle plateforme authentifié, après vérification externe réelle. Aucun bouton ne simule un paiement ou une activation. Caisse et rendez-vous existants préservés.</p>
 </section>
}
