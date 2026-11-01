import { parseVisibilityDraft,type VisibilityDraftFields } from './visibility.ts'
import { parseVisibilityConfig } from './visibilityConfig.ts'
import type { WeeklyOpeningDay,PublicScheduleException } from './scheduling.ts'
export interface VisibilityPreview {
 version:number;capturedAt:string;profile:VisibilityDraftFields;timezone:string
 services:{id:string;displayName:string;description:string;priceXof:number;durationMinutes:number|null}[]
 selectedServiceCount:number;weekly:WeeklyOpeningDay[];exceptions:PublicScheduleException[]
 warnings:('SOURCE_UNAVAILABLE')[];published:false;onlineBooking:false;media:'not_connected'
}
/** Private preview allowlist; no source ERP payload, private note or media object key. */
export function parseVisibilityPreview(input:unknown):VisibilityPreview {
 if(!input || typeof input!=='object' || Array.isArray(input))throw new Error('Aperçu invalide.')
 const r=input as VisibilityPreview
 if(!Number.isSafeInteger(r.version) || r.version<1 || typeof r.capturedAt!=='string' || !Number.isFinite(Date.parse(r.capturedAt)) || new Date(r.capturedAt).toISOString()!==r.capturedAt || r.published!==false || r.onlineBooking!==false || r.media!=='not_connected')throw new Error('Aperçu incohérent.')
 const fields=parseVisibilityDraft({...r.profile,expectedVersion:r.version})
 const profile:VisibilityDraftFields={displayName:fields.displayName,description:fields.description,city:fields.city,commune:fields.commune,publicPhone:fields.publicPhone,...(fields.details?{details:fields.details}:{})}
 const config=parseVisibilityConfig({expectedVersion:r.version,services:[],weekly:r.weekly,exceptions:r.exceptions})
 if(typeof r.timezone!=='string')throw new Error('Fuseau absent.')
 try{new Intl.DateTimeFormat('fr',{timeZone:r.timezone})}catch{throw new Error('Fuseau invalide.')}
 if(!Array.isArray(r.services) || r.services.length>500 || !Number.isSafeInteger(r.selectedServiceCount) || r.selectedServiceCount<r.services.length || r.selectedServiceCount>500 || !Array.isArray(r.warnings) || r.warnings.length>1 || r.warnings.some(w=>w!=='SOURCE_UNAVAILABLE') || ((r.selectedServiceCount>r.services.length)!==r.warnings.includes('SOURCE_UNAVAILABLE')))throw new Error('Sélection incohérente.')
 const seen=new Set<string>()
 const text=(v:unknown,max:number)=>{if(typeof v!=='string' || v.length>max)throw new Error('Texte aperçu invalide.');return v}
 const services=r.services.map(s=>{
  const id=text(s.id,200),displayName=text(s.displayName,160)
  if(!id || seen.has(id) || !displayName.trim() || !Number.isSafeInteger(s.priceXof) || s.priceXof<0 || (s.durationMinutes!==null && (!Number.isInteger(s.durationMinutes) || s.durationMinutes<5 || s.durationMinutes>480)))throw new Error('Prestation aperçu invalide.')
  seen.add(id)
  return {id,displayName,description:text(s.description,4000),priceXof:s.priceXof,durationMinutes:s.durationMinutes}
 })
 return {version:r.version,capturedAt:r.capturedAt,profile,timezone:r.timezone,services,selectedServiceCount:r.selectedServiceCount,weekly:config.weekly,exceptions:config.exceptions,warnings:[...r.warnings],published:false,onlineBooking:false,media:'not_connected'}
}
