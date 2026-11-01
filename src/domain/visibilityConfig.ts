import { parseOpeningWindows,parseScheduleDate,type WeeklyOpeningDay,type PublicScheduleException } from './scheduling.ts'
export interface ServiceChoice { serviceId:string; variantId:string|null }
export interface VisibilityConfig { expectedVersion:number; services:ServiceChoice[]; weekly:WeeklyOpeningDay[]; exceptions:PublicScheduleException[] }
export interface VisibilityOffer extends ServiceChoice { label:string; priceXof:number; durationMinutes:number|null }
export interface VisibilityConfigView extends VisibilityConfig { timezone:string; offers:VisibilityOffer[] }
export function parseVisibilityConfig(input:unknown):VisibilityConfig {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid visibility config')
  const r=input as Record<string,unknown>
  if(Object.keys(r).some(k=>!['expectedVersion','services','weekly','exceptions'].includes(k)) || !Number.isSafeInteger(r.expectedVersion) || Number(r.expectedVersion)<1 || Number(r.expectedVersion)>=2147483647) throw new Error('Invalid config version')
  if(!Array.isArray(r.services) || r.services.length>500 || !Array.isArray(r.weekly) || r.weekly.length!==7 || !Array.isArray(r.exceptions) || r.exceptions.length>366) throw new Error('Invalid config cardinality')
  const seen=new Set<string>(),days=new Set<number>(),dates=new Set<string>()
  const services=r.services.map((v:unknown)=>{
    if(!v || typeof v!=='object' || Array.isArray(v)) throw new Error('Invalid selection')
    const x=v as Record<string,unknown>
    if(Object.keys(x).some(k=>!['serviceId','variantId'].includes(k)) || typeof x.serviceId!=='string' || !x.serviceId.trim() || x.serviceId.length>200 || (x.variantId!==null && (typeof x.variantId!=='string' || !x.variantId.trim() || x.variantId.length>200))) throw new Error('Invalid selection')
    const key=JSON.stringify([x.serviceId,x.variantId]);if(seen.has(key))throw new Error('Duplicate selection');seen.add(key)
    return {serviceId:x.serviceId,variantId:x.variantId as string|null}
  })
  const weekly=r.weekly.map((v:unknown)=>{
    if(!v || typeof v!=='object' || Array.isArray(v)) throw new Error('Invalid week')
    const x=v as Record<string,unknown>,day=Number(x.isoWeekday)
    if(Object.keys(x).some(k=>!['isoWeekday','windows'].includes(k)) || typeof x.isoWeekday!=='number' || !Number.isInteger(day) || day<1 || day>7 || days.has(day)) throw new Error('Invalid weekday')
    days.add(day);return {isoWeekday:day,windows:parseOpeningWindows(x.windows)}
  }).sort((a,b)=>a.isoWeekday-b.isoWeekday)
  const exceptions=r.exceptions.map((v:unknown)=>{
    if(!v || typeof v!=='object' || Array.isArray(v)) throw new Error('Invalid exception')
    const x=v as Record<string,unknown>
    if(Object.keys(x).some(k=>!['localDate','windows'].includes(k))) throw new Error('Invalid exception field')
    const localDate=parseScheduleDate(x.localDate);if(dates.has(localDate))throw new Error('Duplicate date');dates.add(localDate)
    return {localDate,windows:parseOpeningWindows(x.windows)}
  }).sort((a,b)=>a.localDate.localeCompare(b.localDate))
  return {expectedVersion:Number(r.expectedVersion),services,weekly,exceptions}
}
export const emptyVisibilityWeek=():WeeklyOpeningDay[]=>Array.from({length:7},(_,i)=>({isoWeekday:i+1,windows:[]}))
/** Editor syntax, e.g. 09:00-12:00,14:00-18:00 ; blank means closed. */
export function parseWindowText(text:string) {
  if(!text.trim()) return []
  const minute=(s:string)=>{if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s) && s!=='24:00')throw new Error('Horaire HH:MM requis.');return Number(s.slice(0,2))*60+Number(s.slice(3))}
  return parseOpeningWindows(text.split(',').map(part=>{const pair=part.trim().split('-');if(pair.length!==2)throw new Error('Intervalle début-fin requis.');return {startMinute:minute(pair[0].trim()),endMinute:minute(pair[1].trim())}}))
}
export function windowText(windows:WeeklyOpeningDay['windows']):string {
  const time=(m:number)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
  return windows.map(w=>`${time(w.startMinute)}-${time(w.endMinute)}`).join(',')
}
