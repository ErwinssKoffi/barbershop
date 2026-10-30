import { ArrowRight, Download, FileBarChart2, Info, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePeriodFilter } from '../../contexts/periodFilterContext'
import {
  calculateCashSessionSummary,
  calculateEmployeePayrollStatus,
  calculateEstimatedResult,
  calculateExpenseMetrics,
  calculateInventoryValuation,
  calculatePaymentMethodBreakdown,
  calculateRevenueMetrics,
  computeAuditDiffEntries,
} from '../../domain/calculations/finance'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import {
  computeEvolutionPercent,
  currentMonthISO,
  formatDateFR,
  formatDateTimeFR,
  formatFCFA,
  isIsoInBounds,
  todayISO,
  type PeriodPreset,
} from '../../utils/format'

type ReportType =
  | 'caisse'
  | 'paiements'
  | 'recettes'
  | 'depenses'
  | 'mensuel'
  | 'remunerations'
  | 'inventaire'
  | 'benefices'
  | 'audit'

const REPORT_TABS: Array<{
  id: ReportType
  label: string
  printTitle: string
}> = [
  {
    id: 'benefices',
    label: 'Bénéfices',
    printTitle: 'Compte de résultat estimé',
  },
  {
    id: 'mensuel',
    label: 'Mensuel',
    printTitle: 'Comparatif mensuel vs mois précédent',
  },
  { id: 'caisse', label: 'Caisse', printTitle: 'Rapport de caisse espèces' },
  {
    id: 'paiements',
    label: 'Paiements',
    printTitle: 'Rapprochement par mode de paiement',
  },
  { id: 'recettes', label: 'Recettes', printTitle: 'Rapport des recettes' },
  { id: 'depenses', label: 'Dépenses', printTitle: 'Rapport des dépenses' },
  {
    id: 'remunerations',
    label: 'Paie',
    printTitle: 'État des rémunérations',
  },
  {
    id: 'inventaire',
    label: 'Inventaire',
    printTitle: "État de valorisation d'inventaire",
  },
  {
    id: 'audit',
    label: "Journal d'audit",
    printTitle: "Journal d'audit et des corrections",
  },
]

export function ReportsPage() {
  const { state, categoryLabel } = useSalonStore()
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
  const toast = useToast()

  const [reportType, setReportType] = useState<ReportType>('benefices')

  const data = useMemo(() => {
    const revs = state.revenues.filter(
      (r) => !r.isArchived && isIsoInBounds(r.date, bounds),
    )
    const prevRevs = prevBounds
      ? state.revenues.filter(
          (r) => !r.isArchived && isIsoInBounds(r.date, prevBounds),
        )
      : []

    const exps = state.expenses.filter(
      (e) => !e.isArchived && isIsoInBounds(e.date, bounds),
    )
    const prevExps = prevBounds
      ? state.expenses.filter(
          (e) => !e.isArchived && isIsoInBounds(e.date, prevBounds),
        )
      : []

    const movs = state.stockMovements.filter((m) =>
      isIsoInBounds(m.occurredAt, bounds),
    )
    const prevMovs = prevBounds
      ? state.stockMovements.filter((m) =>
          isIsoInBounds(m.occurredAt, prevBounds),
        )
      : []

    const sessions = state.cashSessions.filter((s) =>
      isIsoInBounds(s.openedAt, bounds),
    )

    const revMetrics = calculateRevenueMetrics(revs)
    const prevRevMetrics = calculateRevenueMetrics(prevRevs)
    const expMetrics = calculateExpenseMetrics(exps)
    const prevExpMetrics = calculateExpenseMetrics(prevExps)

    const estResult = calculateEstimatedResult({
      revenues: revs,
      expenses: exps,
      stockMovements: movs,
    })
    const prevEstResult = calculateEstimatedResult({
      revenues: prevRevs,
      expenses: prevExps,
      stockMovements: prevMovs,
    })

    const ym = bounds.end ? todayISO(bounds.end).slice(0, 7) : currentMonthISO()
    const monthRevs = state.revenues.filter(
      (r) => !r.isArchived && r.date.slice(0, 7) === ym,
    )
    const payrollRows = state.employees.map((employee) =>
      calculateEmployeePayrollStatus({
        employee,
        periodMonth: ym,
        periodRevenues: monthRevs,
        advances: state.advances,
        bonuses: state.bonuses,
        salaryPayments: state.salaryPayments,
      }),
    )

    const invValuation = calculateInventoryValuation(state.products)
    const paymentBreakdown = calculatePaymentMethodBreakdown(revs, exps)
    const auditLogs = state.correctionLogs
      .filter((c) => isIsoInBounds(c.createdAt, bounds))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    return {
      revs,
      exps,
      sessions,
      revMetrics,
      prevRevMetrics,
      expMetrics,
      prevExpMetrics,
      estResult,
      prevEstResult,
      payrollRows,
      invValuation,
      paymentBreakdown,
      auditLogs,
      ym,
    }
  }, [
    state.revenues,
    state.expenses,
    state.stockMovements,
    state.cashSessions,
    state.employees,
    state.advances,
    state.bonuses,
    state.salaryPayments,
    state.products,
    state.correctionLogs,
    bounds,
    prevBounds,
  ])

  const handleExportCSV = () => {
    const filePrefix = `rapport-${reportType}-${todayISO()}.csv`
    if (reportType === 'recettes') {
      downloadCsvFile(
        filePrefix,
        ['Date', 'Libellé', 'Catégorie', 'Mode', 'Montant FCFA'],
        data.revs.map((r) => [
          r.date.slice(0, 10),
          r.label,
          categoryLabel('revenue', r.categoryCode),
          categoryLabel('payment_method', r.paymentMethod),
          r.amount,
        ]),
      )
    } else if (reportType === 'depenses') {
      downloadCsvFile(
        filePrefix,
        ['Date', 'Libellé', 'Catégorie', 'Bénéficiaire', 'Montant FCFA'],
        data.exps.map((e) => [
          e.date.slice(0, 10),
          e.label,
          categoryLabel('expense', e.categoryCode),
          e.beneficiary ?? '',
          e.amount,
        ]),
      )
    } else if (reportType === 'caisse') {
      downloadCsvFile(
        filePrefix,
        [
          'Date ouverture',
          'Statut',
          'Ouverture FCFA',
          'Entrées FCFA',
          'Sorties FCFA',
          'Théorique FCFA',
          'Compté FCFA',
          'Écart FCFA',
        ],
        data.sessions.map((s) => {
          const mvs = state.cashMovements.filter((m) => m.sessionId === s.id)
          const sum = calculateCashSessionSummary(s.openingBalance, mvs)
          return [
            s.openedAt.slice(0, 10),
            s.status,
            sum.openingBalance,
            sum.totalIn,
            sum.totalOut,
            sum.theoreticalBalance,
            s.countedClosingBalance ?? '',
            s.discrepancy ?? '',
          ]
        }),
      )
    } else if (reportType === 'remunerations') {
      downloadCsvFile(
        filePrefix,
        [
          'Employé',
          'Poste',
          'Base fixe FCFA',
          'Commissions FCFA',
          'Primes FCFA',
          'Avances FCFA',
          'Net versé FCFA',
          'Reste à payer FCFA',
        ],
        data.payrollRows.map((st) => [
          st.employee.fullName,
          st.employee.roleTitle,
          st.baseSalary,
          st.commissionCalculated,
          st.bonusesTotal,
          st.unsettledAdvancesTotal + st.settledAdvancesTotal,
          st.netPaidInValidatedPayrolls,
          st.remainingToPay,
        ]),
      )
    } else if (reportType === 'inventaire') {
      downloadCsvFile(
        filePrefix,
        ['SKU', 'Produit', 'Quantité', 'Unité', 'Coût unitaire', 'Valeur FCFA'],
        state.products.map((p) => [
          p.sku,
          p.name,
          p.quantity,
          p.unit,
          p.costPrice,
          Math.round(p.quantity * p.costPrice),
        ]),
      )
    } else if (reportType === 'paiements') {
      downloadCsvFile(
        filePrefix,
        [
          'Mode de paiement',
          'Nature trésorerie',
          'Encaissements FCFA',
          'Nb encaissements',
          'Décaissements FCFA',
          'Nb décaissements',
          'Solde net FCFA',
        ],
        data.paymentBreakdown.map((row) => [
          categoryLabel('payment_method', row.method),
          row.method === 'cash' ? 'Tiroir-caisse physique' : 'Compte externe / Mobile Money',
          row.totalIn,
          row.inCount,
          row.totalOut,
          row.outCount,
          row.netFlow,
        ]),
      )
    } else if (reportType === 'audit') {
      downloadCsvFile(
        filePrefix,
        ['Date et heure', 'Type entité', 'Opération', 'Motif obligatoire'],
        data.auditLogs.map((log) => [
          log.createdAt,
          log.entityType,
          log.action,
          log.reason,
        ]),
      )
    } else {
      downloadCsvFile(
        filePrefix,
        ['Indicateur', 'Période actuelle FCFA', 'Période précédente FCFA'],
        [
          [
            "Chiffre d'affaires",
            data.estResult.chiffreAffaires,
            data.prevEstResult.chiffreAffaires,
          ],
          [
            'Charges opérationnelles',
            data.estResult.chargesExploitationHorsStock,
            data.prevEstResult.chargesExploitationHorsStock,
          ],
          [
            'Stock consommé / vendu',
            data.estResult.coutProduitsConsommesOuVendus,
            data.prevEstResult.coutProduitsConsommesOuVendus,
          ],
          [
            'Bénéfice estimé',
            data.estResult.resultatEstime,
            data.prevEstResult.resultatEstime,
          ],
          [
            'Flux net de trésorerie',
            data.estResult.fluxTresorerieNet,
            data.prevEstResult.fluxTresorerieNet,
          ],
        ],
      )
    }
    toast.success('Rapport exporté en CSV.')
  }

  const currentTabTitle =
    REPORT_TABS.find((t) => t.id === reportType)?.printTitle ?? 'Rapport'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Rapports et états financiers</h1>
          <p className="page-subtitle">
            États comptables prêts à imprimer au format A4 et exportables en CSV
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button type="button" variant="outline" onClick={handleExportCSV}>
            <Download size={15} />
            Exporter CSV
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer size={15} />
            Imprimer (Format A4)
          </Button>
        </div>
      </div>

      <div
        className="surface-card no-print"
        style={{
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <Tabs
          value={reportType}
          onValueChange={(v) => setReportType(v as ReportType)}
        >
          <TabsList variant="line" aria-label="Types de rapports">
            {REPORT_TABS.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <FieldLabel htmlFor="rep-period">Période :</FieldLabel>
          <Select
            value={preset}
            onValueChange={(v) => setPreset(v as PeriodPreset)}
          >
            <SelectTrigger id="rep-period" style={{ width: 210 }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Aujourd&apos;hui</SelectItem>
              <SelectItem value="week">Cette semaine</SelectItem>
              <SelectItem value="month">Ce mois</SelectItem>
              <SelectItem value="prev_month">Mois précédent</SelectItem>
              <SelectItem value="year">Année en cours</SelectItem>
              <SelectItem value="custom">Période personnalisée</SelectItem>
            </SelectContent>
          </Select>

          {preset === 'custom' && (
            <>
              <Input
                type="date"
                style={{ width: 145 }}
                value={customStart}
                onChange={(e) => setCustomRange(e.target.value, customEnd)}
              />
              <span>au</span>
              <Input
                type="date"
                style={{ width: 145 }}
                value={customEnd}
                onChange={(e) => setCustomRange(customStart, e.target.value)}
              />
            </>
          )}
        </div>
      </div>

      {/* Feuille d'aperçu imprimable A4 */}
      <section className="a4-preview-sheet">
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '2px solid #18181b',
            paddingBottom: 14,
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
              {state.salon.name}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#52525b' }}>
              {state.salon.address} · Tél : {state.salon.phone}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#52525b' }}>
              {state.settings.printHeaderNote}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 700,
                fontSize: '0.96rem',
              }}
            >
              <FileBarChart2 size={16} />
              {currentTabTitle}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#52525b' }}>
              Période : {periodLabel}
            </div>
          </div>
        </header>

        {reportType === 'benefices' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: '#f4f4f5',
                border: '1px solid #e4e4e7',
                fontSize: '0.82rem',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
            >
              <Info size={17} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Explication de la méthode de calcul :</strong> le{' '}
                <em>bénéfice estimé</em> correspond au{' '}
                <strong>Chiffre d&apos;affaires encaissé</strong> moins les{' '}
                <strong>
                  charges opérationnelles de la période (loyer, factures,
                  salaires et avances versés, entretien, transport)
                </strong>{' '}
                moins le{' '}
                <strong>
                  coût d&apos;achat des produits réellement consommés, vendus ou
                  perdus
                </strong>
                . Les achats de stock non encore consommés sont suivis dans le
                flux de trésorerie mais ne sont pas déduits deux fois du
                résultat.
              </div>
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Poste du compte de résultat simplifié</th>
                  <th style={{ textAlign: 'right' }}>Montant (FCFA)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>(+) Chiffre d&apos;affaires total</td>
                  <td
                    className="tabular-nums"
                    style={{ textAlign: 'right', fontWeight: 700 }}
                  >
                    {formatFCFA(data.estResult.chiffreAffaires)}
                  </td>
                </tr>
                <tr>
                  <td>
                    (−) Charges opérationnelles (hors achats de stock immobilisé)
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    −{formatFCFA(data.estResult.chargesExploitationHorsStock)}
                  </td>
                </tr>
                <tr>
                  <td>
                    (−) Coût d&apos;achat des produits consommés, vendus ou
                    perdus
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    −{formatFCFA(data.estResult.coutProduitsConsommesOuVendus)}
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 800, fontSize: '0.96rem' }}>
                    (=) BÉNÉFICE ESTIMÉ DE LA PÉRIODE
                  </td>
                  <td
                    className="tabular-nums"
                    style={{
                      textAlign: 'right',
                      fontWeight: 800,
                      fontSize: '0.98rem',
                      color:
                        data.estResult.resultatEstime >= 0
                          ? '#15803d'
                          : '#dc2626',
                    }}
                  >
                    {formatFCFA(data.estResult.resultatEstime)}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: '#52525b' }}>
                    Pour information : Achats de stock réglés sur la période
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ textAlign: 'right', color: '#52525b' }}
                  >
                    {formatFCFA(data.estResult.achatsStockPeriode)}
                  </td>
                </tr>
                <tr>
                  <td style={{ fontWeight: 700 }}>
                    Flux net de trésorerie global (Toutes entrées − toutes
                    sorties)
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ textAlign: 'right', fontWeight: 700 }}
                  >
                    {formatFCFA(data.estResult.fluxTresorerieNet)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {reportType === 'mensuel' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Indicateur comparé</th>
                <th style={{ textAlign: 'right' }}>Période actuelle</th>
                <th style={{ textAlign: 'right' }}>Période précédente</th>
                <th style={{ textAlign: 'right' }}>Évolution</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: "Chiffre d'affaires",
                  cur: data.revMetrics.totalRevenue,
                  prev: data.prevRevMetrics.totalRevenue,
                },
                {
                  label: 'Dépenses totales',
                  cur: data.expMetrics.totalDisbursed,
                  prev: data.prevExpMetrics.totalDisbursed,
                },
                {
                  label: 'Charges opérationnelles',
                  cur: data.estResult.chargesExploitationHorsStock,
                  prev: data.prevEstResult.chargesExploitationHorsStock,
                },
                {
                  label: 'Bénéfice estimé',
                  cur: data.estResult.resultatEstime,
                  prev: data.prevEstResult.resultatEstime,
                },
              ].map((row) => {
                const evol = computeEvolutionPercent(
                  row.cur,
                  row.prev,
                  row.prev > 0,
                )
                return (
                  <tr key={row.label}>
                    <td style={{ fontWeight: 600 }}>{row.label}</td>
                    <td
                      className="tabular-nums"
                      style={{ textAlign: 'right', fontWeight: 700 }}
                    >
                      {formatFCFA(row.cur)}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{ textAlign: 'right' }}
                    >
                      {formatFCFA(row.prev)}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{ textAlign: 'right', fontWeight: 600 }}
                    >
                      {evol === null
                        ? 'Données préc. insuffisantes'
                        : `${evol > 0 ? '+' : ''}${evol}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {reportType === 'paiements' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--bg-surface-muted)',
                fontSize: '0.8rem',
              }}
            >
              <strong>Rapprochement Espèces &amp; Mobile Money :</strong> vérifiez
              vos soldes réels sur chaque canal (tiroir-caisse physique vs
              comptes marchands Wave, Orange Money, MTN MoMo, Carte, Virement),
              y compris les tickets réglés en paiement mixte.
            </div>

            <table className="data-table">
              <thead>
                <tr>
                  <th>Canal de règlement</th>
                  <th>Support</th>
                  <th style={{ textAlign: 'right' }}>Encaissements (+)</th>
                  <th style={{ textAlign: 'right' }}>Décaissements (−)</th>
                  <th style={{ textAlign: 'right' }}>Solde net du canal</th>
                  <th style={{ textAlign: 'right' }}>Part du CA</th>
                </tr>
              </thead>
              <tbody>
                {data.paymentBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      Aucun flux enregistré sur la période sélectionnée.
                    </td>
                  </tr>
                ) : (
                  data.paymentBreakdown.map((row) => {
                    const sharePct =
                      data.revMetrics.totalRevenue > 0
                        ? Math.round(
                            (row.totalIn / data.revMetrics.totalRevenue) * 100,
                          )
                        : 0
                    return (
                      <tr key={row.method}>
                        <td style={{ fontWeight: 700 }}>
                          {categoryLabel('payment_method', row.method)}
                        </td>
                        <td>
                          <Badge
                            variant={
                              row.method === 'cash'
                                ? 'success-light'
                                : 'info-light'
                            }
                            size="sm"
                          >
                            {row.method === 'cash'
                              ? 'Caisse espèces'
                              : 'Mobile Money / Banque'}
                          </Badge>
                        </td>
                        <td
                          className="tabular-nums"
                          style={{
                            textAlign: 'right',
                            color: 'var(--color-success)',
                            fontWeight: 600,
                          }}
                        >
                          +{formatFCFA(row.totalIn)} ({row.inCount})
                        </td>
                        <td
                          className="tabular-nums"
                          style={{
                            textAlign: 'right',
                            color: 'var(--color-danger)',
                          }}
                        >
                          −{formatFCFA(row.totalOut)} ({row.outCount})
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right', fontWeight: 800 }}
                        >
                          {row.netFlow >= 0 ? '+' : ''}
                          {formatFCFA(row.netFlow)}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          {sharePct}%
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {reportType === 'caisse' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Statut</th>
                <th style={{ textAlign: 'right' }}>Ouverture</th>
                <th style={{ textAlign: 'right' }}>Entrées esp.</th>
                <th style={{ textAlign: 'right' }}>Sorties esp.</th>
                <th style={{ textAlign: 'right' }}>Théorique</th>
                <th style={{ textAlign: 'right' }}>Compté</th>
                <th style={{ textAlign: 'right' }}>Écart</th>
              </tr>
            </thead>
            <tbody>
              {data.sessions.length === 0 ? (
                <tr>
                  <td colSpan={8}>Aucune session de caisse sur la période.</td>
                </tr>
              ) : (
                data.sessions.map((s) => {
                  const mvs = state.cashMovements.filter(
                    (m) => m.sessionId === s.id,
                  )
                  const sum = calculateCashSessionSummary(
                    s.openingBalance,
                    mvs,
                  )
                  return (
                    <tr key={s.id}>
                      <td>{formatDateFR(s.openedAt)}</td>
                      <td>{s.status === 'open' ? 'Ouverte' : 'Clôturée'}</td>
                      <td
                        className="tabular-nums"
                        style={{ textAlign: 'right' }}
                      >
                        {formatFCFA(sum.openingBalance)}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{ textAlign: 'right' }}
                      >
                        {formatFCFA(sum.totalIn)}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{ textAlign: 'right' }}
                      >
                        {formatFCFA(sum.totalOut)}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{ textAlign: 'right', fontWeight: 700 }}
                      >
                        {formatFCFA(sum.theoreticalBalance)}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{ textAlign: 'right' }}
                      >
                        {s.countedClosingBalance !== undefined
                          ? formatFCFA(s.countedClosingBalance)
                          : '—'}
                      </td>
                      <td
                        className="tabular-nums"
                        style={{ textAlign: 'right', fontWeight: 700 }}
                      >
                        {s.discrepancy !== undefined
                          ? formatFCFA(s.discrepancy)
                          : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        )}

        {reportType === 'recettes' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Catégorie</th>
                <th>Paiement</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {data.revs.length === 0 ? (
                <tr>
                  <td colSpan={5}>Aucune recette sur la période.</td>
                </tr>
              ) : (
                data.revs.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateFR(r.date)}</td>
                    <td>{r.label}</td>
                    <td>{categoryLabel('revenue', r.categoryCode)}</td>
                    <td>{categoryLabel('payment_method', r.paymentMethod)}</td>
                    <td
                      className="tabular-nums"
                      style={{ textAlign: 'right', fontWeight: 700 }}
                    >
                      {formatFCFA(r.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {reportType === 'depenses' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Catégorie</th>
                <th>Bénéficiaire</th>
                <th style={{ textAlign: 'right' }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {data.exps.length === 0 ? (
                <tr>
                  <td colSpan={5}>Aucune dépense sur la période.</td>
                </tr>
              ) : (
                data.exps.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateFR(e.date)}</td>
                    <td>{e.label}</td>
                    <td>{categoryLabel('expense', e.categoryCode)}</td>
                    <td>{e.beneficiary || '—'}</td>
                    <td
                      className="tabular-nums"
                      style={{ textAlign: 'right', fontWeight: 700 }}
                    >
                      {formatFCFA(e.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {reportType === 'remunerations' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Salarié</th>
                <th>Poste</th>
                <th style={{ textAlign: 'right' }}>Brut prévu ({data.ym})</th>
                <th style={{ textAlign: 'right' }}>Avances</th>
                <th style={{ textAlign: 'right' }}>Net réglé</th>
                <th style={{ textAlign: 'right' }}>Reste dû</th>
              </tr>
            </thead>
            <tbody>
              {data.payrollRows.map((st) => (
                <tr key={st.employee.id}>
                  <td style={{ fontWeight: 600 }}>{st.employee.fullName}</td>
                  <td>{st.employee.roleTitle}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    {formatFCFA(
                      st.baseSalary + st.bonusesTotal + st.commissionCalculated,
                    )}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    {formatFCFA(
                      st.unsettledAdvancesTotal + st.settledAdvancesTotal,
                    )}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>
                    {formatFCFA(st.netPaidInValidatedPayrolls)}
                  </td>
                  <td
                    className="tabular-nums"
                    style={{ textAlign: 'right', fontWeight: 700 }}
                  >
                    {formatFCFA(st.remainingToPay)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {reportType === 'inventaire' && (
          <div>
            <div style={{ marginBottom: 10, fontWeight: 700 }}>
              Valeur totale du stock :{' '}
              {formatFCFA(data.invValuation.totalStockCostValue)}
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Réf.</th>
                  <th>Produit</th>
                  <th style={{ textAlign: 'right' }}>Qté disponible</th>
                  <th style={{ textAlign: 'right' }}>Coût unitaire</th>
                  <th style={{ textAlign: 'right' }}>Valeur stock</th>
                </tr>
              </thead>
              <tbody>
                {state.products.map((p) => (
                  <tr key={p.id}>
                    <td>{p.sku}</td>
                    <td>{p.name}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>
                      {p.quantity} {p.unit}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>
                      {formatFCFA(p.costPrice)}
                    </td>
                    <td
                      className="tabular-nums"
                      style={{ textAlign: 'right', fontWeight: 700 }}
                    >
                      {formatFCFA(Math.round(p.quantity * p.costPrice))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {reportType === 'audit' && (
          <div>
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--bg-surface-muted)',
                fontSize: '0.8rem',
              }}
            >
              <strong>Traçabilité comptable :</strong> toute rectification ou
              suppression d&apos;une pièce de recette, d&apos;une dépense, d&apos;une
              clôture de caisse, d&apos;un paiement de salaire validé ou d&apos;un
              ajustement de stock est consignée ci-dessous avec son motif.
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date &amp; Heure</th>
                  <th>Module</th>
                  <th>Résumé de l&apos;opération</th>
                  <th>Motif déclaré</th>
                </tr>
              </thead>
              <tbody>
                {data.auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      Aucune rectification ou annulation enregistrée sur cette
                      période.
                    </td>
                  </tr>
                ) : (
                  data.auditLogs.map((log) => {
                    const diffs = computeAuditDiffEntries(
                      log.previousSnapshotJson,
                      log.newSnapshotJson,
                    )
                    return (
                      <tr key={log.id}>
                        <td
                          className="tabular-nums"
                          style={{ whiteSpace: 'nowrap' }}
                        >
                          {formatDateTimeFR(log.createdAt)}
                        </td>
                        <td>
                          <span className="badge badge-amber">
                            {log.entityType}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{log.action}</div>
                          {diffs.length > 0 && (
                            <div
                              style={{
                                marginTop: 4,
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 6,
                                fontSize: '0.73rem',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {diffs.map((d) => (
                                <span
                                  key={d.fieldLabel}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '2px 6px',
                                    borderRadius: 6,
                                    background: 'var(--bg-surface-muted)',
                                    border: '1px solid var(--border-subtle)',
                                  }}
                                >
                                  <strong>{d.fieldLabel} :</strong>
                                  <span>{d.before}</span>
                                  <ArrowRight size={11} />
                                  <strong style={{ color: 'var(--accent-cta)' }}>
                                    {d.after}
                                  </strong>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td>{log.reason}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
