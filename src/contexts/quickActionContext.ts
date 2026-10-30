import { createContext, useContext } from 'react'

export interface QuickActionContextValue {
  openCheckoutTicket: (prefill?: {
    serviceId?: string
    variantId?: string
    productId?: string
  }) => void
  openQuickExpense: () => void
  openReceiptModal: (receiptRefOrRevenueId: string) => void
}

const fallbackQuickActionContext: QuickActionContextValue = {
  openCheckoutTicket: () => {},
  openQuickExpense: () => {},
  openReceiptModal: () => {},
}

export const QuickActionContext = createContext<QuickActionContextValue>(
  fallbackQuickActionContext,
)

export function useQuickAction(): QuickActionContextValue {
  return useContext(QuickActionContext)
}
