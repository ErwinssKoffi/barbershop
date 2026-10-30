import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  ChevronDownIcon,
  ExternalLinkIcon,
  FileBarChart2,
  MoreHorizontalIcon,
  Receipt,
  SettingsIcon,
  Target,
  TrendingUp,
  Unlock,
  Wallet,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/input'
import { KpiCard } from '@/components/ui/KpiCard'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useCashSession } from '../../contexts/cashSessionContext'
import { usePeriodFilter } from '../../contexts/periodFilterContext'
import { useQuickAction } from '../../contexts/quickActionContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import {
  buildDashboardAlerts,
  calculateBudgetComparisons,
  calculateCashSessionSummary,
  calculateEmployeePayrollStatus,
  calculateEstimatedResult,
  calculateExpenseMetrics,
  calculateRevenueMetrics,
} from '../../domain/calculations/finance'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import {
  computeEvolutionPercent,
  formatDateFR,
  formatFCFA,
  isIsoInBounds,
  todayISO,
} from '../../utils/format'

const PIE_COLORS = [
  '#15803d',
  '#0891b2',
  '#2563eb',
  '#d97706',
  '#7c3aed',
  '#e11d48',
]

export function DashboardPage() {
  const { state, categoryLabel, mutate } = useSalonStore()
  const {
    preset,
    customStart,
    customEnd,
    bounds,
    prevBounds,
    periodLabel,
    setPreset,
    setCustomRange,
  } = usePeriodFilter()
  const { openSession, openQuickCashModal } = useCashSession()
  const { openReceiptModal, openCheckoutTicket } = useQuickAction()
  const { navigateToEntity } = useWorkspaceFocus()
  const toast = useToast()

  const [today] = useState<string>(() => todayISO())
  const [isBudgetOpen, setIsBudgetOpen] = useState(false)
  const navigate = useNavigate()

  const dashboardTabValue =
    preset === 'today' ||
    preset === '7d' ||
    preset === 'month' ||
    preset === 'custom'
      ? preset
      : 'month'

  const periodData = useMemo(() => {
    const curRevs = state.revenues.filter(
      (r) => !r.isArchived && isIsoInBounds(r.date, bounds),
    )
    const prevRevs = prevBounds
      ? state.revenues.filter(
          (r) => !r.isArchived && isIsoInBounds(r.date, prevBounds),
        )
      : []

    const curExps = state.expenses.filter(
      (e) => !e.isArchived && isIsoInBounds(e.date, bounds),
    )
    const prevExps = prevBounds
      ? state.expenses.filter(
          (e) => !e.isArchived && isIsoInBounds(e.date, prevBounds),
        )
      : []

    const curMovs = state.stockMovements.filter((m) =>
      isIsoInBounds(m.occurredAt, bounds),
    )
    const prevMovs = prevBounds
      ? state.stockMovements.filter((m) =>
          isIsoInBounds(m.occurredAt, prevBounds),
        )
      : []

    const revMetrics = calculateRevenueMetrics(curRevs)
    const expMetrics = calculateExpenseMetrics(curExps)

    const estResult = calculateEstimatedResult({
      revenues: curRevs,
      expenses: curExps,
      stockMovements: curMovs,
    })
    const prevEstResult = calculateEstimatedResult({
      revenues: prevRevs,
      expenses: prevExps,
      stockMovements: prevMovs,
    })

    const hasPrevData = prevRevs.length > 0 || prevExps.length > 0

    return {
      curRevs,
      curExps,
      revMetrics,
      expMetrics,
      estResult,
      evolCA: computeEvolutionPercent(
        estResult.chiffreAffaires,
        prevEstResult.chiffreAffaires,
        hasPrevData,
      ),
      evolExp: computeEvolutionPercent(
        estResult.decaissements,
        prevEstResult.decaissements,
        hasPrevData,
      ),
      evolProfit: computeEvolutionPercent(
        estResult.resultatEstime,
        prevEstResult.resultatEstime,
        hasPrevData && prevEstResult.resultatEstime > 0,
      ),
    }
  }, [
    state.revenues,
    state.expenses,
    state.stockMovements,
    bounds,
    prevBounds,
  ])

  const cashBalance = useMemo(() => {
    if (state.cashSessions.length === 0) return 0
    const sorted = [...state.cashSessions].sort((a, b) =>
      b.openedAt.localeCompare(a.openedAt),
    )
    const latest = sorted[0]
    if (
      latest.status === 'closed' &&
      latest.countedClosingBalance !== undefined
    ) {
      return latest.countedClosingBalance
    }
    const mvs = state.cashMovements.filter((m) => m.sessionId === latest.id)
    return calculateCashSessionSummary(latest.openingBalance, mvs)
      .theoreticalBalance
  }, [state.cashSessions, state.cashMovements])

  // Graphique 1 : Recettes vs dépenses par jour
  const dailyChartData = useMemo(() => {
    const map = new Map<
      string,
      { date: string; label: string; recettes: number; depenses: number }
    >()

    const endDt = bounds.end ?? new Date(`${today}T23:59:59`)
    const startDt =
      bounds.start ?? new Date(endDt.getTime() - 13 * 86_400_000)
    const diffDays = Math.min(
      30,
      Math.max(
        0,
        Math.round((endDt.getTime() - startDt.getTime()) / 86_400_000),
      ),
    )

    for (let i = Math.max(0, diffDays - 13); i <= diffDays; i++) {
      const d = new Date(startDt.getTime() + i * 86_400_000)
      const iso = todayISO(d)
      map.set(iso, {
        date: iso,
        label: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
        recettes: 0,
        depenses: 0,
      })
    }

    for (const r of periodData.curRevs) {
      const iso = r.date.slice(0, 10)
      const row = map.get(iso) ?? {
        date: iso,
        label: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
        recettes: 0,
        depenses: 0,
      }
      row.recettes += r.amount
      map.set(iso, row)
    }

    for (const e of periodData.curExps) {
      const iso = e.date.slice(0, 10)
      const row = map.get(iso) ?? {
        date: iso,
        label: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
        recettes: 0,
        depenses: 0,
      }
      row.depenses += e.amount
      map.set(iso, row)
    }

    return Array.from(map.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    )
  }, [bounds, periodData.curRevs, periodData.curExps, today])

  // Graphique 2 : Répartition des dépenses par catégorie
  const expensePieData = useMemo(() => {
    return Object.entries(periodData.expMetrics.byCategory)
      .map(([code, value]) => ({
        name: categoryLabel('expense', code),
        value,
      }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [periodData.expMetrics.byCategory, categoryLabel])

  // Graphique 3 : Évolution mensuelle du bénéfice estimé (6 derniers mois)
  const monthlyProfitChartData = useMemo(() => {
    const months: string[] = []
    const [y, m] = today.slice(0, 7).split('-').map(Number)
    for (let offset = 5; offset >= 0; offset--) {
      const dt = new Date(Date.UTC(y, m - 1 - offset, 1))
      months.push(dt.toISOString().slice(0, 7))
    }

    const monthShort = [
      'Jan',
      'Fév',
      'Mar',
      'Avr',
      'Mai',
      'Juin',
      'Juil',
      'Août',
      'Sep',
      'Oct',
      'Nov',
      'Déc',
    ]

    return months.map((ym) => {
      const revs = state.revenues.filter(
        (r) => !r.isArchived && r.date.slice(0, 7) === ym,
      )
      const exps = state.expenses.filter(
        (e) => !e.isArchived && e.date.slice(0, 7) === ym,
      )
      const movs = state.stockMovements.filter(
        (mv) => mv.occurredAt.slice(0, 7) === ym,
      )
      const res = calculateEstimatedResult({
        revenues: revs,
        expenses: exps,
        stockMovements: movs,
      })
      const mm = Number(ym.slice(5, 7)) - 1
      return {
        month: `${monthShort[mm]} ${ym.slice(2, 4)}`,
        benefice: res.resultatEstime,
      }
    })
  }, [state.revenues, state.expenses, state.stockMovements, today])

  const recentOperations = useMemo(() => {
    const items = [
      ...state.revenues
        .filter((r) => !r.isArchived)
        .map((r) => ({
          id: r.id,
          date: r.date,
          createdAt: r.createdAt,
          kind: 'Recette' as const,
          label: r.label,
          category: categoryLabel('revenue', r.categoryCode),
          method: categoryLabel('payment_method', r.paymentMethod),
          amount: r.amount,
        })),
      ...state.expenses
        .filter((e) => !e.isArchived)
        .map((e) => ({
          id: e.id,
          date: e.date,
          createdAt: e.createdAt,
          kind: 'Dépense' as const,
          label: e.label,
          category: categoryLabel('expense', e.categoryCode),
          method: categoryLabel('payment_method', e.paymentMethod),
          amount: -e.amount,
        })),
    ]
    return items
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, 8)
  }, [state.revenues, state.expenses, categoryLabel])

  const budgetSummary = useMemo(() => {
    const ym = today.slice(0, 7)
    const rows = calculateBudgetComparisons({
      periodMonth: ym,
      budgets: state.budgets,
      revenues: state.revenues,
      expenses: state.expenses,
    })
    const revGoal = rows.find((r) => r.target.kind === 'revenue_goal') ?? null
    const expCaps = rows.filter((r) => r.target.kind === 'expense_cap')
    const overruns = expCaps.filter((r) => r.isOverBudget).length
    return { ym, rows, revGoal, expCaps, capsCount: expCaps.length, overruns }
  }, [today, state.budgets, state.revenues, state.expenses])

  const alerts = useMemo(() => {
    const ym = today.slice(0, 7)
    const activeExps = state.expenses.filter((e) => !e.isArchived)
    const monthRevs = state.revenues.filter(
      (r) => !r.isArchived && r.date.slice(0, 7) === ym,
    )
    const payrollStatuses = state.employees.map((employee) =>
      calculateEmployeePayrollStatus({
        employee,
        periodMonth: ym,
        periodRevenues: monthRevs,
        advances: state.advances,
        bonuses: state.bonuses,
        salaryPayments: state.salaryPayments,
        servicesCatalog: state.services,
      }),
    )
    return buildDashboardAlerts({
      cashSessions: state.cashSessions,
      products: state.products,
      payrollStatuses,
      periodExpenses: periodData.curExps,
      budgets: state.budgets,
      periodRevenues: monthRevs,
      recurringExpenses: state.recurringExpenses,
      allExpenses: activeExps,
      lastBackupExportedAt: state.settings.lastBackupExportedAt,
      todayDateISO: today,
    })
  }, [
    today,
    state.revenues,
    state.expenses,
    state.employees,
    state.advances,
    state.bonuses,
    state.salaryPayments,
    state.cashSessions,
    state.products,
    state.budgets,
    state.settings.lastBackupExportedAt,
      state.recurringExpenses,
      state.services,
      periodData.curExps,
    ])

  const handleQuickBackupExport = async () => {
    try {
      const payload = await mutate((repo) => repo.exportBackupPayload())
      const json = JSON.stringify(payload, null, 2)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `salon-pro-sauvegarde-${today}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success('Sauvegarde JSON locale exportée avec succès.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export impossible.')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tableau de bord</h1>
          <p className="page-subtitle">
            {state.salon.name ? <>{state.salon.name} · </> : null}
            <strong>{periodLabel}</strong>
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
          <Tabs
            value={dashboardTabValue}
            onValueChange={(v) => setPreset(v as typeof dashboardTabValue)}
            style={{ width: 'auto' }}
          >
            <TabsList aria-label="Période">
              {(
                [
                  { id: 'today', label: "Aujourd'hui" },
                  { id: '7d', label: '7 jours' },
                  { id: 'month', label: 'Ce mois' },
                  { id: 'custom', label: 'Personnalisée' },
                ] as const
              ).map((opt) => (
                <TabsTrigger key={opt.id} value={opt.id}>
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {preset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Input
                type="date"
                style={{ width: 142 }}
                value={customStart}
                onChange={(e) => setCustomRange(e.target.value, customEnd)}
                aria-label="Date de début"
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                au
              </span>
              <Input
                type="date"
                style={{ width: 142 }}
                value={customEnd}
                onChange={(e) => setCustomRange(customStart, e.target.value)}
                aria-label="Date de fin"
              />
            </div>
          )}
        </div>
      </div>

      {/* 4 Indicateurs financiers essentiels sur 1 ligne (@reui/c-card-15 + Sparkline) */}
      <section
        className="kpi-grid"
        aria-label="Indicateurs financiers principaux"
      >
        <KpiCard
          label="Chiffre d'affaires"
          value={formatFCFA(periodData.estResult.chiffreAffaires)}
          icon={<ArrowUpCircle size={18} />}
          tone="emerald"
          evolutionPercent={periodData.evolCA}
          sparkId="spark-ca"
          sparkValues={dailyChartData.map((d) => d.recettes)}
          menuActions={[
            {
              label: 'Ouvrir les recettes',
              icon: <ExternalLinkIcon aria-hidden="true" />,
              onSelect: () => navigate('/revenue'),
            },
            {
              label: 'Rapport des recettes',
              icon: <FileBarChart2 aria-hidden="true" />,
              onSelect: () => navigate('/reports'),
            },
          ]}
        />
        <KpiCard
          label="Dépenses totales"
          value={formatFCFA(periodData.estResult.decaissements)}
          icon={<ArrowDownCircle size={18} />}
          tone="amber"
          evolutionPercent={periodData.evolExp}
          invertEvolutionColor
          sparkId="spark-exp"
          sparkValues={dailyChartData.map((d) => d.depenses)}
          menuActions={[
            {
              label: 'Gérer les dépenses',
              icon: <ExternalLinkIcon aria-hidden="true" />,
              onSelect: () => navigate('/expenses'),
            },
            {
              label: 'Plafonds budgétaires',
              icon: <Target aria-hidden="true" />,
              onSelect: () => navigate('/budget'),
            },
          ]}
        />
        <KpiCard
          label="Bénéfice estimé"
          value={formatFCFA(periodData.estResult.resultatEstime)}
          icon={<TrendingUp size={18} />}
          tone={
            periodData.estResult.resultatEstime >= 0 ? 'emerald' : 'danger'
          }
          evolutionPercent={periodData.evolProfit}
          subtitle="CA − charges op. − stock sorti"
          menuActions={[
            {
              label: 'Compte de résultat estimé',
              icon: <FileBarChart2 aria-hidden="true" />,
              onSelect: () => navigate('/reports'),
            },
          ]}
        />
        <KpiCard
          label="Solde de caisse espèces"
          value={formatFCFA(cashBalance)}
          icon={<Wallet size={18} />}
          tone="teal"
          subtitle={openSession ? 'Session ouverte' : 'Dernier solde clôturé'}
          sparkId="spark-cash"
          sparkValues={[
            Math.max(0, cashBalance - 15000),
            Math.max(0, cashBalance - 8000),
            cashBalance,
          ]}
          menuActions={[
            ...(openSession
              ? []
              : [
                  {
                    label: 'Ouvrir la caisse maintenant',
                    icon: <Unlock aria-hidden="true" />,
                    onSelect: openQuickCashModal,
                  },
                ]),
            {
              label: 'Gérer la caisse espèces',
              icon: <Wallet aria-hidden="true" />,
              onSelect: () => navigate('/cash'),
            },
          ]}
        />
      </section>

      {/* Graphiques 1 & 2 (@reui/c-card-2 & @reui/c-card-6) */}
      <section className="bento-mid-grid">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Recettes vs Dépenses par jour</CardTitle>
            <CardDescription>
              Comparaison quotidienne des flux en FCFA ({periodLabel})
            </CardDescription>
            <CardAction>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Actions du graphique des flux"
                    >
                      <MoreHorizontalIcon aria-hidden="true" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Accès rapide</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigate('/revenue')}>
                      <ArrowUpCircle aria-hidden="true" />
                      <span>Journal des recettes</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate('/expenses')}>
                      <ArrowDownCircle aria-hidden="true" />
                      <span>Journal des dépenses</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigate('/reports')}>
                      <FileBarChart2 aria-hidden="true" />
                      <span>États imprimables A4</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={dailyChartData}
                  margin={{ top: 8, right: 10, left: -12, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#10b981"
                        stopOpacity={0.25}
                      />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="#ef4444"
                        stopOpacity={0.18}
                      />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border-subtle)"
                  />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
                    }
                  />
                  <Tooltip
                    formatter={(val, name) => [
                      formatFCFA(Number(val ?? 0)),
                      name === 'recettes' ? 'Recettes' : 'Dépenses',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="recettes"
                    stroke="#10b981"
                    strokeWidth={2.2}
                    fill="url(#revGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="depenses"
                    stroke="#ef4444"
                    strokeWidth={2}
                    fill="url(#expGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Dépenses par catégorie</CardTitle>
            <CardDescription>
              Répartition des charges ({periodLabel})
            </CardDescription>
          </CardHeader>
          <CardContent>
            {expensePieData.length === 0 ? (
              <div
                style={{
                  padding: '32px 12px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.84rem',
                }}
              >
                Aucune dépense enregistrée sur cette période.
              </div>
            ) : (
              <>
                <div
                  style={{ width: '100%', height: 175, position: 'relative' }}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expensePieData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={50}
                        outerRadius={74}
                        paddingAngle={3}
                        stroke="none"
                      >
                        {expensePieData.map((entry, idx) => (
                          <Cell
                            key={entry.name}
                            fill={PIE_COLORS[idx % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => formatFCFA(Number(v ?? 0))} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'none',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.66rem',
                        color: 'var(--text-muted)',
                        fontWeight: 600,
                      }}
                    >
                      Total
                    </span>
                    <span
                      className="tabular-nums"
                      style={{ fontSize: '0.78rem', fontWeight: 700 }}
                    >
                      {formatFCFA(periodData.expMetrics.totalDisbursed)}
                    </span>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    marginTop: 6,
                  }}
                >
                  {expensePieData.map((item, idx) => (
                    <div
                      key={item.name}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.78rem',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: PIE_COLORS[idx % PIE_COLORS.length],
                          }}
                        />
                        {item.name}
                      </span>
                      <span className="tabular-nums" style={{ fontWeight: 600 }}>
                        {formatFCFA(item.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Graphique 3 + Alertes & Cycle Budgétaire (@reui/c-card-13) */}
      <section className="bento-mid-grid">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Évolution mensuelle du bénéfice estimé</CardTitle>
            <CardDescription>
              6 derniers mois · CA moins charges opérationnelles et produits
              consommés
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyProfitChartData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border-subtle)"
                  />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      Math.abs(v) >= 1000
                        ? `${Math.round(v / 1000)}k`
                        : `${v}`
                    }
                  />
                  <Tooltip
                    formatter={(val) => [
                      formatFCFA(Number(val ?? 0)),
                      'Bénéfice estimé',
                    ]}
                  />
                  <Bar
                    dataKey="benefice"
                    fill="#15803d"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle>Alertes et rappels</CardTitle>
              <CardDescription>
                Points d&apos;attention administratifs et financiers
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '14px',
                    borderRadius: 10,
                    background: 'var(--color-success-bg)',
                    color: 'var(--color-success)',
                    fontSize: '0.84rem',
                    fontWeight: 500,
                  }}
                >
                  <CheckCircle2 size={18} />
                  Tout est à jour : aucune alerte de caisse, stock ou salaire.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {alerts.map((al) => (
                    <div
                      key={al.id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '11px 12px',
                        borderRadius: 10,
                        border: '1px solid var(--border-subtle)',
                        background:
                          al.severity === 'danger'
                            ? 'var(--color-danger-bg)'
                            : 'var(--color-warning-bg)',
                      }}
                    >
                      <Link
                        to={al.route}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          flex: 1,
                        }}
                      >
                        <AlertTriangle
                          size={17}
                          color={
                            al.severity === 'danger'
                              ? 'var(--color-danger)'
                              : 'var(--color-warning)'
                          }
                          style={{ flexShrink: 0, marginTop: 2 }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.83rem' }}>
                            {al.title}
                          </div>
                          <div
                            style={{
                              fontSize: '0.77rem',
                              color: 'var(--text-secondary)',
                              marginTop: 2,
                            }}
                          >
                            {al.description}
                          </div>
                        </div>
                      </Link>
                      {al.actionKind === 'export_backup' && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => void handleQuickBackupExport()}
                        >
                          Exporter JSON
                        </Button>
                      )}
                      {al.id.startsWith('alert-cash-') && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => navigate('/cash')}
                        >
                          <Unlock size={12} />
                          Caisse
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Carte Objectif Mensuel extensible (@reui/c-card-13) */}
          <Card
            className={cn(
              'relative w-full gap-4 overflow-visible',
              budgetSummary.expCaps.length > 0 && 'pb-1',
            )}
            style={
              budgetSummary.expCaps.length > 0 ? { marginBottom: 10 } : undefined
            }
          >
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Target size={16} color="var(--accent-emerald)" />
                <span>Objectif mensuel ({budgetSummary.ym})</span>
              </CardTitle>
              <CardAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/budget')}
                >
                  Gérer le budget
                </Button>
              </CardAction>
            </CardHeader>

            <CardContent
              className={cn(
                'relative space-y-3 overflow-hidden transition-all',
                budgetSummary.expCaps.length > 0
                  ? isBudgetOpen
                    ? 'max-h-[500px]'
                    : 'max-h-48'
                  : undefined,
              )}
            >
              <div className="bg-muted/60 rounded-lg space-y-2.5 p-4">
                <div className="text-muted-foreground flex justify-between text-xs font-medium">
                  <span>Chiffre d&apos;affaires réalisé / cible</span>
                  <span>Taux d&apos;atteinte</span>
                </div>
                {budgetSummary.revGoal ? (
                  <>
                    <div className="flex justify-between text-sm font-bold tabular-nums">
                      <span>
                        {formatFCFA(budgetSummary.revGoal.actualAmount)} /{' '}
                        {formatFCFA(budgetSummary.revGoal.target.plannedAmount)}
                      </span>
                      <span>{budgetSummary.revGoal.utilizationPercent}%</span>
                    </div>
                    <Progress
                      value={Math.min(
                        100,
                        budgetSummary.revGoal.utilizationPercent,
                      )}
                      className="h-2"
                    />
                  </>
                ) : (
                  <div className="text-muted-foreground text-xs">
                    Aucun objectif de CA configuré pour ce mois.
                  </div>
                )}
              </div>

              {budgetSummary.capsCount > 0 && (
                <div className="flex flex-col gap-2.5">
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color:
                        budgetSummary.overruns > 0
                          ? 'var(--color-danger)'
                          : 'var(--text-muted)',
                      fontWeight: budgetSummary.overruns > 0 ? 600 : 500,
                    }}
                  >
                    {budgetSummary.overruns > 0
                      ? `${budgetSummary.overruns} plafond(s) de dépense dépassé(s) sur ${budgetSummary.capsCount}.`
                      : `${budgetSummary.capsCount} plafond(s) de dépense suivis — tous respectés.`}
                  </div>

                  {budgetSummary.expCaps.map((cap) => (
                    <div
                      key={cap.target.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-foreground font-medium">
                        {categoryLabel('expense', cap.target.categoryCode)}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatFCFA(cap.actualAmount)} /{' '}
                        {formatFCFA(cap.target.plannedAmount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {budgetSummary.expCaps.length > 2 && (
                <div
                  className={cn(
                    'from-background pointer-events-none absolute inset-x-0 bottom-0 h-20 rounded-b-lg bg-linear-to-t transition-opacity',
                    isBudgetOpen ? 'opacity-0' : 'opacity-100',
                  )}
                />
              )}
            </CardContent>

            {budgetSummary.expCaps.length > 2 && (
              <div className="absolute -bottom-4 left-1/2 -translate-x-1/2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="bg-background rounded-full shadow-sm"
                  onClick={() => setIsBudgetOpen((v) => !v)}
                >
                  <ChevronDownIcon
                    aria-hidden="true"
                    className={cn(
                      'transition-transform',
                      isBudgetOpen && 'rotate-180',
                    )}
                  />
                  <span className="sr-only">
                    Afficher ou masquer les plafonds budgétaires
                  </span>
                </Button>
              </div>
            )}
          </Card>
        </div>
      </section>

      {/* Opérations récentes */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Opérations récentes</CardTitle>
          <CardDescription>
            Dernières écritures enregistrées
          </CardDescription>
          <CardAction>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate('/revenue')}
              >
                Recettes
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate('/expenses')}
              >
                Dépenses
              </Button>
            </div>
          </CardAction>
        </CardHeader>

        <CardContent style={{ paddingTop: 4 }}>
          {recentOperations.length === 0 ? (
            <EmptyState
              icon={<Wallet size={22} />}
              title="Aucune opération enregistrée"
              description="Encaissez un premier ticket client ou enregistrez une dépense pour alimenter votre tableau de bord."
              actionLabel="Nouveau ticket client"
              onAction={() => openCheckoutTicket()}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Opération</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                  <TableHead className="text-right no-print">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOperations.map((op) => (
                  <TableRow key={op.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {op.label}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatDateFR(op.date, state.settings.dateFormat)} ·{' '}
                          {op.method}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" size="sm">
                        {op.category}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="text-right text-sm font-semibold tabular-nums"
                      style={{
                        color:
                          op.amount >= 0
                            ? 'var(--color-success)'
                            : 'var(--color-danger)',
                      }}
                    >
                      {op.amount >= 0
                        ? `+${formatFCFA(op.amount)}`
                        : formatFCFA(op.amount)}
                    </TableCell>
                    <TableCell className="text-right no-print">
                      <div className="inline-flex items-center justify-end gap-1">
                        {op.kind === 'Recette' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            title="Reçu client imprimable"
                            onClick={() => openReceiptModal(op.id)}
                          >
                            <Receipt size={14} />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7"
                          onClick={() =>
                            navigateToEntity({
                              route:
                                op.kind === 'Recette'
                                  ? '/revenue'
                                  : '/expenses',
                              entityId: op.id,
                              searchQuery: op.label,
                            })
                          }
                        >
                          <SettingsIcon
                            className="size-3.5"
                            aria-hidden="true"
                          />
                          Gérer
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
