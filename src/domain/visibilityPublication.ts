export interface VisibilityPublicationStatus {
  version:number|null; visibility:'visible'|'not_visible'; publicationRequested:boolean
  publishedRevision:number|null; canPublish:boolean; blockers:{code:string;message:string}[]
}
export function parsePublicationStatus(value:unknown):VisibilityPublicationStatus {
  const r=value as VisibilityPublicationStatus
  const version=(v:unknown)=>v===null || (typeof v==='number' && Number.isSafeInteger(v) && v>0)
  if(!r || !version(r.version) || !version(r.publishedRevision) || !['visible','not_visible'].includes(r.visibility) || typeof r.publicationRequested!=='boolean' || typeof r.canPublish!=='boolean' || !Array.isArray(r.blockers) || r.blockers.length>20 || (r.canPublish ? r.blockers.length!==0 || r.version===null : r.blockers.length===0))throw new Error('État de publication incohérent.')
  const blockers=r.blockers.map(b=>{
    if(!b || typeof b.code!=='string' || !b.code || b.code.length>80 || typeof b.message!=='string' || !b.message || b.message.length>300)throw new Error('Checklist incohérente.')
    return {code:b.code,message:b.message}
  })
  return {version:r.version,visibility:r.visibility,publicationRequested:r.publicationRequested,publishedRevision:r.publishedRevision,canPublish:r.canPublish,blockers}
}
