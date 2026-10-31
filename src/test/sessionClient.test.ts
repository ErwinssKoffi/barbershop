import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_TOKEN_LOCAL_KEY, AUTH_TOKEN_SESSION_KEY, currentAccessToken, fetchWithSession, logoutServerSession, readStoredSession, refreshAccessSession, storeAuthSession } from '../lib/sessionClient'
import type { PublicSalonUser } from '../domain/models'

const user: PublicSalonUser = { id: 'client-user', tenantId: crypto.randomUUID(), fullName: 'Compte Test', email: 'client@example.invalid', role: 'manager', isActive: true, createdAt: '', updatedAt: '' }
function token(expires = Date.now() + 900_000) { return `s1.${btoa(JSON.stringify({ uid: user.id, tid: user.tenantId, exp: expires, sid: crypto.randomUUID() }))}.signature` }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); storeAuthSession(null, null, false) })
afterEach(() => vi.unstubAllGlobals())

describe('Client de sessions navigateur', () => {
  it('remplace le stockage selon le choix utilisateur et ne conserve pas un ancien jeton en connexion locale', () => {
    storeAuthSession(user, token(), true)
    expect(localStorage.getItem(AUTH_TOKEN_LOCAL_KEY)).toBeTruthy()
    storeAuthSession(user, token(), false)
    expect(localStorage.getItem(AUTH_TOKEN_LOCAL_KEY)).toBeNull()
    expect(sessionStorage.getItem(AUTH_TOKEN_SESSION_KEY)).toBeTruthy()
    storeAuthSession(user, null, false)
    expect(sessionStorage.getItem(AUTH_TOKEN_SESSION_KEY)).toBeNull()
    expect(readStoredSession().user?.id).toBe(user.id)
  })

  it('mutualise les renouvellements simultanés, utilise des URL relatives et les cookies same-origin', async () => {
    storeAuthSession(user, token(Date.now() - 1000), true)
    const next = token()
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/refresh') return json({ user, sessionToken: next })
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${next}`)
      return json({ ok: true })
    })
    vi.stubGlobal('fetch', mock)
    const [a, b] = await Promise.all([fetchWithSession('/api/sync'), fetchWithSession('/api/users')])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(mock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1)
    expect(mock.mock.calls.every(([, init]) => init?.credentials === 'same-origin')).toBe(true)
    expect(readStoredSession().token).toBe(next)
  })

  it('ne rejoue qu’une fois une requête en 401 après rotation réussie', async () => {
    storeAuthSession(user, token(), false)
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/auth/refresh') return json({ user, sessionToken: token() })
      return json({}, ++calls === 1 ? 401 : 200)
    }))
    expect((await fetchWithSession('/api/sync', { method: 'POST', body: '{}' })).status).toBe(200)
    expect(calls).toBe(2)
  })

  it('garde la session en panne réseau mais retire l’accès Cloud en cas de refus serveur', async () => {
    const previous = token(Date.now() - 1000)
    storeAuthSession(user, previous, true)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await refreshAccessSession()).toBe(false)
    expect(readStoredSession().token).toBe(previous)
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'SESSION_REVOKED' }, 401)))
    expect(await refreshAccessSession()).toBe(false)
    expect(readStoredSession().token).toBeNull()
    expect(readStoredSession().user?.id).toBe(user.id)
  })

  it('ne ressuscite pas une connexion après déconnexion pendant un renouvellement', async () => {
    storeAuthSession(user, token(), true)
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>((done) => { resolve = done })
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/auth/refresh' ? pending : Promise.resolve(json({ revoked: true }))))
    const refresh = refreshAccessSession()
    await logoutServerSession()
    resolve(json({ user, sessionToken: token() }))
    expect(await refresh).toBe(false)
    expect(readStoredSession()).toMatchObject({ user: null, token: null })
  })

  it('ne remplace pas une identité par celle d’un cookie d’un autre compte et ne transmet pas les accès à une autre origine', async () => {
    const previous = token()
    storeAuthSession(user, previous, true)
    const mock = vi.fn(async () => json({ user: { ...user, id: 'other-user' }, sessionToken: token() }))
    vi.stubGlobal('fetch', mock)
    expect(await refreshAccessSession()).toBe(false)
    expect(readStoredSession().token).toBe(previous)
    await expect(fetchWithSession('https://other.example.invalid/api')).rejects.toThrow('même origine')
    expect(mock).toHaveBeenCalledTimes(1)
    expect(await currentAccessToken()).toBe(previous)
  })
})
