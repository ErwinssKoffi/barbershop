import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AuthApiError,
  getNeonAuthStatus,
  loginUserOnNeon,
  registerUserOnNeon,
  verifyAuthSessionToken,
  type RegisterUserInput,
} from './authEngine.ts'
import {
  getNeonPool,
  sanitizeDatabaseUrl,
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
  res.end(JSON.stringify(body))
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
        reject(new Error('Corps de requête JSON invalide.'))
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
    message: rawMsg || 'Erreur interne lors de la synchronisation Neon.',
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

  const dbUrl = sanitizeDatabaseUrl(
    options.databaseUrlOverride ?? process.env.DATABASE_URL,
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

  const callerSession = verifyAuthSessionToken(
    extractBearerToken(req),
    expectedPin,
  )

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

    if (pathname === '/api/auth/status' && req.method === 'GET') {
      try {
        const status = await getNeonAuthStatus(pool)
        sendJson(res, 200, {
          ok: true,
          ...status,
        })
      } catch (err) {
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
        const body = (await readJsonBody(req)) as RegisterUserInput
        const result = await registerUserOnNeon(pool, body, {
          expectedPin,
          callerSession,
        })
        sendJson(res, 201, {
          ok: true,
          ...result,
        })
      } catch (err) {
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
        const body = (await readJsonBody(req)) as {
          email?: string
          password?: string
        }
        const result = await loginUserOnNeon(
          pool,
          { email: body.email ?? '', password: body.password ?? '' },
          { expectedPin },
        )
        sendJson(res, 200, {
          ok: true,
          ...result,
        })
      } catch (err) {
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
      const state = await readFullCloudState(pool)
      sendJson(res, 200, {
        ok: true,
        connected: true,
        serverTime: new Date().toISOString(),
        totalRemoteRecords: state.totalRemoteRecords,
        hasRemoteSalon: state.payload !== null,
      })
    } catch (err) {
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
      const state = await readFullCloudState(pool)
      sendJson(res, 200, {
        ok: true,
        syncedAt: new Date().toISOString(),
        totalRemoteRecords: state.totalRemoteRecords,
        payload: state.payload,
        tombstones: state.tombstones,
      })
    } catch (err) {
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

      const result = await syncWithNeonDatabase(pool, {
        payload: body.payload,
        tombstones: Array.isArray(body.tombstones) ? body.tombstones : [],
      })
      sendJson(res, 200, result as unknown as Record<string, unknown>)
    } catch (err) {
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
