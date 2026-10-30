import type { SalonInfo } from './models/index.ts'

const LEGACY_MOCK_ID_PREFIXES = [
  'demo-',
  'rec-std-',
  'rec-tpl-',
  'tpl-std-',
] as const

const LEGACY_MOCK_SALON_NAMES = new Set(['Élégance Coiffure & Barber'])
const LEGACY_MOCK_ADDRESSES = new Set([
  'Cocody Angré 8e Tranche — Abidjan',
  'Cocody Angré 8e Tranche, Abidjan',
])
const LEGACY_MOCK_PHONES = new Set(['+225 07 08 44 55 66'])
const LEGACY_MOCK_MANAGERS = new Set(['Kouamé Koffi'])

const MOCK_FOREIGN_KEY_FIELDS = [
  'sessionId',
  'serviceId',
  'productId',
  'employeeId',
  'recurringTemplateId',
  'linkedRevenueId',
  'linkedExpenseId',
  'linkedPayrollId',
  'linkedAdvanceId',
  'linkedStockMovementId',
  'entityId',
] as const

export function isLegacyMockId(id: unknown): boolean {
  if (typeof id !== 'string' || id.length === 0) return false
  return LEGACY_MOCK_ID_PREFIXES.some((prefix) => id.startsWith(prefix))
}

/**
 * Détecte toute écriture héritée d'un ancien jeu de démonstration / mock
 * (`isDemo: true`, identifiant `demo-*` ou clé étrangère pointant vers une entité `demo-*`),
 * sans jamais toucher aux vraies écritures créées sur un compte réel.
 */
export function isLegacyMockRecord(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false
  const rec = row as Record<string, unknown>

  if (rec.isDemo === true) return true
  if (isLegacyMockId(rec.id)) return true

  for (const fk of MOCK_FOREIGN_KEY_FIELDS) {
    if (isLegacyMockId(rec[fk])) return true
  }

  return false
}

/**
 * Détecte un modèle de charge récurrente pré-rempli automatiquement
 * (les vrais modèles créés par l'utilisateur portent un identifiant `rec-<timestamp>-<rand>`).
 */
export function isLegacyRecurringPresetRecord(row: unknown): boolean {
  if (isLegacyMockRecord(row)) return true
  if (!row || typeof row !== 'object') return false
  const id = (row as Record<string, unknown>).id
  if (typeof id !== 'string') return false
  return !/^rec-\d{10,}-/.test(id)
}

/**
 * Retire toute propriété résiduelle `isDemo` d'un enregistrement réel.
 */
export function stripLegacyDemoFlag<T>(
  row: T,
): { cleaned: T; hadFlag: boolean } {
  if (!row || typeof row !== 'object' || !('isDemo' in (row as object))) {
    return { cleaned: row, hadFlag: false }
  }
  const clone = { ...(row as Record<string, unknown>) }
  delete clone.isDemo
  return { cleaned: clone as T, hadFlag: true }
}

/**
 * Nettoie les champs d'identité du salon qui contiendraient encore les anciennes
 * valeurs fictives par défaut, tout en préservant les informations réelles saisies par le Gérant.
 */
export function sanitizeLegacySalonInfo(
  salon: SalonInfo,
  activeManager?: { fullName?: string; phone?: string } | null,
  nowIso = new Date().toISOString(),
): { cleaned: SalonInfo; changed: boolean } {
  let changed = false
  let nextName = salon.name
  let nextAddress = salon.address
  let nextPhone = salon.phone
  let nextManager = salon.managerName

  if (LEGACY_MOCK_SALON_NAMES.has(nextName.trim())) {
    nextName = ''
    changed = true
  }
  if (LEGACY_MOCK_ADDRESSES.has(nextAddress.trim())) {
    nextAddress = ''
    changed = true
  }
  if (LEGACY_MOCK_PHONES.has(nextPhone.trim())) {
    nextPhone = activeManager?.phone?.trim() ?? ''
    changed = true
  }
  if (LEGACY_MOCK_MANAGERS.has(nextManager.trim())) {
    nextManager = activeManager?.fullName?.trim() ?? ''
    changed = true
  }

  if (!changed) {
    return { cleaned: salon, changed: false }
  }

  return {
    cleaned: {
      ...salon,
      name: nextName,
      address: nextAddress,
      phone: nextPhone,
      managerName: nextManager,
      updatedAt: nowIso,
    },
    changed: true,
  }
}
