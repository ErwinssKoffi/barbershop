import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '@/app/router'
import { Pattern as PatternInput1 } from '@/components/patterns/c-input-1'
import { Pattern as PatternInput15 } from '@/components/patterns/c-input-15'
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
import { SalonProDatabase } from '@/db/database'
import { SalonRepositoryHub } from '@/db/repositories/salonRepositories'
import { SalonStoreProvider } from '@/hooks/SalonStoreProvider'
import { ToastProvider } from '@/hooks/ToastProvider'

function ModalWithSelectHarness({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState('coiffeur')
  return (
    <Modal open title="Test Modale ReUI" onClose={onClose}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="role-select">Poste occupé</FieldLabel>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger id="role-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="coiffeur">Coiffeur polyvalent</SelectItem>
              <SelectItem value="barbier">Maître Barbier</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="emp-name">Nom complet</FieldLabel>
          <Input id="emp-name" placeholder="Ex. Konan Yao" />
        </Field>
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button">Valider</Button>
        </div>
      </FieldGroup>
    </Modal>
  )
}

describe('Composants shadcn / ReUI (@reui/c-input-1 et @reui/c-input-15)', () => {
  it('rend et permet la saisie dans le pattern @reui/c-input-1', async () => {
    const user = userEvent.setup()
    render(<PatternInput1 />)

    const input = screen.getByPlaceholderText('Basic Input')
    expect(input).toHaveAttribute('id', 'basic-input')
    expect(input).toHaveAttribute('data-slot', 'input')

    await user.type(input, 'salon.ivoire')
    expect(input).toHaveValue('salon.ivoire')
  })

  it('rend le formulaire complet @reui/c-input-15 avec sélection dans Select et boutons', async () => {
    const user = userEvent.setup()
    render(<PatternInput15 />)

    const phoneInput = screen.getByLabelText('Phone')
    const addressInput = screen.getByLabelText('Address')
    const countryTrigger = screen.getByLabelText('Country')

    await user.type(phoneInput, '+225 07 08 09 10 11')
    await user.type(addressInput, 'Cocody Angré, Abidjan')
    expect(phoneInput).toHaveValue('+225 07 08 09 10 11')
    expect(addressInput).toHaveValue('Cocody Angré, Abidjan')

    await user.click(countryTrigger)
    const ukOption = await screen.findByRole('option', {
      name: 'United Kingdom',
    })
    await user.click(ukOption)

    expect(countryTrigger).toHaveTextContent('United Kingdom')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
  })

  it("ferme uniquement le menu Select à l'appui sur Échap sans fermer la Modale parente", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ModalWithSelectHarness onClose={onClose} />)

    const trigger = screen.getByLabelText('Poste occupé')
    expect(trigger).toHaveTextContent('Coiffeur polyvalent')

    await user.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    // 1er Échap : referme uniquement la liste déroulante Select, la modale reste ouverte
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // 2nd Échap : la liste étant fermée, l'événement remonte à la modale
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('enregistre une recette via le formulaire ReUI (Field, Input, Select, Button) de SALON PRO', async () => {
    const user = userEvent.setup()
    const dbName = `SalonProReUI_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const repo = new SalonRepositoryHub(new SalonProDatabase(dbName))
    await repo.ensureInitialized(false)

    render(
      <ToastProvider>
        <SalonStoreProvider repository={repo}>
          <MemoryRouter initialEntries={['/revenue']}>
            <AppRoutes />
          </MemoryRouter>
        </SalonStoreProvider>
      </ToastProvider>,
    )

    const newRevBtns = await screen.findAllByRole('button', {
      name: /Nouvelle recette/i,
    })
    await user.click(newRevBtns[0])

    const dialog = await screen.findByRole('dialog')
    const modal = within(dialog)

    const labelInput = modal.getByLabelText(/Libellé de la recette/i)
    const amountInput = modal.getByLabelText(/Montant encaissé \(FCFA\)/i)
    const methodSelect = modal.getByLabelText(/Mode de paiement/i)

    await user.type(labelInput, 'Dégradé américain + barbe')
    await user.clear(amountInput)
    await user.type(amountInput, '7000')
    await user.click(methodSelect)
    await user.click(await modal.findByRole('option', { name: /Wave/i }))

    await user.click(modal.getByRole('button', { name: /Ajouter la recette/i }))

    await waitFor(() => {
      expect(screen.getByText('Dégradé américain + barbe')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/7 000 FCFA/).length).toBeGreaterThan(0)
  })
})
