import { timingSafeEqual } from 'node:crypto'
import pg from 'pg'

const { Pool } = pg

export interface SqlQueryResult<Row = Record<string, unknown>> {
  rows: Row[]
  rowCount: number | null
}

export interface SqlQueryable {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SqlQueryResult<Row>>
}

export interface SqlClientLike extends SqlQueryable {
  release(): void
}

export interface SqlPoolLike extends SqlQueryable {
  end?(): Promise<void>
  connect(): Promise<SqlClientLike>
}

/**
 * Nettoie une URL PostgreSQL (retire guillemets accidentels, &amp; HTML ou liens markdown).
 */
export function sanitizeDatabaseUrl(raw: string | undefined): string {
  if (!raw) return ''
  let cleaned = raw.trim().replace(/^['"]|['"]$/g, '')
  cleaned = cleaned.replace(/&amp;/g, '&')
  // Si un copier-coller markdown a injecté [user:pass@host](mailto:...)
  cleaned = cleaned.replace(
    /\[([^\]]+)\]\(mailto:[^)]+\)/g,
    '$1',
  )
  return cleaned
}

let cachedPool: pg.Pool | null = null
let cachedUrl = ''

export function resolveCloudDatabaseUrl(): string {
  return sanitizeDatabaseUrl(process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL)
}

export function databaseConnectionOptions(url: string): { options?: string } {
  const host = new URL(url).hostname
  const isSupabase = host.endsWith('.supabase.co') || host.endsWith('.supabase.com') ||
    url === sanitizeDatabaseUrl(process.env.SUPABASE_DATABASE_URL)
  // Le projet héberge déjà d’autres tables publiques : aucun fallback sur public.
  return isSupabase ? { options: '-c search_path=salon_pro' } : {}
}

export function getNeonPool(explicitUrl?: string): SqlPoolLike | null {
  const url = sanitizeDatabaseUrl(explicitUrl ?? resolveCloudDatabaseUrl())
  if (!url) return null

  if (cachedPool && cachedUrl === url) {
    return cachedPool
  }

  if (cachedPool) {
    void cachedPool.end().catch(() => {})
  }

  cachedPool = new Pool({
    connectionString: url,
    ...databaseConnectionOptions(url),
    ssl: url.includes('localhost') || url.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: true },
    max: 5,
    connectionTimeoutMillis: 6000,
    idleTimeoutMillis: 20000,
  })
  cachedUrl = url
  return cachedPool
}

/**
 * Vérifie en temps constant le code d'accès Gérant (SALON_SYNC_PIN).
 */
export function verifyManagerPin(
  providedPin: string | undefined | null,
  expectedPinInput?: string,
): { authorized: boolean; pinConfigured: boolean } {
  const expected = (
    expectedPinInput ??
    process.env.SALON_SYNC_PIN ??
    ''
  ).trim()

  if (!expected) {
    return { authorized: false, pinConfigured: false }
  }

  const candidate = (providedPin ?? '').trim()
  if (!candidate) {
    return { authorized: false, pinConfigured: true }
  }

  const bufExpected = Buffer.from(expected, 'utf8')
  const bufCandidate = Buffer.from(candidate, 'utf8')
  if (bufExpected.length !== bufCandidate.length) {
    return { authorized: false, pinConfigured: true }
  }

  return {
    authorized: timingSafeEqual(bufExpected, bufCandidate),
    pinConfigured: true,
  }
}
