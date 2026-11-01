import { parseProfileDetails, type ProfileDetails } from './profileDetails.ts'
export interface VisibilityDraftFields {
  details?:ProfileDetails
  displayName:string; description:string; city:string; commune:string; publicPhone:string|null
}
export function parseVisibilityDraft(input:unknown):VisibilityDraftFields & {expectedVersion:number} {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid visibility draft')
  const r=input as Record<string,unknown>
  if(Object.keys(r).some(k=>!['displayName','description','city','commune','publicPhone','expectedVersion','details'].includes(k))) throw new Error('Unknown visibility field')
  const text=(value:unknown,max:number)=>{
    if(typeof value!=='string' || value.length>max || Array.from(value).some(c=>c.charCodeAt(0)<32 && !['\n','\r','\t'].includes(c))) throw new Error('Invalid profile text')
    return value.trim()
  }
  if(!Number.isSafeInteger(r.expectedVersion) || Number(r.expectedVersion)<0 || Number(r.expectedVersion)>=2147483647) throw new Error('Invalid profile version')
  return {...(r.details!==undefined?{details:parseProfileDetails(r.details)}:{}),displayName:text(r.displayName,160),description:text(r.description,4000),city:text(r.city,120),commune:text(r.commune,120),publicPhone:r.publicPhone===null?null:text(r.publicPhone,80)||null,expectedVersion:Number(r.expectedVersion)}
}
