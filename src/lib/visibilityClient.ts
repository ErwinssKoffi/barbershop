import { parseTextPublicationCommand,parseTextPublicationResult,type TextPublicationCommand } from '../domain/textPublication'
import { parseVisibilityPreview } from '../domain/visibilityPreview'
import { parsePlanEntitlements } from '../domain/subscriptions'
import { parsePublicationStatus } from '../domain/visibilityPublication'
import { parseVisibilityConfig,type VisibilityConfigView } from '../domain/visibilityConfig'
import type { PublicSalonUser } from '../domain/models'
import type { SalonPublicProfileDraft } from '../domain/marketplace'
import { parseVisibilityDraft, type VisibilityDraftFields } from '../domain/visibility'
import { workspaceKey } from '../db/accountWorkspace'
import { accessClaims,currentAccessToken,readStoredSession } from './sessionClient'
import { fetchWithCapturedSession } from './scopedSyncClient'
async function request(user:PublicSalonUser,action:'read'|'save'|'config/read'|'config/save'|'publication/read'|'publication/unpublish'|'subscription/read'|'preview/read'|'publication/publish',input:unknown) {
  const token=await currentAccessToken(),session=readStoredSession(),claims=accessClaims(token)
  if(!user.isActive || user.role!=='manager' || !user.tenantId || !session.user?.isActive || workspaceKey(session.user)!==workspaceKey(user) || !token || claims?.uid!==user.id || claims.tid!==user.tenantId) throw new Error('Reconnectez le Gérant de cet espace.')
  const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),20000)
  try {
    const response=await fetchWithCapturedSession(`/api/visibility/${action}`,token,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})
    const body=await response.json(),latest=readStoredSession()
    if(!latest.user?.isActive || workspaceKey(latest.user)!==workspaceKey(user) || latest.token!==token) throw new Error('Session modifiée : réponse ignorée.')
    if(!response.ok || body?.ok!==true || body.tenantId!==user.tenantId) {
      const messages:Record<string,string>={TEXT_PUBLICATION_DISABLED:'Publication textuelle désactivée sur le serveur.',TEXT_PUBLICATION_MIGRATION_REQUIRED:'Migration volontaire 022 requise.',PUBLIC_SLUG_CONFLICT:'Identifiant public déjà utilisé. Relisez l’état avant de changer votre intention.',PUBLICATION_REVIEW_REQUIRED:'Publication refusée : revérifiez abonnement, prestations, horaires et absence de photos publiques.',SUBSCRIPTION_MIGRATION_REQUIRED:'Migration 019 des abonnements requise.',VISIBILITY_DISABLED:'Module désactivé sur le serveur.',VISIBILITY_MIGRATION_REQUIRED:'Migration 009 non installée.',VISIBILITY_DETAILS_MIGRATION_REQUIRED:'Migration 016 des détails du profil non installée.',VISIBILITY_UNPUBLISH_MIGRATION_REQUIRED:'Migration 018 de dépublication requise.',VISIBILITY_EDITOR_MIGRATION_REQUIRED:'Migrations de l’éditeur (010, 011, 017) requises.',VISIBILITY_PROFILE_REQUIRED:'Enregistrez d’abord le profil.',VISIBILITY_SOURCE_UNAVAILABLE:'Prestation indisponible : retirez-la ou rechargez.',VISIBILITY_VERSION_CONFLICT:'Profil modifié ailleurs. Rechargez le brouillon.'}
      throw new Error(messages[body?.code]??'Opération refusée ou résultat incertain. Rechargez le brouillon avant de recommencer.')
    }
    if(action==='preview/read' || action==='subscription/read')return body
    if(action.startsWith('publication/'))return body
    if(action.startsWith('config/')) return body
    if(body.draft===null && action==='read') return null
    const row=body.draft as SalonPublicProfileDraft
    if(!row || row.tenantId!==user.tenantId || typeof row.id!=='string' || !row.id || !Number.isSafeInteger(row.version) || row.version<1) throw new Error('Réponse profil incohérente.')
    const fields:VisibilityDraftFields=parseVisibilityDraft({displayName:row.displayName,description:row.description,city:row.city,commune:row.commune,publicPhone:row.publicPhone,expectedVersion:row.version,...(row.details!==undefined?{details:row.details}:{})})
    return {...(fields.details?{details:fields.details}:{}),id:row.id,tenantId:row.tenantId,version:row.version,displayName:fields.displayName,description:fields.description,city:fields.city,commune:fields.commune,publicPhone:fields.publicPhone}
  } finally {window.clearTimeout(timeout)}
}

export async function visibilityRequest(user:PublicSalonUser,action:'read'|'save',input:unknown):Promise<SalonPublicProfileDraft|null> {return request(user,action,input)}
export async function visibilityConfigRequest(user:PublicSalonUser,action:'read'|'save',input:unknown):Promise<VisibilityConfigView> {
  const body=await request(user,`config/${action}`,input)
  const row=body.config as VisibilityConfigView
  const config=parseVisibilityConfig({expectedVersion:row?.expectedVersion,services:row?.services,weekly:row?.weekly,exceptions:row?.exceptions})
  if(typeof row.timezone!=='string' || !Array.isArray(row.offers) || row.offers.length>500)throw new Error('Réponse configuration incohérente.')
  try {new Intl.DateTimeFormat('fr',{timeZone:row.timezone})} catch {throw new Error('Fuseau incohérent.')}
  const offers=row.offers.map(o=>{
    parseVisibilityConfig({expectedVersion:1,services:[{serviceId:o.serviceId,variantId:o.variantId}],weekly:config.weekly,exceptions:[]})
    if(typeof o.label!=='string' || !o.label.trim() || o.label.length>160 || !Number.isSafeInteger(o.priceXof) || o.priceXof<0 || (o.durationMinutes!==null && (!Number.isInteger(o.durationMinutes) || o.durationMinutes<5 || o.durationMinutes>480)))throw new Error('Offre incohérente.')
    return {serviceId:o.serviceId,variantId:o.variantId,label:o.label,priceXof:o.priceXof,durationMinutes:o.durationMinutes}
  })
  return {...config,timezone:row.timezone,offers}
}

export async function visibilityPublicationRequest(user:PublicSalonUser) {
  return parsePublicationStatus((await request(user,'publication/read',{})).status)
}
export async function unpublishVisibilityRequest(user:PublicSalonUser,version:number) {
  const r=(await request(user,'publication/unpublish',{expectedVersion:version})).result
  if(!r || !Number.isSafeInteger(r.version) || r.version<1 || typeof r.changed!=='boolean')throw new Error('Réponse de dépublication incohérente : rechargez l’état.')
  return {version:r.version as number,changed:r.changed as boolean}
}

export async function subscriptionAccessRequest(user:PublicSalonUser) {
  const body=await request(user,'subscription/read',{}),s=body.subscription
  if(!s || !['absent','scheduled','active','grace','expired','revoked','suspended'].includes(s.state) || (s.planName!==null && typeof s.planName!=='string'))throw new Error('État abonnement incohérent.')
  for(const key of ['startsAt','endsAt','graceEndsAt'])if(s[key]!==null && (typeof s[key]!=='string' || !Number.isFinite(Date.parse(s[key]))))throw new Error('Période incohérente.')
  if(s.quotas!==null)parsePlanEntitlements(s.quotas)
  return {state:s.state as string,planName:s.planName as string|null,startsAt:s.startsAt as string|null,endsAt:s.endsAt as string|null,graceEndsAt:s.graceEndsAt as string|null}
}

export async function visibilityPreviewRequest(user:PublicSalonUser) {
  return parseVisibilityPreview((await request(user,'preview/read',{})).preview)
}

export async function publishVisibilityTextRequest(user:PublicSalonUser,input:TextPublicationCommand) {
 const command=parseTextPublicationCommand(input)
 return parseTextPublicationResult((await request(user,'publication/publish',command)).result)
}
