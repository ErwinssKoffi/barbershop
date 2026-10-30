export type PeriodPreset =
  | 'today'
  | '7d'
  | 'week'
  | 'month'
  | 'prev_month'
  | 'year'
  | 'all'
  | 'custom'

export interface PeriodFilter {
  preset: PeriodPreset
  startDate?: string // YYYY-MM-DD
  endDate?: string // YYYY-MM-DD
}

const intFormatter = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 0,
})

const shortDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const longDateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Convertit un nombre en entier FCFA sécurisé (sans centimes flottants).
 */
export function toIntFCFA(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value)
}

export function formatFCFA(amount: number): string {
  const safe = toIntFCFA(amount)
  return `${intFormatter.format(safe).replace(/\u202f/g, ' ')} FCFA`
}

export function formatDateFR(
  isoOrDate: string | Date,
  style: 'dd/MM/yyyy' | 'long-fr' = 'long-fr',
): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) return '—'
  return style === 'dd/MM/yyyy'
    ? shortDateFormatter.format(d)
    : longDateFormatter.format(d)
}

export function formatDateTimeFR(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  if (Number.isNaN(d.getTime())) return '—'
  return dateTimeFormatter.format(d)
}

export function resolvePeriodBounds(
  filter: PeriodFilter,
  refDate: Date = new Date(),
): { start: Date | null; end: Date | null } {
  if (filter.preset === 'all') {
    return { start: null, end: null }
  }

  if (filter.preset === 'today') {
    const start = new Date(refDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(refDate)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (filter.preset === '7d') {
    const start = new Date(refDate)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
    const end = new Date(refDate)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (filter.preset === 'week') {
    const day = refDate.getDay()
    const diffToMonday = day === 0 ? -6 : 1 - day
    const start = new Date(refDate)
    start.setDate(refDate.getDate() + diffToMonday)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (filter.preset === 'month') {
    const start = new Date(
      refDate.getFullYear(),
      refDate.getMonth(),
      1,
      0,
      0,
      0,
      0,
    )
    const end = new Date(
      refDate.getFullYear(),
      refDate.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    )
    return { start, end }
  }

  if (filter.preset === 'prev_month') {
    const start = new Date(
      refDate.getFullYear(),
      refDate.getMonth() - 1,
      1,
      0,
      0,
      0,
      0,
    )
    const end = new Date(
      refDate.getFullYear(),
      refDate.getMonth(),
      0,
      23,
      59,
      59,
      999,
    )
    return { start, end }
  }

  if (filter.preset === 'year') {
    const start = new Date(refDate.getFullYear(), 0, 1, 0, 0, 0, 0)
    const end = new Date(refDate.getFullYear(), 11, 31, 23, 59, 59, 999)
    return { start, end }
  }

  const start = filter.startDate
    ? new Date(`${filter.startDate}T00:00:00`)
    : null
  const end = filter.endDate ? new Date(`${filter.endDate}T23:59:59.999`) : null
  return { start, end }
}

/**
 * Retourne la période immédiatement précédente de même durée pour calculer les évolutions %.
 */
export function resolvePreviousPeriodBounds(
  filter: PeriodFilter,
  refDate: Date = new Date(),
): { start: Date; end: Date } | null {
  const { start, end } = resolvePeriodBounds(filter, refDate)
  if (!start || !end) return null

  if (filter.preset === 'month') {
    const prevStart = new Date(
      start.getFullYear(),
      start.getMonth() - 1,
      1,
      0,
      0,
      0,
      0,
    )
    const prevEnd = new Date(
      start.getFullYear(),
      start.getMonth(),
      0,
      23,
      59,
      59,
      999,
    )
    return { start: prevStart, end: prevEnd }
  }

  const durationMs = end.getTime() - start.getTime() + 1
  const prevEnd = new Date(start.getTime() - 1)
  const prevStart = new Date(prevEnd.getTime() - durationMs + 1)
  return { start: prevStart, end: prevEnd }
}

export function isIsoInBounds(
  isoDate: string,
  bounds: { start: Date | null; end: Date | null },
): boolean {
  const ts = new Date(isoDate).getTime()
  if (Number.isNaN(ts)) return false
  if (bounds.start && ts < bounds.start.getTime()) return false
  if (bounds.end && ts > bounds.end.getTime()) return false
  return true
}

export function isIsoInPeriod(
  isoDate: string,
  filter: PeriodFilter,
  refDate?: Date,
): boolean {
  return isIsoInBounds(isoDate, resolvePeriodBounds(filter, refDate))
}

export function todayISO(refDate: Date = new Date()): string {
  const y = refDate.getFullYear()
  const m = String(refDate.getMonth() + 1).padStart(2, '0')
  const d = String(refDate.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function currentMonthISO(refDate: Date = new Date()): string {
  return todayISO(refDate).slice(0, 7)
}

export function formatPeriodLabel(filter: PeriodFilter): string {
  switch (filter.preset) {
    case 'today':
      return "Aujourd'hui"
    case '7d':
      return '7 derniers jours'
    case 'week':
      return 'Cette semaine'
    case 'month':
      return 'Mois en cours'
    case 'prev_month':
      return 'Mois précédent'
    case 'year':
      return 'Année en cours'
    case 'all':
      return 'Toutes périodes'
    case 'custom':
      return `${filter.startDate ?? '…'} → ${filter.endDate ?? '…'}`
  }
}

export function computeEvolutionPercent(
  current: number,
  previous: number,
  hasPreviousData = true,
): number | null {
  if (!hasPreviousData || previous <= 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}
