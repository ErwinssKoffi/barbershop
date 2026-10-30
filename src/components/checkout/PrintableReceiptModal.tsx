import { Printer, Receipt } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Separator } from '@/components/ui/separator'
import type { ReceiptFormat, RevenueEntry } from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { formatDateTimeFR, formatFCFA } from '../../utils/format'

interface PrintableReceiptModalProps {
  open: boolean
  receiptRefOrRevenueId: string | null
  onClose: () => void
}

export function PrintableReceiptModal({
  open,
  receiptRefOrRevenueId,
  onClose,
}: PrintableReceiptModalProps) {
  const { state, categoryLabel } = useSalonStore()
  const [formatOverride, setFormatOverride] = useState<ReceiptFormat | null>(
    null,
  )

  const activeFormat: ReceiptFormat =
    formatOverride ?? state.settings.receiptFormat ?? 'thermal_80mm'

  const lines = useMemo<RevenueEntry[]>(() => {
    if (!receiptRefOrRevenueId) return []
    const active = state.revenues.filter((r) => !r.isArchived)
    const direct = active.find((r) => r.id === receiptRefOrRevenueId)
    if (direct) {
      if (direct.ticketId) {
        return active.filter((r) => r.ticketId === direct.ticketId)
      }
      if (direct.receiptNumber) {
        return active.filter((r) => r.receiptNumber === direct.receiptNumber)
      }
      return [direct]
    }
    const byTicketOrReceipt = active.filter(
      (r) =>
        r.ticketId === receiptRefOrRevenueId ||
        r.receiptNumber === receiptRefOrRevenueId,
    )
    return byTicketOrReceipt
  }, [receiptRefOrRevenueId, state.revenues])

  const paymentSummary = useMemo(() => {
    const map = new Map<string, number>()
    for (const ln of lines) {
      if (ln.paymentSplits && ln.paymentSplits.length > 0) {
        for (const sp of ln.paymentSplits) {
          map.set(sp.method, (map.get(sp.method) ?? 0) + sp.amount)
        }
      } else {
        map.set(
          ln.paymentMethod,
          (map.get(ln.paymentMethod) ?? 0) + ln.amount,
        )
      }
    }
    return Array.from(map.entries())
  }, [lines])

  if (!open || lines.length === 0) return null

  const first = lines[0]
  const receiptNumber =
    first.receiptNumber ?? `REC-${first.id.slice(-6).toUpperCase()}`
  const totalAmount = lines.reduce((sum, l) => sum + l.amount, 0)
  const footerNote =
    state.settings.receiptFooterNote ||
    'Merci de votre visite et de votre fidélité !'

  const handlePrintReceipt = () => {
    document.body.classList.add('printing-receipt-only')
    window.print()
    setTimeout(() => {
      document.body.classList.remove('printing-receipt-only')
    }, 400)
  }

  return (
    <Modal
      open={open}
      title={`Reçu client · ${receiptNumber}`}
      subtitle="Aperçu prêt pour impression ticket thermique 80 mm ou fiche A5"
      maxWidth={activeFormat === 'a5_sheet' ? 600 : 440}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant={activeFormat === 'thermal_80mm' ? 'default' : 'outline'}
              onClick={() => setFormatOverride('thermal_80mm')}
            >
              Ticket 80 mm
            </Button>
            <Button
              type="button"
              size="xs"
              variant={activeFormat === 'a5_sheet' ? 'default' : 'outline'}
              onClick={() => setFormatOverride('a5_sheet')}
            >
              Fiche A5
            </Button>
          </div>
          <Button type="button" size="sm" onClick={handlePrintReceipt}>
            <Printer size={14} />
            Imprimer le reçu
          </Button>
        </div>

        <div
          id="salon-printable-receipt"
          className="receipt-print-sheet"
          style={{
            margin: '0 auto',
            maxWidth: activeFormat === 'thermal_80mm' ? 330 : 540,
            padding: activeFormat === 'thermal_80mm' ? '18px 16px' : '24px',
            borderRadius: 10,
            border: '1px dashed var(--border-strong)',
            background: 'var(--bg-surface)',
            fontSize: activeFormat === 'thermal_80mm' ? '0.8rem' : '0.86rem',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            {state.salon.logoDataUrl ? (
              <img
                src={state.salon.logoDataUrl}
                alt={state.salon.name}
                style={{
                  maxHeight: 42,
                  margin: '0 auto 6px',
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  margin: '0 auto 6px',
                  background: 'var(--accent-emerald-soft)',
                  color: 'var(--accent-cta)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Receipt size={18} />
              </div>
            )}
            <div style={{ fontWeight: 800, fontSize: '0.98rem' }}>
              {state.salon.name}
            </div>
            <div className="text-muted-foreground text-xs">
              {state.salon.address}
            </div>
            <div className="text-muted-foreground text-xs">
              Tél : {state.salon.phone}
            </div>
          </div>

          <Separator />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '10px 0',
              fontSize: '0.76rem',
            }}
          >
            <div className="flex justify-between">
              <span className="text-muted-foreground">N° Reçu :</span>
              <strong className="tabular-nums">{receiptNumber}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date :</span>
              <span className="tabular-nums">
                {formatDateTimeFR(first.date)}
              </span>
            </div>
            {first.clientName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Client(e) :</span>
                <strong>{first.clientName}</strong>
              </div>
            )}
          </div>

          <Separator />

          <div style={{ padding: '10px 0' }} className="space-y-2">
            {lines.map((ln) => {
              const emp = state.employees.find((e) => e.id === ln.employeeId)
              const qty = ln.quantity ?? 1
              return (
                <div
                  key={ln.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{ln.label}</div>
                    <div className="text-muted-foreground text-xs">
                      {qty > 1 && ln.unitPrice
                        ? `${qty} × ${formatFCFA(ln.unitPrice)}`
                        : categoryLabel('revenue', ln.categoryCode)}
                      {emp ? ` · ${emp.firstName}` : ''}
                    </div>
                  </div>
                  <div className="font-semibold tabular-nums">
                    {formatFCFA(ln.amount)}
                  </div>
                </div>
              )
            })}
          </div>

          <Separator />

          <div style={{ padding: '10px 0' }} className="space-y-1">
            <div
              className="flex items-center justify-between"
              style={{ fontSize: '0.96rem', fontWeight: 800 }}
            >
              <span>TOTAL PAYÉ</span>
              <span className="tabular-nums">{formatFCFA(totalAmount)}</span>
            </div>

            {paymentSummary.map(([method, amt]) => (
              <div
                key={method}
                className="text-muted-foreground flex items-center justify-between text-xs"
              >
                <span>
                  Règlement ({categoryLabel('payment_method', method)})
                </span>
                <span className="tabular-nums">{formatFCFA(amt)}</span>
              </div>
            ))}

            {first.amountTendered !== undefined &&
              first.changeGiven !== undefined && (
                <>
                  <div className="text-muted-foreground flex justify-between text-xs">
                    <span>Espèces reçues</span>
                    <span className="tabular-nums">
                      {formatFCFA(first.amountTendered)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-semibold">
                    <span>Monnaie rendue</span>
                    <Badge variant="success-light" size="sm">
                      {formatFCFA(first.changeGiven)}
                    </Badge>
                  </div>
                </>
              )}
          </div>

          <Separator />

          <div
            style={{
              paddingTop: 10,
              textAlign: 'center',
              fontSize: '0.73rem',
              color: 'var(--text-muted)',
            }}
          >
            {footerNote}
          </div>
        </div>
      </div>
    </Modal>
  )
}
