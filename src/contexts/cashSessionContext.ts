import { createContext, useContext } from 'react'
import type { CashSession } from '../domain/models'

export interface CashSessionContextValue {
  openSession: CashSession | null
  theoreticalBalance: number
  isSessionStale: boolean
  openQuickCashModal: () => void
}

const fallbackCashContext: CashSessionContextValue = {
  openSession: null,
  theoreticalBalance: 0,
  isSessionStale: false,
  openQuickCashModal: () => {},
}

export const CashSessionContext =
  createContext<CashSessionContextValue>(fallbackCashContext)

export function useCashSession(): CashSessionContextValue {
  return useContext(CashSessionContext)
}
