/** Private appointment detail DTO, never a public booking response. */
export interface AppointmentServiceSnapshot {
  position: number
  sourceServiceId: string
  sourceVariantId: string | null
  serviceName: string
  variantLabel: string | null
  priceXof: number
  durationMinutes: number
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<min || value>max) throw new Error('Invalid appointment snapshot number')
  return value
}
function text(value: unknown, max: number): string {
  if (typeof value!=='string' || !value.trim() || value.length>max) throw new Error('Invalid appointment snapshot text')
  return value
}
export function appointmentServiceDto(row: AppointmentServiceSnapshot): AppointmentServiceSnapshot {
  const variant=row.sourceVariantId===null?null:text(row.sourceVariantId,200)
  const label=row.variantLabel===null?null:text(row.variantLabel,160)
  if ((variant===null)!==(label===null)) throw new Error('Inconsistent appointment variant')
  return {
    position:integer(row.position,1,100),sourceServiceId:text(row.sourceServiceId,200),sourceVariantId:variant,
    serviceName:text(row.serviceName,160),variantLabel:label,
    priceXof:integer(row.priceXof,0,Number.MAX_SAFE_INTEGER),durationMinutes:integer(row.durationMinutes,5,480),
  }
}
/** Historical totals, NOT a checkout quote or an authority to create financial entries. */
export function appointmentServiceTotals(rows: readonly AppointmentServiceSnapshot[]): { priceXof: number; durationMinutes: number } {
  if (!Array.isArray(rows) || rows.length<1 || rows.length>100) throw new Error('Invalid appointment service count')
  const positions=new Set<number>()
  let price=0n; let duration=0
  for (const input of rows) {
    const row=appointmentServiceDto(input)
    if (positions.has(row.position)) throw new Error('Duplicate appointment position')
    positions.add(row.position); price+=BigInt(row.priceXof); duration+=row.durationMinutes
  }
  if (price>BigInt(Number.MAX_SAFE_INTEGER) || duration>480) throw new Error('Appointment totals exceed supported bounds')
  return {priceXof:Number(price),durationMinutes:duration}
}
