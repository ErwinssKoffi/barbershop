import {
  AlertTriangle,
  ArrowUpCircle,
  Download,
  Plus,
  Printer,
  Receipt,
  Search,
  SettingsIcon,
  Trash2,
  Unlock,
  Wallet,
  X,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { KpiCard } from '@/components/ui/KpiCard'
import { Modal } from '@/components/ui/Modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuth } from '../../contexts/authContext'
import { useCashSession } from '../../contexts/cashSessionContext'
import { usePeriodFilter } from '../../contexts/periodFilterContext'
import { useQuickAction } from '../../contexts/quickActionContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import { calculateRevenueMetrics } from '../../domain/calculations/finance'
import type { RevenueEntry } from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import {
  formatDateFR,
  formatFCFA,
  isIsoInBounds,
  todayISO,
  type PeriodPreset,
} from '../../utils/format'

export function RevenuePage() {
  const { state, categoryLabel, mutate } = useSalonStore()
  const { currentUser } = useAuth()
  const isCashier = currentUser?.role === 'cashier'
  const {
    preset,
    customStart,
    customEnd,
    bounds,
    periodLabel,
    setPreset,
    setCustomRange,
  } = usePeriodFilter()
  const { openSession, openQuickCashModal } = useCashSession()
  const { openCheckoutTicket, openReceiptModal } = useQuickAction()
  const { focusTarget, clearFocusTarget } = useWorkspaceFocus()
  const toast = useToast()

  const [catFilter, setCatFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [localSearch, setLocalSearch] = useState<string | null>(null)

  const isRouteFocused = focusTarget?.route === '/revenue'
  const search =
    localSearch !== null
      ? localSearch
      : isRouteFocused
        ? (focusTarget.searchQuery ?? '')
        : ''

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

  const filteredRevenues = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.revenues
      .filter((r) => !r.isArchived)
      .filter((r) => isRouteFocused || isIsoInBounds(r.date, bounds))
      .filter((r) => catFilter === 'all' || r.categoryCode === catFilter)
      .filter((r) => {
        if (methodFilter === 'all') return true
        if (r.paymentSplits && r.paymentSplits.length > 0) {
          return r.paymentSplits.some((s) => s.method === methodFilter)
        }
        return r.paymentMethod === methodFilter
      })
      .filter(
        (r) =>
          !q ||
          r.label.toLowerCase().includes(q) ||
          (r.receiptNumber ?? '').toLowerCase().includes(q) ||
          (r.clientName ?? '').toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt),
      )
  }, [
    state.revenues,
    isRouteFocused,
    bounds,
    catFilter,
    methodFilter,
    search,
  ])

  const metrics = useMemo(
    () => calculateRevenueMetrics(filteredRevenues),
    [filteredRevenues],
  )
  const cashTurnover = metrics.byPaymentMethod['cash'] ?? 0
  const electronicTurnover = metrics.totalRevenue - cashTurnover

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<RevenueEntry | null>(null)
  const [date, setDate] = useState<string>(() => todayISO())
  const [label, setLabel] = useState('')
  const [categoryCode, setCategoryCode] = useState('hair_service')
  const [serviceId, setServiceId] = useState('')
  const [serviceVariantId, setServiceVariantId] = useState('')
  const [productId, setProductId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [editReason, setEditReason] = useState('')
  const [busy, setBusy] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<RevenueEntry | null>(null)

  const openCreate = () => {
    setEditing(null)
    setDate(todayISO())
    setLabel('')
    setCategoryCode(revenueCategories[0]?.code ?? 'hair_service')
    setServiceId('')
    setServiceVariantId('')
    setProductId('')
    setEmployeeId('')
    setPaymentMethod('cash')
    setAmount('')
    setNote('')
    setEditReason('')
    setFormOpen(true)
  }

  const openEdit = (rev: RevenueEntry) => {
    setEditing(rev)
    setDate(rev.date.slice(0, 10))
    setLabel(rev.label)
    setCategoryCode(rev.categoryCode)
    setServiceId(rev.serviceId ?? '')
    setServiceVariantId(rev.serviceVariantId ?? '')
    setProductId(rev.productId ?? '')
    setEmployeeId(rev.employeeId ?? '')
    setPaymentMethod(rev.paymentMethod)
    setAmount(String(rev.amount))
    setNote(rev.note ?? '')
    setEditReason('Rectification sur pièce de recette')
    setFormOpen(true)
  }

  const selectedServiceObj = useMemo(
    () => (serviceId ? state.services.find((s) => s.id === serviceId) : undefined),
    [serviceId, state.services],
  )
  const isRevPriceLocked = Boolean(isCashier && selectedServiceObj?.priceLocked)

  const handleSelectService = (sid: string) => {
    setServiceId(sid)
    setServiceVariantId('')
    const found = state.services.find((s) => s.id === sid)
    if (found) {
      setLabel(found.name)
      setAmount(String(found.referencePrice))
    }
  }

  const handleSelectServiceVariant = (vid: string) => {
    setServiceVariantId(vid)
    if (!selectedServiceObj) return
    if (!vid) {
      setLabel(selectedServiceObj.name)
      setAmount(String(selectedServiceObj.referencePrice))
      return
    }
    const foundVar = selectedServiceObj.variants?.find((v) => v.id === vid)
    if (foundVar) {
      setLabel(`${selectedServiceObj.name} — ${foundVar.label}`)
      setAmount(String(foundVar.price))
    }
  }

  const handleSelectProduct = (pid: string) => {
    setProductId(pid)
    const found = state.products.find((p) => p.id === pid)
    if (found) {
      if (!label.trim()) setLabel(`Vente ${found.name}`)
      if (found.salePrice) setAmount(String(found.salePrice))
      setCategoryCode('product_sale')
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const isoDate = `${date}T12:00:00.000Z`
    try {
      if (editing) {
        await mutate((repo) =>
          repo.updateRevenue({
            id: editing.id,
            date: isoDate,
            label,
            categoryCode,
            employeeId: employeeId || undefined,
            paymentMethod,
            amount: Number(amount),
            note,
            reason: editReason,
          }),
        )
        toast.success('Recette modifiée avec trace dans le journal.')
      } else {
        const matchedVar =
          selectedServiceObj && serviceVariantId
            ? selectedServiceObj.variants?.find((v) => v.id === serviceVariantId)
            : undefined
        await mutate((repo) =>
          repo.addRevenue({
            date: isoDate,
            label,
            categoryCode,
            serviceId: serviceId || undefined,
            serviceVariantId: matchedVar?.id,
            serviceVariantLabel: matchedVar?.label,
            productId: productId || undefined,
            employeeId: employeeId || undefined,
            paymentMethod,
            amount: Number(amount),
            note,
            callerRole: currentUser?.role,
          }),
        )
        toast.success('Recette enregistrée.')
      }
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur enregistrement.')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmArchive = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await mutate((repo) => repo.archiveRevenue(deleteTarget.id))
      setDeleteTarget(null)
      toast.success(
        'Recette annulée : caisse et stock éventuels réintégrés avec trace d’audit.',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression refusée.')
    } finally {
      setBusy(false)
    }
  }

  const handleExportCSV = () => {
    downloadCsvFile(
      `recettes-${todayISO()}.csv`,
      [
        'Date',
        'N° Reçu',
        'Client',
        'Libellé',
        'Catégorie',
        'Mode de paiement',
        'Employé',
        'Montant FCFA',
        'Observations',
      ],
      filteredRevenues.map((r) => {
        const emp = state.employees.find((x) => x.id === r.employeeId)
        const payLabel =
          r.paymentSplits && r.paymentSplits.length > 1
            ? r.paymentSplits
                .map(
                  (sp) =>
                    `${categoryLabel('payment_method', sp.method)} (${sp.amount})`,
                )
                .join(' + ')
            : categoryLabel('payment_method', r.paymentMethod)
        return [
          r.date.slice(0, 10),
          r.receiptNumber ?? '',
          r.clientName ?? '',
          r.label,
          categoryLabel('revenue', r.categoryCode),
          payLabel,
          emp ? emp.fullName : '',
          r.amount,
          r.note ?? '',
        ]
      }),
    )
    toast.success('Fichier CSV des recettes exporté.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Gestion des recettes</h1>
          <p className="page-subtitle">
            Tickets clients, prestations et ventes de produits ·{' '}
            <strong>{periodLabel}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCSV}
            disabled={filteredRevenues.length === 0}
          >
            <Download size={15} />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            <Printer size={15} />
            Imprimer
          </Button>
          <Button type="button" variant="outline" onClick={openCreate}>
            <Plus size={15} />
            Nouvelle recette
          </Button>
          <Button type="button" onClick={() => openCheckoutTicket()}>
            <Receipt size={15} />
            Ticket client (multi-lignes)
          </Button>
        </div>
      </div>

      {isRouteFocused && (
        <div
          className="no-print"
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: 'var(--accent-emerald-soft)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.82rem',
          }}
        >
          <span>
            Filtre ciblé actif :{' '}
            <strong>{focusTarget?.searchQuery ?? 'Sélection directe'}</strong>
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => {
              clearFocusTarget()
              setLocalSearch('')
            }}
          >
            <X size={13} />
            Tout afficher
          </Button>
        </div>
      )}

      <div className="print-only" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>
          {state.salon.name} — État des Recettes ({periodLabel})
        </h1>
        <p style={{ margin: '4px 0', fontSize: '0.84rem' }}>
          Total CA : {formatFCFA(metrics.totalRevenue)} ({metrics.count}{' '}
          recettes)
        </p>
      </div>

      <section className="kpi-grid">
        <KpiCard
          label="Total des recettes (CA)"
          value={formatFCFA(metrics.totalRevenue)}
          icon={<ArrowUpCircle size={18} />}
          tone="emerald"
          subtitle={`${metrics.count} opération(s)`}
        />
        <KpiCard
          label="Encaissements Espèces"
          value={formatFCFA(cashTurnover)}
          icon={<Wallet size={18} />}
          tone="teal"
          subtitle="Entrent dans la caisse espèces"
        />
        <KpiCard
          label="Wave & Mobile Money / Virement"
          value={formatFCFA(electronicTurnover)}
          icon={<ArrowUpCircle size={18} />}
          tone="blue"
          subtitle="Hors tiroir-caisse physique"
        />
        <KpiCard
          label="Panier moyen"
          value={formatFCFA(
            metrics.count > 0
              ? Math.round(metrics.totalRevenue / metrics.count)
              : 0,
          )}
          icon={<ArrowUpCircle size={18} />}
          tone="amber"
          subtitle="Moyenne par ligne encaissée"
        />
      </section>

      {/* Filtres */}
      <div
        className="surface-card no-print"
        style={{
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))',
          gap: 14,
          alignItems: 'end',
        }}
      >
        <Field>
          <FieldLabel htmlFor="rev-period">Période</FieldLabel>
          <Select
            value={preset}
            onValueChange={(v) => setPreset(v as PeriodPreset)}
          >
            <SelectTrigger id="rev-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Aujourd&apos;hui</SelectItem>
              <SelectItem value="week">Cette semaine</SelectItem>
              <SelectItem value="month">Ce mois</SelectItem>
              <SelectItem value="prev_month">Mois précédent</SelectItem>
              <SelectItem value="year">Année en cours</SelectItem>
              <SelectItem value="all">Toutes périodes</SelectItem>
              <SelectItem value="custom">Période personnalisée</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {preset === 'custom' && (
          <>
            <Field>
              <FieldLabel htmlFor="rev-start">Du</FieldLabel>
              <Input
                id="rev-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomRange(e.target.value, customEnd)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="rev-end">Au</FieldLabel>
              <Input
                id="rev-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomRange(customStart, e.target.value)}
              />
            </Field>
          </>
        )}

        <Field>
          <FieldLabel htmlFor="rev-cat">Catégorie</FieldLabel>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger id="rev-cat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les catégories</SelectItem>
              {revenueCategories.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="rev-pay">Mode de paiement</FieldLabel>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger id="rev-pay">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les modes</SelectItem>
              {paymentMethods.map((m) => (
                <SelectItem key={m.code} value={m.code}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="rev-search">Rechercher (libellé, reçu, client)</FieldLabel>
          <div style={{ position: 'relative' }}>
            <Search
              size={15}
              style={{
                position: 'absolute',
                left: 11,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <Input
              id="rev-search"
              type="search"
              style={{ paddingLeft: 34 }}
              placeholder="Ex. Tresses, REC-2026..."
              value={search}
              onChange={(e) => {
                if (isRouteFocused) clearFocusTarget()
                setLocalSearch(e.target.value)
              }}
            />
          </div>
        </Field>
      </div>

      {/* Tableau (@reui/c-table-10) */}
      <Card>
        <CardContent style={{ paddingTop: 6 }}>
          {filteredRevenues.length === 0 ? (
            <EmptyState
              icon={<ArrowUpCircle size={24} />}
              title="Aucune recette trouvée"
              description="Aucune recette ne correspond aux filtres sélectionnés. Encaissez un Ticket client ou une recette rapide en FCFA."
              actionLabel="Nouveau Ticket client"
              onAction={() => openCheckoutTicket()}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prestation / Vente</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Paiement</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right no-print">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRevenues.map((r) => {
                  const emp = state.employees.find(
                    (e) => e.id === r.employeeId,
                  )
                  const metaParts = [
                    formatDateFR(r.date, state.settings.dateFormat),
                  ]
                  if (r.receiptNumber) metaParts.push(r.receiptNumber)
                  if (r.clientName) metaParts.push(r.clientName)
                  if (emp) metaParts.push(emp.fullName)
                  if (r.reference) metaParts.push(`Réf. ${r.reference}`)

                  const isMixed =
                    r.paymentSplits !== undefined && r.paymentSplits.length > 1
                  const isFocusedRow = focusTarget?.entityId === r.id

                  return (
                    <TableRow
                      key={r.id}
                      style={
                        isFocusedRow
                          ? { background: 'var(--accent-emerald-soft)' }
                          : undefined
                      }
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {r.label}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {metaParts.join(' · ')}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default" size="sm">
                          {categoryLabel('revenue', r.categoryCode)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isMixed ? (
                          <div className="flex flex-col gap-0.5">
                            <Badge variant="warning-light" size="sm">
                              Paiement mixte
                            </Badge>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {r.paymentSplits
                                ?.map(
                                  (sp) =>
                                    `${categoryLabel('payment_method', sp.method)}: ${formatFCFA(sp.amount)}`,
                                )
                                .join(' + ')}
                            </span>
                          </div>
                        ) : (
                          <Badge
                            variant={
                              r.paymentMethod === 'cash'
                                ? 'success-light'
                                : 'info-light'
                            }
                            size="sm"
                          >
                            {categoryLabel('payment_method', r.paymentMethod)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="text-right text-sm font-semibold tabular-nums"
                        style={{ color: 'var(--color-success)' }}
                      >
                        {formatFCFA(r.amount)}
                      </TableCell>
                      <TableCell className="text-right no-print">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            title="Aperçu / Imprimer le reçu client"
                            aria-label={`Imprimer le reçu de ${r.label}`}
                            onClick={() => openReceiptModal(r.id)}
                          >
                            <Receipt size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            title="Modifier"
                            aria-label={`Modifier ${r.label}`}
                            onClick={() => openEdit(r)}
                          >
                            <SettingsIcon
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            Gérer
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            style={{ color: 'var(--color-danger)' }}
                            title="Supprimer"
                            aria-label={`Supprimer ${r.label}`}
                            onClick={() => setDeleteTarget(r)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        title={editing ? 'Modifier une recette' : 'Enregistrer une recette'}
        subtitle="Montant en FCFA entier · Si le paiement est en espèces et qu'une caisse est ouverte, elle est alimentée automatiquement."
        maxWidth={600}
        onClose={() => setFormOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleSubmit(e)}>
          <FieldGroup>
            {paymentMethod === 'cash' && !openSession && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--color-warning-bg)',
                  border: '1px solid rgba(217, 119, 6, 0.35)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: '0.79rem',
                }}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle size={15} color="var(--color-warning)" />
                  <span>
                    Aucune session de caisse ouverte : ouvrez la caisse espèces
                    en 1 clic ou poursuivez en saisie rétroactive.
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
                <FieldLabel htmlFor="f-rev-date">Date</FieldLabel>
                <Input
                  id="f-rev-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-rev-cat">
                  Catégorie de recette
                </FieldLabel>
                <Select value={categoryCode} onValueChange={setCategoryCode}>
                  <SelectTrigger id="f-rev-cat">
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-rev-srv">
                  Prestation liée (optionnel)
                </FieldLabel>
                <Select
                  value={serviceId || '__none__'}
                  onValueChange={(v) =>
                    handleSelectService(v === '__none__' ? '' : v)
                  }
                >
                  <SelectTrigger id="f-rev-srv">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">
                      — Aucune / Saisie libre —
                    </SelectItem>
                    {state.services
                      .filter((s) => s.isActive || s.id === serviceId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {`${s.name} (${formatFCFA(s.referencePrice)})`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>

              {selectedServiceObj?.variants &&
                selectedServiceObj.variants.length > 0 && (
                  <Field>
                    <FieldLabel htmlFor="f-rev-var">
                      Variante tarifaire
                    </FieldLabel>
                    <Select
                      value={serviceVariantId || '__base__'}
                      onValueChange={(v) =>
                        handleSelectServiceVariant(v === '__base__' ? '' : v)
                      }
                    >
                      <SelectTrigger id="f-rev-var">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__base__">
                          Standard ({formatFCFA(selectedServiceObj.referencePrice)})
                        </SelectItem>
                        {selectedServiceObj.variants.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {`${v.label} (${formatFCFA(v.price)})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

              <Field>
                <FieldLabel htmlFor="f-rev-prod">
                  Produit vendu (optionnel — décrémente le stock)
                </FieldLabel>
                <Select
                  value={productId || '__none__'}
                  onValueChange={(v) =>
                    handleSelectProduct(v === '__none__' ? '' : v)
                  }
                >
                  <SelectTrigger id="f-rev-prod">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Aucun —</SelectItem>
                    {state.products
                      .filter(
                        (p) =>
                          (p.isActive && p.usageType !== 'consumable') ||
                          p.id === productId,
                      )
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {`${p.name} (${p.salePrice ? formatFCFA(p.salePrice) : '—'})`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="f-rev-label">
                Libellé de la recette
              </FieldLabel>
              <Input
                id="f-rev-label"
                type="text"
                required
                placeholder="Ex. Tresses sans nœuds mi-dos cliente"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-rev-emp">
                  Employé associé (optionnel)
                </FieldLabel>
                <Select
                  value={employeeId || '__none__'}
                  onValueChange={(v) =>
                    setEmployeeId(v === '__none__' ? '' : v)
                  }
                >
                  <SelectTrigger id="f-rev-emp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Non assigné —</SelectItem>
                    {state.employees
                      .filter((emp) => emp.isActive || emp.id === employeeId)
                      .map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>
                          {`${emp.fullName} (${emp.roleTitle})`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="f-rev-method">Mode de paiement</FieldLabel>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="f-rev-method">
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-rev-amount">
                  Montant encaissé (FCFA)
                  {isRevPriceLocked ? ' · Tarif fixe' : ''}
                </FieldLabel>
                <Input
                  id="f-rev-amount"
                  type="number"
                  min={1}
                  step={1}
                  required
                  readOnly={isRevPriceLocked}
                  value={amount}
                  onChange={(e) => {
                    if (isRevPriceLocked) return
                    setAmount(e.target.value)
                  }}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-rev-notes">
                  Observation éventuelle
                </FieldLabel>
                <Input
                  id="f-rev-notes"
                  type="text"
                  placeholder="Note facultative"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>

            {editing && (
              <Field>
                <FieldLabel htmlFor="f-rev-reason">
                  Motif de modification (traçabilité)
                </FieldLabel>
                <Input
                  id="f-rev-reason"
                  type="text"
                  required
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                />
              </Field>
            )}

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {editing
                  ? 'Enregistrer les modifications'
                  : 'Ajouter la recette'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer cette recette ?"
        message={
          deleteTarget
            ? `La recette « ${deleteTarget.label} » (${formatFCFA(deleteTarget.amount)}) sera retirée du chiffre d'affaires, son mouvement de caisse espèces éventuel sera annulé et tout produit/consommable lié sera réintégré au stock.`
            : ''
        }
        confirmLabel="Supprimer la recette"
        busy={busy}
        onConfirm={() => void handleConfirmArchive()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
