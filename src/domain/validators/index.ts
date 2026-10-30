/**
 * Validateurs métier purs & prévention des doublons d'enregistrement (Sections 3, 17, 21, 23)
 */

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validatePositiveFCFA(
  amount: number,
  fieldLabel = 'Le montant',
): ValidationResult {
  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    return { valid: false, error: `${fieldLabel} doit être un nombre valide.` }
  }
  if (Math.round(amount) <= 0) {
    return {
      valid: false,
      error: `${fieldLabel} doit être strictement supérieur à 0 FCFA.`,
    }
  }
  if (!Number.isInteger(amount)) {
    return {
      valid: false,
      error: `${fieldLabel} doit être un nombre entier en FCFA (sans centimes).`,
    }
  }
  return { valid: true }
}

export function validateNonNegativeFCFA(
  amount: number,
  fieldLabel = 'Le montant',
): ValidationResult {
  if (!Number.isFinite(amount) || Number.isNaN(amount) || amount < 0) {
    return {
      valid: false,
      error: `${fieldLabel} doit être supérieur ou égal à 0 FCFA.`,
    }
  }
  if (!Number.isInteger(amount)) {
    return {
      valid: false,
      error: `${fieldLabel} doit être un entier en FCFA.`,
    }
  }
  return { valid: true }
}

export function validateRevenueInput(input: {
  label: string
  amount: number
  categoryCode: string
  paymentMethod: string
  date: string
}): ValidationResult {
  if (!input.label || input.label.trim().length < 2) {
    return {
      valid: false,
      error: 'Veuillez saisir un libellé de recette (au moins 2 caractères).',
    }
  }
  const amtCheck = validatePositiveFCFA(input.amount, 'Le montant de la recette')
  if (!amtCheck.valid) return amtCheck
  if (!input.categoryCode.trim()) {
    return { valid: false, error: 'Veuillez sélectionner une catégorie.' }
  }
  if (!input.paymentMethod.trim()) {
    return {
      valid: false,
      error: 'Veuillez sélectionner un mode de paiement.',
    }
  }
  if (!input.date || Number.isNaN(new Date(input.date).getTime())) {
    return { valid: false, error: 'La date de la recette est invalide.' }
  }
  return { valid: true }
}

export function validateExpenseInput(input: {
  label: string
  amount: number
  categoryCode: string
  paymentMethod: string
  date: string
}): ValidationResult {
  if (!input.label || input.label.trim().length < 2) {
    return {
      valid: false,
      error: 'Veuillez saisir un libellé de dépense (au moins 2 caractères).',
    }
  }
  const amtCheck = validatePositiveFCFA(input.amount, 'Le montant de la dépense')
  if (!amtCheck.valid) return amtCheck
  if (!input.categoryCode.trim()) {
    return {
      valid: false,
      error: 'Veuillez sélectionner une catégorie de dépense.',
    }
  }
  if (!input.paymentMethod.trim()) {
    return {
      valid: false,
      error: 'Veuillez sélectionner un mode de paiement.',
    }
  }
  if (!input.date || Number.isNaN(new Date(input.date).getTime())) {
    return { valid: false, error: 'La date de la dépense est invalide.' }
  }
  return { valid: true }
}

export function validateServiceInput(input: {
  name: string
  referencePrice: number
  categoryCode: string
  variants?: Array<{ label: string; price: number; durationMinutes?: number }>
  defaultConsumables?: Array<{ productId: string; quantity: number }>
  commissionOverride?: { mode: 'rate' | 'fixed'; value: number } | null
}): ValidationResult {
  if (!input.name || input.name.trim().length < 2) {
    return {
      valid: false,
      error: 'Le nom de la prestation doit contenir au moins 2 caractères.',
    }
  }
  const priceCheck = validatePositiveFCFA(
    input.referencePrice,
    'Le tarif de référence',
  )
  if (!priceCheck.valid) return priceCheck
  if (!input.categoryCode.trim()) {
    return {
      valid: false,
      error: 'Veuillez choisir une catégorie de prestation.',
    }
  }

  if (input.variants && input.variants.length > 0) {
    for (const variant of input.variants) {
      if (!variant.label || variant.label.trim().length < 1) {
        return {
          valid: false,
          error: 'Chaque variante doit avoir un libellé (ex. Court, Long).',
        }
      }
      const varPriceCheck = validatePositiveFCFA(
        variant.price,
        `Le tarif de la variante « ${variant.label.trim()} »`,
      )
      if (!varPriceCheck.valid) return varPriceCheck
      if (
        variant.durationMinutes !== undefined &&
        (!Number.isFinite(variant.durationMinutes) ||
          variant.durationMinutes <= 0)
      ) {
        return {
          valid: false,
          error: `La durée de la variante « ${variant.label.trim()} » doit être supérieure à 0 minute.`,
        }
      }
    }
  }

  if (input.defaultConsumables && input.defaultConsumables.length > 0) {
    for (const cons of input.defaultConsumables) {
      if (!cons.productId || !cons.productId.trim()) {
        return {
          valid: false,
          error: 'Veuillez sélectionner un produit pour chaque consommable cabine.',
        }
      }
      if (
        !Number.isFinite(cons.quantity) ||
        !Number.isInteger(cons.quantity) ||
        cons.quantity < 1
      ) {
        return {
          valid: false,
          error:
            'La quantité de chaque consommable cabine doit être un entier supérieur ou égal à 1.',
        }
      }
    }
  }

  if (input.commissionOverride) {
    if (input.commissionOverride.mode === 'rate') {
      if (
        !Number.isFinite(input.commissionOverride.value) ||
        input.commissionOverride.value <= 0 ||
        input.commissionOverride.value > 100
      ) {
        return {
          valid: false,
          error:
            'Le taux de commission spécifique de la prestation doit être compris entre 0,5% et 100%.',
        }
      }
    } else if (input.commissionOverride.mode === 'fixed') {
      const fixedCheck = validateNonNegativeFCFA(
        input.commissionOverride.value,
        'La commission fixe de la prestation',
      )
      if (!fixedCheck.valid) return fixedCheck
    }
  }

  return { valid: true }
}

export function validateEmployeeInput(input: {
  lastName: string
  firstName: string
  roleTitle: string
  baseSalary: number
  hireDate: string
  commissionEnabled: boolean
  commissionRate: number
}): ValidationResult {
  if (!input.lastName.trim() || !input.firstName.trim()) {
    return {
      valid: false,
      error: "Veuillez renseigner le nom et le prénom de l'employé.",
    }
  }
  if (!input.roleTitle.trim()) {
    return { valid: false, error: "Veuillez renseigner le poste de l'employé." }
  }
  const salCheck = validateNonNegativeFCFA(
    input.baseSalary,
    'Le salaire de base',
  )
  if (!salCheck.valid) return salCheck
  if (!input.hireDate) {
    return { valid: false, error: "Veuillez indiquer la date d'embauche." }
  }
  if (
    input.commissionEnabled &&
    (input.commissionRate <= 0 || input.commissionRate > 100)
  ) {
    return {
      valid: false,
      error: 'Le taux de commission doit être compris entre 0,5% et 100%.',
    }
  }
  return { valid: true }
}

export function validateProductInput(input: {
  name: string
  unit: string
  costPrice: number
  alertThreshold: number
}): ValidationResult {
  if (!input.name || input.name.trim().length < 2) {
    return {
      valid: false,
      error: 'Veuillez indiquer un nom de produit valide.',
    }
  }
  if (!input.unit.trim()) {
    return { valid: false, error: "Veuillez préciser l'unité de comptage." }
  }
  const costCheck = validateNonNegativeFCFA(
    input.costPrice,
    "Le prix d'achat unitaire",
  )
  if (!costCheck.valid) return costCheck
  if (!Number.isInteger(input.alertThreshold) || input.alertThreshold < 0) {
    return {
      valid: false,
      error: "Le seuil d'alerte doit être un entier positif ou nul.",
    }
  }
  return { valid: true }
}

/**
 * Garde anti-double-soumission rapide : bloque la répétition identique dans une fenêtre de temps (ex: 1500 ms).
 */
export class DuplicateSubmissionGuard {
  private recentMap = new Map<string, number>()

  public tryAcquire(fingerprint: string, windowMs = 1500, now = Date.now()): boolean {
    const prevTs = this.recentMap.get(fingerprint)
    if (prevTs !== undefined && now - prevTs < windowMs) {
      return false
    }
    this.recentMap.set(fingerprint, now)
    // Nettoyage léger des anciennes clés
    if (this.recentMap.size > 200) {
      for (const [k, ts] of this.recentMap.entries()) {
        if (now - ts >= windowMs) {
          this.recentMap.delete(k)
        }
      }
    }
    return true
  }

  public clear(): void {
    this.recentMap.clear()
  }
}
