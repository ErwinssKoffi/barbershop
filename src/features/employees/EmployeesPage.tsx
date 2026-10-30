import {
  Award,
  CheckCircle2,
  Download,
  History,
  Plus,
  Power,
  Search,
  SettingsIcon,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Badge } from '@/components/reui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { usePeriodFilter } from '../../contexts/periodFilterContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import { calculateEmployeePerformanceSummary } from '../../domain/calculations/finance'
import type {
  CommissionBasis,
  Employee,
  RemunerationType,
} from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { downloadCsvFile } from '../../utils/csv'
import {
  currentMonthISO,
  formatDateFR,
  formatFCFA,
  isIsoInBounds,
  todayISO,
} from '../../utils/format'

export function EmployeesPage() {
  const { state, mutate } = useSalonStore()
  const { bounds, periodLabel } = usePeriodFilter()
  const { focusTarget, navigateToEntity, clearFocusTarget } =
    useWorkspaceFocus()
  const toast = useToast()

  const [localSearch, setLocalSearch] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'inactive'
  >('all')

  const isRouteFocused = focusTarget?.route === '/employees'
  const search =
    localSearch !== null
      ? localSearch
      : isRouteFocused
        ? (focusTarget.searchQuery ?? '')
        : ''

  const periodRevenues = useMemo(
    () =>
      state.revenues.filter(
        (r) => !r.isArchived && isIsoInBounds(r.date, bounds),
      ),
    [state.revenues, bounds],
  )

  const perfByEmpId = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof calculateEmployeePerformanceSummary>
    >()
    for (const emp of state.employees) {
      map.set(
        emp.id,
        calculateEmployeePerformanceSummary(emp, periodRevenues, state.services),
      )
    }
    return map
  }, [state.employees, periodRevenues, state.services])

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    return state.employees
      .filter((e) =>
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
            ? e.isActive
            : !e.isActive,
      )
      .filter(
        (e) =>
          !q ||
          e.fullName.toLowerCase().includes(q) ||
          e.roleTitle.toLowerCase().includes(q),
      )
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
  }, [state.employees, statusFilter, search])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Employee | null>(null)
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [roleTitle, setRoleTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [hireDate, setHireDate] = useState<string>(() => todayISO())
  const [baseSalary, setBaseSalary] = useState('')
  const [remunerationType, setRemunerationType] =
    useState<RemunerationType>('fixed')
  const [commissionEnabled, setCommissionEnabled] = useState(false)
  const [commissionRate, setCommissionRate] = useState('0')
  const [commissionBasis, setCommissionBasis] =
    useState<CommissionBasis>('employee_services')
  const [defaultBonus, setDefaultBonus] = useState('0')
  const [adminNote, setAdminNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [currentYm] = useState<string>(() => currentMonthISO())
  const [today] = useState<string>(() => todayISO())

  const [historyEmp, setHistoryEmp] = useState<Employee | null>(null)

  const hrMetrics = useMemo(() => {
    const active = state.employees.filter((e) => e.isActive)
    const fixedPayrollBase = active.reduce((sum, e) => sum + e.baseSalary, 0)
    const withCommCount = active.filter(
      (e) => e.remunerationType === 'fixed_plus_variable' && e.commissionEnabled,
    ).length
    const monthPaidNet = state.salaryPayments
      .filter((p) => p.periodMonth === currentYm)
      .reduce((sum, p) => sum + p.netPaidAmount, 0)

    return {
      activeCount: active.length,
      totalCount: state.employees.length,
      fixedPayrollBase,
      withCommCount,
      monthPaidNet,
    }
  }, [state.employees, state.salaryPayments, currentYm])

  const handleExportCSV = () => {
    downloadCsvFile(
      `registre-personnel-${today}.csv`,
      [
        'Nom',
        'Prénom',
        'Poste',
        'Téléphone',
        'Date embauche',
        'Salaire fixe FCFA',
        'Type rémunération',
        'Taux commission %',
        'Statut',
      ],
      filteredEmployees.map((emp) => [
        emp.lastName,
        emp.firstName,
        emp.roleTitle,
        emp.phone,
        emp.hireDate,
        emp.baseSalary,
        emp.remunerationType === 'fixed_plus_variable' && emp.commissionEnabled
          ? 'Fixe + Variable'
          : 'Fixe',
        emp.commissionEnabled ? emp.commissionRate : 0,
        emp.isActive ? 'Actif' : 'Inactif',
      ]),
    )
    toast.success('Registre du personnel exporté en CSV.')
  }

  const openCreate = () => {
    setEditing(null)
    setLastName('')
    setFirstName('')
    setRoleTitle('')
    setPhone('')
    setHireDate(todayISO())
    setBaseSalary('85000')
    setRemunerationType('fixed')
    setCommissionEnabled(false)
    setCommissionRate('0')
    setCommissionBasis('employee_services')
    setDefaultBonus('0')
    setAdminNote('')
    setFormOpen(true)
  }

  const openEdit = (emp: Employee) => {
    setEditing(emp)
    setLastName(emp.lastName)
    setFirstName(emp.firstName)
    setRoleTitle(emp.roleTitle)
    setPhone(emp.phone)
    setHireDate(emp.hireDate)
    setBaseSalary(String(emp.baseSalary))
    setRemunerationType(emp.remunerationType)
    setCommissionEnabled(emp.commissionEnabled)
    setCommissionRate(String(emp.commissionRate))
    setCommissionBasis(emp.commissionBasis)
    setDefaultBonus(String(emp.defaultBonus))
    setAdminNote(emp.adminNote)
    setFormOpen(true)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const commOn =
      remunerationType === 'fixed_plus_variable' && commissionEnabled
    try {
      await mutate((repo) =>
        repo.saveEmployee({
          id: editing?.id,
          lastName,
          firstName,
          roleTitle,
          phone,
          hireDate,
          baseSalary: Number(baseSalary),
          remunerationType,
          commissionEnabled: commOn,
          commissionRate: commOn ? Number(commissionRate) : 0,
          commissionBasis,
          defaultBonus: Number(defaultBonus || 0),
          adminNote,
        }),
      )
      toast.success(
        editing ? 'Fiche employé mise à jour.' : 'Employé enregistré.',
      )
      setFormOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur employé.')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleActive = async (emp: Employee) => {
    try {
      await mutate((repo) => repo.toggleEmployeeActive(emp.id))
      toast.success(
        emp.isActive
          ? `Employé ${emp.fullName} désactivé (historique conservé).`
          : `Employé ${emp.fullName} réactivé.`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur statut.')
    }
  }

  const empHistory = useMemo(() => {
    if (!historyEmp) return { payments: [], advances: [], bonuses: [] }
    return {
      payments: state.salaryPayments
        .filter((p) => p.employeeId === historyEmp.id)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      advances: state.advances
        .filter((a) => !a.isArchived && a.employeeId === historyEmp.id)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
      bonuses: state.bonuses
        .filter((b) => b.employeeId === historyEmp.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  }, [historyEmp, state.salaryPayments, state.advances, state.bonuses])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestion du personnel</h1>
          <p className="page-subtitle">
            Employés salariés du salon, contrat de rémunération et historique
            individuel
          </p>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button type="button" variant="outline" onClick={handleExportCSV}>
            <Download size={15} />
            Exporter CSV
          </Button>
          <Button type="button" onClick={openCreate}>
            <Plus size={15} />
            Ajouter un employé
          </Button>
        </div>
      </div>

      <section className="kpi-grid">
        <KpiCard
          label="Personnel actif"
          value={String(hrMetrics.activeCount)}
          icon={<Users size={18} />}
          tone="emerald"
          subtitle={`Sur ${hrMetrics.totalCount} enregistré(s)`}
        />
        <KpiCard
          label="Masse salariale fixe"
          value={formatFCFA(hrMetrics.fixedPayrollBase)}
          icon={<Wallet size={18} />}
          tone="blue"
          subtitle="Base mensuelle contractuelle"
        />
        <KpiCard
          label="Commissions activées"
          value={String(hrMetrics.withCommCount)}
          icon={<Award size={18} />}
          tone="amber"
          subtitle="Salariés avec part variable"
        />
        <KpiCard
          label="Salaires nets versés"
          value={formatFCFA(hrMetrics.monthPaidNet)}
          icon={<CheckCircle2 size={18} />}
          tone="teal"
          subtitle={`Mois ${currentYm}`}
        />
      </section>

      <div
        className="surface-card"
        style={{
          padding: '16px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
          alignItems: 'end',
        }}
      >
        <Field>
          <FieldLabel htmlFor="emp-status">Statut</FieldLabel>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as 'all' | 'active' | 'inactive')
            }
          >
            <SelectTrigger id="emp-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tout le personnel</SelectItem>
              <SelectItem value="active">Actifs uniquement</SelectItem>
              <SelectItem value="inactive">Inactifs uniquement</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-search">Rechercher un employé</FieldLabel>
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
              id="emp-search"
              type="search"
              style={{ paddingLeft: 34 }}
              placeholder="Nom, prénom, poste..."
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
          {filteredEmployees.length === 0 ? (
            <EmptyState
              icon={<Users size={24} />}
              title="Aucun employé enregistré"
              description="Ajoutez les membres salariés de votre salon avec leur salaire fixe mensuel et leurs modalités éventuelles de prime ou commission."
              actionLabel="Ajouter un employé"
              onAction={openCreate}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employé &amp; Poste</TableHead>
                  <TableHead className="text-right">Rémunération</TableHead>
                  <TableHead className="text-right">
                    Performance ({periodLabel})
                  </TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((emp) => {
                  const perf = perfByEmpId.get(emp.id)
                  const basisShort =
                    emp.commissionBasis === 'employee_services_and_products'
                      ? 'Prest. + Ventes'
                      : emp.commissionBasis === 'total_revenue'
                        ? 'CA global'
                        : 'Prestations'
                  return (
                    <TableRow
                      key={emp.id}
                      style={{ opacity: emp.isActive ? 1 : 0.62 }}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">
                            {emp.lastName} {emp.firstName}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {emp.roleTitle} ·{' '}
                            {emp.phone ||
                              `Embauche ${formatDateFR(emp.hireDate, state.settings.dateFormat)}`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-semibold tabular-nums">
                            {formatFCFA(emp.baseSalary)}
                          </span>
                          {emp.remunerationType === 'fixed_plus_variable' &&
                          emp.commissionEnabled ? (
                            <span
                              className="text-xs font-medium"
                              style={{ color: 'var(--accent-cta)' }}
                            >
                              + {emp.commissionRate}% ({basisShort})
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              Fixe
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {perf && perf.totalGeneratedRevenue > 0 ? (
                          <div className="flex flex-col items-end">
                            <span
                              className="text-sm font-semibold tabular-nums"
                              style={{ color: 'var(--accent-cta)' }}
                            >
                              {formatFCFA(perf.totalGeneratedRevenue)}
                            </span>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {perf.servicesCount} prestat.
                              {perf.productsSoldCount > 0
                                ? ` + ${perf.productsSoldCount} vente(s)`
                                : ''}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            emp.isActive ? 'success-light' : 'destructive-light'
                          }
                          size="sm"
                        >
                          {emp.isActive ? 'Actif' : 'Inactif'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          {emp.isActive && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7"
                              title="Ouvrir la paie ou verser une avance à cet employé"
                              onClick={() =>
                                navigateToEntity({
                                  route: '/payroll',
                                  entityId: emp.id,
                                })
                              }
                            >
                              <TrendingUp
                                className="size-3.5"
                                aria-hidden="true"
                              />
                              Paie
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            title="Historique des rémunérations"
                            aria-label={`Historique de ${emp.fullName}`}
                            onClick={() => setHistoryEmp(emp)}
                          >
                            <History size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7"
                            title="Modifier la fiche"
                            aria-label={`Modifier ${emp.fullName}`}
                            onClick={() => openEdit(emp)}
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
                            title={
                              emp.isActive
                                ? 'Désactiver cet employé'
                                : 'Réactiver cet employé'
                            }
                            onClick={() => void handleToggleActive(emp)}
                          >
                            <Power size={14} />
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
        title={editing ? 'Modifier un employé' : 'Nouvel employé salarié'}
        subtitle="Les commissions sont désactivées par défaut et configurables explicitement."
        maxWidth={600}
        onClose={() => setFormOpen(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleSubmit(e)}>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-emp-last">Nom</FieldLabel>
                <Input
                  id="f-emp-last"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-emp-first">Prénom</FieldLabel>
                <Input
                  id="f-emp-first"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-emp-role">Poste ou fonction</FieldLabel>
                <Input
                  id="f-emp-role"
                  type="text"
                  required
                  placeholder="Ex. Coiffeuse tresses, Chef barbier..."
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-emp-phone">
                  Téléphone (optionnel)
                </FieldLabel>
                <Input
                  id="f-emp-phone"
                  type="tel"
                  placeholder="+225 07..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-emp-hire">
                  Date d&apos;embauche
                </FieldLabel>
                <Input
                  id="f-emp-hire"
                  type="date"
                  required
                  value={hireDate}
                  onChange={(e) => setHireDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="f-emp-base">
                  Salaire fixe mensuel (FCFA)
                </FieldLabel>
                <Input
                  id="f-emp-base"
                  type="number"
                  min={0}
                  step={1}
                  required
                  value={baseSalary}
                  onChange={(e) => setBaseSalary(e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="f-emp-remtype">
                  Type de rémunération
                </FieldLabel>
                <Select
                  value={remunerationType}
                  onValueChange={(v) => {
                    const val = v as RemunerationType
                    setRemunerationType(val)
                    if (val === 'fixed') setCommissionEnabled(false)
                  }}
                >
                  <SelectTrigger id="f-emp-remtype">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">
                      Salaire fixe uniquement
                    </SelectItem>
                    <SelectItem value="fixed_plus_variable">
                      Salaire fixe + commission configurable
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="f-emp-bonus">
                  Prime habituelle indicative (FCFA)
                </FieldLabel>
                <Input
                  id="f-emp-bonus"
                  type="number"
                  min={0}
                  step={1}
                  value={defaultBonus}
                  onChange={(e) => setDefaultBonus(e.target.value)}
                />
              </Field>
            </div>

            {remunerationType === 'fixed_plus_variable' && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: 'var(--bg-surface-muted)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={commissionEnabled}
                    onChange={(e) => setCommissionEnabled(e.target.checked)}
                  />
                  Activer le calcul de commission variable pour cet employé
                </label>

                {commissionEnabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <Field>
                      <FieldLabel htmlFor="f-emp-basis">
                        Base de calcul explicite
                      </FieldLabel>
                      <Select
                        value={commissionBasis}
                        onValueChange={(v) =>
                          setCommissionBasis(v as CommissionBasis)
                        }
                      >
                        <SelectTrigger id="f-emp-basis">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee_services">
                            Prestations seules associées à l&apos;employé (défaut)
                          </SelectItem>
                          <SelectItem value="employee_services_and_products">
                            Prestations + Produits vendus par l&apos;employé
                          </SelectItem>
                          <SelectItem value="total_revenue">
                            Chiffre d&apos;affaires global du salon
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="f-emp-rate">
                        Taux ou pourcentage (%)
                      </FieldLabel>
                      <Input
                        id="f-emp-rate"
                        type="number"
                        min={0.5}
                        max={100}
                        step={0.5}
                        value={commissionRate}
                        onChange={(e) => setCommissionRate(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="f-emp-notes">Note administrative</FieldLabel>
              <Input
                id="f-emp-notes"
                type="text"
                placeholder="Ex. Spécialiste tresses africaines, repos le lundi"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {editing ? 'Enregistrer' : 'Créer la fiche employé'}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      <Modal
        open={historyEmp !== null}
        title={
          historyEmp
            ? `Historique de rémunération — ${historyEmp.fullName}`
            : ''
        }
        subtitle={
          historyEmp
            ? `${historyEmp.roleTitle} · Salaire fixe de base : ${formatFCFA(historyEmp.baseSalary)}`
            : ''
        }
        maxWidth={680}
        onClose={() => setHistoryEmp(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.92rem' }}>
              Paiements de salaires validés ({empHistory.payments.length})
            </h3>
            {empHistory.payments.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Aucun bulletin de salaire enregistré pour le moment.
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Période</th>
                      <th>Date versement</th>
                      <th>Net versé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empHistory.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.periodMonth}</td>
                        <td>{formatDateFR(p.paidAt)}</td>
                        <td className="tabular-nums" style={{ fontWeight: 700 }}>
                          {formatFCFA(p.netPaidAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: '0.92rem' }}>
              Avances sur salaire ({empHistory.advances.length}) &amp; Primes (
              {empHistory.bonuses.length})
            </h3>
            {empHistory.advances.length === 0 &&
            empHistory.bonuses.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Aucune avance ni prime enregistrée.
              </div>
            ) : (
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  fontSize: '0.83rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {empHistory.advances.map((a) => (
                  <li key={a.id}>
                    Avance ({a.periodMonth}) le {formatDateFR(a.paidAt)} :{' '}
                    <strong>{formatFCFA(a.amount)}</strong>{' '}
                    {a.note ? `— ${a.note}` : ''}
                  </li>
                ))}
                {empHistory.bonuses.map((b) => (
                  <li key={b.id}>
                    Prime ({b.periodMonth}) le {formatDateFR(b.createdAt)} :{' '}
                    <strong>{formatFCFA(b.amount)}</strong> — {b.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
