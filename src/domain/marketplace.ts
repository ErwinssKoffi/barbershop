import type { ProfileDetails } from './profileDetails.ts'
/** Public DTO allowlist. Never serialize a draft, tenant identity or database row directly. */
export interface PublicSalonProfileV1 {
  slug: string
  displayName: string
  description: string
  location: { city: string; commune: string }
  publicPhone: string | null
  revision: number
}
export interface SalonPublicProfileDraft {
  details?: ProfileDetails
  id: string
  tenantId: string
  displayName: string
  description: string
  city: string
  commune: string
  publicPhone: string | null
  version: number
}
export interface PublishedSalonProfileRow {
  slug: string
  display_name: string
  description: string
  city: string
  commune: string
  public_phone: string | null
  revision: number
}
/** Call only with a row read under the public reader policy, never a draft. */
export function publicSalonProfileDto(row: PublishedSalonProfileRow): PublicSalonProfileV1 {
  return {
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    location: { city: row.city, commune: row.commune },
    publicPhone: row.public_phone,
    revision: row.revision,
  }
}
