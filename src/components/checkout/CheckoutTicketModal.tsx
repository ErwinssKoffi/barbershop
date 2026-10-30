import {
  AlertTriangle,
  Package,
  Plus,
  Receipt,
  Scissors,
  Trash2,
  Unlock,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/Modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCashSession } from '../../contexts/cashSessionContext'
import type { CheckoutTicketLineInput } from '../../db/repositories/salonRepositories'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { formatFCFA, toIntFCFA, todayISO } from '../../utils/format'

interface DraftLine {
  key: string
  kind: 'service' | 'product'
  serviceId: string
  productId: string
  label: string
  categoryCode: string
  employeeId: string
  quantity: string
  unitPrice: string
}

interface DraftConsumable {
  key: string
  productId: string
  quantity: string
}

interface DraftSplit {
  key: string
  method: string
  amount: string
}

interface CheckoutTicketModalProps {
  open: boolean
  initialServiceId?: string
  initialProductId?: string
  onClose: () => void
  onTicketCreated?: (receiptNumber: string) => void
}

function makeLineKey(): string {
  return `ln-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function CheckoutTicketModal({
  open,
  initialServiceId,
  initialProductId,
  onClose,
  onTicketCreated,
}: CheckoutTicketModalProps) {
  const { state, mutate } = useSalonStore()
  const { openSession, openQuickCashModal } = useCashSession()
  const toast = useToast()

  const activeServices = useMemo(
    () => state.services.filter((s) => s.isActive),
    [state.services],
  )
  const resaleProducts = useMemo(
    () =>
      state.products.filter(
        (p) => p.isActive && p.usageType !== 'consumable' && p.quantity > 0,
      ),
    [state.products],
  )
  const consumableProducts = useMemo(
    () =>
      state.products.filter(
        (p) => p.isActive && p.usageType !== 'resale' && p.quantity > 0,
      ),
    [state.products],
  )
  const activeEmployees = useMemo(
    () => state.employees.filter((e) => e.isActive),
    [state.employees],
  )
  const revenueCategories = useMemo(
    () => state.categories.filter((c) => c.scope === 'revenue' && !c.isArchived),
    [state.categories],
  )
  const paymentMethods = useMemo(
    () =>
      state.categories.filter(
        (c) => c.scope === 'payment_method' && !c.isArchived,
      ),
    [state.categories],
  )

  const [date, setDate] = useState<string>(() => todayISO())
  const [clientName, setClientName] = useState('')
  const [lines, setLines] = useState<DraftLine[]>(() => {
    if (initialProductId) {
      const prod = state.products.find((p) => p.id === initialProductId)
      return [
        {
          key: makeLineKey(),
          kind: 'product',
          serviceId: '',
          productId: prod?.id ?? '',
          label: prod?.name ?? '',
          categoryCode: 'product_sale',
          employeeId: '',
          quantity: '1',
          unitPrice: prod ? String(prod.salePrice ?? prod.costPrice) : '',
        },
      ]
    }
    const srv = initialServiceId
      ? state.services.find((s) => s.id === initialServiceId)
      : undefined
    return [
      {
        key: makeLineKey(),
        kind: 'service',
        serviceId: srv?.id ?? '',
        productId: '',
        label: srv?.name ?? '',
        categoryCode: 'hair_service',
        employeeId: '',
        quantity: '1',
        unitPrice: srv ? String(srv.referencePrice) : '',
      },
    ]
  })

  const [consumables, setConsumables] = useState<DraftConsumable[]>([])
  const [paymentMode, setPaymentMode] = useState<'single' | 'split'>('single')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [splits, setSplits] = useState<DraftSplit[]>([
    { key: 'sp-1', method: 'cash', amount: '' },
    { key: 'sp-2', method: 'wave', amount: '' },
  ])
  const [amountTendered, setAmountTendered] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const totalAmount = useMemo(
    () =>
      lines.reduce((sum, ln) => {
        const q = Math.max(1, Math.round(Number(ln.quantity || 1)))
        const u = toIntFCFA(Number(ln.unitPrice || 0))
        return sum + q * u
      }, 0),
    [lines],
  )

  const splitAllocated = useMemo(
    () =>
      splits.reduce(
        (sum, sp) => sum + Math.max(0, toIntFCFA(Number(sp.amount || 0))),
        0,
      ),
    [splits],
  )

  const cashAmountInTicket = useMemo(() => {
    if (paymentMode === 'single') {
      return paymentMethod === 'cash' ? totalAmount : 0
    }
    return splits
      .filter((s) => s.method === 'cash')
      .reduce((sum, s) => sum + Math.max(0, toIntFCFA(Number(s.amount || 0))), 0)
  }, [paymentMode, paymentMethod, totalAmount, splits])

  const changeToReturn = useMemo(() => {
    const tendered = toIntFCFA(Number(amountTendered || 0))
    if (cashAmountInTicket <= 0 || tendered <= cashAmountInTicket) return 0
    return tendered - cashAmountInTicket
  }, [amountTendered, cashAmountInTicket])

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((prev) =>
      prev.map((ln) => (ln.key === key ? { ...ln, ...patch } : ln)),
    )
  }

  const handleSelectService = (key: string, srvId: string) => {
    if (srvId === '__manual__') {
      updateLine(key, { serviceId: '' })
      return
    }
    const srv = activeServices.find((s) => s.id === srvId)
    if (!srv) return
    const autoCategory =
      srv.categoryCode === 'tresses_nattes' ||
      srv.categoryCode === 'meches_perruques'
        ? 'braiding_weaving'
        : srv.categoryCode === 'coloration' ||
            srv.categoryCode === 'soins_brushing'
          ? 'care_coloring'
          : 'hair_service'
    updateLine(key, {
      serviceId: srv.id,
      label: srv.name,
      categoryCode: autoCategory,
      unitPrice: String(srv.referencePrice),
    })
  }

  const handleSelectProduct = (key: string, prodId: string) => {
    const prod = resaleProducts.find((p) => p.id === prodId)
    if (!prod) return
    updateLine(key, {
      productId: prod.id,
      label: prod.name,
      categoryCode: 'product_sale',
      unitPrice: String(prod.salePrice ?? prod.costPrice),
    })
  }

  const addLine = (kind: 'service' | 'product') => {
    setLines((prev) => [
      ...prev,
      {
        key: makeLineKey(),
        kind,
        serviceId: '',
        productId: '',
        label: '',
        categoryCode: kind === 'product' ? 'product_sale' : 'hair_service',
        employeeId: prev[0]?.employeeId ?? '',
        quantity: '1',
        unitPrice: '',
      },
    ])
  }

  const removeLine = (key: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const nowTime = new Date().toISOString().slice(11)
      const isoDate = `${date}T${nowTime}`

      const preparedLines: CheckoutTicketLineInput[] = lines.map((ln) => ({
        kind: ln.kind,
        serviceId: ln.kind === 'service' ? ln.serviceId || undefined : undefined,
        productId: ln.kind === 'product' ? ln.productId || undefined : undefined,
        label: ln.label,
        categoryCode: ln.categoryCode,
        employeeId: ln.employeeId || undefined,
        quantity: Math.max(1, Math.round(Number(ln.quantity || 1))),
        unitPrice: toIntFCFA(Number(ln.unitPrice || 0)),
      }))

      const preparedConsumables = consumables
        .filter((c) => c.productId && Number(c.quantity) > 0)
        .map((c) => ({
          productId: c.productId,
          quantity: Math.max(1, Math.round(Number(c.quantity))),
        }))

      const preparedSplits =
        paymentMode === 'split'
          ? splits
              .filter((s) => Number(s.amount) > 0)
              .map((s) => ({
                method: s.method,
                amount: toIntFCFA(Number(s.amount)),
              }))
          : undefined

      const result = await mutate((repo) =>
        repo.createCheckoutTicket({
          date: isoDate,
          clientName,
          lines: preparedLines,
          consumables: preparedConsumables,
          paymentMethod:
            paymentMode === 'split' && preparedSplits?.[0]
              ? preparedSplits[0].method
              : paymentMethod,
          paymentSplits: preparedSplits,
          amountTendered: amountTendered ? Number(amountTendered) : undefined,
          note,
        }),
      )

      toast.success(
        `Ticket ${result.receiptNumber} validé (${formatFCFA(result.totalAmount)}).`,
      )
      onClose()
      onTicketCreated?.(result.receiptNumber)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Encaissement impossible.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Nouveau Ticket d'encaissement client"
      subtitle="Combinez prestations et produits sur un seul ticket, avec mise à jour automatique du stock et de la caisse"
      maxWidth={700}
      onClose={onClose}
    >
      <form className="w-full" onSubmit={(e) => void handleSubmit(e)}>
        <FieldGroup>
          {/* Alerte non bloquante lorsque la caisse espèces est fermée */}
          {cashAmountInTicket > 0 && !openSession && (
            <div
              style={{
                padding: '11px 14px',
                borderRadius: 10,
                background: 'var(--color-warning-bg)',
                border: '1px solid rgba(217, 119, 6, 0.35)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                fontSize: '0.8rem',
              }}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} color="var(--color-warning)" />
                <span>
                  <strong>Aucune session de caisse ouverte :</strong> ce
                  règlement espèces ({formatFCFA(cashAmountInTicket)}) sera
                  comptabilisé hors tiroir-caisse si vous n&apos;ouvrez pas la
                  caisse d&apos;abord.
                </span>
              </div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={openQuickCashModal}
              >
                <Unlock size={13} />
                Ouvrir la caisse maintenant
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="tkt-date">Date du ticket</FieldLabel>
              <Input
                id="tkt-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="tkt-client">
                Client(e) (facultatif — affiché sur le reçu)
              </FieldLabel>
              <Input
                id="tkt-client"
                type="text"
                placeholder="Ex. Mme Konan / M. Touré"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
              />
            </Field>
          </div>

          {/* Lignes du panier */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                Prestations &amp; Produits ({lines.length})
              </span>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => addLine('service')}
                >
                  <Scissors size={13} />+ Prestation
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => addLine('product')}
                >
                  <Package size={13} />+ Produit vente
                </Button>
              </div>
            </div>

            {lines.map((ln, idx) => (
              <div
                key={ln.key}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface-muted)',
                }}
                className="space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <Badge
                    variant={ln.kind === 'service' ? 'default' : 'info-light'}
                    size="sm"
                  >
                    {ln.kind === 'service'
                      ? `Ligne ${idx + 1} · Prestation`
                      : `Ligne ${idx + 1} · Produit de revente`}
                  </Badge>
                  {lines.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      style={{ color: 'var(--color-danger)' }}
                      aria-label="Retirer la ligne"
                      onClick={() => removeLine(ln.key)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {ln.kind === 'service' ? (
                    <Field>
                      <FieldLabel>Catalogue prestations</FieldLabel>
                      <Select
                        value={ln.serviceId || '__manual__'}
                        onValueChange={(v) => handleSelectService(ln.key, v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choisir ou saisie libre…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__manual__">
                            Saisie libre personnalisée
                          </SelectItem>
                          {activeServices.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} ({formatFCFA(s.referencePrice)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel>Produit en stock</FieldLabel>
                      <Select
                        value={ln.productId}
                        onValueChange={(v) => handleSelectProduct(ln.key, v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un produit…" />
                        </SelectTrigger>
                        <SelectContent>
                          {resaleProducts.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.quantity} {p.unit} dispo ·{' '}
                              {formatFCFA(p.salePrice ?? p.costPrice)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}

                  <Field>
                    <FieldLabel>Coiffeur / Barbier</FieldLabel>
                    <Select
                      value={ln.employeeId || '__none__'}
                      onValueChange={(v) =>
                        updateLine(ln.key, {
                          employeeId: v === '__none__' ? '' : v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Non attribué</SelectItem>
                        {activeEmployees.map((emp) => (
                          <SelectItem key={emp.id} value={emp.id}>
                            {emp.fullName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.8fr 1fr 0.7fr 1fr',
                    gap: 8,
                  }}
                >
                  <Field>
                    <FieldLabel>Libellé</FieldLabel>
                    <Input
                      type="text"
                      required
                      placeholder="Ex. Coupe + Barbe"
                      value={ln.label}
                      onChange={(e) =>
                        updateLine(ln.key, { label: e.target.value })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Catégorie</FieldLabel>
                    <Select
                      value={ln.categoryCode}
                      onValueChange={(v) =>
                        updateLine(ln.key, { categoryCode: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {revenueCategories.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Qté</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={ln.quantity}
                      onChange={(e) =>
                        updateLine(ln.key, { quantity: e.target.value })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Prix unit. (FCFA)</FieldLabel>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      required
                      value={ln.unitPrice}
                      onChange={(e) =>
                        updateLine(ln.key, { unitPrice: e.target.value })
                      }
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>

          {/* Consommables optionnels utilisés en cabine */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">
                Consommables salon utilisés en cabine (sans surfacturation client)
              </span>
              {consumableProducts.length > 0 && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setConsumables((prev) => [
                      ...prev,
                      {
                        key: makeLineKey(),
                        productId: consumableProducts[0]?.id ?? '',
                        quantity: '1',
                      },
                    ])
                  }
                >
                  <Plus size={13} />
                  Sortir un consommable
                </Button>
              )}
            </div>

            {consumables.map((cons) => (
              <div
                key={cons.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 90px auto',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <Select
                  value={cons.productId}
                  onValueChange={(v) =>
                    setConsumables((prev) =>
                      prev.map((c) =>
                        c.key === cons.key ? { ...c, productId: v } : c,
                      ),
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {consumableProducts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.quantity} {p.unit} dispo)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={cons.quantity}
                  onChange={(e) =>
                    setConsumables((prev) =>
                      prev.map((c) =>
                        c.key === cons.key
                          ? { ...c, quantity: e.target.value }
                          : c,
                      ),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() =>
                    setConsumables((prev) =>
                      prev.filter((c) => c.key !== cons.key),
                    )
                  }
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>

          {/* Mode de paiement : Simple ou Mixte */}
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              border: '1px solid var(--border-strong)',
              background: 'var(--bg-surface)',
            }}
            className="space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant={paymentMode === 'single' ? 'default' : 'outline'}
                  onClick={() => setPaymentMode('single')}
                >
                  1 mode de paiement
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={paymentMode === 'split' ? 'default' : 'outline'}
                  onClick={() => {
                    setPaymentMode('split')
                    const half = Math.floor(totalAmount / 2)
                    setSplits([
                      { key: 'sp-1', method: 'cash', amount: String(half) },
                      {
                        key: 'sp-2',
                        method: 'wave',
                        amount: String(Math.max(0, totalAmount - half)),
                      },
                    ])
                  }}
                >
                  Paiement mixte (Espèces + Mobile Money)
                </Button>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                Total :{' '}
                <span
                  className="tabular-nums"
                  style={{ color: 'var(--accent-cta)' }}
                >
                  {formatFCFA(totalAmount)}
                </span>
              </div>
            </div>

            {paymentMode === 'single' ? (
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Mode de règlement</FieldLabel>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {paymentMethods.map((m) => (
                        <SelectItem key={m.code} value={m.code}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {paymentMethod === 'cash' && (
                  <Field>
                    <FieldLabel htmlFor="tkt-tendered">
                      Espèces remises (calcul monnaie)
                    </FieldLabel>
                    <Input
                      id="tkt-tendered"
                      type="number"
                      min={0}
                      step={1}
                      placeholder={
                        totalAmount > 0 ? `Ex. ${totalAmount}` : 'Optionnel'
                      }
                      value={amountTendered}
                      onChange={(e) => setAmountTendered(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {splits.map((sp) => (
                  <div
                    key={sp.key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr auto',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Select
                      value={sp.method}
                      onValueChange={(v) =>
                        setSplits((prev) =>
                          prev.map((x) =>
                            x.key === sp.key ? { ...x, method: v } : x,
                          ),
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {paymentMethods.map((m) => (
                          <SelectItem key={m.code} value={m.code}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="Montant FCFA"
                      value={sp.amount}
                      onChange={(e) =>
                        setSplits((prev) =>
                          prev.map((x) =>
                            x.key === sp.key
                              ? { ...x, amount: e.target.value }
                              : x,
                          ),
                        )
                      }
                    />
                    {splits.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() =>
                          setSplits((prev) =>
                            prev.filter((x) => x.key !== sp.key),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between text-xs">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setSplits((prev) => [
                        ...prev,
                        {
                          key: makeLineKey(),
                          method: 'orange_money',
                          amount: '',
                        },
                      ])
                    }
                  >
                    + Ajouter un mode
                  </Button>
                  <Badge
                    variant={
                      splitAllocated === totalAmount
                        ? 'success-light'
                        : 'warning-light'
                    }
                    size="sm"
                  >
                    Réparti : {formatFCFA(splitAllocated)} /{' '}
                    {formatFCFA(totalAmount)}
                  </Badge>
                </div>
              </div>
            )}

            {changeToReturn > 0 && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'var(--accent-emerald-soft)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.84rem',
                }}
              >
                <span>Monnaie à rendre au client :</span>
                <strong
                  className="tabular-nums"
                  style={{ color: 'var(--accent-cta)', fontSize: '0.95rem' }}
                >
                  {formatFCFA(changeToReturn)}
                </strong>
              </div>
            )}
          </div>

          <Field>
            <FieldLabel htmlFor="tkt-note">Note interne (facultatif)</FieldLabel>
            <Input
              id="tkt-note"
              type="text"
              placeholder="Précision prestation, référence Wave..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy || totalAmount <= 0}>
              <Receipt size={15} />
              Valider le ticket ({formatFCFA(totalAmount)})
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Modal>
  )
}
