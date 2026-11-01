export interface ScheduleBlockInput {
  scope: 'salon' | 'employee'; employeeId: string | null
  startAt: string; endAt: string; privateNote: string
}
/** Explicit UTC instants only. Local/DST conversion belongs to a future server command. */
export function scheduleBlockInstant(input: unknown): string {
  if (typeof input!=='string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(input)) throw new Error('Explicit UTC block instant required')
  const date=new Date(input)
  const canonical=input.includes('.')?input:input.replace('Z','.000Z')
  if (!Number.isFinite(date.getTime()) || date.toISOString()!==canonical) throw new Error('Invalid block instant')
  return canonical
}
export function parseScheduleBlock(input: unknown): ScheduleBlockInput {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Invalid schedule block')
  const row=input as Record<string,unknown>
  if (Object.keys(row).some(k=>!['scope','employeeId','startAt','endAt','privateNote'].includes(k))) throw new Error('Unknown block field')
  if (!['salon','employee'].includes(row.scope as string)) throw new Error('Invalid block scope')
  if ((row.scope==='salon' && row.employeeId!==null) || (row.scope==='employee' && (typeof row.employeeId!=='string' || !row.employeeId.trim() || row.employeeId.length>200))) throw new Error('Invalid employee scope')
  if (typeof row.privateNote!=='string' || row.privateNote.length>1000) throw new Error('Invalid private block note')
  const startAt=scheduleBlockInstant(row.startAt),endAt=scheduleBlockInstant(row.endAt)
  if (Date.parse(endAt)<=Date.parse(startAt)) throw new Error('Empty or reversed block interval')
  return {scope:row.scope as 'salon'|'employee',employeeId:row.employeeId as string|null,startAt,endAt,privateNote:row.privateNote}
}
export interface PrivateBusyBlock {
  scope: 'salon' | 'employee'; employeeId: string | null; employeeRef: string | null
  startAt: string; endAt: string; state: 'active' | 'cancelled'
}
/** Internal only. Busy intervals must not become a public list exposing employee absences. */
export function scheduleBlockOverlaps(block: PrivateBusyBlock, employeeId: string, from: string, to: string): boolean {
  const parsed=parseScheduleBlock({scope:block.scope,employeeId:block.employeeRef,startAt:block.startAt,endAt:block.endAt,privateNote:''})
  if ((block.scope==='salon' && block.employeeId!==null) || (block.scope==='employee' && block.employeeId!==null && block.employeeId!==block.employeeRef)) throw new Error('Invalid live employee reference')
  if (!['active','cancelled'].includes(block.state) || typeof employeeId!=='string' || !employeeId.trim()) throw new Error('Invalid busy block context')
  const start=scheduleBlockInstant(from),end=scheduleBlockInstant(to)
  if (Date.parse(end)<=Date.parse(start)) throw new Error('Invalid candidate interval')
  return block.state==='active' && (parsed.scope==='salon' || block.employeeId===employeeId) &&
    Date.parse(parsed.startAt)<Date.parse(end) && Date.parse(parsed.endAt)>Date.parse(start)
}
