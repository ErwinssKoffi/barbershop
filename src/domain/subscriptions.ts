/** Approved commercial policy, not a seeded subscription or payment. */
export interface PlanEntitlements {
  establishments:number; users:number; managers:number; cashiers:number; employees:number; galleryImages:number; publicServices:number
  publicProfile:boolean; serviceListing:boolean; contactRequests:boolean; appointmentRequests:boolean; onlineBooking:boolean
}
export const ESSENTIEL_V1={code:'essentiel',version:1,name:'SALON PRO ESSENTIEL',priceXof:4900,currency:'XOF',periodKind:'calendar_month',graceSeconds:259200,
  entitlements:{establishments:1,users:2,managers:1,cashiers:1,employees:5,galleryImages:3,publicServices:10,publicProfile:true,serviceListing:true,contactRequests:true,appointmentRequests:true,onlineBooking:false}} as const
export function parsePlanEntitlements(value:unknown):PlanEntitlements {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Invalid entitlements')
  const r=value as Record<string,unknown>,out:Record<string,unknown>={}
  const numbers=['establishments','users','managers','cashiers','employees','galleryImages','publicServices'],booleans=['publicProfile','serviceListing','contactRequests','appointmentRequests','onlineBooking']
  if(Object.keys(r).length!==12 || Object.keys(r).some(k=>![...numbers,...booleans].includes(k)))throw new Error('Unknown entitlement')
  for(const k of numbers){if(typeof r[k]!=='number' || !Number.isSafeInteger(r[k]) || Number(r[k])<0 || Number(r[k])>2147483647)throw new Error('Invalid quota');out[k]=r[k]}
  for(const k of booleans){if(typeof r[k]!=='boolean')throw new Error('Invalid capability');out[k]=r[k]}
  return out as unknown as PlanEntitlements
}
export interface SubscriptionWindow { startsAt:string; endsAt:string; graceEndsAt:string; revokedAt:string|null; entitlements:PlanEntitlements }
export type SubscriptionState='absent'|'scheduled'|'active'|'grace'|'expired'|'revoked'|'suspended'
export function effectiveSubscription(row:SubscriptionWindow|null,now:string,tenantActive:boolean) {
  const instant=(v:string)=>{const n=Date.parse(v);if(!Number.isFinite(n))throw new Error('Invalid subscription instant');return n}
  const at=instant(now)
  let state:SubscriptionState='absent'
  let caps:PlanEntitlements|null=null
  if(row){caps=parsePlanEntitlements(row.entitlements);const start=instant(row.startsAt),end=instant(row.endsAt),grace=instant(row.graceEndsAt)
    if(end<=start || grace<end)throw new Error('Invalid subscription period')
    state=row.revokedAt!==null?(instant(row.revokedAt)<=at?'revoked':(()=>{throw new Error('Future revocation invalid')})()):at<start?'scheduled':at<end?'active':at<grace?'grace':'expired'
  }
  if(!tenantActive)state='suspended'
  const active=state==='active'
  return {state,canKeepVisible:(active||state==='grace')&&caps?.publicProfile===true,canPublish:active&&caps?.publicProfile===true,canUpload:active&&caps?.publicProfile===true&&(caps?.galleryImages??0)>0,canContactRequest:active&&caps?.contactRequests===true,canAppointmentRequest:active&&caps?.appointmentRequests===true,canBook:active&&caps?.onlineBooking===true,quotas:active?caps:null}
}
/** Calendar month from the ORIGINAL anchor. Reject ambiguous/nonexistent target local times. */
export function subscriptionMonthEnd(anchor:string,monthOffset:number,timezone:string):string {
  const base=new Date(anchor)
  if(!/^(?!0000)\d{4}-/.test(anchor) || !Number.isFinite(base.getTime()) || base.toISOString()!==anchor || !Number.isInteger(monthOffset) || monthOffset<1 || monthOffset>1200)throw new Error('Invalid monthly anchor')
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  const parts=(date:Date)=>Object.fromEntries(formatter.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]))
  const utc=(y:number,m:number,d:number,h=0,min=0,s=0,ms=0)=>{const date=new Date(0);date.setUTCFullYear(y,m-1,d);date.setUTCHours(h,min,s,ms);return date.getTime()}
  const a=parts(base),index=a.year*12+a.month-1+monthOffset,year=Math.floor(index/12),month=index%12+1
  if(year<1 || year>9999)throw new Error('Monthly date unsupported')
  const day=Math.min(a.day,new Date(utc(year,month+1,0)).getUTCDate())
  const wall=utc(year,month,day,a.hour,a.minute,a.second,base.getUTCMilliseconds()),candidates=new Set<number>()
  for(let hours=-36;hours<=36;hours+=6){
    const probe=new Date(wall+hours*3600000),p=parts(probe)
    const offset=utc(p.year,p.month,p.day,p.hour,p.minute,p.second,probe.getUTCMilliseconds())-probe.getTime()
    const candidate=wall-offset,q=parts(new Date(candidate))
    if(q.year===year && q.month===month && q.day===day && q.hour===a.hour && q.minute===a.minute && q.second===a.second)candidates.add(candidate)
  }
  if(candidates.size!==1)throw new Error('Ambiguous or nonexistent local renewal time; operator review required')
  return new Date([...candidates][0]).toISOString()
}
