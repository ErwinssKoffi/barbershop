import {
  AlertTriangle,
  ArrowDownCircle,
  CalendarClock,
  CheckCircle2,
  Download,
  Eye,
  Package,
  Plus,
  Printer,
  Repeat,
  Search,
  SettingsIcon,
  Trash2,
  Unlock,
  X,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { useCashSession } from '../../contexts/cashSessionContext'
import { usePeriodFilter } from '../../contexts/periodFilterContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import { calculateExpenseMetrics } from '../../domain/calculations/finance'
import type {
  ExpenseEntry,
  RecurringExpenseTemplate,
} from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import {
  computeEvolutionPercent,
  formatDateFR,
  formatDateTimeFR,
  formatFCFA,
  isIsoInBounds,
  todayISO,
  type PeriodPreset,
} from '../../utils/format'

export function ExpensesPage() {
  const { state, categoryLabel, mutate } = useSalonStore()
  const {
    preset,
    customStart,
    customEnd,
    selectedMonth,
    bounds,
    prevBounds,
    periodLabel,
    setPreset,
    setCustomRange,
  } = usePeriodFilter()
  const { openSession, openQuickCashModal } = useCashSession()
  const { focusTarget, navigateToEntity, clearFocusTarget } =
    useWorkspaceFocus()
  const toast = useToast()

  const [catFilter, setCatFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [localSearch, setLocalSearch] = useState<string | null>(null)

  const isRouteFocused = focusTarget?.route === '/expenses'
  const search =
    localSearch !== null
      ? localSearch
      : isRouteFocused
        ? (focusTarget.searchQuery ?? '')
        : ''

  const expenseCategories = useMemo(
    () => state.categories.filter((c) => c.scope === 'expense' && !c.isArchived),
    [state.categories],
  )
  const selectableManualExpenseCategories = useMemo(
    () =>
      expenseCategories.filter(
        (c) => c.code !== 'salaries' && c.code !== 'bonuses',
      ),
    [expenseCategories],
  )
  const paymentMethods = useMemo(
    () =>
      state.categories.filter(
        (c) => c.scope === 'payment_method' && !c.isArchived,
      ),
    [state.categories],
  )

  const activeRecurringTemplates = useMemo(
    () => state.recurringExpenses.filter((t) => t.isActive),
    [state.recurringExpenses],
  )

  const recurringPaidMap = useMemo(() => {
    const map = new Map<string, ExpenseEntry>()
    for (const exp of state.expenses) {
      if (
        !exp.isArchived &&
        exp.recurringTemplateId &&
        exp.recurringPeriodMonth === selectedMonth
      ) {
        map.set(exp.recurringTemplateId, exp)
      }
    }
    return map
  }, [state.expenses, selectedMonth])

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.expenses
      .filter((e) => !e.isArchived)
      .filter((e) => isRouteFocused || isIsoInBounds(e.date, bounds))
      .filter((e) => catFilter === 'all' || e.categoryCode === catFilter)
      .filter((e) => methodFilter === 'all' || e.paymentMethod === methodFilter)
      .filter(
        (e) =>
          !q ||
          e.label.toLowerCase().includes(q) ||
          (e.beneficiary ?? '').toLowerCase().includes(q) ||
          (e.receiptRef ?? '').toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt),
      )
  }, [
    state.expenses,
    isRouteFocused,
    bounds,
    catFilter,
    methodFilter,
    search,
  ])

  const prevExpenses = useMemo(
    () =>
      prevBounds
        ? state.expenses
            .filter((e) => !e.isArchived && isIsoInBounds(e.date, prevBounds))
            .filter((e) => catFilter === 'all' || e.categoryCode === catFilter)
            .filter(
              (e) =>
                methodFilter === 'all' || e.paymentMethod === methodFilter,
            )
        : [],
    [state.expenses, prevBounds, catFilter, methodFilter],
  )

  const metrics = useMemo(
    () => calculateExpenseMetrics(filteredExpenses),
    [filteredExpenses],
  )
  const prevMetrics = useMemo(
    () => calculateExpenseMetrics(prevExpenses),
    [prevExpenses],
  )

  const evolExpenses = useMemo(
    () =>
      computeEvolutionPercent(
        metrics.totalDisbursed,
        prevMetrics.totalDisbursed,
        prevMetrics.totalDisbursed > 0,
      ),
    [metrics.totalDisbursed, prevMetrics.totalDisbursed],
  )

  const cashExpenses = metrics.byPaymentMethod['cash'] ?? 0

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseEntry | null>(null)
  const [date, setDate] = useState<string>(() => todayISO())
  const [label, setLabel] = useState('')
  const [categoryCode, setCategoryCode] = useState('rent')
  const [beneficiary, setBeneficiary] = useState('')
  const [receiptRef, setReceiptRef] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [editReason, setEditReason] = useState('')
  const [detailItem, setDetailItem] = useState<ExpenseEntry | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntry | null>(null)
  const [busy, setBusy] = useState(false)

  // Modales charges fixes récurrentes
  const [payRecTpl, setPayRecTpl] = useState<RecurringExpenseTemplate | null>(
    null,
  )
  const [payRecAmount, setPayRecAmount] = useState('')
  const [payRecMethod, setPayRecMethod] = useState('cash')
  const [payRecRef, setPayRecRef] = useState('')

  const [newTplOpen, setNewTplOpen] = useState(false)
  const [tplLabel, setTplLabel] = useState('')
  const [tplCat, setTplCat] = useState('rent')
  const [tplAmount, setTplAmount] = useState('')
  const [tplMethod, setTplMethod] = useState('cash')
  const [tplBeneficiary, setTplBeneficiary] = useState('')
  const [tplDay, setTplDay] = useState('5')

  const openCreate = () => {
    setEditing(null)
    setDate(todayISO())
    setLabel('')
    setCategoryCode(selectableManualExpenseCategories[0]?.code ?? 'rent')
    setBeneficiary('')
    setReceiptRef('')
    setPaymentMethod('cash')
    setAmount('')
    setNote('')
    setEditReason('')
    setFormOpen(true)
  }

  const openEdit = (exp: ExpenseEntry) => {
    setEditing(exp)
    setDate(exp.date.slice(0, 10))
    setLabel(exp.label)
    setCategoryCode(exp.categoryCode)
    setBeneficiary(exp.beneficiary ?? '')
    setReceiptRef(exp.receiptRef ?? '')
    setPaymentMethod(exp.paymentMethod)
    setAmount(String(exp.amount))
    setNote(exp.note ?? '')
    setEditReason('Rectification sur pièce justificative')
    setFormOpen(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const isoDate = `${date}T12:00:00.000Z`
    try {
      if (editing) {
        await mutate((repo) =>
          repo.updateExpense({
            id: editing.id,
            date: isoDate,
            label,
            categoryCode,
            beneficiary,
            receiptRef,
            paymentMethod,
            amount: Number(amount),
            note,
            reason: editReason,
          }),
        )
        toast.success('Dépense rectifiée avec trace dans le journal.')
      } else {
        await mutate((repo) =>
          repo.addExpense({
            date: isoDate,
            label,
            categoryCode,
            beneficiary,
            receiptRef,
            paymentMethod,
            amount: Number(amount),
            note,
          }),
        )
        toast.success('Dépense enregistrée.')
      }
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur dépense.')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmRecurringPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (!payRecTpl) return
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.payRecurringExpenseForMonth({
          templateId: payRecTpl.id,
          periodMonth: selectedMonth,
          date: new Date().toISOString(),
          amount: Number(payRecAmount),
          paymentMethod: payRecMethod,
          receiptRef: payRecRef,
        }),
      )
      toast.success(
        `Charge « ${payRecTpl.label} » validée pour ${selectedMonth}.`,
      )
      setPayRecTpl(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Validation impossible.')
    } finally {
      setBusy(false)
    }
  }

  const handleCreateTemplate = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.saveRecurringExpenseTemplate({
          label: tplLabel,
          categoryCode: tplCat,
          defaultAmount: Number(tplAmount),
          paymentMethod: tplMethod,
          beneficiary: tplBeneficiary,
          dayOfMonth: Number(tplDay),
        }),
      )
      setNewTplOpen(false)
      setTplLabel('')
      setTplAmount('')
      setTplBeneficiary('')
      toast.success('Charge récurrente ajoutée.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Création refusée.')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await mutate((repo) => repo.archiveExpense(deleteTarget.id))
      setDeleteTarget(null)
      toast.success('Dépense supprimée et archivée.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression refusée.')
    } finally {
      setBusy(false)
    }
  }

  const handleExportCSV = () => {
    downloadCsvFile(
      `depenses-${todayISO()}.csv`,
      [
        'Date',
        'Libellé',
        'Catégorie',
        'Fournisseur / Bénéficiaire',
        'Justificatif',
        'Mode de paiement',
        'Montant FCFA',
        'Module source',
        'Notes',
      ],
      filteredExpenses.map((e) => [
        e.date.slice(0, 10),
        e.label,
        categoryLabel('expense', e.categoryCode),
        e.beneficiary ?? '',
        e.receiptRef ?? '',
        categoryLabel('payment_method', e.paymentMethod),
        e.amount,
        e.sourceModule,
        e.note ?? '',
      ]),
    )
    toast.success('Fichier CSV des dépenses exporté.')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Gestion des dépenses</h1>
          <p className="page-subtitle">
            Charges fixes, factures et achats · <strong>{periodLabel}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCSV}
            disabled={filteredExpenses.length === 0}
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
          <Button type="button" onClick={openCreate}>
            <Plus size={15} />
            Nouvelle dépense
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
            <strong>{focusTarget?.searchQuery ?? 'Dépense sélectionnée'}</strong>
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
          {state.salon.name} — État des Dépenses ({periodLabel})
        </h1>
        <p style={{ margin: '4px 0', fontSize: '0.84rem' }}>
          Total décaissé : {formatFCFA(metrics.totalDisbursed)}
        </p>
      </div>

      <section className="kpi-grid">
        <KpiCard
          label="Total des sorties"
          value={formatFCFA(metrics.totalDisbursed)}
          icon={<ArrowDownCircle size={18} />}
          tone="amber"
          evolutionPercent={evolExpenses}
          invertEvolutionColor
        />
        <KpiCard
          label="Charges opérationnelles"
          value={formatFCFA(metrics.operatingCharges)}
          icon={<ArrowDownCircle size={18} />}
          tone="blue"
          subtitle="Loyer, factures, salaires, entretien"
        />
        <KpiCard
          label="Achats de stock (inventorié)"
          value={formatFCFA(metrics.stockPurchasesTotal)}
          icon={<ArrowDownCircle size={18} />}
          tone="teal"
          subtitle="Non déduits deux fois du bénéfice"
        />
        <KpiCard
          label="Sorties en espèces"
          value={formatFCFA(cashExpenses)}
          icon={<ArrowDownCircle size={18} />}
          tone="danger"
          subtitle="Prélevées sur la caisse espèces"
        />
      </section>

      {/* Bloc Charges fixes récurrentes du mois */}
      <Card className="no-print">
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Repeat size={16} color="var(--accent-cta)" />
                Charges fixes mensuelles — {selectedMonth}
              </CardTitle>
              <CardDescription>
                Validez vos factures récurrentes (Loyer, CIE, SODECI, Internet…)
                en 1 clic avec montant ajustable
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setNewTplOpen(true)}
              >
                <Plus size={13} />
                Modèle récurrent
              </Button>
            </div>
          </div>
        </CardHeader>
        {activeRecurringTemplates.length > 0 && (
          <CardContent style={{ paddingTop: 12 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
                gap: 10,
              }}
            >
              {activeRecurringTemplates.map((tpl) => {
                const paidEntry = recurringPaidMap.get(tpl.id)
                return (
                  <div
                    key={tpl.id}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: `1px solid ${
                        paidEntry
                          ? 'rgba(16, 185, 129, 0.35)'
                          : 'var(--border-subtle)'
                      }`,
                      background: paidEntry
                        ? 'var(--accent-emerald-soft)'
                        : 'var(--bg-surface-muted)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">
                          {tpl.label}
                        </span>
                        <span className="text-muted-foreground flex items-center gap-1 text-xs">
                          <CalendarClock size={12} />J{tpl.dayOfMonth}
                        </span>
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Réf. mensuelle :{' '}
                        <strong className="tabular-nums">
                          {formatFCFA(tpl.defaultAmount)}
                        </strong>
                        {tpl.beneficiary ? ` · ${tpl.beneficiary}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      {paidEntry ? (
                        <Badge variant="success-light" size="sm">
                          <CheckCircle2 size={12} /> Réglée (
                          {formatFCFA(paidEntry.amount)})
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          size="xs"
                          onClick={() => {
                            setPayRecTpl(tpl)
                            setPayRecAmount(String(tpl.defaultAmount))
                            setPayRecMethod(tpl.paymentMethod)
                            setPayRecRef('')
                          }}
                        >
                          Valider ce mois
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        title="Retirer ce modèle récurrent"
                        onClick={() =>
                          void mutate((repo) =>
                            repo.deleteRecurringExpenseTemplate(tpl.id),
                          )
                        }
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        )}
      </Card>

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
          <FieldLabel htmlFor="exp-period">Période</FieldLabel>
          <Select
            value={preset}
            onValueChange={(v) => setPreset(v as PeriodPreset)}
          >
            <SelectTrigger id="exp-period">
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
              <FieldLabel htmlFor="exp-start">Du</FieldLabel>
              <Input
                id="exp-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomRange(e.target.value, customEnd)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="exp-end">Au</FieldLabel>
              <Input
                id="exp-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomRange(customStart, e.target.value)}
              />
            </Field>
          </>
        )}

        <Field>
          <FieldLabel htmlFor="exp-cat">Catégorie</FieldLabel>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger id="exp-cat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les catégories</SelectItem>
              {expenseCategories.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="exp-pay">Mode de paiement</FieldLabel>
          <Select value={methodFilter} onValueChange={setMethodFilter}>
            <SelectTrigger id="exp-pay">
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
          <FieldLabel htmlFor="exp-search">Rechercher</FieldLabel>
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
              id="exp-search"
              type="search"
              style={{ paddingLeft: 34 }}
              placeholder="Libellé, fournisseur, reçu..."
              value={search}
              onChange={(e) => {
                if (isRouteFocused) clearFocusTarget()
                setLocalSearch(e.target.value)
              }}
            />
          </div>
        </Field>
      </div>

      <Card>
        <CardContent style={{ paddingTop: 6 }}>
          {filteredExpenses.length === 0 ? (
            <EmptyState
              icon={<ArrowDownCircle size={24} />}
              title="Aucune dépense enregistrée"
              description="Ajoutez vos factures (loyer, électricité et eau, entretien, transport...) avec leur bénéficiaire et référence de reçu."
              actionLabel="Ajouter une dépense"
              onAction={openCreate}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dépense</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead>Paiement</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right no-print">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map((exp) => {
                  const isLinked =
                    exp.sourceModule === 'payroll' ||
                    exp.sourceModule === 'inventory_purchase'
                  const subParts = [
                    formatDateFR(exp.date, state.settings.dateFormat),
                  ]
                  if (exp.beneficiary) subParts.push(exp.beneficiary)
                  if (exp.receiptRef) subParts.push(`Réf. ${exp.receiptRef}`)

                  return (
                    <TableRow key={exp.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {exp.label}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {subParts.join(' · ')}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" size="sm">
                          {categoryLabel('expense', exp.categoryCode)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            exp.paymentMethod === 'cash'
                              ? 'warning-light'
                              : 'info-light'
                          }
                          size="sm"
                        >
                          {categoryLabel('payment_method', exp.paymentMethod)}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-right text-sm font-semibold tabular-nums"
                        style={{ color: 'var(--color-danger)' }}
                      >
                        {formatFCFA(exp.amount)}
                      </TableCell>
                      <TableCell className="text-right no-print">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            title="Voir le détail et la traçabilité"
                            aria-label={`Détail ${exp.label}`}
                            onClick={() => setDetailItem(exp)}
                          >
                            <Eye size={14} />
                          </Button>
                          {isLinked ? (
                            <Badge
                              variant="secondary"
                              size="sm"
                              title="Écriture liée automatiquement à la Paie ou à l'Inventaire"
                            >
                              {exp.sourceModule === 'inventory_purchase'
                                ? 'Achat stock'
                                : 'Paie liée'}
                            </Badge>
                          ) : (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7"
                                title="Modifier"
                                aria-label={`Modifier ${exp.label}`}
                                onClick={() => openEdit(exp)}
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
                                aria-label={`Supprimer ${exp.label}`}
                                onClick={() => setDeleteTarget(exp)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </>
                          )}
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

      {/* Modale Nouvelle dépense / Modification */}
      <Modal
        open={formOpen}
        title={editing ? 'Modifier une dépense' : 'Nouvelle dépense'}
        subtitle="Les salaires et primes se règlent dans « Salaires et commissions » afin d'éviter tout double comptage."
        maxWidth={580}
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
                    Caisse espèces fermée : ouvrez-la pour synchroniser cette
                    sortie au tiroir-caisse.
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

            {categoryCode === 'hair_products' && !editing && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--accent-emerald-soft)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: '0.79rem',
                }}
              >
                <span>
                  Achat de produits suivis en stock ? Basculez vers
                  l&apos;Inventaire pour mettre à jour vos quantités et le CUMP
                  automatiquement.
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setFormOpen(false)
                    navigateToEntity({ route: '/inventory', action: 'restock' })
                  }}
                >
                  <Package size={13} />
                  Approvisionner le stock
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-exp-date">Date</FieldLabel>
                <Input
                  id="f-exp-date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-exp-cat">
                  Catégorie de dépense
                </FieldLabel>
                <Select value={categoryCode} onValueChange={setCategoryCode}>
                  <SelectTrigger id="f-exp-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableManualExpenseCategories.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="f-exp-label">
                Libellé de la dépense
              </FieldLabel>
              <Input
                id="f-exp-label"
                type="text"
                required
                placeholder="Ex. Facture CIE électricité du mois"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-exp-benef">
                  Fournisseur ou bénéficiaire
                </FieldLabel>
                <Input
                  id="f-exp-benef"
                  type="text"
                  placeholder="Ex. CIE / Bailleur SCI..."
                  value={beneficiary}
                  onChange={(e) => setBeneficiary(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-exp-ref">
                  N° de justificatif / reçu
                </FieldLabel>
                <Input
                  id="f-exp-ref"
                  type="text"
                  placeholder="Ex. FAC-2026-104"
                  value={receiptRef}
                  onChange={(e) => setReceiptRef(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-exp-method">Mode de paiement</FieldLabel>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="f-exp-method">
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
              <Field>
                <FieldLabel htmlFor="f-exp-amount">Montant (FCFA)</FieldLabel>
                <Input
                  id="f-exp-amount"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="f-exp-notes">
                Note complémentaire
              </FieldLabel>
              <Input
                id="f-exp-notes"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>

            {editing && (
              <Field>
                <FieldLabel htmlFor="f-exp-reason">
                  Motif de la modification
                </FieldLabel>
                <Input
                  id="f-exp-reason"
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
                {editing ? 'Enregistrer' : 'Ajouter la dépense'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      {/* Modale Validation 1-clic d'une charge récurrente */}
      <Modal
        open={payRecTpl !== null}
        title={payRecTpl ? `Valider : ${payRecTpl.label}` : ''}
        subtitle={`Mois imputé : ${selectedMonth} · Ajustez le montant réel si la facture varie (ex. CIE / SODECI)`}
        maxWidth={480}
        onClose={() => setPayRecTpl(null)}
      >
        <form
          className="w-full"
          onSubmit={(e) => void handleConfirmRecurringPayment(e)}
        >
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="rec-pay-amt">
                  Montant réglé (FCFA)
                </FieldLabel>
                <Input
                  id="rec-pay-amt"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={payRecAmount}
                  onChange={(e) => setPayRecAmount(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="rec-pay-method">
                  Mode de règlement
                </FieldLabel>
                <Select value={payRecMethod} onValueChange={setPayRecMethod}>
                  <SelectTrigger id="rec-pay-method">
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
            <Field>
              <FieldLabel htmlFor="rec-pay-ref">
                Référence facture / reçu (optionnel)
              </FieldLabel>
              <Input
                id="rec-pay-ref"
                type="text"
                placeholder="Ex. Quittance loyer ou N° facture CIE"
                value={payRecRef}
                onChange={(e) => setPayRecRef(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPayRecTpl(null)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Confirmer le règlement
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      {/* Modale Création d'un modèle de charge récurrente */}
      <Modal
        open={newTplOpen}
        title="Nouveau modèle de charge fixe mensuelle"
        subtitle="Sera proposé chaque mois dans votre liste de contrôle rapide"
        maxWidth={500}
        onClose={() => setNewTplOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleCreateTemplate(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="tpl-label">Libellé récurrent</FieldLabel>
              <Input
                id="tpl-label"
                type="text"
                required
                placeholder="Ex. Gardiennage / Canal+ / Loyer..."
                value={tplLabel}
                onChange={(e) => setTplLabel(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="tpl-cat">Catégorie</FieldLabel>
                <Select value={tplCat} onValueChange={setTplCat}>
                  <SelectTrigger id="tpl-cat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableManualExpenseCategories.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="tpl-amt">
                  Montant habituel (FCFA)
                </FieldLabel>
                <Input
                  id="tpl-amt"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={tplAmount}
                  onChange={(e) => setTplAmount(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel htmlFor="tpl-method">Paiement</FieldLabel>
                <Select value={tplMethod} onValueChange={setTplMethod}>
                  <SelectTrigger id="tpl-method">
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
              <Field>
                <FieldLabel htmlFor="tpl-benef">Bénéficiaire</FieldLabel>
                <Input
                  id="tpl-benef"
                  type="text"
                  placeholder="Bailleur, CIE..."
                  value={tplBeneficiary}
                  onChange={(e) => setTplBeneficiary(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tpl-day">Jour échéance</FieldLabel>
                <Input
                  id="tpl-day"
                  type="number"
                  min={1}
                  max={28}
                  value={tplDay}
                  onChange={(e) => setTplDay(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewTplOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Enregistrer le modèle
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      <Modal
        open={detailItem !== null}
        title="Détail de la pièce de dépense"
        subtitle="Justificatif comptable et journal des rectifications éventuelles"
        maxWidth={560}
        onClose={() => setDetailItem(null)}
      >
        {detailItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                fontSize: '0.84rem',
              }}
            >
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Date
                </div>
                <div style={{ fontWeight: 600 }}>
                  {formatDateFR(detailItem.date, 'long-fr')}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Montant décaissé
                </div>
                <div
                  className="tabular-nums"
                  style={{ fontWeight: 700, color: 'var(--color-danger)' }}
                >
                  {formatFCFA(detailItem.amount)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Catégorie
                </div>
                <div style={{ fontWeight: 600 }}>
                  {categoryLabel('expense', detailItem.categoryCode)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Mode de règlement
                </div>
                <div style={{ fontWeight: 600 }}>
                  {categoryLabel('payment_method', detailItem.paymentMethod)}
                </div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Fournisseur / Bénéficiaire
                </div>
                <div>{detailItem.beneficiary || '—'}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  N° de justificatif
                </div>
                <div className="tabular-nums">
                  {detailItem.receiptRef || '—'}
                </div>
              </div>
            </div>

            {detailItem.note && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: 'var(--bg-surface-muted)',
                  fontSize: '0.82rem',
                }}
              >
                <strong>Note :</strong> {detailItem.note}
              </div>
            )}

            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  marginBottom: 6,
                }}
              >
                Historique des rectifications traçables
              </div>
              {state.correctionLogs.filter(
                (c) =>
                  c.entityType === 'expense' && c.entityId === detailItem.id,
              ).length === 0 ? (
                <div
                  style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}
                >
                  Aucune modification enregistrée depuis la création le{' '}
                  {formatDateTimeFR(detailItem.createdAt)}.
                </div>
              ) : (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  {state.correctionLogs
                    .filter(
                      (c) =>
                        c.entityType === 'expense' &&
                        c.entityId === detailItem.id,
                    )
                    .map((log) => (
                      <div
                        key={log.id}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: 'var(--bg-surface-muted)',
                          fontSize: '0.78rem',
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {formatDateTimeFR(log.createdAt)} — {log.action}
                        </div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          Motif : {log.reason}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Supprimer cette dépense ?"
        message={
          deleteTarget
            ? `La dépense « ${deleteTarget.label} » (${formatFCFA(deleteTarget.amount)}) sera supprimée.`
            : ''
        }
        confirmLabel="Supprimer"
        busy={busy}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
