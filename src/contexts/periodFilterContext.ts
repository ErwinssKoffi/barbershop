import { createContext, useContext } from 'react'
import {
  currentMonthISO,
  formatPeriodLabel,
  resolvePeriodBounds,
  resolvePreviousPeriodBounds,
  todayISO,
  type PeriodFilter,
  type PeriodPreset,
} from '../utils/format'

export interface PeriodFilterContextValue {
  preset: PeriodPreset
  setPreset: (next: PeriodPreset) => void
  customStart: string
  setCustomStart: (next: string) => void
  customEnd: string
  setCustomEnd: (next: string) => void
  setCustomRange: (start: string, end: string) => void
  selectedMonth: string
  setSelectedMonth: (ym: string) => void
  periodFilter: PeriodFilter
  periodLabel: string
  bounds: { start: Date | null; end: Date | null }
  prevBounds: { start: Date; end: Date } | null
  previousBounds: { start: Date; end: Date } | null
}

const defaultToday = todayISO()
const defaultMonth = currentMonthISO()
const defaultFilter: PeriodFilter = {
  preset: 'month',
  startDate: `${defaultMonth}-01`,
  endDate: defaultToday,
}
const defaultPrev = resolvePreviousPeriodBounds(defaultFilter)

const fallbackContextValue: PeriodFilterContextValue = {
  preset: 'month',
  setPreset: () => {},
  customStart: `${defaultMonth}-01`,
  setCustomStart: () => {},
  customEnd: defaultToday,
  setCustomEnd: () => {},
  setCustomRange: () => {},
  selectedMonth: defaultMonth,
  setSelectedMonth: () => {},
  periodFilter: defaultFilter,
  periodLabel: formatPeriodLabel(defaultFilter),
  bounds: resolvePeriodBounds(defaultFilter),
  prevBounds: defaultPrev,
  previousBounds: defaultPrev,
}

export const PeriodFilterContext =
  createContext<PeriodFilterContextValue>(fallbackContextValue)

export function usePeriodFilter(): PeriodFilterContextValue {
  return useContext(PeriodFilterContext)
}
