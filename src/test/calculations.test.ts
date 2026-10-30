import { describe, expect, it } from 'vitest'
import {
  buildDashboardAlerts,
  calculateBudgetComparisons,
  calculateCashSessionSummary,
  calculateConsumedStockCost,
  calculateEmployeeCommission,
  calculateEmployeePayrollStatus,
  calculateEstimatedResult,
  calculateInventoryValuation,
} from '../domain/calculations/finance'
import type {
  AdvanceEntry,
  BonusEntry,
  BudgetTarget,
  CashMovement,
  Employee,
  ExpenseEntry,
  ProductItem,
  RevenueEntry,
  SalaryPayment,
  StockMovement,
} from '../domain/models'
import {
  DuplicateSubmissionGuard,
  validateExpenseInput,
  validatePositiveFCFA,
  validateRevenueInput,
} from '../domain/validators'
import {
  computeEvolutionPercent,
  formatFCFA,
  toIntFCFA,
} from '../utils/format'

describe('Formatage FCFA et validation des entrées', () => {
  it('formate uniquement des entiers en FCFA sans centimes flottants', () => {
    expect(toIntFCFA(12500.4)).toBe(12500)
    expect(toIntFCFA(12500.6)).toBe(12501)
    expect(formatFCFA(0)).toBe('0 FCFA')
    expect(formatFCFA(150000)).toBe('150 000 FCFA')
  })

  it('rejette les montants invalides, nuls, négatifs ou décimaux', () => {
    expect(validatePositiveFCFA(0).valid).toBe(false)
    expect(validatePositiveFCFA(-5000).valid).toBe(false)
    expect(validatePositiveFCFA(2500.5).valid).toBe(false)
    expect(validatePositiveFCFA(5000).valid).toBe(true)

    expect(
      validateRevenueInput({
        label: '',
        amount: 5000,
        categoryCode: 'hair_service',
        paymentMethod: 'cash',
        date: '2026-10-29T10:00:00.000Z',
      }).valid,
    ).toBe(false)

    expect(
      validateExpenseInput({
        label: 'Facture eau',
        amount: -1000,
        categoryCode: 'utilities',
        paymentMethod: 'cash',
        date: '2026-10-29T10:00:00.000Z',
      }).valid,
    ).toBe(false)
  })

  it('bloque les doubles soumissions rapides avec DuplicateSubmissionGuard', () => {
    const guard = new DuplicateSubmissionGuard()
    expect(guard.tryAcquire('rev:coupe:5000', 1500, 1000)).toBe(true)
    expect(guard.tryAcquire('rev:coupe:5000', 1500, 1400)).toBe(false)
    expect(guard.tryAcquire('rev:coupe:5000', 1500, 2600)).toBe(true)
  })

  it('retourne null pour l’évolution quand les données précédentes sont absentes', () => {
    expect(computeEvolutionPercent(50000, 0, false)).toBeNull()
    expect(computeEvolutionPercent(60000, 50000, true)).toBe(20)
  })
})

describe('Calculs purs de caisse, résultat estimé, salaires et stock', () => {
  it('calcule exactement le solde théorique de caisse espèces', () => {
    const mvs: CashMovement[] = [
      {
        id: 'm1',
        sessionId: 's1',
        type: 'in',
        amount: 15000,
        reason: 'Tresses',
        categoryCode: 'braiding_weaving',
        paymentMethod: 'cash',
        occurredAt: '2026-10-29T10:00:00Z',
        createdAt: '2026-10-29T10:00:00Z',
        updatedAt: '2026-10-29T10:00:00Z',
      },
      {
        id: 'm2',
        sessionId: 's1',
        type: 'out',
        amount: 4000,
        reason: 'Transport',
        categoryCode: 'transport',
        paymentMethod: 'cash',
        occurredAt: '2026-10-29T11:00:00Z',
        createdAt: '2026-10-29T11:00:00Z',
        updatedAt: '2026-10-29T11:00:00Z',
      },
      {
        id: 'm3',
        sessionId: 's1',
        type: 'correction_in',
        amount: 1000,
        reason: 'Régularisation monnaie',
        categoryCode: 'cash_correction',
        paymentMethod: 'cash',
        occurredAt: '2026-10-29T12:00:00Z',
        createdAt: '2026-10-29T12:00:00Z',
        updatedAt: '2026-10-29T12:00:00Z',
      },
    ]

    const res = calculateCashSessionSummary(25000, mvs)
    expect(res.openingBalance).toBe(25000)
    expect(res.totalIn).toBe(16000)
    expect(res.totalOut).toBe(4000)
    expect(res.theoreticalBalance).toBe(37000)
  })

  it('distingue flux de trésorerie, achats de stock et bénéfice estimé sans double comptage', () => {
    const revenues: RevenueEntry[] = [
      {
        id: 'r1',
        date: '2026-10-10T10:00:00Z',
        label: 'Pose de mèches',
        categoryCode: 'braiding_weaving',
        amount: 100000,
        paymentMethod: 'wave',
        sourceModule: 'revenue',
        createdAt: '2026-10-10T10:00:00Z',
        updatedAt: '2026-10-10T10:00:00Z',
      },
    ]
    const expenses: ExpenseEntry[] = [
      {
        id: 'e1',
        date: '2026-10-05T10:00:00Z',
        label: 'Loyer salon',
        categoryCode: 'rent',
        amount: 30000,
        paymentMethod: 'transfer',
        sourceModule: 'expenses',
        isStockPurchase: false,
        createdAt: '2026-10-05T10:00:00Z',
        updatedAt: '2026-10-05T10:00:00Z',
      },
      {
        id: 'e2',
        date: '2026-10-06T10:00:00Z',
        label: 'Achat 10 paquets de mèches',
        categoryCode: 'hair_products',
        amount: 20000,
        paymentMethod: 'cash',
        sourceModule: 'inventory_purchase',
        isStockPurchase: true,
        createdAt: '2026-10-06T10:00:00Z',
        updatedAt: '2026-10-06T10:00:00Z',
      },
    ]
    const stockMovements: StockMovement[] = [
      {
        id: 'sm1',
        productId: 'p1',
        type: 'purchase',
        quantityDelta: 10,
        quantityAfter: 10,
        unitCost: 2000,
        reason: 'Approvisionnement',
        occurredAt: '2026-10-06T10:00:00Z',
        createdAt: '2026-10-06T10:00:00Z',
      },
      {
        id: 'sm2',
        productId: 'p1',
        type: 'use',
        quantityDelta: -3,
        quantityAfter: 7,
        unitCost: 2000,
        reason: 'Consommation cliente',
        occurredAt: '2026-10-10T10:00:00Z',
        createdAt: '2026-10-10T10:00:00Z',
      },
    ]

    expect(calculateConsumedStockCost(stockMovements)).toBe(6000)

    const result = calculateEstimatedResult({
      revenues,
      expenses,
      stockMovements,
    })

    // CA = 100 000 ; Décaissements totaux = 50 000 ; Trésorerie nette = 50 000
    expect(result.chiffreAffaires).toBe(100000)
    expect(result.decaissements).toBe(50000)
    expect(result.fluxTresorerieNet).toBe(50000)
    // Résultat estimé = 100 000 - 30 000 (charges hors stock) - 6 000 (3 paquets consommés) = 64 000 FCFA
    expect(result.chargesExploitationHorsStock).toBe(30000)
    expect(result.coutProduitsConsommesOuVendus).toBe(6000)
    expect(result.resultatEstime).toBe(64000)
  })

  it('calcule salaires, primes, avances et commissions sans double déduction', () => {
    const emp: Employee = {
      id: 'emp-1',
      lastName: 'Kouassi',
      firstName: 'Awa',
      fullName: 'Awa Kouassi',
      roleTitle: 'Coiffeuse',
      phone: '',
      hireDate: '2025-01-10',
      baseSalary: 90000,
      remunerationType: 'fixed_plus_variable',
      defaultBonus: 5000,
      commissionEnabled: true,
      commissionBasis: 'employee_services',
      commissionRate: 10,
      adminNote: '',
      isActive: true,
      createdAt: '2025-01-10T00:00:00Z',
      updatedAt: '2025-01-10T00:00:00Z',
    }

    const revs: RevenueEntry[] = [
      {
        id: 'r1',
        date: '2026-10-12T10:00:00Z',
        label: 'Tresses',
        categoryCode: 'braiding_weaving',
        employeeId: 'emp-1',
        amount: 50000,
        paymentMethod: 'cash',
        sourceModule: 'revenue',
        createdAt: '2026-10-12T10:00:00Z',
        updatedAt: '2026-10-12T10:00:00Z',
      },
    ]

    const comm = calculateEmployeeCommission(emp, revs)
    expect(comm.basisAmount).toBe(50000)
    expect(comm.commissionAmount).toBe(5000)

    const advances: AdvanceEntry[] = [
      {
        id: 'adv-1',
        employeeId: 'emp-1',
        periodMonth: '2026-10',
        amount: 20000,
        paidAt: '2026-10-15T10:00:00Z',
        paymentMethod: 'cash',
        linkedExpenseId: 'exp-adv-1',
        createdAt: '2026-10-15T10:00:00Z',
        updatedAt: '2026-10-15T10:00:00Z',
      },
    ]
    const bonuses: BonusEntry[] = [
      {
        id: 'bon-1',
        employeeId: 'emp-1',
        periodMonth: '2026-10',
        amount: 10000,
        reason: 'Prime assiduité',
        createdAt: '2026-10-20T10:00:00Z',
      },
    ]

    // Avant paiement final : 90 000 + (5 000 + 10 000 primes) + 5 000 comm - 20 000 avance = 90 000 restant
    const beforePay = calculateEmployeePayrollStatus({
      employee: emp,
      periodMonth: '2026-10',
      periodRevenues: revs,
      advances,
      bonuses,
      salaryPayments: [],
    })
    expect(beforePay.remainingToPay).toBe(90000)

    // Après paiement du reliquat de 90 000 et rapprochement de l'avance -> reste à payer = 0 (aucune double déduction !)
    const settledAdvances: AdvanceEntry[] = [
      { ...advances[0], settledInPayrollId: 'sal-1' },
    ]
    const payments: SalaryPayment[] = [
      {
        id: 'sal-1',
        employeeId: 'emp-1',
        periodMonth: '2026-10',
        baseSalary: 90000,
        bonusesTotal: 15000,
        advancesDeducted: 20000,
        deductions: 0,
        commissionCalculated: 5000,
        commissionValidated: 5000,
        netPaidAmount: 90000,
        paidAt: '2026-10-28T10:00:00Z',
        paymentMethod: 'cash',
        status: 'validated',
        createdAt: '2026-10-28T10:00:00Z',
        updatedAt: '2026-10-28T10:00:00Z',
      },
    ]

    const afterPay = calculateEmployeePayrollStatus({
      employee: emp,
      periodMonth: '2026-10',
      periodRevenues: revs,
      advances: settledAdvances,
      bonuses,
      salaryPayments: payments,
    })
    expect(afterPay.remainingToPay).toBe(0)
    expect(afterPay.totalDisbursedToEmployee).toBe(110000)
  })

  it('valorise le stock, détecte les seuils bas et calcule les écarts budgétaires', () => {
    const products: ProductItem[] = [
      {
        id: 'p1',
        name: 'Shampoing Kératine',
        sku: 'SHP-01',
        categoryCode: 'shampoo_cond',
        quantity: 2,
        unit: 'bouteille',
        costPrice: 4500,
        salePrice: 8000,
        alertThreshold: 3,
        usageType: 'both',
        isActive: true,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ]
    const val = calculateInventoryValuation(products)
    expect(val.totalStockCostValue).toBe(9000)
    expect(val.lowStockProducts).toHaveLength(1)

    const alerts = buildDashboardAlerts({
      cashSessions: [],
      products,
      payrollStatuses: [],
      periodExpenses: [],
    })
    expect(alerts.some((a) => a.id === 'alert-stock-p1')).toBe(true)

    const budgets: BudgetTarget[] = [
      {
        id: 'b1',
        periodMonth: '2026-10',
        kind: 'expense_cap',
        categoryCode: 'utilities',
        plannedAmount: 40000,
        createdAt: '2026-10-01T00:00:00Z',
        updatedAt: '2026-10-01T00:00:00Z',
      },
    ]
    const exps: ExpenseEntry[] = [
      {
        id: 'e1',
        date: '2026-10-15T10:00:00Z',
        label: 'Facture CIE',
        categoryCode: 'utilities',
        amount: 50000,
        paymentMethod: 'wave',
        sourceModule: 'expenses',
        isStockPurchase: false,
        createdAt: '2026-10-15T10:00:00Z',
        updatedAt: '2026-10-15T10:00:00Z',
      },
    ]
    const comp = calculateBudgetComparisons({
      periodMonth: '2026-10',
      budgets,
      revenues: [],
      expenses: exps,
    })
    expect(comp[0].isOverBudget).toBe(true)
    expect(comp[0].varianceAmount).toBe(-10000)
  })
})
