import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { CheckoutTicketModal } from '../components/checkout/CheckoutTicketModal'
import { PrintableReceiptModal } from '../components/checkout/PrintableReceiptModal'
import { QuickExpenseModal } from '../components/checkout/QuickExpenseModal'
import { QuickActionContext } from './quickActionContext'

export function QuickActionProvider({ children }: { children: ReactNode }) {
  const [ticketModalOpen, setTicketModalOpen] = useState(false)
  const [ticketSessionKey, setTicketSessionKey] = useState(0)
  const [prefillServiceId, setPrefillServiceId] = useState<string | undefined>(
    undefined,
  )
  const [prefillProductId, setPrefillProductId] = useState<string | undefined>(
    undefined,
  )

  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const [receiptTarget, setReceiptTarget] = useState<string | null>(null)

  const openCheckoutTicket = useCallback(
    (prefill?: { serviceId?: string; productId?: string }) => {
      setPrefillServiceId(prefill?.serviceId)
      setPrefillProductId(prefill?.productId)
      setTicketSessionKey((k) => k + 1)
      setTicketModalOpen(true)
    },
    [],
  )

  const openQuickExpense = useCallback(() => {
    setExpenseModalOpen(true)
  }, [])

  const openReceiptModal = useCallback((receiptRefOrRevenueId: string) => {
    setReceiptTarget(receiptRefOrRevenueId)
  }, [])

  const value = useMemo(
    () => ({
      openCheckoutTicket,
      openQuickExpense,
      openReceiptModal,
    }),
    [openCheckoutTicket, openQuickExpense, openReceiptModal],
  )

  return (
    <QuickActionContext.Provider value={value}>
      {children}
      {ticketModalOpen && (
        <CheckoutTicketModal
          key={ticketSessionKey}
          open={ticketModalOpen}
          initialServiceId={prefillServiceId}
          initialProductId={prefillProductId}
          onClose={() => setTicketModalOpen(false)}
          onTicketCreated={(receiptNumber) => setReceiptTarget(receiptNumber)}
        />
      )}
      <QuickExpenseModal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
      />
      <PrintableReceiptModal
        open={receiptTarget !== null}
        receiptRefOrRevenueId={receiptTarget}
        onClose={() => setReceiptTarget(null)}
      />
    </QuickActionContext.Provider>
  )
}
