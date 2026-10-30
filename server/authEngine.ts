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
import { verifyManagerPin, type SqlPoolLike } from './neonClient.ts'
import { ensureNeonSchema, readFullCloudState } from './syncEngine.ts'

const PBKDF2_ITERATIONS = 100_000
const KEY_BYTES = 32
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 jours

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
  if (!Number.isFinite(iterations) || iterations < 1_000) {
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

function getSigningSecret(fallbackSecret?: string): string {
  const raw =
    process.env.SALON_AUTH_SECRET ??
    fallbackSecret ??
    process.env.SALON_SYNC_PIN ??
    ''
  return raw.trim() || loadOrCreatePersistentRuntimeSecret()
}

export function signAuthSessionToken(
  user: Pick<SalonUserAccount, 'id' | 'email' | 'role'>,
  fallbackSecret?: string,
): string {
  const payload: SessionTokenPayload = {
    uid: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  )
  const sig = createHmac('sha256', getSigningSecret(fallbackSecret))
    .update(`s1.${encodedPayload}`)
    .digest('base64url')
  return `s1.${encodedPayload}.${sig}`
}

export function verifyAuthSessionToken(
  token: string | undefined,
  fallbackSecret?: string,
): SessionTokenPayload | null {
  if (!token || !token.startsWith('s1.')) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [, encodedPayload, providedSig] = parts
  const expectedSig = createHmac('sha256', getSigningSecret(fallbackSecret))
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
    if (!parsed.uid || !parsed.email || !parsed.exp) return null
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
  const res = await pool.query<{ payload_json: SalonUserAccount | string }>(
    'SELECT payload_json FROM salon_users ORDER BY created_at ASC',
  )
  const accounts = res.rows
    .map((r) => parseAccountRow(r.payload_json))
    .filter((u) => u.isActive)
  return {
    hasUsers: accounts.length > 0,
    hasManager: accounts.some((u) => u.role === 'manager'),
  }
}

export interface RegisterUserInput {
  fullName: string
  email: string
  phone?: string
  password: string
  role?: UserRole
  salonName?: string
  managerPin?: string
}

export async function registerUserOnNeon(
  pool: SqlPoolLike,
  input: RegisterUserInput,
  options?: {
    expectedPin?: string
    callerSession?: SessionTokenPayload | null
  },
): Promise<{
  user: PublicSalonUser
  recordForCache: SalonUserAccount
  sessionToken: string
}> {
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
  if (password.length < 6) {
    throw new AuthApiError(
      400,
      'WEAK_PASSWORD',
      'Le mot de passe doit contenir au moins 6 caractères.',
    )
  }

  await ensureNeonSchema(pool)

  const existingRes = await pool.query<{
    payload_json: SalonUserAccount | string
  }>('SELECT payload_json FROM salon_users ORDER BY created_at ASC')
  const existingUsers = existingRes.rows.map((r) =>
    parseAccountRow(r.payload_json),
  )

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

  // Si un Gérant existe déjà, l'ajout d'un compte exige une session Gérant active (ou un code serveur SALON_SYNC_PIN configuré)
  if (hasExistingManager) {
    const isManagerCaller = options?.callerSession?.role === 'manager'
    const pinCheck = verifyManagerPin(input.managerPin, options?.expectedPin)
    const pinOk = pinCheck.pinConfigured && pinCheck.authorized
    if (!isManagerCaller && !pinOk) {
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

  await pool.query(
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
  await readFullCloudState(pool)

  return {
    user: toPublicUser(account),
    recordForCache: account,
    sessionToken: signAuthSessionToken(account, options?.expectedPin),
  }
}

export async function loginUserOnNeon(
  pool: SqlPoolLike,
  input: { email: string; password: string },
  options?: { expectedPin?: string },
): Promise<{
  user: PublicSalonUser
  recordForCache: SalonUserAccount
  sessionToken: string
}> {
  const email = normalizeEmail(input.email ?? '')
  const password = input.password ?? ''

  if (!email || !password) {
    throw new AuthApiError(
      400,
      'MISSING_CREDENTIALS',
      'Veuillez saisir votre adresse e-mail et votre mot de passe.',
    )
  }

  await ensureNeonSchema(pool)

  const res = await pool.query<{ payload_json: SalonUserAccount | string }>(
    'SELECT payload_json FROM salon_users ORDER BY created_at ASC',
  )
  const account = res.rows
    .map((r) => parseAccountRow(r.payload_json))
    .find((u) => normalizeEmail(u.email) === email)

  if (!account || !verifyPasswordNode(password, account.passwordHash)) {
    throw new AuthApiError(
      401,
      'INVALID_CREDENTIALS',
      'Adresse e-mail ou mot de passe incorrect.',
    )
  }

  if (!account.isActive) {
    throw new AuthApiError(
      403,
      'ACCOUNT_DISABLED',
      'Ce compte a été désactivé par le Gérant.',
    )
  }

  const nowIso = new Date().toISOString()
  const updatedAccount: SalonUserAccount = {
    ...account,
    lastLoginAt: nowIso,
    updatedAt: nowIso,
  }

  await pool.query(
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
  await readFullCloudState(pool)

  return {
    user: toPublicUser(updatedAccount),
    recordForCache: updatedAccount,
    sessionToken: signAuthSessionToken(updatedAccount, options?.expectedPin),
  }
}
