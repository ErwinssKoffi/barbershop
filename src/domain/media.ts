export const MEDIA_STATES = ['pending','processing','ready','rejected','deleted'] as const
export type MediaState = typeof MEDIA_STATES[number]
export type MediaMime = 'image/jpeg' | 'image/png' | 'image/webp'
export type MediaPurpose = 'logo' | 'cover' | 'gallery'
export interface MediaLimits { maxBytes: number; maxPixels: number; maxDimension: number }
export interface ImageEvidence {
  declaredMime: MediaMime; declaredBytes: number
  actualMime: MediaMime; actualBytes: number
  width: number; height: number; sha256: string
}
function whole(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid media size')
  return value
}
function mime(value: unknown): MediaMime {
  if (typeof value!=='string' || !['image/jpeg','image/png','image/webp'].includes(value)) throw new Error('Unsupported image MIME')
  return value as MediaMime
}
export function parseMediaLimits(input: unknown): MediaLimits {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Explicit media limits required')
  const row = input as Record<string,unknown>
  if (Object.keys(row).some(key => !['maxBytes','maxPixels','maxDimension'].includes(key))) throw new Error('Unknown media limit')
  return { maxBytes: whole(row.maxBytes,Number.MAX_SAFE_INTEGER), maxPixels: whole(row.maxPixels,Number.MAX_SAFE_INTEGER), maxDimension: whole(row.maxDimension,2147483647) }
}
/** Signature sniffing only. Does NOT decode images, validate containers, strip EXIF or detect bombs. */
export function sniffImageMime(bytes: Uint8Array): MediaMime | null {
  if (bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg'
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((byte,i) => bytes[i]===byte)) return 'image/png'
  if (bytes.length >= 12 && [82,73,70,70].every((byte,i) => bytes[i]===byte) && [87,69,66,80].every((byte,i) => bytes[i+8]===byte)) return 'image/webp'
  return null
}
/** Evidence must come from a trusted bounded decoder/storage inspection, never a complete request body. */
export function validateImageEvidence(evidence: ImageEvidence, limits: MediaLimits): ImageEvidence {
  const policy = parseMediaLimits(limits)
  const declaredBytes = whole(evidence.declaredBytes,policy.maxBytes)
  const actualBytes = whole(evidence.actualBytes,policy.maxBytes)
  const declaredMime = mime(evidence.declaredMime)
  const actualMime = mime(evidence.actualMime)
  const width = whole(evidence.width,policy.maxDimension)
  const height = whole(evidence.height,policy.maxDimension)
  if (declaredMime!==actualMime || declaredBytes!==actualBytes) throw new Error('Upload does not match declared metadata')
  if (BigInt(width)*BigInt(height)>BigInt(policy.maxPixels)) throw new Error('Image pixel limit exceeded')
  if (typeof evidence.sha256!=='string' || !/^[a-f0-9]{64}$/.test(evidence.sha256)) throw new Error('Invalid image digest')
  return { declaredMime,declaredBytes,actualMime,actualBytes,width,height,sha256:evidence.sha256 }
}
export function canTransitionMedia(from: MediaState, to: MediaState): boolean {
  const allowed: Record<MediaState,MediaState[]> = { pending:['processing','rejected','deleted'],processing:['ready','rejected','deleted'],ready:['deleted'],rejected:['deleted'],deleted:[] }
  return MEDIA_STATES.includes(from) && MEDIA_STATES.includes(to) && (from===to || allowed[from]?.includes(to)===true)
}
function uuid(input: string): string {
  if (typeof input!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input)) throw new Error('Invalid media identity')
  return input.toLowerCase()
}
/** Server-generated UUIDs only; path construction is NOT an authorization or an upload signature. */
export function originalMediaKey(tenantId: string, mediaId: string): string {
  return `${uuid(tenantId)}/${uuid(mediaId)}/original`
}
export function variantMediaKey(tenantId: string, mediaId: string, variantId: string): string {
  return `${uuid(tenantId)}/${uuid(mediaId)}/variants/${uuid(variantId)}`
}
export interface PublicMediaV1 {
  id: string; purpose: MediaPurpose; sortOrder: number
  altText: string; creditText: string; width: number; height: number; mime: MediaMime
}
/** Only RLS-visible projection rows. No private keys, bucket, hash, upload URL or original in DTO. */
export function publicMediaDto(row: PublicMediaV1 & { renderable: boolean }): PublicMediaV1 {
  if (row.renderable!==true || !['logo','cover','gallery'].includes(row.purpose) || !Number.isSafeInteger(row.sortOrder) || row.sortOrder<0) throw new Error('Media unavailable')
  if (typeof row.altText!=='string' || !row.altText.trim() || row.altText.length>300 || typeof row.creditText!=='string' || row.creditText.length>300) throw new Error('Invalid public media text')
  return { id:uuid(row.id),purpose:row.purpose,sortOrder:row.sortOrder,altText:row.altText,creditText:row.creditText,width:whole(row.width,2147483647),height:whole(row.height,2147483647),mime:mime(row.mime) }
}
