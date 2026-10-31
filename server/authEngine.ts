import { issueSession, type SessionGrant, type SessionMetadata } from './sessions.ts'
import { defaultTenantId, resolveSessionTenant, withTenantClient } from './tenantContext.ts'
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from '../src/domain/passwordPolicy.ts'
import {
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  PublicSalonUser,
  SalonUserAccount,
  UserRole,
} from '../src/domain/models/index.ts'
import { type SqlPoolLike } from './neonClient.ts'
import { ensureNeonSchema, readFullCloudState } from './syncEngine.ts'

const PBKDF2_ITERATIONS = 100_000
const KEY_BYTES = 32
const SESSION_TTL_MS = 15 * 60 * 1000 // 15 minutes

let cachedRuntimeSecret: string | null = null

function loadOrCreatePersistentRuntimeSecret(): string {
  if (cachedRuntimeSecret) return cachedRuntimeSecret
  const secretFilePath = resolve(process.cwd(), '.salon-auth-secret')
  try {
    if (existsSync(secretFilePath)) {
      const stored = readFileSync(secretFilePath, 'utf8').trim()
      if (stored.length >= 32) {
        cachedRuntimeSecret = stored
        return stored
      }
    }
    const generated = randomBytes(32).toString('hex')
    writeFileSync(secretFilePath, `${generated}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    cachedRuntimeSecret = generated
    return generated
  } catch {
    // Environnement serverless en lecture seule : repli mémoire si SALON_AUTH_SECRET non défini
    cachedRuntimeSecret = randomBytes(32).toString('hex')
    return cachedRuntimeSecret
  }
}

export interface SessionTokenPayload {
  tid?: string
  sid?: string
  iat?: number
  uid: string
  email: string
  role: UserRole
  exp: number
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function hashPasswordNode(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): string {
  const salt = randomBytes(16)
  const derived = pbkdf2Sync(password, salt, iterations, KEY_BYTES, 'sha256')
  return `pbkdf2_sha256$${iterations}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPasswordNode(
  password: string,
  storedHash: string,
): boolean {
  const parts = storedHash.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false
  }
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isInteger(iterations) || iterations < 1_000 || iterations > 2_000_000 ||
      !/^[a-f0-9]{32}$/i.test(parts[2]) || !/^[a-f0-9]{64}$/i.test(parts[3])) {
    return false
  }
  const salt = Buffer.from(parts[2], 'hex')
  const expected = Buffer.from(parts[3], 'hex')
  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    expected.length,
    'sha256',
  )
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function toPublicUser(account: SalonUserAccount): PublicSalonUser {
  const { passwordHash: _ignored, ...rest } = account
  void _ignored
  return rest
}

export function assertAuthConfiguration(): void {
  if (process.env.NODE_ENV === 'production' && (process.env.SALON_AUTH_SECRET?.trim().length ?? 0) < 32) {
    throw new AuthApiError(503, 'AUTH_SECRET_MISSING', 'La configuration de sécurité du serveur est incomplète.')
  }
}

function getSigningSecret(): string {
  assertAuthConfiguration()
  // Un PIN humain partagé ne doit jamais servir de clé de signature.
  return process.env.SALON_AUTH_SECRET?.trim() || loadOrCreatePersistentRuntimeSecret()
}

export function signAuthSessionToken(
  user: Pick<SalonUserAccount, 'id' | 'email' | 'role' | 'tenantId'> & { sessionId?: string },
  _fallbackSecret?: string,
): string {
  const payload: SessionTokenPayload = {
    tid: user.tenantId,
    sid: user.sessionId,
    iat: Date.now(),
    uid: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  )
  const sig = createHmac('sha256', getSigningSecret())
    .update(`s1.${encodedPayload}`)
    .digest('base64url')
  return `s1.${encodedPayload}.${sig}`
}

export function verifyAuthSessionToken(
  token: string | undefined,
  _fallbackSecret?: string,
): SessionTokenPayload | null {
  if (!token || !token.startsWith('s1.')) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [, encodedPayload, providedSig] = parts
  const expectedSig = createHmac('sha256', getSigningSecret())
    .update(`s1.${encodedPayload}`)
    .digest('base64url')

  const a = Buffer.from(providedSig, 'utf8')
  const b = Buffer.from(expectedSig, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as SessionTokenPayload
    if (typeof parsed.uid !== 'string' || typeof parsed.email !== 'string' ||
        !Number.isFinite(parsed.exp) || !['manager', 'cashier'].includes(parsed.role)) return null
    if (parsed.sid !== undefined && (typeof parsed.sid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.sid))) return null
    if (parsed.tid !== undefined && (typeof parsed.tid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.tid))) return null
    if (Date.now() > parsed.exp) return null
    return parsed
  } catch {
    return null
  }
}

export class AuthApiError extends Error {
  public readonly status: number
  public readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function parseAccountRow(raw: SalonUserAccount | string): SalonUserAccount {
  return typeof raw === 'string' ? (JSON.parse(raw) as SalonUserAccount) : raw
}

export async function getNeonAuthStatus(
  pool: SqlPoolLike,
): Promise<{ hasUsers: boolean; hasManager: boolean }> {
  await ensureNeonSchema(pool)
  const res = await pool.query<{ has_users: boolean; has_manager: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM memberships m JOIN salon_users u ON u.id = m.user_id
       WHERE m.is_active AND u.is_active) AS has_users,
      EXISTS (SELECT 1 FROM memberships m JOIN salon_users u ON u.id = m.user_id
       WHERE m.is_active AND u.is_active AND m.role = 'manager') AS has_manager`,
  )
  return { hasUsers: res.rows[0]?.has_users ?? false, hasManager: res.rows[0]?.has_manager ?? false }

}

export interface RegisterUserInput {
  fullName: string
  email: string
  phone?: string
  password: string
  role?: UserRole
  salonName?: string
  managerPin?: string
  rememberMe?: boolean
}

export async function registerUserOnNeon(
  pool: SqlPoolLike,
  input: RegisterUserInput,
  options?: {
    expectedPin?: string
    callerSession?: SessionTokenPayload | null
    metadata?: SessionMetadata
    issueSession?: boolean
  },
): Promise<{
  user: PublicSalonUser
  recordForCache: SalonUserAccount
} & Partial<SessionGrant>> {
  if (!input || typeof input !== 'object' || typeof input.fullName !== 'string' ||
      typeof input.email !== 'string' || typeof input.password !== 'string' ||
      (input.phone !== undefined && typeof input.phone !== 'string') ||
      (input.salonName !== undefined && (typeof input.salonName !== 'string' || input.salonName.length > 200)) ||
      (input.role !== undefined && !['manager', 'cashier'].includes(input.role)) ||
      (input.managerPin !== undefined && typeof input.managerPin !== 'string') ||
      (input.rememberMe !== undefined && typeof input.rememberMe !== 'boolean') ||
      input.fullName.length > 200 || input.email.length > 320) {
    throw new AuthApiError(400, 'INVALID_USER_INPUT', 'Informations de compte invalides.')
  }
  const fullName = (input.fullName ?? '').trim()
  const email = normalizeEmail(input.email ?? '')
  const password = input.password ?? ''
  const role: UserRole = input.role === 'cashier' ? 'cashier' : 'manager'

  if (fullName.length < 2) {
    throw new AuthApiError(
      400,
      'INVALID_NAME',
      'Veuillez renseigner votre nom complet (au moins 2 caractères).',
    )
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthApiError(
      400,
      'INVALID_EMAIL',
      'Veuillez saisir une adresse e-mail valide.',
    )
  }
  if (!isStrongPassword(password)) {
    throw new AuthApiError(
      400,
      'WEAK_PASSWORD',
      PASSWORD_POLICY_MESSAGE,
    )
  }

  await ensureNeonSchema(pool)

  const resolvedCaller = options?.callerSession ? await resolveSessionTenant(pool, options.callerSession) : null
  const tenantId = resolvedCaller?.tid ?? await defaultTenantId(pool)
  return withTenantClient(pool, tenantId, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('salon-pro-registration:' || $1))", [tenantId])
  const existingRes = await client.query<{
    payload_json: SalonUserAccount | string; role: UserRole; is_active: boolean
  }>(`SELECT u.payload_json, m.role, m.is_active FROM salon_users u JOIN memberships m ON m.user_id = u.id
      WHERE m.tenant_id = $1 ORDER BY u.created_at ASC`, [tenantId])
  const existingUsers = existingRes.rows.map((row) => {
    const user = parseAccountRow(row.payload_json)
    return { ...user, role: row.role, isActive: user.isActive && row.is_active }
  })
  // Une identité globale ne peut pas être remplacée par un provisionnement dans un autre salon.
  const globalEmail = await client.query<{ id: string }>('SELECT id FROM salon_users WHERE lower(email) = $1', [email])
  if (globalEmail.rows.length) throw new AuthApiError(409, 'EMAIL_EXISTS', 'Un compte existe déjà avec cette adresse e-mail.')

  if (existingUsers.some((u) => normalizeEmail(u.email) === email)) {
    throw new AuthApiError(
      409,
      'EMAIL_EXISTS',
      'Un compte existe déjà avec cette adresse e-mail.',
    )
  }

  const hasExistingManager = existingUsers.some(
    (u) => u.isActive && u.role === 'manager',
  )

  if (!hasExistingManager && role !== 'manager') {
    throw new AuthApiError(
      400,
      'FIRST_USER_MUST_BE_MANAGER',
      'Le tout premier compte du salon doit avoir le rôle Gérant.',
    )
  }

  // Dès qu’un compte existe, un ajout exige un Gérant actif dans le salon (jamais un PIN partagé).
  if (existingUsers.length > 0) {
    const isManagerCaller = existingUsers.some((user) =>
      user.id === resolvedCaller?.uid && user.isActive && resolvedCaller.role === 'manager',
    )
    if (!isManagerCaller) {
      throw new AuthApiError(
        403,
        'MANAGER_APPROVAL_REQUIRED',
        'Un compte Gérant existe déjà : connectez-vous en tant que Gérant pour ajouter un collaborateur.',
      )
    }
  }

  const nowIso = new Date().toISOString()
  const account: SalonUserAccount = {
    id: `usr-${randomUUID()}`,
    tenantId,
    fullName,
    email,
    phone: input.phone?.trim() || undefined,
    role,
    passwordHash: hashPasswordNode(password),
    isActive: true,
    lastLoginAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  }

  await client.query(
    `INSERT INTO salon_users (id, email, full_name, phone, role, password_hash, is_active, last_login_at, created_at, updated_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      account.id,
      account.email,
      account.fullName,
      account.phone ?? null,
      account.role,
      account.passwordHash,
      account.isActive,
      account.lastLoginAt ?? null,
      account.createdAt,
      account.updatedAt,
      JSON.stringify(account),
    ],
  )

  // Purge persistante immédiate de toute donnée mock éventuelle en base Cloud pour ce compte réel
  await client.query('INSERT INTO memberships (tenant_id, user_id, role, is_active) VALUES ($1, $2, $3, true)', [tenantId, account.id, account.role])
  if (existingUsers.length === 0 && input.salonName?.trim()) {
    await client.query('UPDATE tenants SET name = $2 WHERE id = $1', [tenantId, input.salonName.trim()])
  }
  await readFullCloudState(client)

  return {
    user: toPublicUser(account),
    recordForCache: account,
    ...(options?.issueSession === false ? {} : await issueSession(client, { ...toPublicUser(account), tenantId }, { ...options?.metadata, rememberMe: input.rememberMe !== false })),
  }
  })
}

function normalizeLookupText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function matchesNeonAccountIdentifier(
  account: SalonUserAccount,
  rawIdentifier: string,
): boolean {
  const trimmed = rawIdentifier.trim()
  if (!trimmed) return false

  if (normalizeEmail(account.email) === normalizeEmail(trimmed)) {
    return true
  }

  const normInput = normalizeLookupText(trimmed)
  if (normInput.length >= 2 && normalizeLookupText(account.fullName) === normInput) {
    return true
  }

  const inputDigits = trimmed.replace(/\D+/g, '')
  const accountDigits = (account.phone ?? '').replace(/\D+/g, '')
  if (inputDigits.length >= 6 && accountDigits.length >= 6) {
    if (
      accountDigits === inputDigits ||
      accountDigits.endsWith(inputDigits) ||
      inputDigits.endsWith(accountDigits)
    ) {
      return true
    }
  }

  return false
}

export async function loginUserOnNeon(
  pool: SqlPoolLike,
  input: { email: string; password: string },
  options?: { expectedPin?: string; metadata?: SessionMetadata },
): Promise<{
  user: PublicSalonUser
  recordForCache: SalonUserAccount
} & SessionGrant> {
  const identifier = (input.email ?? '').trim()
  const password = input.password ?? ''

  if (!identifier || !password) {
    throw new AuthApiError(
      400,
      'MISSING_CREDENTIALS',
      'Veuillez saisir votre identifiant (e-mail, nom ou téléphone) et votre mot de passe.',
    )
  }

  await ensureNeonSchema(pool)

  const res = await pool.query<{ payload_json: SalonUserAccount | string; tenant_id: string }>(
    'SELECT payload_json, tenant_id FROM salon_users ORDER BY created_at ASC',
  )
  const candidates = res.rows
    .map((r) => ({ ...parseAccountRow(r.payload_json), tenantId: r.tenant_id }))
    .filter((u) => matchesNeonAccountIdentifier(u, identifier))

  const account = candidates.find((u) =>
    verifyPasswordNode(password, u.passwordHash),
  )

  if (!account) {
    throw new AuthApiError(
      401,
      'INVALID_CREDENTIALS',
      'Identifiant ou mot de passe incorrect.',
    )
  }

  if (!account.isActive) {
    throw new AuthApiError(
      403,
      'ACCOUNT_DISABLED',
      'Ce compte a été désactivé par le Gérant.',
    )
  }

  const membership = await resolveSessionTenant(pool, { uid: account.id, email: account.email, role: account.role, tid: account.tenantId, exp: Date.now() + SESSION_TTL_MS })
  return withTenantClient(pool, membership.tid, async (client) => {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('session-user:' || $1))", [account.id])
  const fresh = await client.query<{ payload_json: SalonUserAccount }>('SELECT payload_json FROM salon_users WHERE id = $1', [account.id])
  if (!fresh.rows[0] || !verifyPasswordNode(password, fresh.rows[0].payload_json.passwordHash)) {
    throw new AuthApiError(401, 'INVALID_CREDENTIALS', 'Identifiant ou mot de passe incorrect.')
  }
  const activeMembership = await resolveSessionTenant(client, membership)
  const nowIso = new Date().toISOString()
  const updatedAccount: SalonUserAccount = {
    ...fresh.rows[0].payload_json,
    tenantId: membership.tid,
    role: activeMembership.role,
    lastLoginAt: nowIso,
    updatedAt: nowIso,
  }

  await client.query(
    `INSERT INTO salon_users (id, email, full_name, phone, role, password_hash, is_active, last_login_at, created_at, updated_at, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       last_login_at = EXCLUDED.last_login_at,
       updated_at = EXCLUDED.updated_at,
       payload_json = EXCLUDED.payload_json
     WHERE EXCLUDED.updated_at > salon_users.updated_at`,
    [
      updatedAccount.id,
      updatedAccount.email,
      updatedAccount.fullName,
      updatedAccount.phone ?? null,
      updatedAccount.role,
      updatedAccount.passwordHash,
      updatedAccount.isActive,
      updatedAccount.lastLoginAt ?? null,
      updatedAccount.createdAt,
      updatedAccount.updatedAt,
      JSON.stringify(updatedAccount),
    ],
  )

  // Purge persistante immédiate de toute donnée mock éventuelle en base Cloud lors de la connexion
  await readFullCloudState(client)

  return {
    user: toPublicUser(updatedAccount),
    recordForCache: updatedAccount,
    ...await issueSession(client, { ...toPublicUser(updatedAccount), tenantId: membership.tid }, options?.metadata),
  }
  })
}
