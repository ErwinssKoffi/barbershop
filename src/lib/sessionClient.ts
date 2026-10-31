import type { PublicSalonUser } from '../domain/models'

export const AUTH_USER_LOCAL_KEY = 'salon_pro_auth_user_local'
export const AUTH_USER_SESSION_KEY = 'salon_pro_auth_user_session'
export const AUTH_TOKEN_LOCAL_KEY = 'salon_pro_auth_token_local'
export const AUTH_TOKEN_SESSION_KEY = 'salon_pro_auth_token_session'
export const SESSION_UPDATED_EVENT = 'salon-pro-session-updated'
let generation = 0
let refreshFlight: Promise<boolean> | null = null

export function readStoredSession(): { user: PublicSalonUser | null; token: string | null; rememberMe: boolean } {
  try {
    const local = window.localStorage.getItem(AUTH_USER_LOCAL_KEY)
    const source = local ? window.localStorage : window.sessionStorage
    const user = JSON.parse(source.getItem(local ? AUTH_USER_LOCAL_KEY : AUTH_USER_SESSION_KEY) ?? 'null') as PublicSalonUser | null
    const token = source.getItem(local ? AUTH_TOKEN_LOCAL_KEY : AUTH_TOKEN_SESSION_KEY)
    return { user: user?.id && user?.email ? user : null, token, rememberMe: Boolean(local) }
  } catch { return { user: null, token: null, rememberMe: false } }
}

function notify(): void { window.dispatchEvent(new Event(SESSION_UPDATED_EVENT)) }
export function storeAuthSession(user: PublicSalonUser | null, token: string | null, rememberMe: boolean): void {
  generation++
  try {
    for (const [storage, userKey, tokenKey] of [
      [window.localStorage, AUTH_USER_LOCAL_KEY, AUTH_TOKEN_LOCAL_KEY],
      [window.sessionStorage, AUTH_USER_SESSION_KEY, AUTH_TOKEN_SESSION_KEY],
    ] as const) { storage.removeItem(userKey); storage.removeItem(tokenKey) }
    if (user) {
      const storage = rememberMe ? window.localStorage : window.sessionStorage
      storage.setItem(rememberMe ? AUTH_USER_LOCAL_KEY : AUTH_USER_SESSION_KEY, JSON.stringify(user))
      if (token) storage.setItem(rememberMe ? AUTH_TOKEN_LOCAL_KEY : AUTH_TOKEN_SESSION_KEY, token)
    }
  } catch { /* Stockage refusé : aucune persistance des secrets de renouvellement dans JS. */ }
  notify()
}

export function accessClaims(token: string | null): { tid?: string; exp?: number; sid?: string } | null {
  if (!token) return null
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) } catch { return null }
}

export async function refreshAccessSession(): Promise<boolean> {
  if (refreshFlight) return refreshFlight
  const starting = readStoredSession()
  if (!starting.token || !starting.user) return false
  const startedAtGeneration = generation
  const rotate = async () => {
    const latest = readStoredSession()
    if (generation !== startedAtGeneration) return false
    // Un autre onglet a déjà consommé le cookie sous le même verrou Web Locks.
    if (latest.token !== starting.token && (accessClaims(latest.token)?.exp ?? 0) > Date.now() + 30_000) return true
    try {
      const response = await window.fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      const data = await response.json() as { user?: PublicSalonUser; sessionToken?: string }
      if (generation !== startedAtGeneration) return false
      if (response.ok && data.user && data.sessionToken && data.user.id === latest.user?.id && data.user.tenantId === latest.user?.tenantId) {
        storeAuthSession(data.user, data.sessionToken, latest.rememberMe)
        return true
      }
      // Une panne/429 ne détruit pas la session récupérable ; un refus d'auth doit retirer l'accès Cloud.
      if (response.status === 401 || response.status === 403) storeAuthSession(latest.user, null, latest.rememberMe)
    } catch { /* Continuité locale, réessai au prochain accès réseau. */ }
    return false
  }
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  refreshFlight = (locks ? locks.request('salon-pro-refresh', rotate) : rotate()).finally(() => { refreshFlight = null })
  return refreshFlight
}

export async function currentAccessToken(): Promise<string | null> {
  const token = readStoredSession().token
  const claims = accessClaims(token)
  if (token && (!claims?.sid || (claims.exp ?? 0) <= Date.now() + 60_000)) await refreshAccessSession()
  return readStoredSession().token
}

/** Pour des appels JSON rejouables. Un seul renouvellement puis un seul rejeu sur 401. */
export async function fetchWithSession(url: string, init: RequestInit = {}): Promise<Response> {
  if (!url.startsWith('/api/')) throw new Error('Les appels authentifiés doivent rester sur la même origine /api/.')
  const token = await currentAccessToken()
  const send = (access: string | null) => {
    const headers = new Headers(init.headers)
    headers.delete('Authorization')
    if (access) headers.set('Authorization', `Bearer ${access}`)
    return window.fetch(url, { ...init, credentials: 'same-origin', headers })
  }
  const response = await send(token)
  if (response.status === 401 && token && await refreshAccessSession()) return send(readStoredSession().token)
  return response
}

export async function logoutServerSession(): Promise<void> {
  const token = readStoredSession().token
  storeAuthSession(null, null, false)
  try {
    await window.fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch { /* Hors-ligne : révocation serveur impossible, aucune session locale ne subsiste. */ }
}
