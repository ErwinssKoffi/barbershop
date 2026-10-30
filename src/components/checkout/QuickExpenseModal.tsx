import { AlertTriangle, Package, Unlock } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/Modal'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCashSession } from '../../contexts/cashSessionContext'
import { useWorkspaceFocus } from '../../contexts/workspaceFocusContext'
import { useSalonStore } from '../../hooks/salonStoreContext'
import { useToast } from '../../hooks/toastContext'
import { todayISO } from '../../utils/format'

interface QuickExpenseModalProps {
  open: boolean
  onClose: () => void
}

export function QuickExpenseModal({ open, onClose }: QuickExpenseModalProps) {
  const { state, mutate } = useSalonStore()
  const { openSession, openQuickCashModal } = useCashSession()
  const { navigateToEntity } = useWorkspaceFocus()
  const toast = useToast()

  const expenseCategories = useMemo(
    () =>
      state.categories.filter(
        (c) =>
          c.scope === 'expense' &&
          !c.isArchived &&
          c.code !== 'salaries' &&
          c.code !== 'bonuses',
      ),
    [state.categories],
  )
  const paymentMethods = useMemo(
    () =>
      state.categories.filter(
        (c) => c.scope === 'payment_method' && !c.isArchived,
      ),
    [state.categories],
  )

  const [date, setDate] = useState<string>(() => todayISO())
  const [label, setLabel] = useState('')
  const [categoryCode, setCategoryCode] = useState('utilities')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [beneficiary, setBeneficiary] = useState('')
  const [receiptRef, setReceiptRef] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      const nowTime = new Date().toISOString().slice(11)
      await mutate((repo) =>
        repo.addExpense({
          date: `${date}T${nowTime}`,
          label,
          categoryCode,
          amount: Number(amount),
          paymentMethod,
          beneficiary,
          receiptRef,
        }),
      )
      toast.success('Dépense enregistrée avec succès.')
      setLabel('')
      setAmount('')
      setBeneficiary('')
      setReceiptRef('')
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erreur dépense.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Saisie rapide d'une dépense"
      subtitle="Enregistrez une charge ou facture sans quitter votre écran"
      maxWidth={540}
      onClose={onClose}
    >
      <form className="w-full" onSubmit={(e) => void handleSubmit(e)}>
        <FieldGroup>
          {paymentMethod === 'cash' && !openSession && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--color-warning-bg)',
                border: '1px solid rgba(217, 119, 6, 0.35)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: '0.79rem',
              }}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle size={15} color="var(--color-warning)" />
                <span>
                  Caisse espèces fermée : ouvrez-la pour imputer cette sortie au
                  tiroir-caisse.
                </span>
              </div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={openQuickCashModal}
              >
                <Unlock size={13} />
                Ouvrir la caisse
              </Button>
            </div>
          )}

          {categoryCode === 'hair_products' && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--accent-emerald-soft)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                fontSize: '0.79rem',
              }}
            >
              <span>
                Achat de stock inventorié ? Passez par l&apos;Inventaire pour
                mettre à jour vos quantités et le CUMP automatiquement.
              </span>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  onClose()
                  navigateToEntity({ route: '/inventory', action: 'restock' })
                }}
              >
                <Package size={13} />
                Approvisionner le stock
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="qe-date">Date</FieldLabel>
              <Input
                id="qe-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="qe-cat">Catégorie</FieldLabel>
              <Select value={categoryCode} onValueChange={setCategoryCode}>
                <SelectTrigger id="qe-cat">
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
          </div>

          <Field>
            <FieldLabel htmlFor="qe-label">Libellé de la dépense</FieldLabel>
            <Input
              id="qe-label"
              type="text"
              required
              placeholder="Ex. Facture CIE, Produits entretien, Transport..."
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="qe-amount">Montant (FCFA)</FieldLabel>
              <Input
                id="qe-amount"
                type="number"
                min={1}
                step={1}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="qe-method">Mode de paiement</FieldLabel>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger id="qe-method">
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="qe-benef">Bénéficiaire / Fournisseur</FieldLabel>
              <Input
                id="qe-benef"
                type="text"
                placeholder="Ex. CIE, SODECI, Grossiste..."
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="qe-ref">N° Reçu / Facture</FieldLabel>
              <Input
                id="qe-ref"
                type="text"
                placeholder="Facultatif"
                value={receiptRef}
                onChange={(e) => setReceiptRef(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              Enregistrer la dépense
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Modal>
  )
}
