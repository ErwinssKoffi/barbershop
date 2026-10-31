import { openAccountWorkspace } from '../db/accountWorkspace'
import { filterSyncPayload } from '../../server/syncPolicy'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppRoutes } from '../app/router'
import { AuthProvider } from '../contexts/AuthProvider'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import {
  calculateEmployeeCommission,
  calculateEmployeePayrollStatus,
} from '../domain/calculations/finance'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { ToastProvider } from '../hooks/ToastProvider'

describe('Configuration des prestations (3 modes au choix, catégories directes et RBAC Gérant/Caissier)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('persiste les 3 niveaux de paramètres, applique le verrouillage du prix pour le Caissier et calcule les commissions spécifiques par prestation', async () => {
    const repo = new SalonRepositoryHub(
      new SalonProDatabase(`SvcConfigRepo_${crypto.randomUUID()}`),
    )
    await repo.ensureInitialized(false)

    // 1. Persistance du mode de configuration choisi par l'utilisateur
    expect((await repo.readFullState()).settings.serviceConfigMode).toBe(
      'simple',
    )
    await repo.updateSettings({ serviceConfigMode: 'full' })
    expect((await repo.readFullState()).settings.serviceConfigMode).toBe('full')

    // 2. Produit cabine pour tester les consommables par défaut
    const shampoo = await repo.saveProduct({
      name: 'Shampoing Kératine Cabine',
      sku: 'CAB-SHP-01',
      categoryCode: 'shampoo_cond',
      initialQuantity: 10,
      unit: 'dose',
      costPrice: 500,
      alertThreshold: 2,
      usageType: 'consumable',
    })

    // 3. Création d'une prestation complète (variantes + tarif fixe + consommable cabine + commission spécifique)
    const braids = await repo.saveService({
      name: 'Tresses Boho',
      categoryCode: 'tresses_nattes',
      referencePrice: 15000,
      durationMinutes: 120,
      description: 'Finition mousse incluse',
      priceLocked: true,
      variants: [
        { label: 'Épaules', price: 15000, durationMinutes: 120 },
        { label: 'Mi-dos', price: 22000, durationMinutes: 180 },
      ],
      defaultConsumables: [{ productId: shampoo.id, quantity: 2 }],
      commissionOverride: { mode: 'rate', value: 20 },
      callerRole: 'manager',
    })

    expect(braids.priceLocked).toBe(true)
    expect(braids.variants).toHaveLength(2)
    expect(braids.defaultConsumables).toEqual([
      { productId: shampoo.id, quantity: 2 },
    ])
    expect(braids.commissionOverride).toEqual({ mode: 'rate', value: 20 })

    // Prestation avec prime fixe FCFA par réalisation
    const cut = await repo.saveService({
      name: 'Coupe Signature',
      categoryCode: 'coupe_barbe',
      referencePrice: 5000,
      commissionOverride: { mode: 'fixed', value: 1200 },
      callerRole: 'manager',
    })

    // 4. Un Caissier ne peut ni modifier le catalogue ni altérer un tarif verrouillé en caisse
    await expect(
      repo.saveService({
        name: 'Prestation non autorisée',
        categoryCode: 'coupe_barbe',
        referencePrice: 3000,
        callerRole: 'cashier',
      }),
    ).rejects.toThrow(/seul le Gérant/i)

    await expect(
      repo.addCustomCategory({
        scope: 'service',
        label: 'Catégorie interdite',
        callerRole: 'cashier',
      }),
    ).rejects.toThrow(/seul le Gérant/i)

    const longVariant = braids.variants![1]
    await expect(
      repo.createCheckoutTicket({
        date: '2026-10-30T10:00:00.000Z',
        paymentMethod: 'cash',
        callerRole: 'cashier',
        lines: [
          {
            kind: 'service',
            serviceId: braids.id,
            serviceVariantId: longVariant.id,
            serviceVariantLabel: longVariant.label,
            label: `${braids.name} — ${longVariant.label}`,
            categoryCode: 'braiding_weaving',
            quantity: 1,
            unitPrice: 18000, // tentative de modification d'un tarif verrouillé à 22 000 FCFA
          },
        ],
      }),
    ).rejects.toThrow(/verrouillé à 22/i)

    // Avec le bon tarif de la variante, le Caissier peut encaisser normalement
    const emp = await repo.saveEmployee({
      firstName: 'Aïcha',
      lastName: 'Bamba',
      roleTitle: 'Coiffeuse',
      hireDate: '2026-01-10',
      baseSalary: 80000,
      remunerationType: 'fixed_plus_variable',
      commissionEnabled: true,
      commissionBasis: 'employee_services',
      commissionRate: 10,
    })

    const validTicket = await repo.createCheckoutTicket({
      date: '2026-10-30T10:15:00.000Z',
      paymentMethod: 'wave',
      callerRole: 'cashier',
      lines: [
        {
          kind: 'service',
          serviceId: braids.id,
          serviceVariantId: longVariant.id,
          serviceVariantLabel: longVariant.label,
          label: `${braids.name} — ${longVariant.label}`,
          categoryCode: 'braiding_weaving',
          employeeId: emp.id,
          quantity: 1,
          unitPrice: 22000,
        },
        {
          kind: 'service',
          serviceId: cut.id,
          label: cut.name,
          categoryCode: 'hair_service',
          employeeId: emp.id,
          quantity: 2,
          unitPrice: 5000,
        },
      ],
    })

    expect(validTicket.totalAmount).toBe(32000)
    expect(validTicket.entries[0].serviceVariantLabel).toBe('Mi-dos')

    // 5. Calcul exact de la commission spécifique :
    // - Tresses Boho (22 000 FCFA à 20% spécifique) = 4 400 FCFA (au lieu de 10% = 2 200)
    // - Coupe Signature (2 réalisations × 1 200 FCFA fixe) = 2 400 FCFA
    // Total commission attendu = 6 800 FCFA
    const fullState = await repo.readFullState()
    const comm = calculateEmployeeCommission(
      emp,
      fullState.revenues,
      fullState.services,
    )
    expect(comm.basisAmount).toBe(32000)
    expect(comm.commissionAmount).toBe(6800)

    const payrollStatus = calculateEmployeePayrollStatus({
      employee: emp,
      periodMonth: '2026-10',
      periodRevenues: fullState.revenues,
      advances: [],
      bonuses: [],
      salaryPayments: [],
      servicesCatalog: fullState.services,
    })
    expect(payrollStatus.commissionCalculated).toBe(6800)
    expect(payrollStatus.remainingToPay).toBe(86800)
  })

  it('permet au Gérant de choisir son mode de configuration, de gérer les catégories de prestations, et restreint le Caissier à la lecture/encaissement', async () => {
    const user = userEvent.setup()
    let repo = new SalonRepositoryHub(
      new SalonProDatabase(`SvcConfigUI_${crypto.randomUUID()}`),
    )
    await repo.ensureInitialized(false)

    // Créer un produit cabine en stock pour vérifier le pré-remplissage au Ticket Client
    const oil = await repo.saveProduct({
      name: 'Huile Ricin Cabine',
      sku: 'CAB-OIL-01',
      categoryCode: 'creams_oils',
      initialQuantity: 8,
      unit: 'application',
      costPrice: 400,
      alertThreshold: 2,
      usageType: 'consumable',
    })

    const manager = await repo.registerLocalUserAccount({
      fullName: 'Gérant Koffi',
      email: 'gerant@salon.ci',
      password: 'secret1234',
      role: 'manager',
    })
    const cashier = await repo.registerLocalUserAccount({
      fullName: 'Caissier Aya',
      email: 'caissier@salon.ci',
      password: 'secret1234',
      role: 'cashier',
      callerIsAuthenticatedManager: true,
    })

    const identityRepo = repo
    repo = await openAccountWorkspace(identityRepo.database, manager)
    const view = render(
      <ToastProvider>
        <SalonStoreProvider repository={identityRepo}>
          <MemoryRouter initialEntries={['/login']}>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </MemoryRouter>
        </SalonStoreProvider>
      </ToastProvider>,
    )

    // Connexion en tant que Gérant
    const emailInput = await screen.findByLabelText(/Adresse e-mail/i)
    await user.type(emailInput, 'gerant@salon.ci')
    await user.type(screen.getByLabelText(/^Mot de passe$/i), 'secret1234')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    // Naviguer vers Prestations
    const navServices = await screen.findByRole('link', {
      name: /Prestations/i,
    })
    await user.click(navServices)

    expect(
      await screen.findByRole('heading', { name: /Prestations et tarifs/i }),
    ).toBeInTheDocument()

    // Le Gérant voit les 3 modes au choix et bascule en mode "Complet"
    await user.click(screen.getByRole('button', { name: 'Complet' }))
    await waitFor(async () => {
      const s = await repo.readFullState()
      expect(s.settings.serviceConfigMode).toBe('full')
    })

    // Gestion directe des catégories depuis l'écran Prestations
    await user.click(screen.getByRole('button', { name: /Catégories/i }))
    const newCatInput = await screen.findByLabelText(
      /Nouvelle catégorie de prestations/i,
    )
    await user.type(newCatInput, 'Locks & Vanilles')
    await user.click(screen.getByRole('button', { name: /^Ajouter$/i }))
    expect(await screen.findByText('Locks & Vanilles')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Fermer la fenêtre/i }))

    // Création d'une prestation en mode Complet (avec variante + consommable cabine)
    await user.click(
      screen.getByRole('button', { name: /Nouvelle prestation/i }),
    )
    await user.type(
      await screen.findByLabelText(/Nom de la prestation/i),
      'Départ de Locks',
    )
    await user.type(screen.getByLabelText(/Tarif standard \(FCFA\)/i), '20000')

    await user.click(
      screen.getByRole('button', { name: /Ajouter une variante/i }),
    )
    await user.type(screen.getByLabelText('Libellé variante 1'), 'Longueur dos')
    const varPriceInput = screen.getByLabelText('Tarif variante 1')
    await user.clear(varPriceInput)
    await user.type(varPriceInput, '30000')

    await user.click(
      screen.getByRole('button', { name: /Lier un consommable/i }),
    )
    const consQtyInput = screen.getByLabelText('Quantité consommable 1')
    await user.clear(consQtyInput)
    await user.type(consQtyInput, '2')

    await user.click(
      screen.getByRole('button', { name: /Ajouter au catalogue/i }),
    )

    expect(await screen.findByText('Départ de Locks')).toBeInTheDocument()
    expect(screen.getByText('Longueur dos')).toBeInTheDocument()
    expect(screen.getByText(/1 cons\. cabine/i)).toBeInTheDocument()

    // Fin de session Gérant -> Nouvelle session Caissier dans son espace distinct
    view.unmount()
    window.localStorage.clear()
    window.sessionStorage.clear()

    // Simulate the public snapshot received from the API in the separate cashier cache.
    const publicSnapshot = filterSyncPayload(await repo.exportBackupPayload(), 'cashier')
    repo = await openAccountWorkspace(identityRepo.database, cashier)
    await repo.mergeCloudDelta({ cursor: 1, hasMore: false, payload: publicSnapshot })
    const cashierView = render(
      <ToastProvider>
        <SalonStoreProvider repository={identityRepo}>
          <MemoryRouter initialEntries={['/login']}>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </MemoryRouter>
        </SalonStoreProvider>
      </ToastProvider>,
    )

    await user.type(
      await screen.findByLabelText(/Adresse e-mail/i),
      'caissier@salon.ci',
    )
    await user.type(screen.getByLabelText(/^Mot de passe$/i), 'secret1234')
    await user.click(screen.getByRole('button', { name: /Se connecter/i }))

    await user.click(
      await screen.findByRole('link', { name: /Prestations et tarifs/i }),
    )

    // Le Caissier consulte la grille mais n'a accès à aucun bouton de configuration
    expect(
      await screen.findByText(/Configuration réservée au Gérant/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Nouvelle prestation/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Catégories$/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Gérer/i }),
    ).not.toBeInTheDocument()

    // Le Caissier peut cliquer directement sur la variante "Longueur dos" pour encaisser :
    // le Ticket Client pré-remplit la variante (30 000 FCFA) ET le consommable cabine (Huile Ricin Cabine, qté 2) !
    await user.click(screen.getByRole('button', { name: /Longueur dos/i }))
    expect(
      await screen.findByText(/Nouveau Ticket d'encaissement client/i),
    ).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('Départ de Locks — Longueur dos'),
    ).toBeInTheDocument()
    expect(screen.getByDisplayValue('30000')).toBeInTheDocument()

    // Valider le ticket et vérifier que les 2 doses d'Huile Ricin ont bien été déduites du stock !
    await user.click(
      screen.getByRole('button', { name: /Valider le ticket/i }),
    )
    await waitFor(async () => {
      const s = await repo.readFullState()
      const updatedOil = s.products.find((p) => p.id === oil.id)
      expect(updatedOil?.quantity).toBe(6) // 8 - 2 applications cabine
    })

    cashierView.unmount()
  }, 15000)
})
