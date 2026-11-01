import type { ServiceCatalogItem } from './models/index'
import { parseOpeningWindows, parseScheduleDate, type OpeningWindow } from './scheduling.ts'

export interface BookingRules {
  onlineBookingEnabled: boolean
  slotStepMinutes: number
  minimumNoticeMinutes: number
  horizonDays: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  cancellationAllowed: boolean
  cancellationNoticeMinutes: number
  employeeChoiceAllowed: boolean
  revision: number
}
const ruleKeys = ['onlineBookingEnabled','slotStepMinutes','minimumNoticeMinutes','horizonDays','bufferBeforeMinutes','bufferAfterMinutes','cancellationAllowed','cancellationNoticeMinutes','employeeChoiceAllowed','revision']
function whole(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Invalid catalogue number')
  return value
}
export function parseBookingRules(input: unknown): BookingRules {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid booking rules')
  const r = input as Record<string, unknown>
  if (Object.keys(r).some(k => !ruleKeys.includes(k))) throw new Error('Unknown booking rule')
  for (const key of ['onlineBookingEnabled','cancellationAllowed','employeeChoiceAllowed']) {
    if (typeof r[key] !== 'boolean') throw new Error('Missing booking policy')
  }
  return {
    onlineBookingEnabled: r.onlineBookingEnabled as boolean,
    slotStepMinutes: whole(r.slotStepMinutes,1,1440),
    minimumNoticeMinutes: whole(r.minimumNoticeMinutes,0,2147483647),
    horizonDays: whole(r.horizonDays,1,2147483647),
    bufferBeforeMinutes: whole(r.bufferBeforeMinutes,0,1440),
    bufferAfterMinutes: whole(r.bufferAfterMinutes,0,1440),
    cancellationAllowed: r.cancellationAllowed as boolean,
    cancellationNoticeMinutes: whole(r.cancellationNoticeMinutes,0,2147483647),
    employeeChoiceAllowed: r.employeeChoiceAllowed as boolean,
    revision: whole(r.revision,1,2147483647),
  }
}
/** Explicit pick before validation permits database metadata without serializing it. */
export function publicBookingRulesDto(rules: BookingRules): BookingRules {
  const selected = Object.fromEntries(ruleKeys.map(key => [key, rules[key as keyof BookingRules]]))
  return parseBookingRules(selected)
}
export interface ServicePublicationSnapshot {
  sourceServiceId: string
  sourceVariantId: string | null
  sourceUpdatedAt: string
  displayName: string
  description: string
  priceXof: number
  durationMinutes: number | null
  bookingRequested: boolean
}
/** Trusted server catalogue read only: a request body is never a price/duration authority. */
export function deriveServicePublication(service: ServiceCatalogItem, variantId: string | null, bookingRequested: boolean): ServicePublicationSnapshot {
  if (!service.isActive || typeof bookingRequested !== 'boolean' || !service.id || !service.updatedAt) throw new Error('Unavailable source service')
  const matches = variantId === null ? [] : (service.variants ?? []).filter(v => v.id === variantId)
  if (variantId !== null && matches.length !== 1) throw new Error('Unavailable source variant')
  const variant = matches[0]
  const priceXof = whole(variant ? variant.price : service.referencePrice,0,Number.MAX_SAFE_INTEGER)
  const duration = variant?.durationMinutes ?? service.durationMinutes
  const durationMinutes = duration === undefined ? null : whole(duration,5,480)
  if (bookingRequested && durationMinutes === null) throw new Error('Booking requires catalogue duration')
  const displayName = `${service.name.trim()}${variant ? ` — ${variant.label.trim()}` : ''}`
  if (!displayName || displayName.length > 160 || service.description.length > 4000) throw new Error('Invalid public service text')
  return { sourceServiceId: service.id, sourceVariantId: variantId, sourceUpdatedAt: service.updatedAt, displayName, description: service.description, priceXof, durationMinutes, bookingRequested }
}
export interface PublicServiceV1 {
  id: string
  displayName: string
  description: string
  priceXof: number
  currency: 'XOF'
  durationMinutes: number | null
  bookable: boolean
}
/** Input must originate from the RLS-filtered published projection, not a draft. */
export function publicServiceDto(row: ServicePublicationSnapshot & { id: string }, rules: BookingRules | null, publicBookingEnabled: boolean): PublicServiceV1 {
  const durationMinutes = row.durationMinutes === null ? null : whole(row.durationMinutes,5,480)
  const effective = rules === null ? null : publicBookingRulesDto(rules)
  return {
    id: row.id, displayName: row.displayName, description: row.description,
    priceXof: whole(row.priceXof,0,Number.MAX_SAFE_INTEGER), currency: 'XOF', durationMinutes,
    bookable: publicBookingEnabled === true && effective?.onlineBookingEnabled === true && row.bookingRequested === true && durationMinutes !== null,
  }
}
/** Grid anchored at local midnight; buffers must fit the SAME opening window, including pauses. */
export function serviceFitsOpeningWindow(startMinute: number, durationMinutes: number, windows: readonly OpeningWindow[], rules: BookingRules): boolean {
  const r = parseBookingRules(rules)
  const start = whole(startMinute,0,1439)
  const duration = whole(durationMinutes,5,480)
  if (!r.onlineBookingEnabled || start % r.slotStepMinutes !== 0) return false
  const from = start-r.bufferBeforeMinutes
  const to = start+duration+r.bufferAfterMinutes
  return parseOpeningWindows(windows).some(window => from >= window.startMinute && to <= window.endMinute)
}
function instant(input: string): number {
  const value = Date.parse(input)
  if (!Number.isFinite(value) || new Date(value).toISOString() !== input) throw new Error('Canonical UTC instant required')
  return value
}
/** Caller derives both local dates from trusted instants and the salon timezone; no DST mapping here. */
export function bookingWithinPolicy(startAt: string, now: string, bookingLocalDate: string, todayLocalDate: string, rules: BookingRules): boolean {
  const r = parseBookingRules(rules)
  const delta = BigInt(instant(startAt))-BigInt(instant(now))
  const day = Date.parse(`${parseScheduleDate(bookingLocalDate)}T00:00:00.000Z`)
  const today = Date.parse(`${parseScheduleDate(todayLocalDate)}T00:00:00.000Z`)
  const daysAhead = (day-today)/86400000
  return r.onlineBookingEnabled && delta >= BigInt(r.minimumNoticeMinutes)*60000n && daysAhead >= 0 && daysAhead <= r.horizonDays
}
export function cancellationWithinPolicy(startAt: string, now: string, rules: BookingRules): boolean {
  const r = parseBookingRules(rules)
  const delta = BigInt(instant(startAt))-BigInt(instant(now))
  return r.cancellationAllowed && delta >= BigInt(r.cancellationNoticeMinutes)*60000n
}
