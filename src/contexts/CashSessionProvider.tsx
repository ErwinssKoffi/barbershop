import { Unlock } from 'lucide-react'
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/Modal'
import { calculateCashSessionSummary } from '../domain/calculations/finance'
import { useSalonStore } from '../hooks/salonStoreContext'
import { useToast } from '../hooks/toastContext'
import { todayISO } from '../utils/format'
import { CashSessionContext } from './cashSessionContext'

export function CashSessionProvider({ children }: { children: ReactNode }) {
  const { state, mutate } = useSalonStore()
  const toast = useToast()

  const [quickOpenVisible, setQuickOpenVisible] = useState(false)
  const [openingBalance, setOpeningBalance] = useState('0')
  const [openingNote, setOpeningNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [todayStr] = useState<string>(() => todayISO())

  const openSession = useMemo(
    () => state.cashSessions.find((s) => s.status === 'open') ?? null,
    [state.cashSessions],
  )

  const theoreticalBalance = useMemo(() => {
    if (!openSession) return 0
    const mvs = state.cashMovements.filter(
      (m) => m.sessionId === openSession.id,
    )
    return calculateCashSessionSummary(openSession.openingBalance, mvs)
      .theoreticalBalance
  }, [openSession, state.cashMovements])

  const isSessionStale = useMemo(() => {
    if (!openSession) return false
    return openSession.openedAt.slice(0, 10) < todayStr
  }, [openSession, todayStr])

  const openQuickCashModal = useCallback(() => {
    setOpeningBalance('0')
    setOpeningNote('')
    setQuickOpenVisible(true)
  }, [])

  const handleOpenSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mutate((repo) =>
        repo.openCashSession(Number(openingBalance || 0), openingNote),
      )
      setQuickOpenVisible(false)
      toast.success('Session de caisse ouverte avec succès.')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Ouverture de caisse impossible.',
      )
    } finally {
      setBusy(false)
    }
  }

  const value = useMemo(
    () => ({
      openSession,
      theoreticalBalance,
      isSessionStale,
      openQuickCashModal,
    }),
    [openSession, theoreticalBalance, isSessionStale, openQuickCashModal],
  )

  return (
    <CashSessionContext.Provider value={value}>
      {children}
      <Modal
        open={quickOpenVisible}
        title="Ouvrir la session de caisse espèces"
        subtitle="Ouvrez votre tiroir-caisse sans quitter l'opération en cours"
        maxWidth={460}
        onClose={() => setQuickOpenVisible(false)}
      >
        <form className="w-full" onSubmit={(e) => void handleOpenSubmit(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="quick-cash-opening">
                Fond de caisse initial (FCFA)
              </FieldLabel>
              <Input
                id="quick-cash-opening"
                type="number"
                min={0}
                step={1}
                required
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
              />
              <FieldDescription>
                Espèces physiquement présentes dans la caisse au démarrage.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="quick-cash-note">
                Note d&apos;ouverture (facultatif)
              </FieldLabel>
              <Input
                id="quick-cash-note"
                type="text"
                placeholder="Ex. Fond monnaie du matin..."
                value={openingNote}
                onChange={(e) => setOpeningNote(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setQuickOpenVisible(false)}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                <Unlock size={15} />
                Ouvrir la caisse maintenant
              </Button>
            </div>
          </FieldGroup>
        </form>
      </Modal>
    </CashSessionContext.Provider>
  )
}
