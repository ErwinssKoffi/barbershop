import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  CheckCircle2,
  Edit3,
  Lock,
  Plus,
  Printer,
  Unlock,
  Wallet,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCashSession } from '../../contexts/cashSessionContext'
import {
  calculateCashSessionSummary,
  calculateDenominationTotal,
  FCFA_DENOMINATIONS,
} from '../../domain/calculations/finance'
import type { CashSession } from '../../domain/models'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { formatDateFR, formatDateTimeFR, formatFCFA } from '../../utils/format'

export function CashPage() {
  const { state, mutate } = useSalonStore()
  const { isSessionStale } = useCashSession()
  const toast = useToast()

  const sortedSessions = useMemo(
    () =>
      [...state.cashSessions].sort((a, b) =>
        b.openedAt.localeCompare(a.openedAt),
      ),
    [state.cashSessions],
  )

  const openSession = useMemo(
    () => sortedSessions.find((s) => s.status === 'open') ?? null,
    [sortedSessions],
  )

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )

  const activeSession: CashSession | null = useMemo(() => {
    if (selectedSessionId) {
      return (
        sortedSessions.find((s) => s.id === selectedSessionId) ??
        openSession ??
        sortedSessions[0] ??
        null
      )
    }
    return openSession ?? sortedSessions[0] ?? null
  }, [selectedSessionId, sortedSessions, openSession])

  const sessionMovements = useMemo(() => {
    if (!activeSession) return []
    return state.cashMovements
      .filter((m) => m.sessionId === activeSession.id)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  }, [activeSession, state.cashMovements])

  const summary = useMemo(
    () =>
      activeSession
        ? calculateCashSessionSummary(
            activeSession.openingBalance,
            sessionMovements,
          )
        : null,
    [activeSession, sessionMovements],
  )

  // Modales
  const [openModal, setOpenModal] = useState(false)
  const [openingBalance, setOpeningBalance] = useState('25000')
  const [openingNote, setOpeningNote] = useState('')

  const [movModal, setMovModal] = useState<'in' | 'out' | null>(null)
  const [movAmount, setMovAmount] = useState('')
  const [movReason, setMovReason] = useState('')

  const [closeModal, setCloseModal] = useState(false)
  const [countedAmount, setCountedAmount] = useState('')
  const [closingNote, setClosingNote] = useState('')
  const [useBilletage, setUseBilletage] = useState(false)
  const [denominations, setDenominations] = useState<Record<string, number>>({})

  const handleUpdateDenomination = (denom: number, rawQty: string) => {
    const qty = Math.max(0, Math.round(Number(rawQty || 0)))
    const next = { ...denominations, [String(denom)]: qty }
    setDenominations(next)
    setCountedAmount(String(calculateDenominationTotal(next)))
  }

  const [corrOpen, setCorrOpen] = useState(false)
  const [corrDir, setCorrDir] = useState<'in' | 'out'>('in')
  const [corrAmount, setCorrAmount] = useState('')
  const [corrReason, setCorrReason] = useState('')

  const [closedCorrOpen, setClosedCorrOpen] = useState(false)
  const [closedNewCount, setClosedNewCount] = useState('')
  const [closedCorrReason, setClosedCorrReason] = useState('')
  const [busy, setBusy] = useState(false)

  const handleOpenSession = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const created = await mutate((repo) =>
        repo.openCashSession(Number(openingBalance), openingNote),
      )
      setSelectedSessionId(created.id)
      setOpenModal(false)
      setOpeningNote('')
      toast.success('Session de caisse ouverte avec succès.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ouverture impossible.')
    } finally {
      setBusy(false)
    }
  }

  const handleRecordMovement = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeSession || !movModal) return
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.recordManualCashMovement({
          sessionId: activeSession.id,
          direction: movModal,
          amount: Number(movAmount),
          reason: movReason,
        }),
      )
      setMovModal(null)
      setMovAmount('')
      setMovReason('')
      toast.success('Mouvement d’espèces enregistré.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur mouvement.')
    } finally {
      setBusy(false)
    }
  }

  const handleCloseSession = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeSession) return
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.closeCashSession({
          sessionId: activeSession.id,
          countedClosingBalance: Number(countedAmount),
          closingNote,
          closingDenominations: useBilletage ? denominations : undefined,
        }),
      )
      setCloseModal(false)
      setClosingNote('')
      setUseBilletage(false)
      setDenominations({})
      toast.success('Session de caisse clôturée et verrouillée.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clôture impossible.')
    } finally {
      setBusy(false)
    }
  }

  const handleOpenSessionCorrection = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeSession) return
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.recordCashCorrection({
          sessionId: activeSession.id,
          direction: corrDir,
          amount: Number(corrAmount),
          reason: corrReason,
        }),
      )
      setCorrOpen(false)
      setCorrAmount('')
      setCorrReason('')
      toast.success('Correction traçable enregistrée dans le journal.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Correction refusée.')
    } finally {
      setBusy(false)
    }
  }

  const handleClosedSessionCorrection = async (e: FormEvent) => {
    e.preventDefault()
    if (!activeSession) return
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.correctClosedSessionCount({
          sessionId: activeSession.id,
          newCountedBalance: Number(closedNewCount),
          reason: closedCorrReason,
        }),
      )
      setClosedCorrOpen(false)
      setClosedCorrReason('')
      toast.success('Clôture rectifiée avec trace dans le journal d’audit.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rectification refusée.')
    } finally {
      setBusy(false)
    }
  }

  const previewDiscrepancy =
    summary && countedAmount.trim() !== ''
      ? Math.round(Number(countedAmount)) - summary.theoreticalBalance
      : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Gestion de caisse (Espèces)</h1>
          <p className="page-subtitle">
            Suivi du tiroir-caisse physique · Les paiements Wave / Mobile Money
            n&apos;entrent pas automatiquement en caisse espèces
          </p>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {!openSession && (
            <Button type="button" onClick={() => setOpenModal(true)}>
              <Unlock size={15} />
              Ouvrir une session de caisse
            </Button>
          )}

          {activeSession?.status === 'open' && (
            <>
              <Button type="button" onClick={() => setMovModal('in')}>
                <Plus size={15} />
                Entrée espèces
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMovModal('out')}
              >
                <ArrowDownCircle size={15} />
                Sortie espèces
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCorrOpen(true)}
              >
                <Edit3 size={15} />
                Correction traçable
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCountedAmount(
                    String(summary ? summary.theoreticalBalance : 0),
                  )
                  setCloseModal(true)
                }}
              >
                <Lock size={15} />
                Clôturer la caisse
              </Button>
            </>
          )}

          {activeSession?.status === 'closed' && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setClosedNewCount(
                  String(activeSession.countedClosingBalance ?? 0),
                )
                setClosedCorrOpen(true)
              }}
            >
              <Edit3 size={15} />
              Rectifier le comptage (traçable)
            </Button>
          )}

          {activeSession && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.print()}
            >
              <Printer size={15} />
              Rapport de clôture imprimable
            </Button>
          )}
        </div>
      </div>

      {/* Bannière d'alerte proactive : session ouverte une journée antérieure */}
      {openSession && isSessionStale && (
        <div
          className="no-print"
          style={{
            padding: '13px 18px',
            borderRadius: 12,
            background: 'var(--color-danger-bg)',
            border: '1px solid rgba(239, 68, 68, 0.38)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: '0.83rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <AlertTriangle size={18} color="var(--color-danger)" />
            <span>
              <strong>Session de la veille non clôturée :</strong> la caisse
              ouverte le {formatDateFR(openSession.openedAt)} est toujours
              active. Clôturez-la avant d&apos;ouvrir la journée d&apos;aujourd&apos;hui.
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              setSelectedSessionId(openSession.id)
              setCountedAmount(
                String(summary ? summary.theoreticalBalance : 0),
              )
              setCloseModal(true)
            }}
          >
            <Lock size={14} />
            Clôturer cette session maintenant
          </Button>
        </div>
      )}

      {!activeSession || !summary ? (
        <article className="surface-card">
          <EmptyState
            icon={<Wallet size={24} />}
            title="Aucune session de caisse enregistrée"
            description="Ouvrez une session de caisse avec votre fond de roulement en espèces (FCFA) pour suivre automatiquement les entrées, sorties et écarts de fin de journée."
            actionLabel="Ouvrir une session de caisse"
            onAction={() => setOpenModal(true)}
          />
        </article>
      ) : (
        <>
          <div className="print-only" style={{ marginBottom: 16 }}>
            <h1 style={{ margin: 0, fontSize: '1.35rem' }}>
              {state.salon.name} — Rapport de Caisse
            </h1>
            <p style={{ margin: '4px 0', fontSize: '0.86rem' }}>
              Session ouverte le {formatDateTimeFR(activeSession.openedAt)} ·
              Statut : {activeSession.status === 'open' ? 'Ouverte' : 'Clôturée'}
            </p>
          </div>

          <div
            className="surface-card"
            style={{
              padding: '12px 18px',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                className={`badge ${
                  activeSession.status === 'open' ? 'badge-green' : 'badge-amber'
                }`}
              >
                {activeSession.status === 'open' ? (
                  <>
                    <Unlock size={12} /> Caisse ouverte
                  </>
                ) : (
                  <>
                    <Lock size={12} /> Clôturée
                  </>
                )}
              </span>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Ouverte le {formatDateTimeFR(activeSession.openedAt)}
                {activeSession.closedAt
                  ? ` · Clôturée le ${formatDateTimeFR(activeSession.closedAt)}`
                  : ''}
              </span>
            </div>

            {sortedSessions.length > 1 && (
              <div
                className="no-print"
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <FieldLabel htmlFor="session-select">Session :</FieldLabel>
                <Select
                  value={activeSession.id}
                  onValueChange={setSelectedSessionId}
                >
                  <SelectTrigger id="session-select" style={{ width: 220 }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedSessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {`${formatDateFR(s.openedAt)} — ${s.status === 'open' ? 'Ouverte' : 'Clôturée'}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* 4 Indicateurs essentiels sur 1 seule ligne */}
          <section className="kpi-grid">
            <KpiCard
              label="Fond d'ouverture"
              value={formatFCFA(summary.openingBalance)}
              icon={<Wallet size={18} />}
              tone="blue"
            />
            <KpiCard
              label="Entrées espèces"
              value={formatFCFA(summary.totalIn)}
              icon={<ArrowUpCircle size={18} />}
              tone="emerald"
            />
            <KpiCard
              label="Sorties espèces"
              value={formatFCFA(summary.totalOut)}
              icon={<ArrowDownCircle size={18} />}
              tone="amber"
            />
            {activeSession.status === 'open' ? (
              <KpiCard
                label="Solde théorique"
                value={formatFCFA(summary.theoreticalBalance)}
                icon={<CheckCircle2 size={18} />}
                tone="teal"
                subtitle="Attendu dans le tiroir"
              />
            ) : (
              <KpiCard
                label="Compté à la clôture"
                value={formatFCFA(activeSession.countedClosingBalance ?? 0)}
                icon={<Lock size={18} />}
                tone={
                  !activeSession.discrepancy
                    ? 'emerald'
                    : 'danger'
                }
                subtitle={`Théorique : ${formatFCFA(summary.theoreticalBalance)} · Écart : ${(activeSession.discrepancy ?? 0) > 0 ? '+' : ''}${formatFCFA(activeSession.discrepancy ?? 0)}`}
              />
            )}
          </section>

          {/* Historique des mouvements */}
          <article className="surface-card">
            <div className="surface-card-header">
              <div>
                <h2 className="surface-card-title">
                  Historique des mouvements d&apos;espèces (
                  {sessionMovements.length})
                </h2>
                <div className="surface-card-subtitle">
                  {activeSession.closingNote
                    ? `Notes : ${activeSession.closingNote}`
                    : 'Toutes les entrées et sorties physiques de la session'}
                </div>
              </div>
            </div>
            <div className="surface-card-body" style={{ paddingTop: 6 }}>
              {sessionMovements.length === 0 ? (
                <div
                  style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                  }}
                >
                  Aucun mouvement d&apos;espèces sur cette session pour le
                  moment.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Motif / Opération</TableHead>
                      <TableHead>Sens</TableHead>
                      <TableHead className="text-right">Montant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessionMovements.map((m) => {
                      const isIn =
                        m.type === 'in' ||
                        m.type === 'correction_in' ||
                        m.type === 'opening'
                      const badgeVariant = m.type.startsWith('correction')
                        ? 'warning-light'
                        : isIn
                          ? 'success-light'
                          : 'destructive-light'
                      return (
                        <TableRow key={m.id}>
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">
                                {m.reason}
                              </span>
                              <span className="text-muted-foreground text-xs tabular-nums">
                                {formatDateTimeFR(m.occurredAt)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={badgeVariant} size="sm">
                              {m.type === 'in'
                                ? 'Entrée espèces'
                                : m.type === 'out'
                                  ? 'Sortie espèces'
                                  : m.type === 'correction_in'
                                    ? 'Correction (+)'
                                    : m.type === 'correction_out'
                                      ? 'Correction (−)'
                                      : 'Ouverture'}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="text-right text-sm font-semibold tabular-nums"
                            style={{
                              color: isIn
                                ? 'var(--color-success)'
                                : 'var(--color-danger)',
                            }}
                          >
                            {isIn ? '+' : '-'}
                            {formatFCFA(m.amount)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </article>
        </>
      )}

      {/* Modale ouverture */}
      <Modal
        open={openModal}
        title="Ouvrir une session de caisse"
        subtitle="Indiquez le fond de caisse disponible en espèces au démarrage"
        onClose={() => setOpenModal(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleOpenSession(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="open-balance">
                Fond de caisse initial (FCFA)
              </FieldLabel>
              <Input
                id="open-balance"
                type="number"
                min={0}
                step={1}
                required
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="open-notes">
                Observation (optionnel)
              </FieldLabel>
              <Input
                id="open-notes"
                type="text"
                placeholder="Ex. Petite monnaie vérifiée"
                value={openingNote}
                onChange={(e) => setOpeningNote(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenModal(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Ouvrir la caisse
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      {/* Modale Entrée / Sortie manuelle */}
      <Modal
        open={movModal !== null}
        title={
          movModal === 'in'
            ? 'Nouvelle entrée en espèces'
            : 'Nouvelle sortie en espèces'
        }
        subtitle="Mouvement direct dans le tiroir-caisse ouvert"
        onClose={() => setMovModal(null)}
      >
        <form className="w-full" onSubmit={(e) => void handleRecordMovement(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="mov-label">Motif / Libellé</FieldLabel>
              <Input
                id="mov-label"
                type="text"
                required
                placeholder={
                  movModal === 'in'
                    ? 'Ex. Apport de monnaie en caisse'
                    : 'Ex. Dépôt banque espèces'
                }
                value={movReason}
                onChange={(e) => setMovReason(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="mov-amount">
                Montant en espèces (FCFA)
              </FieldLabel>
              <Input
                id="mov-amount"
                type="number"
                min={1}
                step={1}
                required
                value={movAmount}
                onChange={(e) => setMovAmount(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMovModal(null)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Enregistrer
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      {/* Modale Correction traçable sur caisse ouverte */}
      <Modal
        open={corrOpen}
        title="Correction traçable de caisse"
        subtitle="Enregistre une écriture corrective avec motif obligatoire dans le journal d'audit."
        onClose={() => setCorrOpen(false)}
      >
        <form
          className="w-full"
          onSubmit={(e) => void handleOpenSessionCorrection(e)}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="corr-dir">
                Sens de la régularisation
              </FieldLabel>
              <Select
                value={corrDir}
                onValueChange={(v) => setCorrDir(v as 'in' | 'out')}
              >
                <SelectTrigger id="corr-dir">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">
                    Correction positive (+ espèces)
                  </SelectItem>
                  <SelectItem value="out">
                    Correction négative (− espèces)
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="corr-amt">Montant (FCFA)</FieldLabel>
              <Input
                id="corr-amt"
                type="number"
                min={1}
                step={1}
                required
                value={corrAmount}
                onChange={(e) => setCorrAmount(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="corr-rsn">
                Motif obligatoire de la correction
              </FieldLabel>
              <Input
                id="corr-rsn"
                type="text"
                required
                placeholder="Ex. Oubli rendu monnaie rectifié"
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCorrOpen(false)}
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

      {/* Modale Clôture de caisse */}
      <Modal
        open={closeModal}
        title="Clôturer la session de caisse"
        subtitle="Une fois validée, la clôture est verrouillée."
        onClose={() => setCloseModal(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleCloseSession(e)}>
          <FieldGroup>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--bg-surface-muted)',
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.85rem',
              }}
            >
              <span>
                Solde théorique attendu :{' '}
                <strong>{formatFCFA(summary?.theoreticalBalance ?? 0)}</strong>
              </span>
              <Button
                type="button"
                size="xs"
                variant={useBilletage ? 'default' : 'outline'}
                onClick={() => setUseBilletage((v) => !v)}
              >
                <Calculator size={13} />
                {useBilletage
                  ? 'Masquer le billetage FCFA'
                  : 'Billetage coupures FCFA'}
              </Button>
            </div>

            {useBilletage && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-surface-muted)',
                }}
                className="space-y-2"
              >
                <div className="text-muted-foreground text-xs font-medium">
                  Saisissez le nombre de billets et pièces comptés dans le tiroir :
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 8,
                  }}
                >
                  {FCFA_DENOMINATIONS.map((denom) => (
                    <div
                      key={denom}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 6,
                        padding: '4px 8px',
                        borderRadius: 8,
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <span
                        className="tabular-nums"
                        style={{ fontSize: '0.78rem', fontWeight: 600 }}
                      >
                        {denom.toLocaleString('fr-FR')} F ×
                      </span>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        aria-label={`Coupures de ${denom} FCFA`}
                        style={{ width: 74, height: 28, textAlign: 'right' }}
                        value={denominations[String(denom)] ?? ''}
                        placeholder="0"
                        onChange={(e) =>
                          handleUpdateDenomination(denom, e.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="counted-cash">
                Montant réellement compté en espèces (FCFA)
              </FieldLabel>
              <Input
                id="counted-cash"
                type="number"
                min={0}
                step={1}
                required
                value={countedAmount}
                onChange={(e) => setCountedAmount(e.target.value)}
              />
            </Field>

            {previewDiscrepancy !== null && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  background:
                    previewDiscrepancy === 0
                      ? 'var(--color-success-bg)'
                      : 'var(--color-warning-bg)',
                  color:
                    previewDiscrepancy === 0
                      ? 'var(--color-success)'
                      : 'var(--color-warning)',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                }}
              >
                Écart constaté : {previewDiscrepancy > 0 ? '+' : ''}
                {formatFCFA(previewDiscrepancy)}
              </div>
            )}

            <Field>
              <FieldLabel htmlFor="closing-notes">
                Note de clôture / Justification d&apos;écart
              </FieldLabel>
              <Input
                id="closing-notes"
                type="text"
                placeholder="Ex. Comptage de fin de journée conforme"
                value={closingNote}
                onChange={(e) => setClosingNote(e.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCloseModal(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Valider la clôture définitive
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>

      {/* Modale Correction traçable d'une session déjà clôturée */}
      <Modal
        open={closedCorrOpen}
        title="Correction traçable d'une clôture validée"
        subtitle="Le motif précis (min. 5 caractères) est archivé dans le journal des corrections."
        onClose={() => setClosedCorrOpen(false)}
      >
        <form
          className="w-full"
          onSubmit={(e) => void handleClosedSessionCorrection(e)}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="closed-new-cnt">
                Nouveau montant espèces compté (FCFA)
              </FieldLabel>
              <Input
                id="closed-new-cnt"
                type="number"
                min={0}
                step={1}
                required
                value={closedNewCount}
                onChange={(e) => setClosedNewCount(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="closed-corr-rsn">
                Motif obligatoire de rectification
              </FieldLabel>
              <Input
                id="closed-corr-rsn"
                type="text"
                required
                minLength={5}
                placeholder="Ex. Billet de 5 000 FCFA retrouvé dans le compartiment"
                value={closedCorrReason}
                onChange={(e) => setClosedCorrReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setClosedCorrOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                Valider la rectification
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>
    </div>
  )
}
