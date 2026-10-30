import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Download,
  Edit3,
  Plus,
  Printer,
  Unlock,
  Wallet,
  X,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
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
import { useCashSession } from '../../contexts/cashSessionContext'
import { usePeriodFilter } from '../../contexts/periodFilterContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import {
  calculateEmployeePayrollStatus,
  type EmployeePayrollStatus,
} from '../../domain/calculations/finance'
import type { SalaryPayment } from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import { formatDateFR, formatFCFA, todayISO } from '../../utils/format'

export function PayrollPage() {
  const { state, categoryLabel, mutate } = useSalonStore()
  const { selectedMonth: periodMonth, setSelectedMonth: setPeriodMonth } =
    usePeriodFilter()
  const { openSession, openQuickCashModal } = useCashSession()
  const { focusTarget, clearFocusTarget } = useWorkspaceFocus()
  const toast = useToast()

  const isRouteFocused = focusTarget?.route === '/payroll'

  const paymentMethods = useMemo(
    () =>
      state.categories.filter(
        (c) => c.scope === 'payment_method' && !c.isArchived,
      ),
    [state.categories],
  )

  const periodRevenues = useMemo(
    () =>
      state.revenues.filter(
        (r) => !r.isArchived && r.date.slice(0, 7) === periodMonth,
      ),
    [state.revenues, periodMonth],
  )

  const payrollRows = useMemo(() => {
    return state.employees
      .filter((e) => e.isActive)
      .map((employee) =>
        calculateEmployeePayrollStatus({
          employee,
          periodMonth,
          periodRevenues,
          advances: state.advances,
          bonuses: state.bonuses,
          salaryPayments: state.salaryPayments,
        }),
      )
  }, [
    state.employees,
    periodMonth,
    periodRevenues,
    state.advances,
    state.bonuses,
    state.salaryPayments,
  ])

  const totals = useMemo(() => {
    let expectedGross = 0
    let advances = 0
    let paidNet = 0
    let remaining = 0
    for (const st of payrollRows) {
      expectedGross +=
        st.baseSalary + st.bonusesTotal + st.commissionCalculated
      advances += st.unsettledAdvancesTotal + st.settledAdvancesTotal
      paidNet += st.netPaidInValidatedPayrolls
      remaining += st.remainingToPay
    }
    return { expectedGross, advances, paidNet, remaining }
  }, [payrollRows])

  const periodPayments = useMemo(
    () =>
      state.salaryPayments
        .filter((p) => p.periodMonth === periodMonth)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    [state.salaryPayments, periodMonth],
  )

  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [advEmpId, setAdvEmpId] = useState('')
  const [advDate, setAdvDate] = useState<string>(() => todayISO())
  const [advAmount, setAdvAmount] = useState('')
  const [advMethod, setAdvMethod] = useState('cash')
  const [advNotes, setAdvNotes] = useState('')

  const [bonusOpen, setBonusOpen] = useState(false)
  const [bonEmpId, setBonEmpId] = useState('')
  const [bonAmount, setBonAmount] = useState('')
  const [bonReason, setBonReason] = useState('')

  const [payStatus, setPayStatus] = useState<EmployeePayrollStatus | null>(null)
  const [payDate, setPayDate] = useState<string>(() => todayISO())
  const [payCommValidated, setPayCommValidated] = useState('0')
  const [payBonus, setPayBonus] = useState('0')
  const [payDeductions, setPayDeductions] = useState('0')
  const [payMethod, setPayMethod] = useState('cash')
  const [payNotes, setPayNotes] = useState('')
  const [isPartialPayment, setIsPartialPayment] = useState(false)
  const [partialNetAmount, setPartialNetAmount] = useState('')

  const [correctPayment, setCorrectPayment] = useState<SalaryPayment | null>(
    null,
  )
  const [corrNote, setCorrNote] = useState('')
  const [corrReason, setCorrReason] = useState('')

  const [receiptPayment, setReceiptPayment] = useState<SalaryPayment | null>(
    null,
  )
  const [busy, setBusy] = useState(false)

  const selectedAdvanceStatus = useMemo(
    () => payrollRows.find((r) => r.employee.id === advEmpId) ?? null,
    [payrollRows, advEmpId],
  )

  const openPayDialog = (st: EmployeePayrollStatus) => {
    setPayStatus(st)
    setPayDate(todayISO())
    setPayCommValidated(String(st.commissionCalculated))
    setPayBonus(String(st.bonusesTotal))
    setPayDeductions('0')
    setPayMethod('cash')
    setPayNotes('')
    setIsPartialPayment(false)
    setPartialNetAmount('')
  }

  const handleSaveAdvance = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.recordSalaryAdvance({
          employeeId: advEmpId,
          paidAt: `${advDate}T12:00:00.000Z`,
          periodMonth,
          amount: Number(advAmount),
          paymentMethod: advMethod,
          note: advNotes,
        }),
      )
      setAdvanceOpen(false)
      setAdvAmount('')
      setAdvNotes('')
      toast.success(
        'Avance enregistrée et sortie financière associée créée sans double comptage.',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur avance.')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveBonus = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.recordEmployeeBonus({
          employeeId: bonEmpId,
          periodMonth,
          amount: Number(bonAmount),
          reason: bonReason,
        }),
      )
      setBonusOpen(false)
      setBonAmount('')
      setBonReason('')
      toast.success('Prime ajoutée sur la période.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur prime.')
    } finally {
      setBusy(false)
    }
  }

  const fullCalculatedNetRemaining = payStatus
    ? Math.max(
        0,
        payStatus.baseSalary +
          Number(payBonus || 0) +
          Number(payCommValidated || 0) -
          Number(payDeductions || 0) -
          payStatus.settledAdvancesTotal -
          payStatus.unsettledAdvancesTotal -
          payStatus.netPaidInValidatedPayrolls,
      )
    : 0

  const effectiveNetToPay =
    isPartialPayment && Number(partialNetAmount) > 0
      ? Math.min(fullCalculatedNetRemaining, Math.round(Number(partialNetAmount)))
      : fullCalculatedNetRemaining

  const handleValidateSalary = async (e: FormEvent) => {
    e.preventDefault()
    if (!payStatus) return
    setBusy(true)
    try {
      const created = await mutate((repo) =>
        repo.validateSalaryPayment({
          employeeId: payStatus.employee.id,
          periodMonth,
          paidAt: `${payDate}T12:00:00.000Z`,
          baseSalary: payStatus.baseSalary,
          bonusesTotal: Number(payBonus || 0),
          deductions: Number(payDeductions || 0),
          commissionCalculated: payStatus.commissionCalculated,
          commissionValidated: Number(payCommValidated || 0),
          paymentMethod: payMethod,
          customNetAmount: isPartialPayment
            ? Number(partialNetAmount)
            : undefined,
          note: payNotes,
        }),
      )
      setPayStatus(null)
      setReceiptPayment(created)
      toast.success(
        created.isPartial
          ? 'Acompte partiel de salaire validé avec bulletin imprimable.'
          : 'Paiement de salaire validé et écriture financière unique enregistrée.',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur validation paie.')
    } finally {
      setBusy(false)
    }
  }

  const handleCorrectPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (!correctPayment) return
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.correctSalaryPaymentNoteOrBonus({
          payrollId: correctPayment.id,
          newNote: corrNote,
          reason: corrReason,
        }),
      )
      setCorrectPayment(null)
      setCorrReason('')
      toast.success('Correction traçable du bulletin de paie enregistrée.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Correction refusée.')
    } finally {
      setBusy(false)
    }
  }

  const handleExportCSV = () => {
    downloadCsvFile(
      `paie-${periodMonth}.csv`,
      [
        'Employé',
        'Poste',
        'Période',
        'Salaire de base',
        'Commission calculée',
        'Primes',
        'Avances versées',
        'Net déjà versé',
        'Reste à payer',
      ],
      payrollRows.map((st) => [
        st.employee.fullName,
        st.employee.roleTitle,
        periodMonth,
        st.baseSalary,
        st.commissionCalculated,
        st.bonusesTotal,
        st.unsettledAdvancesTotal + st.settledAdvancesTotal,
        st.netPaidInValidatedPayrolls,
        st.remainingToPay,
      ]),
    )
    toast.success('État de paie exporté en CSV.')
  }

  const handlePrintPayslip = () => {
    document.body.classList.add('printing-payslip-only')
    window.print()
    setTimeout(() => {
      document.body.classList.remove('printing-payslip-only')
    }, 400)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Salaires et commissions</h1>
          <p className="page-subtitle">
            Avances, commissions, règlements partiels ou complets ·{' '}
            <strong>{periodMonth}</strong>
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Input
            type="month"
            style={{ width: 165 }}
            value={periodMonth}
            onChange={(e) => setPeriodMonth(e.target.value)}
            aria-label="Mois de paie"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const targetId =
                (isRouteFocused ? focusTarget?.entityId : undefined) ??
                state.employees.find((e) => e.isActive)?.id ??
                ''
              setAdvEmpId(targetId)
              setAdvDate(todayISO())
              setAdvanceOpen(true)
            }}
            disabled={state.employees.length === 0}
          >
            <Plus size={15} />
            Avance sur salaire
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const targetId =
                (isRouteFocused ? focusTarget?.entityId : undefined) ??
                state.employees.find((e) => e.isActive)?.id ??
                ''
              setBonEmpId(targetId)
              setBonusOpen(true)
            }}
            disabled={state.employees.length === 0}
          >
            <Plus size={15} />
            Prime
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleExportCSV}
            disabled={payrollRows.length === 0}
          >
            <Download size={15} />
            Exporter CSV
          </Button>
        </div>
      </div>

      {isRouteFocused && focusTarget?.entityId && (
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
            Employé mis en évidence depuis le registre du personnel.
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={clearFocusTarget}
          >
            <X size={13} />
            Effacer la mise en évidence
          </Button>
        </div>
      )}

      <section className="kpi-grid no-print">
        <KpiCard
          label="Masse salariale prévue"
          value={formatFCFA(totals.expectedGross)}
          icon={<Award size={18} />}
          tone="blue"
          subtitle={`Fixe + primes + comm. (${periodMonth})`}
        />
        <KpiCard
          label="Avances déjà versées"
          value={formatFCFA(totals.advances)}
          icon={<Wallet size={18} />}
          tone="amber"
          subtitle="Déjà sorties en trésorerie"
        />
        <KpiCard
          label="Reliquats de salaires versés"
          value={formatFCFA(totals.paidNet)}
          icon={<CheckCircle2 size={18} />}
          tone="emerald"
          subtitle="Bulletins validés sur le mois"
        />
        <KpiCard
          label="Reste total à payer"
          value={formatFCFA(totals.remaining)}
          icon={<Award size={18} />}
          tone={totals.remaining > 0 ? 'danger' : 'emerald'}
          subtitle="Solde net restant dû à l'équipe"
        />
      </section>

      <article className="surface-card no-print">
        <div className="surface-card-body" style={{ paddingTop: 10 }}>
          {payrollRows.length === 0 ? (
            <EmptyState
              icon={<Award size={24} />}
              title="Aucun employé actif pour cette période"
              description="Ajoutez d'abord vos employés salariés dans la rubrique Personnel pour préparer la paie."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employé</th>
                    <th style={{ textAlign: 'right' }}>Base fixe</th>
                    <th style={{ textAlign: 'right' }}>Comm. &amp; Primes</th>
                    <th style={{ textAlign: 'right' }}>Avances &amp; Versé</th>
                    <th style={{ textAlign: 'right' }}>Reste à payer</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollRows.map((st) => {
                    const totalAdv =
                      st.unsettledAdvancesTotal + st.settledAdvancesTotal
                    const variableTotal =
                      st.commissionCalculated + st.bonusesTotal
                    const alreadyPaidTotal =
                      totalAdv + st.netPaidInValidatedPayrolls
                    const isFocused =
                      isRouteFocused && focusTarget?.entityId === st.employee.id
                    return (
                      <tr
                        key={st.employee.id}
                        style={
                          isFocused
                            ? { background: 'var(--accent-emerald-soft)' }
                            : undefined
                        }
                      >
                        <td>
                          <div className="flex items-center gap-2">
                            <span style={{ fontWeight: 600 }}>
                              {st.employee.fullName}
                            </span>
                            {st.overAdvanceAmount > 0 && (
                              <Badge variant="destructive-light" size="sm">
                                Dépassement +{formatFCFA(st.overAdvanceAmount)}
                              </Badge>
                            )}
                            {st.netPaidInValidatedPayrolls > 0 &&
                              st.remainingToPay > 0 && (
                                <Badge variant="warning-light" size="sm">
                                  Partiel versé
                                </Badge>
                              )}
                          </div>
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                            }}
                          >
                            {st.employee.roleTitle}
                            {st.employee.commissionEnabled
                              ? ` · ${st.employee.commissionRate}% sur ${formatFCFA(st.commissionBasisAmount)}`
                              : ''}
                          </div>
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          {formatFCFA(st.baseSalary)}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          <div>{formatFCFA(variableTotal)}</div>
                          {st.bonusesTotal > 0 && st.commissionCalculated > 0 && (
                            <div
                              style={{
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                              }}
                            >
                              dont {formatFCFA(st.bonusesTotal)} prime
                            </div>
                          )}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{
                            textAlign: 'right',
                            color:
                              alreadyPaidTotal > 0
                                ? 'var(--color-warning)'
                                : 'var(--text-muted)',
                          }}
                        >
                          <div>{formatFCFA(alreadyPaidTotal)}</div>
                          {totalAdv > 0 && st.netPaidInValidatedPayrolls > 0 && (
                            <div
                              style={{
                                fontSize: '0.7rem',
                                color: 'var(--text-muted)',
                              }}
                            >
                              Av. {formatFCFA(totalAdv)}
                            </div>
                          )}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{
                            textAlign: 'right',
                            fontWeight: 700,
                            color:
                              st.remainingToPay > 0
                                ? 'var(--color-danger)'
                                : 'var(--color-success)',
                          }}
                        >
                          {formatFCFA(st.remainingToPay)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {st.remainingToPay > 0 ? (
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ height: 30, padding: '0 10px' }}
                              onClick={() => openPayDialog(st)}
                            >
                              {st.netPaidInValidatedPayrolls > 0
                                ? 'Solder le reste'
                                : 'Régler le salaire'}
                            </button>
                          ) : (
                            <span className="badge badge-green">Soldé</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </article>

      {periodPayments.length > 0 && (
        <article className="surface-card no-print">
          <div className="surface-card-header">
            <div>
              <h2 className="surface-card-title">
                Paiements de salaires validés ({periodMonth})
              </h2>
              <div className="surface-card-subtitle">
                Chaque paiement validé est verrouillé ; toute annotation ou
                rectification passe par une correction traçable.
              </div>
            </div>
          </div>
          <div className="surface-card-body" style={{ paddingTop: 6 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employé</th>
                    <th>Type</th>
                    <th>Mode</th>
                    <th style={{ textAlign: 'right' }}>Avances déduites</th>
                    <th style={{ textAlign: 'right' }}>Retenues</th>
                    <th style={{ textAlign: 'right' }}>Net versé</th>
                    <th style={{ textAlign: 'right' }}>Bulletin / Correction</th>
                  </tr>
                </thead>
                <tbody>
                  {periodPayments.map((pmt) => {
                    const emp = state.employees.find(
                      (e) => e.id === pmt.employeeId,
                    )
                    return (
                      <tr key={pmt.id}>
                        <td className="tabular-nums">
                          {formatDateFR(pmt.paidAt)}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {emp ? emp.fullName : '—'}
                        </td>
                        <td>
                          <Badge
                            variant={
                              pmt.isPartial ? 'warning-light' : 'success-light'
                            }
                            size="sm"
                          >
                            {pmt.isPartial ? 'Acompte partiel' : 'Solde'}
                          </Badge>
                        </td>
                        <td>
                          {categoryLabel('payment_method', pmt.paymentMethod)}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          {formatFCFA(pmt.advancesDeducted)}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right' }}
                        >
                          {formatFCFA(pmt.deductions)}
                        </td>
                        <td
                          className="tabular-nums"
                          style={{ textAlign: 'right', fontWeight: 700 }}
                        >
                          {formatFCFA(pmt.netPaidAmount)}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <div
                            style={{
                              display: 'inline-flex',
                              gap: 6,
                              justifyContent: 'flex-end',
                            }}
                          >
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ height: 28, padding: '0 8px' }}
                              onClick={() => setReceiptPayment(pmt)}
                            >
                              <Printer size={13} />
                              Reçu
                            </button>
                            <button
                              type="button"
                              className="btn btn-outline"
                              style={{ height: 28, padding: '0 8px' }}
                              onClick={() => {
                                setCorrectPayment(pmt)
                                setCorrNote(pmt.note ?? '')
                                setCorrReason('')
                              }}
                            >
                              <Edit3 size={13} />
                              Corriger
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      )}

      {/* Bulletin / Reçu de paiement de salaire imprimable avec cadres de signature */}
      {receiptPayment && (
        <Modal
          open={receiptPayment !== null}
          title="Bulletin & Reçu de paiement de salaire"
          subtitle="Document prêt à imprimer avec encadrés de signature employeur et salarié"
          maxWidth={600}
          onClose={() => setReceiptPayment(null)}
        >
          {(() => {
            const emp = state.employees.find(
              (e) => e.id === receiptPayment.employeeId,
            )
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  className="a4-preview-sheet payslip-print-sheet"
                  style={{ padding: 22 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      borderBottom: '2px solid #18181b',
                      paddingBottom: 10,
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '1.08rem' }}>
                        {state.salon.name}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#52525b' }}>
                        {state.salon.address} · Tél. {state.salon.phone}
                      </div>
                    </div>
                    <Badge
                      variant={
                        receiptPayment.isPartial
                          ? 'warning-light'
                          : 'success-light'
                      }
                      size="sm"
                    >
                      {receiptPayment.isPartial
                        ? 'ACOMPTE / RÈGLEMENT PARTIEL'
                        : 'SOLDE DE PAIE VALIDÉ'}
                    </Badge>
                  </div>

                  <h3 style={{ margin: '0 0 12px', fontSize: '0.96rem' }}>
                    BULLETIN &amp; REÇU DE PAIEMENT DE SALAIRE — Période{' '}
                    {receiptPayment.periodMonth}
                  </h3>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                      fontSize: '0.82rem',
                      padding: 10,
                      borderRadius: 8,
                      background: 'var(--bg-surface-muted)',
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <strong>Salarié(e) :</strong> {emp?.fullName ?? '—'}
                    </div>
                    <div>
                      <strong>Fonction :</strong> {emp?.roleTitle ?? '—'}
                    </div>
                    <div>
                      <strong>Date de règlement :</strong>{' '}
                      {formatDateFR(receiptPayment.paidAt)}
                    </div>
                    <div>
                      <strong>Mode de règlement :</strong>{' '}
                      {categoryLabel(
                        'payment_method',
                        receiptPayment.paymentMethod,
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gap: 6,
                      fontSize: '0.84rem',
                      marginBottom: 14,
                    }}
                  >
                    <div className="flex justify-between">
                      <span>Salaire fixe mensuel de base</span>
                      <strong className="tabular-nums">
                        {formatFCFA(receiptPayment.baseSalary)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        Commission validée (calculée :{' '}
                        {formatFCFA(receiptPayment.commissionCalculated)})
                      </span>
                      <strong className="tabular-nums">
                        +{formatFCFA(receiptPayment.commissionValidated)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Primes sur la période</span>
                      <strong className="tabular-nums">
                        +{formatFCFA(receiptPayment.bonusesTotal)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>Avances déjà perçues déduites</span>
                      <span className="tabular-nums">
                        −{formatFCFA(receiptPayment.advancesDeducted)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Autres retenues éventuelles</span>
                      <span className="tabular-nums">
                        −{formatFCFA(receiptPayment.deductions)}
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 10,
                        borderTop: '1px solid #d4d4d8',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '1rem',
                        fontWeight: 800,
                      }}
                    >
                      <span>NET VERSÉ CE JOUR</span>
                      <span
                        className="tabular-nums"
                        style={{ color: 'var(--accent-cta)' }}
                      >
                        {formatFCFA(receiptPayment.netPaidAmount)}
                      </span>
                    </div>
                    {receiptPayment.note && (
                      <div
                        style={{
                          fontSize: '0.78rem',
                          color: 'var(--text-muted)',
                          marginTop: 4,
                        }}
                      >
                        Observation : {receiptPayment.note}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 14,
                      marginTop: 18,
                    }}
                  >
                    <div
                      style={{
                        border: '1px solid #d4d4d8',
                        borderRadius: 8,
                        padding: '10px 12px',
                        minHeight: 74,
                        fontSize: '0.75rem',
                      }}
                    >
                      <strong>Cachet &amp; Signature Gérant(e)</strong>
                      <div style={{ color: '#71717a', marginTop: 2 }}>
                        {state.salon.managerName}
                      </div>
                    </div>
                    <div
                      style={{
                        border: '1px solid #d4d4d8',
                        borderRadius: 8,
                        padding: '10px 12px',
                        minHeight: 74,
                        fontSize: '0.75rem',
                      }}
                    >
                      <strong>Signature du Salarié (« Bon pour acquit »)</strong>
                      <div style={{ color: '#71717a', marginTop: 2 }}>
                        {emp?.fullName ?? ''}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="no-print flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setReceiptPayment(null)}
                  >
                    Fermer
                  </Button>
                  <Button type="button" onClick={handlePrintPayslip}>
                    <Printer size={15} />
                    Imprimer le bulletin
                  </Button>
                </div>
              </div>
            )
          })()}
        </Modal>
      )}

      {/* Modale Avance avec contrôle intelligent du plafond */}
      <Modal
        open={advanceOpen}
        title="Enregistrer une avance sur salaire"
        subtitle={`Période imputée : ${periodMonth} · Crée immédiatement la sortie financière correspondante.`}
        onClose={() => setAdvanceOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleSaveAdvance(e)}>
          <FieldGroup>
            {advMethod === 'cash' && !openSession && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background: 'var(--color-warning-bg)',
                  border: '1px solid rgba(217, 119, 6, 0.35)',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: '0.78rem',
                }}
              >
                <span>
                  Caisse espèces fermée : ouvrez-la pour imputer cette avance au
                  tiroir-caisse.
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={openQuickCashModal}
                >
                  <Unlock size={12} />
                  Ouvrir la caisse
                </Button>
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="f-adv-emp">Employé bénéficiaire</FieldLabel>
              <Select value={advEmpId} onValueChange={setAdvEmpId}>
                <SelectTrigger id="f-adv-emp">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.employees
                    .filter((e) => e.isActive)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.fullName} ({e.roleTitle})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>

            {selectedAdvanceStatus && (
              <div
                style={{
                  padding: '9px 12px',
                  borderRadius: 8,
                  background:
                    Number(advAmount || 0) > selectedAdvanceStatus.remainingToPay
                      ? 'var(--color-warning-bg)'
                      : 'var(--bg-surface-muted)',
                  border: `1px solid ${
                    Number(advAmount || 0) > selectedAdvanceStatus.remainingToPay
                      ? 'rgba(217, 119, 6, 0.4)'
                      : 'var(--border-subtle)'
                  }`,
                  fontSize: '0.79rem',
                }}
              >
                <div className="flex justify-between">
                  <span>Plafond net disponible ce mois :</span>
                  <strong className="tabular-nums">
                    {formatFCFA(selectedAdvanceStatus.remainingToPay)}
                  </strong>
                </div>
                {Number(advAmount || 0) >
                  selectedAdvanceStatus.remainingToPay && (
                  <div
                    className="mt-1 flex items-center gap-1.5 font-medium"
                    style={{ color: 'var(--color-warning)' }}
                  >
                    <AlertTriangle size={14} />
                    Attention : cette avance dépasse le solde net estimé du mois
                    de{' '}
                    {formatFCFA(
                      Math.round(Number(advAmount || 0)) -
                        selectedAdvanceStatus.remainingToPay,
                    )}
                    .
                  </div>
                )}
              </div>
            )}

            <div className="form-grid-2">
              <Field>
                <FieldLabel htmlFor="f-adv-date">Date de versement</FieldLabel>
                <Input
                  id="f-adv-date"
                  type="date"
                  required
                  value={advDate}
                  onChange={(e) => setAdvDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-adv-amt">
                  Montant de l&apos;avance (FCFA)
                </FieldLabel>
                <Input
                  id="f-adv-amt"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={advAmount}
                  onChange={(e) => setAdvAmount(e.target.value)}
                />
              </Field>
            </div>
            <div className="form-grid-2">
              <Field>
                <FieldLabel htmlFor="f-adv-method">Mode de paiement</FieldLabel>
                <Select value={advMethod} onValueChange={setAdvMethod}>
                  <SelectTrigger id="f-adv-method">
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
                <FieldLabel htmlFor="f-adv-notes">Motif / Note</FieldLabel>
                <Input
                  id="f-adv-notes"
                  type="text"
                  placeholder="Ex. Avance quinzaine"
                  value={advNotes}
                  onChange={(e) => setAdvNotes(e.target.value)}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdvanceOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Enregistrer l&apos;avance
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      {/* Modale Prime */}
      <Modal
        open={bonusOpen}
        title="Attribuer une prime"
        subtitle={`Période : ${periodMonth} · S'ajoute à la rémunération brute à verser lors de la paie.`}
        onClose={() => setBonusOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleSaveBonus(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="f-bon-emp">Employé</FieldLabel>
              <Select value={bonEmpId} onValueChange={setBonEmpId}>
                <SelectTrigger id="f-bon-emp">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.employees
                    .filter((e) => e.isActive)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.fullName}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="f-bon-amt">
                Montant de la prime (FCFA)
              </FieldLabel>
              <Input
                id="f-bon-amt"
                type="number"
                min={1}
                step={1}
                required
                value={bonAmount}
                onChange={(e) => setBonAmount(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="f-bon-reason">Motif de la prime</FieldLabel>
              <Input
                id="f-bon-reason"
                type="text"
                required
                placeholder="Ex. Prime d'assiduité et qualité client"
                value={bonReason}
                onChange={(e) => setBonReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setBonusOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Ajouter la prime
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      {/* Modale Validation de salaire (solde complet ou acompte partiel) */}
      <Modal
        open={payStatus !== null}
        title="Valider un paiement de salaire"
        subtitle={`Période ${periodMonth} · Règlement complet ou partiel sans double comptage.`}
        maxWidth={580}
        onClose={() => setPayStatus(null)}
      >
        {payStatus && (
          <form
            className="w-full"
            onSubmit={(e) => void handleValidateSalary(e)}
          >
            <FieldGroup>
              {payMethod === 'cash' && !openSession && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 8,
                    background: 'var(--color-warning-bg)',
                    border: '1px solid rgba(217, 119, 6, 0.35)',
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: '0.78rem',
                  }}
                >
                  <span>
                    Caisse espèces fermée : ouvrez-la pour imputer ce versement
                    au tiroir-caisse.
                  </span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={openQuickCashModal}
                  >
                    <Unlock size={12} />
                    Ouvrir la caisse
                  </Button>
                </div>
              )}

              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: 'var(--bg-surface-muted)',
                  fontSize: '0.82rem',
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div>
                  <strong>Salarié :</strong> {payStatus.employee.fullName}
                </div>
                <div>
                  <strong>Salaire fixe :</strong>{' '}
                  {formatFCFA(payStatus.baseSalary)}
                </div>
                <div>
                  <strong>Commission calculée auto :</strong>{' '}
                  {formatFCFA(payStatus.commissionCalculated)} (base :{' '}
                  {formatFCFA(payStatus.commissionBasisAmount)}, taux{' '}
                  {payStatus.employee.commissionRate}%)
                </div>
                <div>
                  <strong>Avances non imputées déduites auto :</strong> −
                  {formatFCFA(payStatus.unsettledAdvancesTotal)}
                </div>
                {payStatus.netPaidInValidatedPayrolls > 0 && (
                  <div>
                    <strong>Acomptes de paie déjà versés ce mois :</strong> −
                    {formatFCFA(payStatus.netPaidInValidatedPayrolls)}
                  </div>
                )}
              </div>

              <div className="form-grid-2">
                <Field>
                  <FieldLabel htmlFor="f-pay-date">
                    Date de versement
                  </FieldLabel>
                  <Input
                    id="f-pay-date"
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="f-pay-comm">
                    Commission réellement validée (FCFA)
                  </FieldLabel>
                  <Input
                    id="f-pay-comm"
                    type="number"
                    min={0}
                    step={1}
                    value={payCommValidated}
                    onChange={(e) => setPayCommValidated(e.target.value)}
                  />
                </Field>
              </div>

              <div className="form-grid-2">
                <Field>
                  <FieldLabel htmlFor="f-pay-bon">
                    Primes totales validées (FCFA)
                  </FieldLabel>
                  <Input
                    id="f-pay-bon"
                    type="number"
                    min={0}
                    step={1}
                    value={payBonus}
                    onChange={(e) => setPayBonus(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="f-pay-ded">
                    Retenues éventuelles (FCFA)
                  </FieldLabel>
                  <Input
                    id="f-pay-ded"
                    type="number"
                    min={0}
                    step={1}
                    value={payDeductions}
                    onChange={(e) => setPayDeductions(e.target.value)}
                  />
                </Field>
              </div>

              {/* Option Règlement partiel (acompte + solde restant) */}
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface-muted)',
                }}
                className="space-y-2"
              >
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={isPartialPayment}
                    onChange={(e) => {
                      setIsPartialPayment(e.target.checked)
                      if (e.target.checked && !partialNetAmount) {
                        setPartialNetAmount(
                          String(Math.floor(fullCalculatedNetRemaining / 2)),
                        )
                      }
                    }}
                  />
                  Verser un règlement partiel (conserver le reliquat restant à
                  payer plus tard)
                </label>

                {isPartialPayment && (
                  <Field>
                    <FieldLabel htmlFor="f-pay-partial">
                      Montant partiel versé aujourd&apos;hui (FCFA — max{' '}
                      {formatFCFA(fullCalculatedNetRemaining)})
                    </FieldLabel>
                    <Input
                      id="f-pay-partial"
                      type="number"
                      min={1}
                      max={Math.max(1, fullCalculatedNetRemaining)}
                      step={1}
                      required
                      value={partialNetAmount}
                      onChange={(e) => setPartialNetAmount(e.target.value)}
                    />
                  </Field>
                )}
              </div>

              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'var(--color-success-bg)',
                  color: 'var(--color-success)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>
                  {isPartialPayment
                    ? 'Acompte net versé ce jour :'
                    : 'Solde net à verser :'}
                </span>
                <span className="tabular-nums">
                  {formatFCFA(effectiveNetToPay)}
                </span>
              </div>

              <div className="form-grid-2">
                <Field>
                  <FieldLabel htmlFor="f-pay-method">
                    Mode de règlement
                  </FieldLabel>
                  <Select value={payMethod} onValueChange={setPayMethod}>
                    <SelectTrigger id="f-pay-method">
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
                  <FieldLabel htmlFor="f-pay-notes">
                    Note (optionnel)
                  </FieldLabel>
                  <Input
                    id="f-pay-notes"
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                  />
                </Field>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPayStatus(null)}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={busy}>
                  Valider le paiement
                </Button>
              </div>
            </FieldGroup>
          </form>
        )}
      </Modal>

      {/* Modale Correction traçable */}
      <Modal
        open={correctPayment !== null}
        title="Annotation / Correction traçable d'un bulletin validé"
        subtitle="Le motif de rectification est obligatoire et enregistré dans le journal d'audit."
        onClose={() => setCorrectPayment(null)}
      >
        <form
          className="w-full"
          onSubmit={(e) => void handleCorrectPayment(e)}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="corr-sal-note">
                Note rectifiée sur le bulletin
              </FieldLabel>
              <Input
                id="corr-sal-note"
                type="text"
                required
                value={corrNote}
                onChange={(e) => setCorrNote(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="corr-sal-reason">
                Motif obligatoire de la correction
              </FieldLabel>
              <Input
                id="corr-sal-reason"
                type="text"
                required
                placeholder="Ex. Précision référence virement ou régularisation"
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCorrectPayment(null)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Enregistrer la correction
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>
    </div>
  )
}
