import { filterSyncPayload, filterSyncTombstones } from './syncPolicy.ts'
import { lockSyncState, parseSyncCursor, readSyncDelta } from './syncProtocol.ts'
import { assertLiveSession, rotateSession, revokeSession } from './sessions.ts'
import { assertSameOrigin, readRefreshCookie, writeRefreshCookie } from './sessionCookies.ts'
import { defaultTenantId, resolveSessionTenant, withTenantClient } from './tenantContext.ts'
import { clearLoginIdentityLimit, consumeAuthLimit, normalizeLoginIdentifier, RateLimitError, requestIp } from './authRateLimit.ts'
import { listManagedUsers, requireActiveManager, updateManagedUser, type UpdateUserInput } from './userAdministration.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AuthApiError,
  assertAuthConfiguration,
  getNeonAuthStatus,
  loginUserOnNeon,
  registerUserOnNeon,
  verifyAuthSessionToken,
  type RegisterUserInput,
} from './authEngine.ts'
import {
  getNeonPool,
  sanitizeDatabaseUrl,
  resolveCloudDatabaseUrl,
  verifyManagerPin,
  type SqlPoolLike,
} from './neonClient.ts'
import {
  ensureNeonSchema,
  readFullCloudState,
  syncWithNeonDatabase,
  type CloudSyncEnvelope,
} from './syncEngine.ts'

export interface ApiHandlerOptions {
  poolOverride?: SqlPoolLike | null
  expectedPinOverride?: string
  databaseUrlOverride?: string
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(JSON.stringify(body))
}

function sendAuthResult<T extends { refreshToken?: string; refreshExpiresAt?: string; rememberMe?: boolean }>(res: ServerResponse, status: number, result: T): void {
  const { refreshToken, rememberMe, ...body } = result
  if (refreshToken) writeRefreshCookie(res, refreshToken, rememberMe, result.refreshExpiresAt)
  sendJson(res, status, { ok: true, ...body })
}

function extractBearerToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }
  return undefined
}

function extractPinFromHeaders(req: IncomingMessage): string | undefined {
  const pinHeader = req.headers['x-salon-pin']
  if (typeof pinHeader === 'string' && pinHeader.trim()) {
    return pinHeader.trim()
  }
  return extractBearerToken(req)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const maybePreparsed = (req as IncomingMessage & { body?: unknown }).body
  if (maybePreparsed !== undefined && maybePreparsed !== null) {
    return typeof maybePreparsed === 'string'
      ? JSON.parse(maybePreparsed)
      : maybePreparsed
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    const MAX_BYTES = 15 * 1024 * 1024

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length
      if (totalBytes > MAX_BYTES) {
        reject(new Error('Charge utile trop volumineuse (max 15 Mo).'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(JSON.parse(raw))
      } catch {
        reject(new SyntaxError('Corps de requête JSON invalide.'))
      }
    })
    req.on('error', reject)
  })
}

function formatDbError(err: unknown): {
  status: number
  code: string
  message: string
} {
  if (err instanceof SyntaxError) return { status: 400, code: 'INVALID_JSON', message: 'Corps de requête JSON invalide.' }
  if (err instanceof AuthApiError) {
    return {
      status: err.status,
      code: err.code,
      message: err.message,
    }
  }
  const rawMsg = err instanceof Error ? err.message : String(err)
  if (
    rawMsg.includes('ENOTFOUND') ||
    rawMsg.includes('EAI_AGAIN') ||
    rawMsg.includes('ECONNREFUSED') ||
    rawMsg.includes('ETIMEDOUT') ||
    rawMsg.includes('Connection terminated') ||
    rawMsg.includes('timeout')
  ) {
    return {
      status: 503,
      code: 'NETWORK_UNREACHABLE',
      message:
        'Base Cloud Neon temporairement injoignable (hors-ligne ou pare-feu réseau). Vos données restent protégées localement dans IndexedDB et se synchroniseront dès le retour de la connexion.',
    }
  }
  if (rawMsg.includes('password authentication failed')) {
    return {
      status: 502,
      code: 'DB_AUTH_FAILED',
      message:
        'Échec d’authentification PostgreSQL Neon : vérifiez DATABASE_URL côté serveur.',
    }
  }
  return {
    status: 500,
    code: 'SYNC_ERROR',
    message: 'Erreur interne du serveur. Veuillez réessayer ultérieurement.',
  }
}

export async function handleSalonApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: ApiHandlerOptions = {},
): Promise<boolean> {
  const urlObj = new URL(req.url ?? '/', 'http://localhost')
  const pathname = urlObj.pathname

  if (!pathname.startsWith('/api/')) {
    return false
  }

  try {
    assertAuthConfiguration()
  } catch (error) {
    const formatted = formatDbError(error)
    sendJson(res, formatted.status, { ok: false, code: formatted.code, message: formatted.message })
    return true
  }

  const dbUrl = sanitizeDatabaseUrl(
    options.databaseUrlOverride ?? resolveCloudDatabaseUrl(),
  )
  const expectedPin = options.expectedPinOverride ?? process.env.SALON_SYNC_PIN

  // 1. Santé publique (sans exposer DATABASE_URL ni le PIN)
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, {
      ok: true,
      databaseConfigured: Boolean(dbUrl || options.poolOverride),
      pinRequired: Boolean((expectedPin ?? '').trim()),
    })
    return true
  }

  const pool =
    options.poolOverride !== undefined
      ? options.poolOverride
      : getNeonPool(dbUrl)

  let callerSession = verifyAuthSessionToken(
    extractBearerToken(req),
    expectedPin,
  )

  const credentialRoute = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/status'].includes(pathname)
  if (callerSession && pool && !credentialRoute) {
    try {
      await ensureNeonSchema(pool)
      await assertLiveSession(pool, callerSession)
      callerSession = await resolveSessionTenant(pool, callerSession)
    } catch (error) {
      const formatted = formatDbError(error)
      sendJson(res, formatted.status, { ok: false, code: formatted.code, message: formatted.message })
      return true
    }
  }

  // 2. Routes publiques d'authentification (/api/auth/*)
  if (pathname.startsWith('/api/auth/')) {
    if (!pool) {
      sendJson(res, 503, {
        ok: false,
        code: 'DB_NOT_CONFIGURED',
        message:
          "DATABASE_URL n'est pas configurée côté serveur : fonctionnement local hors-ligne actif.",
      })
      return true
    }

    if ((pathname === '/api/auth/refresh' || pathname === '/api/auth/logout') && req.method === 'POST') {
      try {
        assertSameOrigin(req)
        await ensureNeonSchema(pool)
        await consumeAuthLimit(pool, 'session-ip', requestIp(req), 120, 900)
        const refreshToken = readRefreshCookie(req)
        if (pathname === '/api/auth/logout') {
          const revoked = await revokeSession(pool, refreshToken, callerSession)
          writeRefreshCookie(res)
          sendJson(res, 200, { ok: true, revoked })
        } else {
          const result = await rotateSession(pool, refreshToken, { ip: requestIp(req), userAgent: req.headers['user-agent'] })
          sendAuthResult(res, 200, result)
        }
      } catch (error) {
        if (error instanceof RateLimitError) res.setHeader('Retry-After', String(error.retryAfter))
        const formatted = formatDbError(error)
        if (formatted.status === 401) writeRefreshCookie(res)
        sendJson(res, formatted.status, { ok: false, code: formatted.code, message: formatted.message })
      }
      return true
    }

    if (pathname === '/api/auth/status' && req.method === 'GET') {
      try {
        const status = await getNeonAuthStatus(pool)
        sendJson(res, 200, {
          ok: true,
          ...status,
        })
      } catch (err) {
        if (err instanceof RateLimitError) res.setHeader('Retry-After', String(err.retryAfter))
        const formatted = formatDbError(err)
        sendJson(res, formatted.status, {
          ok: false,
          code: formatted.code,
          message: formatted.message,
        })
      }
      return true
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      try {
        assertSameOrigin(req)
        await ensureNeonSchema(pool)
        await consumeAuthLimit(pool, 'register-ip', requestIp(req), 10, 3600)
        const body = (await readJsonBody(req)) as RegisterUserInput
        const result = await registerUserOnNeon(pool, body, {
          expectedPin,
          callerSession,
          metadata: { ip: requestIp(req), userAgent: req.headers['user-agent'] },
        })
        sendAuthResult(res, 201, result)
      } catch (err) {
        if (err instanceof RateLimitError) res.setHeader('Retry-After', String(err.retryAfter))
        const formatted = formatDbError(err)
        sendJson(res, formatted.status, {
          ok: false,
          code: formatted.code,
          message: formatted.message,
        })
      }
      return true
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      try {
        assertSameOrigin(req)
        const body = (await readJsonBody(req)) as {
          email?: string
          password?: string
          rememberMe?: boolean
        }
        if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || (body.rememberMe !== undefined && typeof body.rememberMe !== 'boolean') || body.email.length > 320 || body.password.length > 1024) {
          throw new AuthApiError(400, 'INVALID_CREDENTIALS_INPUT', 'Identifiant ou mot de passe invalide.')
        }
        await ensureNeonSchema(pool)
        await consumeAuthLimit(pool, 'login-ip', requestIp(req), 30, 900)
        await consumeAuthLimit(pool, 'login-identity', normalizeLoginIdentifier(body.email), 5, 900)
        const result = await loginUserOnNeon(
          pool,
          { email: body.email ?? '', password: body.password ?? '' },
          { expectedPin, metadata: { ip: requestIp(req), userAgent: req.headers['user-agent'], rememberMe: body.rememberMe !== false } },
        )
        await clearLoginIdentityLimit(pool, body.email)
        sendAuthResult(res, 200, result)
      } catch (err) {
        if (err instanceof RateLimitError) res.setHeader('Retry-After', String(err.retryAfter))
        const formatted = formatDbError(err)
        sendJson(res, formatted.status, {
          ok: false,
          code: formatted.code,
          message: formatted.message,
        })
      }
      return true
    }

    sendJson(res, 404, {
      ok: false,
      code: 'NOT_FOUND',
      message: `Route Auth introuvable : ${req.method} ${pathname}`,
    })
    return true
  }

  // Les comptes ne passent jamais par la synchronisation, ni par le PIN partagé.
  if (pathname === '/api/users' || pathname.startsWith('/api/users/')) {
    try {
      if (!pool) throw new AuthApiError(503, 'DB_NOT_CONFIGURED', 'Base Cloud non configurée.')
      if (!callerSession) throw new AuthApiError(401, 'SESSION_REQUIRED', 'Connectez-vous pour administrer les comptes.')
      await ensureNeonSchema(pool)
      await requireActiveManager(pool, callerSession)
      await consumeAuthLimit(pool, 'user-admin', callerSession.uid, 60, 900)
      if (pathname === '/api/users' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, users: await listManagedUsers(pool, callerSession) })
      } else if ((pathname === '/api/users' || pathname === '/api/users/provision') && req.method === 'POST') {
        const body = await readJsonBody(req) as RegisterUserInput
        if (!body || typeof body !== 'object' || Array.isArray(body) || 'passwordHash' in body) {
          throw new AuthApiError(400, 'INVALID_USER_INPUT', 'Fournissez les informations du compte et un mot de passe, jamais un hash.')
        }
        // Création seule : registerUserOnNeon refuse les e-mails existants.
        const result = await registerUserOnNeon(pool, body, { callerSession, expectedPin, issueSession: false })
        console.info(JSON.stringify({ action: 'user.create', actorId: callerSession.uid, userId: result.user.id }))
        sendJson(res, 201, { ok: true, user: result.user })
      } else if (/^\/api\/users\/[^/]+$/.test(pathname) && req.method === 'PATCH') {
        const body = await readJsonBody(req) as UpdateUserInput
        const user = await updateManagedUser(pool, callerSession, decodeURIComponent(pathname.split('/').at(-1)!), body)
        sendJson(res, 200, { ok: true, user })
      } else {
        sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'Méthode non autorisée.' })
      }
    } catch (error) {
      if (error instanceof RateLimitError) res.setHeader('Retry-After', String(error.retryAfter))
      const formatted = formatDbError(error)
      sendJson(res, formatted.status, { ok: false, code: formatted.code, message: formatted.message })
    }
    return true
  }

  // 3. Routes /api/sync* : exigent soit un jeton de session signé valide, soit un code serveur SALON_SYNC_PIN configuré
  const pinCheck = verifyManagerPin(extractPinFromHeaders(req), expectedPin)
  const authorizedByPin = pinCheck.pinConfigured && pinCheck.authorized
  if (!authorizedByPin && !callerSession) {
    sendJson(res, 401, {
      ok: false,
      code: 'INVALID_PIN',
      message:
        'Session utilisateur ou code serveur invalide. Connectez-vous à votre compte pour synchroniser.',
    })
    return true
  }

  if (!pool) {
    sendJson(res, 503, {
      ok: false,
      code: 'DB_NOT_CONFIGURED',
      message:
        "DATABASE_URL n'est pas configurée côté serveur (.env ou variables d'environnement).",
    })
    return true
  }

  if (pathname === '/api/sync/verify' && req.method === 'POST') {
    try {
      await ensureNeonSchema(pool)
      const tenantId = callerSession?.tid ?? await defaultTenantId(pool)
      const state = await withTenantClient(pool, tenantId, readFullCloudState)
      sendJson(res, 200, {
        ok: true,
        connected: true,
        serverTime: new Date().toISOString(),
        totalRemoteRecords: state.totalRemoteRecords,
        hasRemoteSalon: state.payload !== null,
      })
    } catch (err) {
      if (err instanceof RateLimitError) res.setHeader('Retry-After', String(err.retryAfter))
        const formatted = formatDbError(err)
      sendJson(res, formatted.status, {
        ok: false,
        connected: false,
        code: formatted.code,
        message: formatted.message,
      })
    }
    return true
  }

  if (pathname === '/api/sync/pull' && req.method === 'GET') {
    try {
      await ensureNeonSchema(pool)
      const tenantId = callerSession?.tid ?? await defaultTenantId(pool)
      const rawSince = urlObj.searchParams.get('since')
      const since = rawSince === null ? undefined : parseSyncCursor(Number(rawSince))
      const rawLimit = urlObj.searchParams.get('limit')
      const limit = rawLimit === null ? 500 : Number(rawLimit)
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AuthApiError(400, 'INVALID_LIMIT', 'Limite de pagination invalide.')
      const result = await withTenantClient(pool, tenantId, async (client) => {
        await lockSyncState(client)
        if (since !== undefined) return readSyncDelta(client, since, callerSession?.role, limit)
        const state = await readFullCloudState(client)
        return { payload: filterSyncPayload(state.payload, callerSession?.role), tombstones: filterSyncTombstones(state.tombstones, callerSession?.role), totalRemoteRecords: state.totalRemoteRecords, cursor: await lockSyncState(client), hasMore: false }
      })
      sendJson(res, 200, { ok: true, ...result })
    } catch (err) {
      if (err instanceof RateLimitError) res.setHeader('Retry-After', String(err.retryAfter))
        const formatted = formatDbError(err)
      sendJson(res, formatted.status, {
        ok: false,
        code: formatted.code,
        message: formatted.message,
      })
    }
    return true
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    try {
      const body = (await readJsonBody(req)) as Partial<CloudSyncEnvelope>
      if (
        !body ||
        !body.payload ||
        body.payload.format !== 'SALON_PRO_BACKUP_V1'
      ) {
        sendJson(res, 400, {
          ok: false,
          code: 'INVALID_PAYLOAD',
          message:
            'Format de synchronisation invalide (SALON_PRO_BACKUP_V1 attendu).',
        })
        return true
      }

      await ensureNeonSchema(pool)
      const result = await syncWithNeonDatabase(pool, {
        payload: body.payload,
        cursor: parseSyncCursor(body.cursor),
        tombstones: Array.isArray(body.tombstones) ? body.tombstones : [],
      }, callerSession?.tid ?? await defaultTenantId(pool), callerSession?.role)
      sendJson(res, 200, { ...result, tombstones: filterSyncTombstones(result.tombstones, callerSession?.role), ...(result.payload !== undefined ? { payload: filterSyncPayload(result.payload, callerSession?.role) } : {}) })
    } catch (err) {
      if (err instanceof RateLimitError) res.setHeader('Retry-After', String(err.retryAfter))
        const formatted = formatDbError(err)
      sendJson(res, formatted.status, {
        ok: false,
        code: formatted.code,
        message: formatted.message,
      })
    }
    return true
  }

  sendJson(res, 404, {
    ok: false,
    code: 'NOT_FOUND',
    message: `Route API introuvable : ${req.method} ${pathname}`,
  })
  return true
}
