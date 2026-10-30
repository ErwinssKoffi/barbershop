import type { AppSettings, CategoryItem, SalonInfo } from '../domain/models'

export function buildDefaultSalonInfo(
  nowIso = new Date().toISOString(),
): SalonInfo {
  return {
    id: 'salon-main',
    name: '',
    address: '',
    phone: '',
    managerName: '',
    currency: 'XOF',
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

export function buildDefaultSettings(
  nowIso = new Date().toISOString(),
): AppSettings {
  return {
    id: 'default',
    theme: 'light',
    dateFormat: 'long-fr',
    printHeaderNote:
      'Document interne de gestion — Montants exprimés en Francs CFA (FCFA)',
    printCompact: false,
    receiptFormat: 'thermal_80mm',
    receiptFooterNote: 'Merci de votre visite et de votre fidélité !',
    updatedAt: nowIso,
  }
}

export function buildSystemCategories(
  nowIso = new Date().toISOString(),
): CategoryItem[] {
  const items: Array<{
    scope: CategoryItem['scope']
    code: string
    label: string
  }> = [
    // Modes de paiement
    { scope: 'payment_method', code: 'cash', label: 'Espèces' },
    { scope: 'payment_method', code: 'wave', label: 'Wave' },
    { scope: 'payment_method', code: 'orange_money', label: 'Orange Money' },
    { scope: 'payment_method', code: 'mtn_momo', label: 'MTN MoMo' },
    { scope: 'payment_method', code: 'transfer', label: 'Virement bancaire' },
    { scope: 'payment_method', code: 'card', label: 'Carte bancaire' },
    { scope: 'payment_method', code: 'other', label: 'Autre mode' },

    // Catégories de recettes
    {
      scope: 'revenue',
      code: 'hair_service',
      label: 'Prestation coiffure / barbe',
    },
    {
      scope: 'revenue',
      code: 'braiding_weaving',
      label: 'Tresses, nattes & mèches',
    },
    {
      scope: 'revenue',
      code: 'care_coloring',
      label: 'Soins capillaires & coloration',
    },
    { scope: 'revenue', code: 'product_sale', label: 'Vente de produits' },
    { scope: 'revenue', code: 'other_revenue', label: 'Autres recettes' },

    // Catégories initiales de dépenses
    { scope: 'expense', code: 'rent', label: 'Loyer' },
    { scope: 'expense', code: 'utilities', label: 'Électricité et eau' },
    { scope: 'expense', code: 'hair_products', label: 'Produits capillaires' },
    {
      scope: 'expense',
      code: 'equipment',
      label: 'Matériel et équipements',
    },
    { scope: 'expense', code: 'maintenance', label: 'Entretien' },
    { scope: 'expense', code: 'transport', label: 'Transport' },
    { scope: 'expense', code: 'telecom', label: 'Téléphone et Internet' },
    { scope: 'expense', code: 'salaries', label: 'Salaires' },
    { scope: 'expense', code: 'bonuses', label: 'Primes' },
    {
      scope: 'expense',
      code: 'admin_fees',
      label: 'Charges administratives',
    },
    { scope: 'expense', code: 'other_expense', label: 'Autres dépenses' },

    // Catégories de prestations
    { scope: 'service', code: 'coupe_barbe', label: 'Coupe & Barbe' },
    { scope: 'service', code: 'tresses_nattes', label: 'Tresses & Nattes' },
    {
      scope: 'service',
      code: 'meches_perruques',
      label: 'Mèches & Perruques',
    },
    {
      scope: 'service',
      code: 'soins_brushing',
      label: 'Soins, Brushing & Défrisage',
    },
    { scope: 'service', code: 'coloration', label: 'Coloration' },
    {
      scope: 'service',
      code: 'autre_prestation',
      label: 'Autres prestations',
    },

    // Catégories de produits d'inventaire
    {
      scope: 'product',
      code: 'shampoo_cond',
      label: 'Shampoing & Après-shampoing',
    },
    {
      scope: 'product',
      code: 'creams_oils',
      label: 'Crèmes & Huiles capillaires',
    },
    { scope: 'product', code: 'hair_color', label: 'Colorations' },
    { scope: 'product', code: 'extensions', label: 'Mèches & Extensions' },
    { scope: 'product', code: 'accessories', label: 'Lames & Accessoires' },
    { scope: 'product', code: 'other_product', label: 'Autres produits' },
  ]

  return items.map((it) => ({
    id: `cat-${it.scope}-${it.code}`,
    scope: it.scope,
    code: it.code,
    label: it.label,
    isSystem: true,
    isArchived: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  }))
}
