import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { AuthApiError } from './authEngine.ts'
import type { SqlPoolLike } from './neonClient.ts'

function bucketKey(scope: string, identity: string): string {
  return `${scope}:${createHash('sha256').update(identity).digest('hex')}`
}

export function requestIp(req: IncomingMessage): string {
  // Ne pas faire confiance aux en-têtes proxy fournis par un navigateur en hébergement direct.
  if (process.env.VERCEL === '1') {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim()
  }
  return req.socket?.remoteAddress ?? 'unknown'
}

export class RateLimitError extends AuthApiError {
  readonly retryAfter: number
  constructor(retryAfter: number) {
    super(429, 'RATE_LIMITED', 'Trop de tentatives. Veuillez patienter avant de réessayer.')
    this.retryAfter = retryAfter
  }
}

/** Compteur atomique PostgreSQL partagé entre instances, avant tout calcul PBKDF2. */
export async function consumeAuthLimit(pool: SqlPoolLike, scope: string, identity: string, limit: number, windowSeconds: number): Promise<void> {
  const result = await pool.query<{ attempts: number; retry_after: number }>(
    `INSERT INTO auth_rate_limits (bucket, attempts, expires_at)
     VALUES ($1, 1, now() + $2 * interval '1 second')
     ON CONFLICT (bucket) DO UPDATE SET
       attempts = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.attempts + 1 END,
       expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_rate_limits.expires_at END
     RETURNING attempts, GREATEST(1, CEIL(EXTRACT(EPOCH FROM expires_at - now())))::integer AS retry_after`,
    [bucketKey(scope, identity), windowSeconds],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Compteur d’authentification indisponible.')
  if (row.attempts > limit) throw new RateLimitError(row.retry_after)
}

export async function clearLoginIdentityLimit(pool: SqlPoolLike, identifier: string): Promise<void> {
  await pool.query('DELETE FROM auth_rate_limits WHERE bucket = $1', [bucketKey('login-identity', normalizeLoginIdentifier(identifier))])
}

export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}
