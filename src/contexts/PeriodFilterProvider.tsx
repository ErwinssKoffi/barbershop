import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  currentMonthISO,
  formatPeriodLabel,
  resolvePeriodBounds,
  resolvePreviousPeriodBounds,
  todayISO,
  type PeriodFilter,
  type PeriodPreset,
} from '../utils/format'
import { PeriodFilterContext } from './periodFilterContext'

export function PeriodFilterProvider({ children }: { children: ReactNode }) {
  const [preset, setPresetState] = useState<PeriodPreset>('month')
  const [customStart, setCustomStart] = useState<string>(
    () => `${currentMonthISO()}-01`,
  )
  const [customEnd, setCustomEnd] = useState<string>(() => todayISO())
  const [selectedMonth, setSelectedMonthState] = useState<string>(() =>
    currentMonthISO(),
  )

  const setPreset = useCallback((next: PeriodPreset) => {
    setPresetState(next)
    if (next === 'month') {
      setSelectedMonthState(currentMonthISO())
    } else if (next === 'prev_month') {
      const now = new Date()
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      setSelectedMonthState(todayISO(prev).slice(0, 7))
    }
  }, [])

  const setCustomRange = useCallback((start: string, end: string) => {
    setCustomStart(start)
    setCustomEnd(end)
  }, [])

  const setSelectedMonth = useCallback((ym: string) => {
    setSelectedMonthState(ym)
    if (ym === currentMonthISO()) {
      setPresetState('month')
    } else {
      const [yr, mo] = ym.split('-').map(Number)
      if (yr && mo) {
        const lastDay = new Date(yr, mo, 0).getDate()
        setCustomStart(`${ym}-01`)
        setCustomEnd(`${ym}-${String(lastDay).padStart(2, '0')}`)
        setPresetState('custom')
      }
    }
  }, [])

  const periodFilter = useMemo<PeriodFilter>(
    () => ({
      preset,
      startDate: customStart,
      endDate: customEnd,
    }),
    [preset, customStart, customEnd],
  )

  const bounds = useMemo(
    () => resolvePeriodBounds(periodFilter),
    [periodFilter],
  )
  const previousBounds = useMemo(
    () => resolvePreviousPeriodBounds(periodFilter),
    [periodFilter],
  )
  const periodLabel = useMemo(
    () => formatPeriodLabel(periodFilter),
    [periodFilter],
  )

  const value = useMemo(
    () => ({
      preset,
      setPreset,
      customStart,
      setCustomStart,
      customEnd,
      setCustomEnd,
      setCustomRange,
      selectedMonth,
      setSelectedMonth,
      periodFilter,
      periodLabel,
      bounds,
      prevBounds: previousBounds,
      previousBounds,
    }),
    [
      preset,
      setPreset,
      customStart,
      customEnd,
      setCustomRange,
      selectedMonth,
      setSelectedMonth,
      periodFilter,
      periodLabel,
      bounds,
      previousBounds,
    ],
  )

  return (
    <PeriodFilterContext.Provider value={value}>
      {children}
    </PeriodFilterContext.Provider>
  )
}
