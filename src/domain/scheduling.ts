/** Minute offsets in the salon's local day, not UTC instants or employee availability. */
export interface OpeningWindow { startMinute: number; endMinute: number }
export interface WeeklyOpeningDay { isoWeekday: number; windows: OpeningWindow[] }
export interface PublicScheduleException { localDate: string; windows: OpeningWindow[] }
export interface PrivateScheduleException extends PublicScheduleException { privateNote: string; version: number }
export interface PublicScheduleV1 {
  timezone: string
  revision: number
  weekly: WeeklyOpeningDay[]
  exceptions: PublicScheduleException[]
}

/** No default business hours. Empty is closed; overlapping input is invalid, adjacent ranges merge. */
export function parseOpeningWindows(input: unknown): OpeningWindow[] {
  if (!Array.isArray(input) || input.length > 1440) throw new Error('Invalid opening windows')
  const windows = input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid opening window')
    const row = item as Record<string, unknown>
    if (Object.keys(row).some(key => !['startMinute','endMinute'].includes(key)) ||
        !Number.isInteger(row.startMinute) || !Number.isInteger(row.endMinute) ||
        Number(row.startMinute) < 0 || Number(row.endMinute) > 1440 ||
        Number(row.endMinute) <= Number(row.startMinute)) throw new Error('Invalid opening window')
    return { startMinute: Number(row.startMinute), endMinute: Number(row.endMinute) }
  }).sort((a, b) => a.startMinute - b.startMinute)
  const canonical: OpeningWindow[] = []
  for (const window of windows) {
    const previous = canonical.at(-1)
    if (previous && window.startMinute < previous.endMinute) throw new Error('Overlapping opening windows')
    if (previous && window.startMinute === previous.endMinute) previous.endMinute = window.endMinute
    else canonical.push({ ...window })
  }
  return canonical
}

/** Bind this as a query parameter cast to int4multirange, never interpolate user SQL. */
export function openingWindowsSqlValue(input: unknown): string {
  return `{${parseOpeningWindows(input).map(w => `[${w.startMinute},${w.endMinute})`).join(',')}}`
}
export function parseScheduleDate(input: unknown): string {
  if (typeof input !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(input)) throw new Error('Invalid local schedule date')
  const date = new Date(`${input}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== input) throw new Error('Invalid local schedule date')
  return input
}

/** An explicit exception replaces the whole weekly day, including when it is closed. */
export function openingWindowsForDate(date: string, weekly: readonly WeeklyOpeningDay[], exceptions: readonly PublicScheduleException[]): OpeningWindow[] {
  const localDate = parseScheduleDate(date)
  const matches = exceptions.filter(row => row.localDate === localDate)
  if (matches.length > 1) throw new Error('Duplicate schedule exception')
  if (matches.length) return parseOpeningWindows(matches[0].windows)
  const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay() || 7
  const days = weekly.filter(row => row.isoWeekday === weekday)
  if (days.length > 1) throw new Error('Duplicate weekly opening day')
  return days.length ? parseOpeningWindows(days[0].windows) : []
}

/** Explicit allowlist: private notes, tenant IDs and author metadata cannot reach the DTO. */
export function publicScheduleDto(input: PublicScheduleV1): PublicScheduleV1 {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || typeof input.timezone !== 'string') throw new Error('Invalid schedule')
  // Validation only, not UTC conversion. The published snapshot must use the salon timezone.
  try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }) } catch { throw new Error('Invalid schedule timezone') }
  const seenDays = new Set<number>()
  const seenDates = new Set<string>()
  const weekly = input.weekly.map(row => {
    if (!Number.isInteger(row.isoWeekday) || row.isoWeekday < 1 || row.isoWeekday > 7 || seenDays.has(row.isoWeekday)) throw new Error('Invalid weekly opening day')
    seenDays.add(row.isoWeekday)
    return { isoWeekday: row.isoWeekday, windows: parseOpeningWindows(row.windows) }
  }).sort((a,b) => a.isoWeekday-b.isoWeekday)
  const exceptions = input.exceptions.map(row => {
    const localDate = parseScheduleDate(row.localDate)
    if (seenDates.has(localDate)) throw new Error('Duplicate schedule exception')
    seenDates.add(localDate)
    return { localDate, windows: parseOpeningWindows(row.windows) }
  }).sort((a,b) => a.localDate.localeCompare(b.localDate))
  return { timezone: input.timezone, revision: input.revision, weekly, exceptions }
}
