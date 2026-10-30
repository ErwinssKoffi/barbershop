import type {
  AdvanceEntry,
  BonusEntry,
  BudgetTarget,
  CashMovement,
  CashSession,
  Employee,
  ExpenseEntry,
  ProductItem,
  RecurringExpenseTemplate,
  RevenueEntry,
  SalaryPayment,
  StockMovement,
} from '../models'
import { toIntFCFA } from '../../utils/format'

export const FCFA_DENOMINATIONS = [
  10000, 5000, 2000, 1000, 500, 250, 200, 100, 50, 25,
] as const

/**
 * Calcule le total d'un billetage FCFA à partir du nombre de coupures / pièces.
 */
export function calculateDenominationTotal(
  counts: Record<string, number>,
): number {
  let total = 0
  for (const denom of FCFA_DENOMINATIONS) {
    const qty = Math.max(0, Math.floor(Number(counts[String(denom)] ?? 0)))
    if (Number.isFinite(qty) && qty > 0) {
      total += denom * qty
    }
  }
  return toIntFCFA(total)
}

/**
 * Calcule le Coût Unitaire Moyen Pondéré (CUMP) en FCFA entier lors d'un réapprovisionnement.
 */
export function calculateCUMP(
  currentQty: number,
  currentCost: number,
  addedQty: number,
  addedUnitCost: number,
): number {
  const safeAddedCost = toIntFCFA(addedUnitCost)
  const safeAddedQty = Math.max(0, Math.floor(addedQty))
  const safeCurrentQty = Math.max(0, Math.floor(currentQty))
  const safeCurrentCost = toIntFCFA(currentCost)

  if (safeAddedQty <= 0) {
    return safeCurrentCost
  }
  if (safeCurrentQty <= 0) {
    return safeAddedCost
  }
  const totalValue =
    safeCurrentQty * safeCurrentCost + safeAddedQty * safeAddedCost
  return toIntFCFA(Math.round(totalValue / (safeCurrentQty + safeAddedQty)))
}

export interface CashSessionSummary {
  openingBalance: number
  totalIn: number
  totalOut: number
  theoreticalBalance: number
}

/**
 * Calcule le solde théorique d'une session de caisse espèces.
 * Règle Section 7 & 20 : seuls les mouvements espèces (`CashMovement`) impactent le tiroir-caisse.
 */
export function calculateCashSessionSummary(
  openingBalance: number,
  movements: CashMovement[],
): CashSessionSummary {
  const opening = toIntFCFA(openingBalance)
  let totalIn = 0
  let totalOut = 0

  for (const mv of movements) {
    const amt = toIntFCFA(mv.amount)
    if (mv.type === 'in' || mv.type === 'correction_in') {
      totalIn += amt
    } else if (mv.type === 'out' || mv.type === 'correction_out') {
      totalOut += amt
    }
  }

  return {
    openingBalance: opening,
    totalIn,
    totalOut,
    theoreticalBalance: opening + totalIn - totalOut,
  }
}

export interface RevenueMetrics {
  totalRevenue: number
  count: number
  byPaymentMethod: Record<string, number>
  byCategory: Record<string, number>
}

export function calculateRevenueMetrics(
  revenues: RevenueEntry[],
): RevenueMetrics {
  const active = revenues.filter((r) => !r.isArchived)
  let totalRevenue = 0
  const byPaymentMethod: Record<string, number> = {}
  const byCategory: Record<string, number> = {}

  for (const r of active) {
    const amt = toIntFCFA(r.amount)
    totalRevenue += amt
    if (r.paymentSplits && r.paymentSplits.length > 0) {
      for (const sp of r.paymentSplits) {
        const spAmt = toIntFCFA(sp.amount)
        byPaymentMethod[sp.method] =
          (byPaymentMethod[sp.method] ?? 0) + spAmt
      }
    } else {
      byPaymentMethod[r.paymentMethod] =
        (byPaymentMethod[r.paymentMethod] ?? 0) + amt
    }
    byCategory[r.categoryCode] = (byCategory[r.categoryCode] ?? 0) + amt
  }

  return {
    totalRevenue,
    count: active.length,
    byPaymentMethod,
    byCategory,
  }
}

export interface ExpenseMetrics {
  /** Total réellement décaissé sur la période (inclut achats de stock et salaires versés) */
  totalDisbursed: number
  /** Charges comptabilisées hors achats de stock suivis en inventaire */
  operatingCharges: number
  /** Montant consacré à l'achat de stock inventorié */
  stockPurchasesTotal: number
  /** Total des écritures générées par le module Paie (salaires + avances) */
  payrollDisbursedTotal: number
  count: number
  byCategory: Record<string, number>
  byPaymentMethod: Record<string, number>
}

export function calculateExpenseMetrics(
  expenses: ExpenseEntry[],
): ExpenseMetrics {
  const active = expenses.filter((e) => !e.isArchived)
  let totalDisbursed = 0
  let operatingCharges = 0
  let stockPurchasesTotal = 0
  let payrollDisbursedTotal = 0
  const byCategory: Record<string, number> = {}
  const byPaymentMethod: Record<string, number> = {}

  for (const e of active) {
    const amt = toIntFCFA(e.amount)
    totalDisbursed += amt
    byCategory[e.categoryCode] = (byCategory[e.categoryCode] ?? 0) + amt
    byPaymentMethod[e.paymentMethod] =
      (byPaymentMethod[e.paymentMethod] ?? 0) + amt

    if (e.isStockPurchase) {
      stockPurchasesTotal += amt
    } else {
      operatingCharges += amt
    }

    if (e.sourceModule === 'payroll') {
      payrollDisbursedTotal += amt
    }
  }

  return {
    totalDisbursed,
    operatingCharges,
    stockPurchasesTotal,
    payrollDisbursedTotal,
    count: active.length,
    byCategory,
    byPaymentMethod,
  }
}

export interface PaymentMethodReconciliationRow {
  method: string
  totalIn: number
  totalOut: number
  netFlow: number
  inCount: number
  outCount: number
}

/**
 * Rapprochement complet par mode de paiement (Espèces, Wave, Orange Money, MTN MoMo, Carte, Virement...).
 * Gère également les tickets en paiement mixte (`paymentSplits`).
 */
export function calculatePaymentMethodBreakdown(
  revenues: RevenueEntry[],
  expenses: ExpenseEntry[],
): PaymentMethodReconciliationRow[] {
  const map = new Map<
    string,
    { totalIn: number; totalOut: number; inCount: number; outCount: number }
  >()

  const ensure = (method: string) => {
    let row = map.get(method)
    if (!row) {
      row = { totalIn: 0, totalOut: 0, inCount: 0, outCount: 0 }
      map.set(method, row)
    }
    return row
  }

  for (const r of revenues) {
    if (r.isArchived) continue
    if (r.paymentSplits && r.paymentSplits.length > 0) {
      for (const sp of r.paymentSplits) {
        if (sp.amount <= 0) continue
        const row = ensure(sp.method)
        row.totalIn += toIntFCFA(sp.amount)
        row.inCount += 1
      }
    } else {
      const row = ensure(r.paymentMethod)
      row.totalIn += toIntFCFA(r.amount)
      row.inCount += 1
    }
  }

  for (const e of expenses) {
    if (e.isArchived) continue
    const row = ensure(e.paymentMethod)
    row.totalOut += toIntFCFA(e.amount)
    row.outCount += 1
  }

  return Array.from(map.entries())
    .map(([method, stats]) => ({
      method,
      totalIn: stats.totalIn,
      totalOut: stats.totalOut,
      netFlow: stats.totalIn - stats.totalOut,
      inCount: stats.inCount,
      outCount: stats.outCount,
    }))
    .sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut))
}

/**
 * Coût des produits réellement sortis du stock (utilisation interne, vente client ou perte).
 * Les entrées par achat (`purchase`) ne sont PAS comptées ici pour éviter le double comptage.
 */
export function calculateConsumedStockCost(
  stockMovements: StockMovement[],
): number {
  let cost = 0
  for (const mv of stockMovements) {
    if (mv.type === 'use' || mv.type === 'sale' || mv.type === 'loss') {
      cost += Math.abs(mv.quantityDelta) * toIntFCFA(mv.unitCost)
    }
  }
  return toIntFCFA(cost)
}

export interface EstimatedResultSummary {
  chiffreAffaires: number
  encaissements: number
  decaissements: number
  fluxTresorerieNet: number
  chargesExploitationHorsStock: number
  masseSalarialePayee: number
  coutProduitsConsommesOuVendus: number
  achatsStockPeriode: number
  resultatEstime: number
  transactionsCount: number
}

/**
 * Calcule les indicateurs financiers centraux (Section 20) :
 * - Chiffre d'affaires = Recettes reconnues non archivées
 * - Décaissements = Toutes les dépenses payées (trésorerie)
 * - Résultat estimé = Recettes reconnues - Charges hors achats stock - Coût des produits sortis du stock
 */
export function calculateEstimatedResult(params: {
  revenues: RevenueEntry[]
  expenses: ExpenseEntry[]
  stockMovements: StockMovement[]
}): EstimatedResultSummary {
  const rev = calculateRevenueMetrics(params.revenues)
  const exp = calculateExpenseMetrics(params.expenses)
  const coutProduitsConsommesOuVendus = calculateConsumedStockCost(
    params.stockMovements,
  )

  const chiffreAffaires = rev.totalRevenue
  const encaissements = rev.totalRevenue
  const decaissements = exp.totalDisbursed
  const fluxTresorerieNet = encaissements - decaissements
  const chargesExploitationHorsStock = exp.operatingCharges
  const resultatEstime =
    chiffreAffaires -
    chargesExploitationHorsStock -
    coutProduitsConsommesOuVendus

  return {
    chiffreAffaires,
    encaissements,
    decaissements,
    fluxTresorerieNet,
    chargesExploitationHorsStock,
    masseSalarialePayee: exp.payrollDisbursedTotal,
    coutProduitsConsommesOuVendus,
    achatsStockPeriode: exp.stockPurchasesTotal,
    resultatEstime,
    transactionsCount: rev.count + exp.count,
  }
}

export function isProductSaleRevenue(r: RevenueEntry): boolean {
  return (
    r.categoryCode === 'product_sale' ||
    Boolean(r.productId) ||
    r.sourceModule === 'inventory_sale'
  )
}

/**
 * Calcule la commission explicite et vérifiable d'un employé sur une période (Section 12).
 * Désactivée par défaut (`commissionEnabled === false` -> 0 FCFA).
 * - `employee_services` (défaut) : prestations réalisées par l'employé (hors ventes de produits)
 * - `employee_services_and_products` : prestations + ventes de produits rattachées à l'employé
 * - `total_revenue` : chiffre d'affaires global du salon
 */
export function calculateEmployeeCommission(
  employee: Employee,
  periodRevenues: RevenueEntry[],
): { basisAmount: number; commissionAmount: number } {
  if (!employee.commissionEnabled || employee.commissionRate <= 0) {
    return { basisAmount: 0, commissionAmount: 0 }
  }

  const activeRevs = periodRevenues.filter((r) => !r.isArchived)
  const matchingRevs =
    employee.commissionBasis === 'total_revenue'
      ? activeRevs
      : employee.commissionBasis === 'employee_services_and_products'
        ? activeRevs.filter((r) => r.employeeId === employee.id)
        : activeRevs.filter(
            (r) => r.employeeId === employee.id && !isProductSaleRevenue(r),
          )

  const basisAmount = matchingRevs.reduce(
    (sum, r) => sum + toIntFCFA(r.amount),
    0,
  )
  const commissionAmount = Math.round(
    (basisAmount * employee.commissionRate) / 100,
  )

  return { basisAmount, commissionAmount }
}

export interface EmployeePerformanceSummary {
  employeeId: string
  servicesCount: number
  servicesRevenue: number
  productsSoldCount: number
  productsRevenue: number
  totalGeneratedRevenue: number
  averageTicketAmount: number
  commissionEarned: number
}

export function calculateEmployeePerformanceSummary(
  employee: Employee,
  periodRevenues: RevenueEntry[],
): EmployeePerformanceSummary {
  const ownRevs = periodRevenues.filter(
    (r) => !r.isArchived && r.employeeId === employee.id,
  )
  let servicesCount = 0
  let servicesRevenue = 0
  let productsSoldCount = 0
  let productsRevenue = 0

  for (const r of ownRevs) {
    const amt = toIntFCFA(r.amount)
    if (isProductSaleRevenue(r)) {
      productsSoldCount += Math.max(1, r.quantity ?? 1)
      productsRevenue += amt
    } else {
      servicesCount += Math.max(1, r.quantity ?? 1)
      servicesRevenue += amt
    }
  }

  const totalGeneratedRevenue = servicesRevenue + productsRevenue
  const averageTicketAmount =
    ownRevs.length > 0 ? Math.round(totalGeneratedRevenue / ownRevs.length) : 0
  const { commissionAmount } = calculateEmployeeCommission(
    employee,
    periodRevenues,
  )

  return {
    employeeId: employee.id,
    servicesCount,
    servicesRevenue,
    productsSoldCount,
    productsRevenue,
    totalGeneratedRevenue,
    averageTicketAmount,
    commissionEarned: commissionAmount,
  }
}

export interface EmployeePayrollStatus {
  employee: Employee
  periodMonth: string
  baseSalary: number
  bonusesTotal: number
  commissionBasisAmount: number
  commissionCalculated: number
  commissionValidatedTotal: number
  unsettledAdvances: AdvanceEntry[]
  unsettledAdvancesTotal: number
  settledAdvancesTotal: number
  deductionsTotal: number
  netPaidInValidatedPayrolls: number
  totalDisbursedToEmployee: number
  remainingToPay: number
  overAdvanceAmount: number
}

/**
 * Calcule la situation salariale mensuelle d'un employé sans jamais déduire une avance deux fois.
 */
export function calculateEmployeePayrollStatus(params: {
  employee: Employee
  periodMonth: string
  periodRevenues: RevenueEntry[]
  advances: AdvanceEntry[]
  bonuses: BonusEntry[]
  salaryPayments: SalaryPayment[]
}): EmployeePayrollStatus {
  const { employee, periodMonth } = params

  const empAdvances = params.advances.filter(
    (a) =>
      !a.isArchived &&
      a.employeeId === employee.id &&
      a.periodMonth === periodMonth,
  )
  const unsettledAdvances = empAdvances.filter((a) => !a.settledInPayrollId)
  const settledAdvances = empAdvances.filter((a) =>
    Boolean(a.settledInPayrollId),
  )

  const unsettledAdvancesTotal = unsettledAdvances.reduce(
    (s, a) => s + toIntFCFA(a.amount),
    0,
  )
  const settledAdvancesTotal = settledAdvances.reduce(
    (s, a) => s + toIntFCFA(a.amount),
    0,
  )

  const empBonuses = params.bonuses.filter(
    (b) => b.employeeId === employee.id && b.periodMonth === periodMonth,
  )
  const recordedBonuses = empBonuses.reduce(
    (s, b) => s + toIntFCFA(b.amount),
    0,
  )
  const bonusesTotal = recordedBonuses + toIntFCFA(employee.defaultBonus)

  const { basisAmount, commissionAmount } = calculateEmployeeCommission(
    employee,
    params.periodRevenues,
  )

  const empPayrolls = params.salaryPayments.filter(
    (sp) => sp.employeeId === employee.id && sp.periodMonth === periodMonth,
  )

  const netPaidInValidatedPayrolls = empPayrolls.reduce(
    (s, sp) => s + toIntFCFA(sp.netPaidAmount),
    0,
  )
  const deductionsTotal = empPayrolls.reduce(
    (s, sp) => s + toIntFCFA(sp.deductions),
    0,
  )
  const commissionValidatedTotal = empPayrolls.reduce(
    (s, sp) => s + toIntFCFA(sp.commissionValidated),
    0,
  )

  const fullPayrolls = empPayrolls.filter((sp) => !sp.isPartial)
  const effectiveCommission =
    fullPayrolls.length > 0 ? commissionValidatedTotal : commissionAmount

  const totalDueBeforeDisbursements = employee.isActive
    ? toIntFCFA(employee.baseSalary) +
      bonusesTotal +
      effectiveCommission -
      deductionsTotal
    : 0

  const totalDisbursedToEmployee =
    netPaidInValidatedPayrolls + unsettledAdvancesTotal + settledAdvancesTotal

  const rawBalance = totalDueBeforeDisbursements - totalDisbursedToEmployee
  const remainingToPay = Math.max(0, rawBalance)
  const overAdvanceAmount = rawBalance < 0 ? Math.abs(rawBalance) : 0

  return {
    employee,
    periodMonth,
    baseSalary: toIntFCFA(employee.baseSalary),
    bonusesTotal,
    commissionBasisAmount: basisAmount,
    commissionCalculated: commissionAmount,
    commissionValidatedTotal,
    unsettledAdvances,
    unsettledAdvancesTotal,
    settledAdvancesTotal,
    deductionsTotal,
    netPaidInValidatedPayrolls,
    totalDisbursedToEmployee,
    remainingToPay,
    overAdvanceAmount,
  }
}

export interface InventoryValuation {
  totalItemsCount: number
  totalUnitsCount: number
  totalStockCostValue: number
  potentialResaleValue: number
  lowStockProducts: ProductItem[]
}

export function calculateInventoryValuation(
  products: ProductItem[],
): InventoryValuation {
  const active = products.filter((p) => p.isActive)
  let totalUnitsCount = 0
  let totalStockCostValue = 0
  let potentialResaleValue = 0
  const lowStockProducts: ProductItem[] = []

  for (const p of active) {
    totalUnitsCount += p.quantity
    totalStockCostValue += p.quantity * toIntFCFA(p.costPrice)
    if (p.salePrice && p.usageType !== 'consumable') {
      potentialResaleValue += p.quantity * toIntFCFA(p.salePrice)
    }
    if (p.quantity <= p.alertThreshold) {
      lowStockProducts.push(p)
    }
  }

  return {
    totalItemsCount: active.length,
    totalUnitsCount,
    totalStockCostValue,
    potentialResaleValue,
    lowStockProducts,
  }
}

export interface BudgetComparisonRow {
  target: BudgetTarget
  actualAmount: number
  varianceAmount: number
  utilizationPercent: number
  isNearCap: boolean
  isOverBudget: boolean
}

export function calculateBudgetComparisons(params: {
  periodMonth: string
  budgets: BudgetTarget[]
  revenues: RevenueEntry[]
  expenses: ExpenseEntry[]
}): BudgetComparisonRow[] {
  const monthBudgets = params.budgets.filter(
    (b) => b.periodMonth === params.periodMonth,
  )
  const monthRevs = params.revenues.filter(
    (r) => !r.isArchived && r.date.slice(0, 7) === params.periodMonth,
  )
  const monthExps = params.expenses.filter(
    (e) => !e.isArchived && e.date.slice(0, 7) === params.periodMonth,
  )

  const totalRev = monthRevs.reduce((s, r) => s + toIntFCFA(r.amount), 0)

  return monthBudgets.map((target) => {
    const planned = Math.max(1, toIntFCFA(target.plannedAmount))
    if (target.kind === 'revenue_goal') {
      const actualAmount = totalRev
      const varianceAmount = actualAmount - target.plannedAmount
      const utilizationPercent = Math.round((actualAmount / planned) * 100)
      return {
        target,
        actualAmount,
        varianceAmount,
        utilizationPercent,
        isNearCap: false,
        isOverBudget: false,
      }
    }

    const actualAmount = monthExps
      .filter((e) => e.categoryCode === target.categoryCode)
      .reduce((s, e) => s + toIntFCFA(e.amount), 0)
    const varianceAmount = target.plannedAmount - actualAmount
    const utilizationPercent = Math.round((actualAmount / planned) * 100)
    const isOverBudget = actualAmount > target.plannedAmount
    const isNearCap = !isOverBudget && utilizationPercent >= 85

    return {
      target,
      actualAmount,
      varianceAmount,
      utilizationPercent,
      isNearCap,
      isOverBudget,
    }
  })
}

export interface BudgetRunRateForecast {
  elapsedDays: number
  daysInMonth: number
  dailyAverageRevenue: number
  projectedMonthRevenue: number
  plannedRevenueGoal: number | null
  projectedAttainmentPercent: number | null
  isCurrentOrPastMonth: boolean
}

/**
 * Calcule le rythme journalier moyen et la projection de chiffre d'affaires de fin de mois.
 */
export function calculateBudgetRunRateForecast(params: {
  periodMonth: string // YYYY-MM
  actualMonthRevenue: number
  plannedRevenueGoal?: number
  referenceDateISO?: string // YYYY-MM-DD
}): BudgetRunRateForecast {
  const ref = params.referenceDateISO ?? new Date().toISOString().slice(0, 10)
  const [yrStr, moStr] = params.periodMonth.split('-')
  const year = Number(yrStr) || 2026
  const month = Number(moStr) || 1
  const daysInMonth = new Date(year, month, 0).getDate()

  const refYm = ref.slice(0, 7)
  let elapsedDays = daysInMonth
  let isCurrentOrPastMonth = true

  if (params.periodMonth === refYm) {
    elapsedDays = Math.max(1, Math.min(daysInMonth, Number(ref.slice(8, 10)) || 1))
  } else if (params.periodMonth > refYm) {
    elapsedDays = 0
    isCurrentOrPastMonth = false
  }

  const actual = toIntFCFA(params.actualMonthRevenue)
  const dailyAverageRevenue =
    elapsedDays > 0 ? Math.round(actual / elapsedDays) : 0
  const projectedMonthRevenue =
    params.periodMonth < refYm
      ? actual
      : elapsedDays > 0
        ? dailyAverageRevenue * daysInMonth
        : 0

  const goal =
    params.plannedRevenueGoal && params.plannedRevenueGoal > 0
      ? toIntFCFA(params.plannedRevenueGoal)
      : null
  const projectedAttainmentPercent =
    goal !== null ? Math.round((projectedMonthRevenue / goal) * 100) : null

  return {
    elapsedDays,
    daysInMonth,
    dailyAverageRevenue,
    projectedMonthRevenue,
    plannedRevenueGoal: goal,
    projectedAttainmentPercent,
    isCurrentOrPastMonth,
  }
}

export interface DashboardAlertItem {
  id: string
  severity: 'danger' | 'warning' | 'info'
  title: string
  description: string
  route: string
  targetEntityId?: string
  actionKind?: 'export_backup' | 'navigate'
}

/**
 * Détecte les alertes proactives et explicables du Salon :
 * 1. Session de caisse ouverte (danger si ouverte un jour précédent = oubli de clôture)
 * 2. Sauvegarde JSON absente ou datant de > 7 jours lorsqu'il y a des données réelles
 * 3. Produits en rupture (danger) ou sous seuil d'alerte (warning)
 * 4. Plafonds budgétaires dépassés (> 100 % danger) ou proches (>= 85 % warning)
 * 5. Charges fixes mensuelles non réglées après l'échéance
 * 6. Salaires du mois en cours restant à payer
 * 7. Dépenses inhabituelles (> 2,5x la moyenne courante)
 */
export function buildDashboardAlerts(params: {
  cashSessions: CashSession[]
  products: ProductItem[]
  payrollStatuses: EmployeePayrollStatus[]
  periodExpenses: ExpenseEntry[]
  budgets?: BudgetTarget[]
  periodRevenues?: RevenueEntry[]
  recurringExpenses?: RecurringExpenseTemplate[]
  allExpenses?: ExpenseEntry[]
  lastBackupExportedAt?: string
  todayDateISO?: string
}): DashboardAlertItem[] {
  const alerts: DashboardAlertItem[] = []
  const todayStr =
    params.todayDateISO ?? new Date().toISOString().slice(0, 10)
  const currentYm = todayStr.slice(0, 7)
  const currentDayOfMonth = Number(todayStr.slice(8, 10)) || 1

  const openSession = params.cashSessions.find((s) => s.status === 'open')
  if (openSession) {
    const openedDate = openSession.openedAt.slice(0, 10)
    const isStale = openedDate < todayStr
    alerts.push({
      id: `alert-cash-${openSession.id}`,
      severity: isStale ? 'danger' : 'info',
      title: isStale
        ? `Oubli de clôture : caisse ouverte depuis le ${openedDate}`
        : 'Session de caisse ouverte (non clôturée)',
      description: isStale
        ? 'Cette session date d’un jour antérieur. Clôturez-la avec comptage espèces avant d’ouvrir la journée en cours.'
        : "N'oubliez pas d'effectuer le comptage espèces et de clôturer la caisse en fin de journée.",
      route: '/cash',
      targetEntityId: openSession.id,
    })
  }

  // Santé de la sauvegarde locale (> 7 jours) lorsqu'il existe des écritures
  const hasRealActivity =
    (params.periodRevenues ?? []).some((r) => !r.isArchived) ||
    params.periodExpenses.some((e) => !e.isArchived)

  if (hasRealActivity) {
    if (!params.lastBackupExportedAt) {
      alerts.push({
        id: 'alert-backup-never',
        severity: 'warning',
        title: 'Aucune sauvegarde JSON externe effectuée',
        description:
          'Vos données sont stockées sur cet appareil. Exportez une copie JSON de sécurité en 1 clic.',
        route: '/settings',
        actionKind: 'export_backup',
      })
    } else {
      const diffMs =
        new Date(`${todayStr}T23:59:59`).getTime() -
        new Date(params.lastBackupExportedAt).getTime()
      const daysSince = Math.floor(diffMs / 86_400_000)
      if (daysSince > 7) {
        alerts.push({
          id: 'alert-backup-stale',
          severity: 'warning',
          title: `Sauvegarde JSON ancienne (${daysSince} jours)`,
          description:
            'Pensez à exporter une sauvegarde JSON récente sur clé USB ou dossier externe.',
          route: '/settings',
          actionKind: 'export_backup',
        })
      }
    }
  }

  for (const prod of params.products) {
    if (prod.isActive && prod.quantity <= prod.alertThreshold) {
      alerts.push({
        id: `alert-stock-${prod.id}`,
        severity: prod.quantity === 0 ? 'danger' : 'warning',
        title:
          prod.quantity === 0
            ? `Rupture de stock : ${prod.name}`
            : `Stock bas : ${prod.name}`,
        description: `Quantité disponible : ${prod.quantity} ${prod.unit} (seuil d'alerte : ${prod.alertThreshold}).`,
        route: '/inventory',
        targetEntityId: prod.id,
      })
    }
  }

  // Pré-alertes (85 %) et dépassements (100 %) de plafonds budgétaires du mois en cours
  if (params.budgets && params.budgets.length > 0 && params.allExpenses) {
    const budgetRows = calculateBudgetComparisons({
      periodMonth: currentYm,
      budgets: params.budgets,
      revenues: params.periodRevenues ?? [],
      expenses: params.allExpenses,
    })
    for (const row of budgetRows) {
      if (row.target.kind !== 'expense_cap') continue
      if (row.isOverBudget) {
        alerts.push({
          id: `alert-budget-over-${row.target.id}`,
          severity: 'danger',
          title: `Plafond budgétaire dépassé (${row.utilizationPercent} %)`,
          description: `Dépensé : ${row.actualAmount.toLocaleString('fr-FR')} FCFA pour un plafond de ${row.target.plannedAmount.toLocaleString('fr-FR')} FCFA.`,
          route: '/budget',
          targetEntityId: row.target.id,
        })
      } else if (row.isNearCap) {
        alerts.push({
          id: `alert-budget-near-${row.target.id}`,
          severity: 'warning',
          title: `Plafond budgétaire proche (${row.utilizationPercent} %)`,
          description: `Attention : ${row.actualAmount.toLocaleString('fr-FR')} FCFA déjà engagés sur ${row.target.plannedAmount.toLocaleString('fr-FR')} FCFA.`,
          route: '/budget',
          targetEntityId: row.target.id,
        })
      }
    }
  }

  // Charges récurrentes arrivées à échéance ce mois et non encore réglées
  if (params.recurringExpenses && params.allExpenses) {
    for (const tpl of params.recurringExpenses) {
      if (!tpl.isActive) continue
      if (currentDayOfMonth >= Math.max(10, tpl.dayOfMonth)) {
        const alreadyPaid = params.allExpenses.some(
          (e) =>
            !e.isArchived &&
            (e.recurringTemplateId === tpl.id
              ? e.recurringPeriodMonth === currentYm
              : e.categoryCode === tpl.categoryCode &&
                e.date.slice(0, 7) === currentYm &&
                e.label.toLowerCase() === tpl.label.toLowerCase()),
        )
        if (!alreadyPaid) {
          alerts.push({
            id: `alert-rec-exp-${tpl.id}`,
            severity: 'warning',
            title: `Échéance mensuelle à régler : ${tpl.label}`,
            description: `Prévue vers le ${tpl.dayOfMonth} du mois (${tpl.defaultAmount.toLocaleString('fr-FR')} FCFA).`,
            route: '/expenses',
            targetEntityId: tpl.id,
          })
        }
      }
    }
  }

  const pendingEmployees = params.payrollStatuses.filter(
    (st) => st.employee.isActive && st.remainingToPay > 0,
  )
  if (pendingEmployees.length > 0) {
    const totalPending = pendingEmployees.reduce(
      (s, st) => s + st.remainingToPay,
      0,
    )
    alerts.push({
      id: 'alert-payroll-pending',
      severity: 'warning',
      title: `${pendingEmployees.length} rémunération(s) en attente ce mois`,
      description: `Solde prévisionnel restant à régler : ${totalPending.toLocaleString('fr-FR')} FCFA.`,
      route: '/payroll',
    })
  }

  // Règle simple et explicable de dépense inhabituelle (> 2,5x la moyenne courante)
  const routineExpenses = params.periodExpenses.filter(
    (e) =>
      !e.isArchived &&
      !e.isStockPurchase &&
      e.categoryCode !== 'rent' &&
      e.sourceModule !== 'payroll',
  )
  if (routineExpenses.length >= 3) {
    const avg =
      routineExpenses.reduce((s, e) => s + e.amount, 0) / routineExpenses.length
    for (const exp of routineExpenses) {
      if (exp.amount > avg * 2.5 && exp.amount >= 15000) {
        alerts.push({
          id: `alert-unusual-${exp.id}`,
          severity: 'warning',
          title: `Dépense inhabituelle : ${exp.label}`,
          description: `Montant de ${exp.amount.toLocaleString('fr-FR')} FCFA (supérieur à 2,5× la moyenne courante de ${Math.round(avg).toLocaleString('fr-FR')} FCFA).`,
          route: '/expenses',
          targetEntityId: exp.id,
        })
      }
    }
  }

  return alerts
}

export interface AuditDiffField {
  fieldLabel: string
  before: string
  after: string
}

const AUDIT_FIELD_LABELS: Record<string, string> = {
  label: 'Libellé',
  amount: 'Montant (FCFA)',
  paymentMethod: 'Mode de paiement',
  categoryCode: 'Catégorie',
  date: 'Date',
  beneficiary: 'Bénéficiaire',
  receiptRef: 'Réf. justificatif',
  reference: 'Référence',
  note: 'Note',
  closingNote: 'Note de clôture',
  countedClosingBalance: 'Espèces comptées (FCFA)',
  discrepancy: 'Écart de caisse (FCFA)',
  quantity: 'Quantité stock',
  quantityAfter: 'Stock après mouvement',
  netPaidAmount: 'Net versé (FCFA)',
  isArchived: 'Archivé / Annulé',
}

function formatAuditValue(key: string, val: unknown): string {
  if (val === undefined || val === null || val === '') return '—'
  if (typeof val === 'boolean') return val ? 'Oui' : 'Non'
  if (
    typeof val === 'number' &&
    (key.toLowerCase().includes('amount') ||
      key.toLowerCase().includes('balance') ||
      key === 'discrepancy')
  ) {
    return `${val.toLocaleString('fr-FR')} FCFA`
  }
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(val)) {
    return val.slice(0, 16).replace('T', ' ')
  }
  if (typeof val === 'object') {
    return JSON.stringify(val)
  }
  return String(val)
}

/**
 * Extrait les différences lisibles (Avant -> Après) entre deux snapshots JSON du Journal d'audit.
 */
export function computeAuditDiffEntries(
  previousSnapshotJson: string,
  newSnapshotJson: string,
): AuditDiffField[] {
  try {
    const prev = (
      previousSnapshotJson ? JSON.parse(previousSnapshotJson) : {}
    ) as Record<string, unknown>
    const next = (
      newSnapshotJson ? JSON.parse(newSnapshotJson) : {}
    ) as Record<string, unknown>

    const diffs: AuditDiffField[] = []
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
    const ignored = new Set([
      'id',
      'createdAt',
      'updatedAt',
      'cashMovementId',
      'linkedExpenseId',
      'linkedRevenueId',
      'linkedStockMovementId',
      'paymentSplits',
    ])

    for (const key of keys) {
      if (ignored.has(key)) continue
      const a = prev[key]
      const b = next[key]
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs.push({
          fieldLabel: AUDIT_FIELD_LABELS[key] ?? key,
          before: formatAuditValue(key, a),
          after: formatAuditValue(key, b),
        })
      }
    }
    return diffs
  } catch {
    return []
  }
}
