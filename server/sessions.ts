import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { AuthApiError, signAuthSessionToken, type SessionTokenPayload } from './authEngine.ts'
import { resolveSessionTenant, setTenantContext } from './tenantContext.ts'
import type { SqlPoolLike, SqlQueryable } from './neonClient.ts'
import type { PublicSalonUser } from '../src/domain/models/index.ts'

export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
export interface SessionGrant {
  sessionToken: string
  refreshToken: string
  sessionId: string
  expiresAt: string
  refreshExpiresAt: string
  rememberMe: boolean
}
export interface SessionMetadata { ip?: string; userAgent?: string; rememberMe?: boolean }
interface SessionRow {
  id: string; user_id: string; tenant_id: string; family_id: string; remember_me: boolean
  expires_at: string | Date; revoked_at: string | Date | null; revoked_reason: string | null
}
function hashRefresh(token: string): string { return createHash('sha256').update(token).digest('hex') }
function validRefresh(token: unknown): token is string { return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) }

/** Appelé dans la transaction de connexion/inscription/rotation. Le secret brut ne va jamais en base. */
export async function issueSession(db: SqlQueryable, user: PublicSalonUser & { tenantId: string }, metadata: SessionMetadata = {}, familyId: string = randomUUID(), deadline = new Date(Date.now() + REFRESH_TTL_MS)): Promise<SessionGrant> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('session-user:' || $1))", [user.id])
  const id = randomUUID()
  const refreshToken = randomBytes(32).toString('base64url')
  const rememberMe = metadata.rememberMe !== false
  await db.query(`INSERT INTO sessions (id, user_id, tenant_id, family_id, refresh_hash, expires_at, ip, user_agent, remember_me)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  [id, user.id, user.tenantId, familyId, hashRefresh(refreshToken), deadline.toISOString(), metadata.ip?.slice(0, 100) ?? null, metadata.userAgent?.slice(0, 500) ?? null, rememberMe])
  return {
    sessionToken: signAuthSessionToken({ ...user, sessionId: id }), refreshToken, sessionId: id,
    expiresAt: new Date(Math.min(Date.now() + 15 * 60 * 1000, deadline.getTime())).toISOString(),
    refreshExpiresAt: deadline.toISOString(), rememberMe,
  }
}

export async function assertLiveSession(db: SqlQueryable, session: SessionTokenPayload): Promise<void> {
  if (!session.sid) throw new AuthApiError(401, 'SESSION_REQUIRED', 'Reconnectez-vous pour sécuriser votre session.')
  const result = await db.query(`SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND tenant_id = $3
    AND revoked_at IS NULL AND expires_at > now()`, [session.sid, session.uid, session.tid ?? null])
  if (!result.rows.length) throw new AuthApiError(401, 'SESSION_REVOKED', 'Cette session a expiré ou a été révoquée. Reconnectez-vous.')
}

export async function rotateSession(pool: SqlPoolLike, refreshToken: unknown, metadata: SessionMetadata = {}): Promise<SessionGrant & { user: PublicSalonUser }> {
  if (!validRefresh(refreshToken)) throw new AuthApiError(401, 'INVALID_REFRESH', 'Renouvellement de session invalide.')
  const client = await pool.connect()
  let replay = false
  try {
    await client.query('BEGIN')
    const lookup = await client.query<{ family_id: string; user_id: string }>('SELECT family_id, user_id FROM sessions WHERE refresh_hash = $1', [hashRefresh(refreshToken)])
    if (!lookup.rows[0]) throw new AuthApiError(401, 'INVALID_REFRESH', 'Renouvellement de session invalide.')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('session-user:' || $1))", [lookup.rows[0].user_id])
    // Même ordre de verrous pour la rotation, le rejeu et la déconnexion.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('session-family:' || $1))", [lookup.rows[0].family_id])
    const result = await client.query<SessionRow>('SELECT * FROM sessions WHERE refresh_hash = $1 FOR UPDATE', [hashRefresh(refreshToken)])
    const row = result.rows[0]
    if (row.revoked_at) {
      if (row.revoked_reason === 'rotated') {
        await client.query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = 'replay' WHERE family_id = $1 AND revoked_at IS NULL", [row.family_id])
        replay = true
        await client.query('COMMIT')
      } else throw new AuthApiError(401, 'SESSION_REVOKED', 'Cette session a été révoquée.')
    } else {
      if (new Date(row.expires_at).getTime() <= Date.now()) throw new AuthApiError(401, 'INVALID_REFRESH', 'Cette session a expiré.')
      const membership = await resolveSessionTenant(client, { uid: row.user_id, tid: row.tenant_id, email: '', role: 'cashier', exp: Date.now() + 1000 })
      await setTenantContext(client, membership.tid)
      const account = await client.query<{ payload_json: PublicSalonUser & { passwordHash?: string } }>('SELECT payload_json FROM salon_users WHERE id = $1', [row.user_id])
      const { passwordHash: _ignored, ...identity } = account.rows[0].payload_json
      void _ignored
      const user = { ...identity, tenantId: membership.tid, role: membership.role }
      const grant = await issueSession(client, user, { ...metadata, rememberMe: row.remember_me }, row.family_id, new Date(row.expires_at))
      await client.query("UPDATE sessions SET revoked_at = now(), revoked_reason = 'rotated', replaced_by = $2, last_used_at = now() WHERE id = $1", [row.id, grant.sessionId])
      await client.query('COMMIT')
      return { ...grant, user }
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  if (replay) throw new AuthApiError(401, 'SESSION_REUSED', 'Jeton de renouvellement déjà utilisé : reconnectez-vous.')
  throw new AuthApiError(401, 'INVALID_REFRESH', 'Renouvellement de session invalide.')
}

/** Une déconnexion révoque la famille/appareil, pas les autres appareils de l'identité. */
export async function revokeSession(pool: SqlPoolLike, refreshToken: unknown, session: SessionTokenPayload | null): Promise<boolean> {
  const result = validRefresh(refreshToken)
    ? await pool.query<{ family_id: string }>('SELECT family_id FROM sessions WHERE refresh_hash = $1', [hashRefresh(refreshToken)])
    : session?.sid ? await pool.query<{ family_id: string }>('SELECT family_id FROM sessions WHERE id = $1 AND user_id = $2 AND tenant_id = $3', [session.sid, session.uid, session.tid ?? null])
      : { rows: [] }
  const family = result.rows[0]?.family_id
  if (!family) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('session-family:' || $1))", [family])
    const update = await client.query("UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE family_id = $1 AND revoked_at IS NULL", [family])
    await client.query('COMMIT')
    return (update.rowCount ?? 0) > 0
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
