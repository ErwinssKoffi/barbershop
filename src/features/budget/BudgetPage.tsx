import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Plus,
  Printer,
  SettingsIcon,
  Target,
  Trash2,
  TrendingUp,
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
import { Progress } from '@/components/ui/progress'
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
import { usePeriodFilter } from '../../contexts/periodFilterContext'
import {
  calculateBudgetComparisons,
  calculateBudgetRunRateForecast,
} from '../../domain/calculations/finance'
import type { BudgetTarget } from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import { formatFCFA } from '../../utils/format'

function getPreviousMonthISO(ym: string): string {
  const [yStr, mStr] = ym.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  if (!y || !m) return ym
  const dt = new Date(Date.UTC(y, m - 2, 1))
  return dt.toISOString().slice(0, 7)
}

export function BudgetPage() {
  const { state, categoryLabel, mutate } = useSalonStore()
  const { selectedMonth: periodMonth, setSelectedMonth: setPeriodMonth } =
    usePeriodFilter()
  const toast = useToast()

  const previousMonth = useMemo(
    () => getPreviousMonthISO(periodMonth),
    [periodMonth],
  )

  const expenseCategories = useMemo(
    () => state.categories.filter((c) => c.scope === 'expense' && !c.isArchived),
    [state.categories],
  )

  const [kind, setKind] = useState<'revenue_goal' | 'expense_cap'>(
    'expense_cap',
  )
  const [categoryCode, setCategoryCode] = useState('rent')
  const [plannedAmount, setPlannedAmount] = useState('')
  const [note, setNote] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BudgetTarget | null>(null)
  const [busy, setBusy] = useState(false)

  const rows = useMemo(
    () =>
      calculateBudgetComparisons({
        periodMonth,
        budgets: state.budgets,
        revenues: state.revenues,
        expenses: state.expenses,
      }),
    [periodMonth, state.budgets, state.revenues, state.expenses],
  )

  const revGoalRow = rows.find((r) => r.target.kind === 'revenue_goal') ?? null
  const expenseRows = rows.filter((r) => r.target.kind === 'expense_cap')
  const totalCap = expenseRows.reduce(
    (s, r) => s + r.target.plannedAmount,
    0,
  )
  const totalActualExp = expenseRows.reduce((s, r) => s + r.actualAmount, 0)
  const overrunsCount = expenseRows.filter((r) => r.isOverBudget).length
  const nearCapCount = expenseRows.filter((r) => r.isNearCap).length

  const actualMonthRevenue = useMemo(
    () =>
      state.revenues
        .filter((r) => !r.isArchived && r.date.slice(0, 7) === periodMonth)
        .reduce((s, r) => s + r.amount, 0),
    [state.revenues, periodMonth],
  )

  const runRateForecast = useMemo(
    () =>
      calculateBudgetRunRateForecast({
        periodMonth,
        actualMonthRevenue,
        plannedRevenueGoal: revGoalRow?.target.plannedAmount,
      }),
    [periodMonth, actualMonthRevenue, revGoalRow?.target.plannedAmount],
  )

  const handlePrefillRow = (target: BudgetTarget) => {
    setKind(target.kind)
    if (target.kind === 'expense_cap') {
      setCategoryCode(target.categoryCode)
    }
    setPlannedAmount(String(target.plannedAmount))
    setNote(target.note ?? '')
  }

  const handleSaveTarget = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.upsertBudgetTarget({
          periodMonth,
          kind,
          categoryCode:
            kind === 'revenue_goal' ? 'global_revenue' : categoryCode,
          plannedAmount: Number(plannedAmount),
          note,
        }),
      )
      setPlannedAmount('')
      setNote('')
      toast.success('Objectif / plafond budgétaire enregistré.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur budget.')
    } finally {
      setBusy(false)
    }
  }

  const handleCopyPreviousMonth = async () => {
    setBusy(true)
    try {
      const copied = await mutate((repo) =>
        repo.copyBudgetFromMonth(previousMonth, periodMonth),
      )
      if (copied > 0) {
        toast.success(
          `${copied} ligne(s) budgétaire(s) reconduite(s) depuis ${previousMonth}.`,
        )
      } else {
        toast.warning(
          'Toutes les lignes du mois précédent étaient déjà configurées sur ce mois.',
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Copie impossible.')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await mutate((repo) => repo.deleteBudgetTarget(deleteTarget.id))
      setDeleteTarget(null)
      toast.success('Ligne budgétaire retirée.')
    } catch (err) {
      setDeleteTarget(null)
      toast.error(err instanceof Error ? err.message : 'Suppression refusée.')
    } finally {
      setBusy(false)
    }
  }

  const handleExportCSV = () => {
    downloadCsvFile(
      `budget-${periodMonth}.csv`,
      [
        'Mois',
        'Nature',
        'Catégorie',
        'Montant prévu FCFA',
        'Montant réel FCFA',
        'Écart FCFA',
        'Taux %',
        'Statut',
      ],
      rows.map((r) => [
        periodMonth,
        r.target.kind === 'revenue_goal' ? 'Objectif CA' : 'Plafond dépense',
        r.target.kind === 'revenue_goal'
          ? 'Chiffre d’affaires global'
          : categoryLabel('expense', r.target.categoryCode),
        r.target.plannedAmount,
        r.actualAmount,
        r.varianceAmount,
        r.utilizationPercent,
        r.isOverBudget ? 'Dépassement' : 'Conforme',
      ]),
    )
    toast.success(`Budget ${periodMonth} exporté en CSV.`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div
        className="print-only"
        style={{
          borderBottom: '2px solid #111827',
          paddingBottom: 10,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>
          {state.salon.name} — SUIVI BUDGÉTAIRE ({periodMonth})
        </div>
        <div style={{ fontSize: '0.8rem', color: '#4b5563' }}>
          {state.salon.address} · Tél : {state.salon.phone}
        </div>
      </div>

      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Budget mensuel et objectifs</h1>
          <p className="page-subtitle">
            Comparaison automatique entre objectifs prévus et réalisations
            comptables en FCFA
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <FieldLabel htmlFor="bud-month">Mois :</FieldLabel>
          <Input
            id="bud-month"
            type="month"
            style={{ width: 168 }}
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void handleCopyPreviousMonth()}
            title={`Reconduire les plafonds de ${previousMonth}`}
          >
            <Copy size={14} />
            Copier {previousMonth}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={rows.length === 0}
            onClick={handleExportCSV}
          >
            <Download size={14} />
            CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
          >
            <Printer size={14} />
            Imprimer
          </Button>
        </div>
      </div>

      <section className="kpi-grid">
        <KpiCard
          label="Objectif de CA"
          value={
            revGoalRow
              ? formatFCFA(revGoalRow.target.plannedAmount)
              : 'Non défini'
          }
          icon={<Target size={18} />}
          tone="blue"
          subtitle={`Mois ${periodMonth}`}
        />
        <KpiCard
          label="CA réel enregistré"
          value={formatFCFA(actualMonthRevenue)}
          icon={<TrendingUp size={18} />}
          tone="emerald"
          subtitle={
            runRateForecast.isCurrentOrPastMonth
              ? `Projection fin de mois : ${formatFCFA(runRateForecast.projectedMonthRevenue)}`
              : revGoalRow
                ? `Réalisation : ${revGoalRow.utilizationPercent}%`
                : 'Définissez un objectif de CA'
          }
        />
        <KpiCard
          label="Plafonds de dépenses cumulés"
          value={formatFCFA(totalCap)}
          icon={<Target size={18} />}
          tone="amber"
          subtitle={`Consommé sur postes suivis : ${formatFCFA(totalActualExp)}`}
        />
        <KpiCard
          label="Catégories en dépassement"
          value={String(overrunsCount)}
          icon={
            overrunsCount > 0 ? (
              <AlertTriangle size={18} />
            ) : (
              <CheckCircle2 size={18} />
            )
          }
          tone={overrunsCount > 0 ? 'danger' : 'emerald'}
          subtitle={
            overrunsCount > 0
              ? 'Plafond dépassé'
              : nearCapCount > 0
                ? `${nearCapCount} pré-alerte(s) ≥ 85%`
                : 'Plafonds respectés'
          }
        />
      </section>

      <div className="bento-mid-grid">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Suivi budgétaire ({periodMonth})</CardTitle>
          </CardHeader>
          <CardContent style={{ paddingTop: 4 }}>
            {rows.length === 0 ? (
              <EmptyState
                icon={<Target size={24} />}
                title="Aucun objectif ou plafond défini pour ce mois"
                description="Utilisez le formulaire ci-contre ou reconduisez les lignes du mois précédent."
                actionLabel={`Copier le budget de ${previousMonth}`}
                onAction={() => void handleCopyPreviousMonth()}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Poste budgétaire</TableHead>
                    <TableHead className="text-right">Réalisé / Prévu</TableHead>
                    <TableHead>Progression</TableHead>
                    <TableHead className="text-right no-print">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const isRev = r.target.kind === 'revenue_goal'
                    const title = isRev
                      ? "Objectif Chiffre d'affaires"
                      : categoryLabel('expense', r.target.categoryCode)
                    const rowProjectedAmount = isRev
                      ? runRateForecast.projectedMonthRevenue
                      : runRateForecast.elapsedDays > 0
                        ? Math.round(
                            (r.actualAmount / runRateForecast.elapsedDays) *
                              runRateForecast.daysInMonth,
                          )
                        : r.actualAmount
                    const projectedWillExceed =
                      !isRev && rowProjectedAmount > r.target.plannedAmount
                    return (
                      <TableRow key={r.target.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">
                              {title}
                            </span>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              Fin de mois estimée :{' '}
                              <strong
                                style={{
                                  color: projectedWillExceed
                                    ? 'var(--color-danger)'
                                    : 'var(--text-primary)',
                                }}
                              >
                                {formatFCFA(rowProjectedAmount)}
                              </strong>
                              {r.target.note ? ` · ${r.target.note}` : ''}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          <div className="flex flex-col items-end">
                            <span className="font-semibold">
                              {formatFCFA(r.actualAmount)}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              sur {formatFCFA(r.target.plannedAmount)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell style={{ minWidth: 165 }}>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span
                                style={{
                                  fontWeight: 700,
                                  color: r.isOverBudget
                                    ? 'var(--color-danger)'
                                    : r.isNearCap
                                      ? 'var(--color-warning)'
                                      : 'var(--text-primary)',
                                }}
                              >
                                {r.utilizationPercent}%
                              </span>
                              <Badge
                                variant={
                                  r.isOverBudget
                                    ? 'destructive-light'
                                    : r.isNearCap
                                      ? 'warning-light'
                                      : 'success-light'
                                }
                                size="sm"
                              >
                                {r.isOverBudget
                                  ? 'Dépassement'
                                  : r.isNearCap
                                    ? 'Pré-alerte ≥ 85%'
                                    : 'Conforme'}
                              </Badge>
                            </div>
                            <Progress
                              value={Math.min(100, r.utilizationPercent)}
                              variant={
                                r.isOverBudget ? 'destructive' : 'default'
                              }
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right no-print">
                          <div className="inline-flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7"
                              title="Modifier ce montant prévu"
                              aria-label={`Modifier ${title}`}
                              onClick={() => handlePrefillRow(r.target)}
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
                              title="Retirer cette ligne budgétaire"
                              aria-label={`Supprimer ${title}`}
                              onClick={() => setDeleteTarget(r.target)}
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

        <Card className="no-print">
          <CardHeader className="border-b">
            <CardTitle>
              Définir un objectif ou plafond ({periodMonth})
            </CardTitle>
            <CardDescription>
              Créer ou mettre à jour une ligne budgétaire
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="w-full" onSubmit={(e) => void handleSaveTarget(e)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="f-bud-kind">Type de cible</FieldLabel>
                  <Select
                    value={kind}
                    onValueChange={(v) =>
                      setKind(v as 'revenue_goal' | 'expense_cap')
                    }
                  >
                    <SelectTrigger id="f-bud-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense_cap">
                        Plafond de dépense par catégorie
                      </SelectItem>
                      <SelectItem value="revenue_goal">
                        Objectif mensuel de chiffre d&apos;affaires
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {kind === 'expense_cap' && (
                  <Field>
                    <FieldLabel htmlFor="f-bud-cat">
                      Catégorie de dépense
                    </FieldLabel>
                    <Select
                      value={categoryCode}
                      onValueChange={setCategoryCode}
                    >
                      <SelectTrigger id="f-bud-cat">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {expenseCategories.map((c) => (
                          <SelectItem key={c.code} value={c.code}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}

                <Field>
                  <FieldLabel htmlFor="f-bud-amt">
                    Montant prévu (FCFA)
                  </FieldLabel>
                  <Input
                    id="f-bud-amt"
                    type="number"
                    min={1}
                    step={1}
                    required
                    placeholder="Ex. 150000"
                    value={plannedAmount}
                    onChange={(e) => setPlannedAmount(e.target.value)}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="f-bud-note">Note (optionnel)</FieldLabel>
                  <Input
                    id="f-bud-note"
                    type="text"
                    placeholder="Observation budgétaire"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>

                <div className="flex justify-end pt-4">
                  <Button type="submit" className="w-full" disabled={busy}>
                    <Plus size={15} />
                    Enregistrer au budget {periodMonth}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Retirer cette ligne budgétaire ?"
        message={
          deleteTarget
            ? `La ligne budgétaire (${formatFCFA(deleteTarget.plannedAmount)}) sur le mois ${deleteTarget.periodMonth} sera retirée.`
            : ''
        }
        confirmLabel="Retirer"
        busy={busy}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
