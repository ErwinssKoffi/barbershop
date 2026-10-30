import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '@/app/router'
import { SalonProDatabase } from '@/db/database'
import { SalonRepositoryHub } from '@/db/repositories/salonRepositories'
import {
  buildDashboardAlerts,
  calculateBudgetComparisons,
  calculateBudgetRunRateForecast,
  calculateCashSessionSummary,
  calculateCUMP,
  calculateDenominationTotal,
  calculateEmployeeCommission,
  calculateEmployeePayrollStatus,
  calculateEmployeePerformanceSummary,
  calculatePaymentMethodBreakdown,
  calculateRevenueMetrics,
  computeAuditDiffEntries,
} from '@/domain/calculations/finance'
import type { Employee, RevenueEntry } from '@/domain/models'
import { SalonStoreProvider } from '@/hooks/SalonStoreProvider'
import { ToastProvider } from '@/hooks/ToastProvider'

function createFreshRepo() {
  const name = `SalonProFlows_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return new SalonRepositoryHub(new SalonProDatabase(name))
}

describe('Nouvelles règles métier, calculs FCFA et architecture 5 Contextes', () => {
  it('calcule exactement le billetage FCFA, le CUMP entier et la répartition des paiements mixtes', () => {
    const billetage = calculateDenominationTotal({
      '10000': 3,
      '5000': 2,
      '2000': 4,
      '500': 3,
      '100': 5,
    })
    expect(billetage).toBe(50000)

    // CUMP : (10 * 2 000 + 5 * 2 600) / 15 = 33 000 / 15 = 2 200 FCFA
    expect(calculateCUMP(10, 2000, 5, 2600)).toBe(2200)

    const mixedRevs: RevenueEntry[] = [
      {
        id: 'r1',
        ticketId: 'tkt-1',
        receiptNumber: 'REC-20261029-001',
        date: '2026-10-29T10:00:00.000Z',
        label: 'Tresses + Huile',
        categoryCode: 'braiding_weaving',
        amount: 12000,
        paymentMethod: 'cash',
        paymentSplits: [
          { method: 'cash', amount: 5000 },
          { method: 'wave', amount: 7000 },
        ],
        sourceModule: 'revenue',
        isArchived: false,
        createdAt: '2026-10-29T10:00:00.000Z',
        updatedAt: '2026-10-29T10:00:00.000Z',
      },
    ]

    const revMetrics = calculateRevenueMetrics(mixedRevs)
    expect(revMetrics.totalRevenue).toBe(12000)
    expect(revMetrics.byPaymentMethod['cash']).toBe(5000)
    expect(revMetrics.byPaymentMethod['wave']).toBe(7000)

    const reconciliation = calculatePaymentMethodBreakdown(mixedRevs, [])
    expect(reconciliation.find((x) => x.method === 'cash')?.totalIn).toBe(5000)
    expect(reconciliation.find((x) => x.method === 'wave')?.totalIn).toBe(7000)
  })

  it('gère les 3 bases de commission employé, le dépassement de plafond avances et les prévisions run-rate', () => {
    const baseEmp: Employee = {
      id: 'emp-1',
      firstName: 'Awa',
      lastName: 'Koné',
      fullName: 'Awa Koné',
      roleTitle: 'Coiffeuse',
      phone: '',
      hireDate: '2025-01-01',
      baseSalary: 80000,
      remunerationType: 'fixed_plus_variable',
      commissionEnabled: true,
      commissionRate: 10,
      commissionBasis: 'employee_services',
      defaultBonus: 0,
      isActive: true,
      adminNote: '',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    }

    const revs: RevenueEntry[] = [
      {
        id: 'rv-srv',
        date: '2026-10-15T10:00:00.000Z',
        label: 'Pose perruque',
        categoryCode: 'braiding_weaving',
        employeeId: 'emp-1',
        amount: 20000,
        paymentMethod: 'cash',
        sourceModule: 'revenue',
        isArchived: false,
        createdAt: '2026-10-15T10:00:00.000Z',
        updatedAt: '2026-10-15T10:00:00.000Z',
      },
      {
        id: 'rv-prd',
        date: '2026-10-15T11:00:00.000Z',
        label: 'Sérum capillaire',
        categoryCode: 'product_sale',
        productId: 'prd-1',
        employeeId: 'emp-1',
        amount: 10000,
        paymentMethod: 'wave',
        sourceModule: 'revenue',
        isArchived: false,
        createdAt: '2026-10-15T11:00:00.000Z',
        updatedAt: '2026-10-15T11:00:00.000Z',
      },
    ]

    expect(calculateEmployeeCommission(baseEmp, revs).commissionAmount).toBe(
      2000,
    )
    expect(
      calculateEmployeeCommission(
        { ...baseEmp, commissionBasis: 'employee_services_and_products' },
        revs,
      ).commissionAmount,
    ).toBe(3000)

    const perf = calculateEmployeePerformanceSummary(baseEmp, revs)
    expect(perf.servicesCount).toBe(1)
    expect(perf.productsSoldCount).toBe(1)
    expect(perf.totalGeneratedRevenue).toBe(30000)

    const statusOverAdv = calculateEmployeePayrollStatus({
      employee: baseEmp,
      periodMonth: '2026-10',
      periodRevenues: revs,
      advances: [
        {
          id: 'adv-big',
          employeeId: 'emp-1',
          periodMonth: '2026-10',
          paidAt: '2026-10-16T10:00:00.000Z',
          amount: 90000,
          paymentMethod: 'cash',
          linkedExpenseId: 'exp-adv-big',
          isArchived: false,
          createdAt: '2026-10-16T10:00:00.000Z',
          updatedAt: '2026-10-16T10:00:00.000Z',
        },
      ],
      bonuses: [],
      salaryPayments: [],
    })
    // Brut attendu = 80 000 + 2 000 = 82 000 ; Avance = 90 000 -> dépassement = 8 000 FCFA
    expect(statusOverAdv.remainingToPay).toBe(0)
    expect(statusOverAdv.overAdvanceAmount).toBe(8000)

    const forecast = calculateBudgetRunRateForecast({
      periodMonth: '2026-10',
      actualMonthRevenue: 150000,
      plannedRevenueGoal: 300000,
      referenceDateISO: '2026-10-15',
    })
    expect(forecast.dailyAverageRevenue).toBe(10000)
    expect(forecast.projectedMonthRevenue).toBe(310000)

    const diffs = computeAuditDiffEntries(
      JSON.stringify({ amount: 5000, paymentMethod: 'wave' }),
      JSON.stringify({ amount: 7500, paymentMethod: 'cash' }),
    )
    expect(diffs).toHaveLength(2)
  })

  it('exécute atomiquement un Ticket Client multi-lignes avec paiement mixte, stock/consommable et réintégration sur annulation', async () => {
    const repo = createFreshRepo()
    await repo.ensureInitialized(false)

    const session = await repo.openCashSession(20000, 'Ouverture test')
    const srv = await repo.saveService({
      name: 'Coupe + Barbe VIP',
      categoryCode: 'coupe_coiffage',
      referencePrice: 8000,
      description: '',
    })
    const resaleProd = await repo.saveProduct({
      sku: 'HUILE-01',
      name: 'Huile à barbe Argan',
      categoryCode: 'oils_serums',
      usageType: 'resale',
      initialQuantity: 10,
      unit: 'flacon',
      costPrice: 2000,
      salePrice: 4000,
      alertThreshold: 2,
    })
    const consumableProd = await repo.saveProduct({
      sku: 'LAME-01',
      name: 'Boîte lames rasoir',
      categoryCode: 'blades_hygiene',
      usageType: 'consumable',
      initialQuantity: 20,
      unit: 'pièce',
      costPrice: 100,
      alertThreshold: 5,
    })

    // Ticket total = 8 000 + 4 000 = 12 000 FCFA (réglé 5 000 Espèces + 7 000 Wave, remis 10 000 Espèces -> monnaie 5 000)
    const ticket = await repo.createCheckoutTicket({
      date: '2026-10-29T14:00:00.000Z',
      clientName: 'M. Bamba',
      lines: [
        {
          kind: 'service',
          serviceId: srv.id,
          label: srv.name,
          categoryCode: 'hair_service',
          quantity: 1,
          unitPrice: 8000,
        },
        {
          kind: 'product',
          productId: resaleProd.id,
          label: resaleProd.name,
          categoryCode: 'product_sale',
          quantity: 1,
          unitPrice: 4000,
        },
      ],
      consumables: [{ productId: consumableProd.id, quantity: 2 }],
      paymentMethod: 'cash',
      paymentSplits: [
        { method: 'cash', amount: 5000 },
        { method: 'wave', amount: 7000 },
      ],
      amountTendered: 10000,
    })

    expect(ticket.receiptNumber).toMatch(/^REC-20261029-001$/)
    expect(ticket.totalAmount).toBe(12000)
    expect(ticket.entries[0]?.changeGiven).toBe(5000)

    let state = await repo.readFullState()
    const movs = state.cashMovements.filter((m) => m.sessionId === session.id)
    const cashSummary = calculateCashSessionSummary(session.openingBalance, movs)
    // Seule la part espèces (5 000 FCFA) entre dans le tiroir-caisse (20 000 + 5 000 = 25 000 FCFA) !
    expect(cashSummary.theoreticalBalance).toBe(25000)

    expect(
      state.products.find((p) => p.id === resaleProd.id)?.quantity,
    ).toBe(9)
    expect(
      state.products.find((p) => p.id === consumableProd.id)?.quantity,
    ).toBe(18)

    // Annulation de la ligne produit + ligne prestation (consommables portés sur la 1ère ligne)
    for (const entry of ticket.entries) {
      await repo.archiveRevenue(entry.id)
    }

    state = await repo.readFullState()
    expect(
      state.products.find((p) => p.id === resaleProd.id)?.quantity,
    ).toBe(10)
    expect(
      state.products.find((p) => p.id === consumableProd.id)?.quantity,
    ).toBe(20)

    const movsAfterCancel = state.cashMovements.filter(
      (m) => m.sessionId === session.id,
    )
    expect(
      calculateCashSessionSummary(session.openingBalance, movsAfterCancel)
        .theoreticalBalance,
    ).toBe(20000)
  })

  it('gère le CUMP sur achat, les charges fixes récurrentes et le salaire partiel puis solde', async () => {
    const repo = createFreshRepo()
    await repo.ensureInitialized(false)

    const prod = await repo.saveProduct({
      sku: 'SHP-01',
      name: 'Shampoing Kératine',
      categoryCode: 'shampoo_cond',
      usageType: 'consumable',
      initialQuantity: 4,
      unit: 'bouteille',
      costPrice: 3000,
      alertThreshold: 2,
    })

    // Achat de 4 bouteilles à 4 000 FCFA -> CUMP = (12 000 + 16 000) / 8 = 3 500 FCFA
    await repo.recordStockMovement({
      productId: prod.id,
      occurredAt: '2026-10-29T09:00:00.000Z',
      type: 'purchase',
      quantity: 4,
      unitCost: 4000,
      reason: 'Réassort grossiste',
      paymentMethod: 'wave',
      recordFinancialEntry: true,
    })

    let state = await repo.readFullState()
    expect(state.products.find((p) => p.id === prod.id)?.costPrice).toBe(3500)

    // Charges fixes récurrentes sans doublon sur le même mois
    const tpl = await repo.saveRecurringExpenseTemplate({
      label: 'Loyer local Cocody',
      categoryCode: 'rent',
      defaultAmount: 150000,
      paymentMethod: 'bank_transfer',
      dayOfMonth: 5,
    })
    await repo.payRecurringExpenseForMonth({
      templateId: tpl.id,
      periodMonth: '2026-10',
      date: '2026-10-05T10:00:00.000Z',
      amount: 150000,
      paymentMethod: 'bank_transfer',
    })
    await expect(
      repo.payRecurringExpenseForMonth({
        templateId: tpl.id,
        periodMonth: '2026-10',
        date: '2026-10-06T10:00:00.000Z',
        amount: 150000,
        paymentMethod: 'bank_transfer',
      }),
    ).rejects.toThrow(/déjà été validée/)

    // Paie partielle puis solde sans double déduction d'avance
    const emp = await repo.saveEmployee({
      lastName: 'Touré',
      firstName: 'Moussa',
      roleTitle: 'Barbier',
      phone: '',
      hireDate: '2025-02-01',
      baseSalary: 100000,
      remunerationType: 'fixed',
      commissionEnabled: false,
      commissionRate: 0,
      commissionBasis: 'employee_services',
      defaultBonus: 0,
      adminNote: '',
    })

    await repo.recordSalaryAdvance({
      employeeId: emp.id,
      periodMonth: '2026-10',
      paidAt: '2026-10-10T10:00:00.000Z',
      amount: 20000,
      paymentMethod: 'wave',
    })

    // Reste dû = 80 000 FCFA -> 1er versement partiel de 30 000 FCFA
    const p1 = await repo.validateSalaryPayment({
      employeeId: emp.id,
      periodMonth: '2026-10',
      paidAt: '2026-10-25T10:00:00.000Z',
      baseSalary: 100000,
      bonusesTotal: 0,
      deductions: 0,
      commissionCalculated: 0,
      commissionValidated: 0,
      customNetAmount: 30000,
      paymentMethod: 'wave',
    })
    expect(p1.isPartial).toBe(true)
    expect(p1.netPaidAmount).toBe(30000)

    // Solde restant = 50 000 FCFA
    const p2 = await repo.validateSalaryPayment({
      employeeId: emp.id,
      periodMonth: '2026-10',
      paidAt: '2026-10-30T10:00:00.000Z',
      baseSalary: 100000,
      bonusesTotal: 0,
      deductions: 0,
      commissionCalculated: 0,
      commissionValidated: 0,
      paymentMethod: 'wave',
    })
    expect(p2.isPartial).toBe(false)
    expect(p2.netPaidAmount).toBe(50000)

    state = await repo.readFullState()
    const totalPayrollDisbursed = state.expenses
      .filter((e) => !e.isArchived && e.sourceModule === 'payroll')
      .reduce((s, e) => s + e.amount, 0)
    // 20 000 (avance) + 30 000 (partiel) + 50 000 (solde) = 100 000 FCFA exact !
    expect(totalPayrollDisbursed).toBe(100000)

    // Alertes proactives : budget 85% et sauvegarde absente
    await repo.upsertBudgetTarget({
      periodMonth: '2026-10',
      kind: 'expense_cap',
      categoryCode: 'rent',
      plannedAmount: 170000, // 150 000 / 170 000 = 88 % (>= 85 %)
    })
    state = await repo.readFullState()
    const budgetRows = calculateBudgetComparisons({
      periodMonth: '2026-10',
      budgets: state.budgets,
      revenues: state.revenues,
      expenses: state.expenses,
    })
    expect(budgetRows[0]?.isNearCap).toBe(true)

    const alerts = buildDashboardAlerts({
      cashSessions: state.cashSessions,
      products: state.products,
      payrollStatuses: [],
      periodExpenses: state.expenses,
      budgets: state.budgets,
      allExpenses: state.expenses,
      todayDateISO: '2026-10-29',
    })
    expect(alerts.some((a) => a.id === 'alert-backup-never')).toBe(true)
    expect(alerts.some((a) => a.id.startsWith('alert-budget-near-'))).toBe(true)
  })

  it('ouvre le Ticket Client universel, affiche l’alerte caisse fermée + ouverture 1-clic et génère le reçu imprimable', async () => {
    const user = userEvent.setup()
    const repo = createFreshRepo()
    await repo.ensureInitialized(false)
    await repo.saveService({
      name: 'Coupe Royale Homme',
      categoryCode: 'coupe_coiffage',
      referencePrice: 5000,
      description: '',
    })

    render(
      <ToastProvider>
        <SalonStoreProvider repository={repo}>
          <MemoryRouter initialEntries={['/revenue']}>
            <AppRoutes />
          </MemoryRouter>
        </SalonStoreProvider>
      </ToastProvider>,
    )

    const ticketBtn = await screen.findByRole('button', {
      name: /Ticket client \(multi-lignes\)/i,
    })
    await user.click(ticketBtn)

    const dialog = await screen.findByRole('dialog', {
      name: /Nouveau Ticket d'encaissement client/i,
    })
    const modal = within(dialog)

    const libelleInput = modal.getByPlaceholderText('Ex. Coupe + Barbe')
    const priceInput = modal.getAllByRole('spinbutton')[1]
    await user.type(libelleInput, 'Coupe Royale Homme')
    await user.clear(priceInput)
    await user.type(priceInput, '5000')

    // L'alerte non bloquante de caisse fermée s'affiche avec le bouton d'ouverture 1-clic
    expect(
      modal.getByText(/Aucune session de caisse ouverte/i),
    ).toBeInTheDocument()
    expect(
      modal.getByRole('button', { name: /Ouvrir la caisse maintenant/i }),
    ).toBeInTheDocument()

    // On valide le ticket (non bloquant) et le reçu imprimable s'ouvre automatiquement !
    await user.click(
      modal.getByRole('button', { name: /Valider le ticket/i }),
    )

    const receiptDialog = await screen.findByRole('dialog', {
      name: /Reçu client · REC-/i,
    })
    expect(within(receiptDialog).getByText('TOTAL PAYÉ')).toBeInTheDocument()
    expect(
      within(receiptDialog).getByRole('button', { name: /Fiche A5/i }),
    ).toBeInTheDocument()
  })
})
