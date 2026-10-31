import { workspaceKey } from '../db/accountWorkspace'
import { AUTH_USER_LOCAL_KEY, AUTH_USER_SESSION_KEY, AUTH_TOKEN_LOCAL_KEY, AUTH_TOKEN_SESSION_KEY, SESSION_UPDATED_EVENT, readStoredSession, storeAuthSession, logoutServerSession, currentAccessToken, fetchWithSession } from '../lib/sessionClient'
export { AUTH_USER_LOCAL_KEY, AUTH_USER_SESSION_KEY, AUTH_TOKEN_LOCAL_KEY, AUTH_TOKEN_SESSION_KEY }
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react'
import type { PublicSalonUser, SalonUserAccount } from '../domain/models'
import { useSalonStore } from '../hooks/salonStoreContext'
import {
  AuthContext,
  type AuthMode,
  type LoginAccountParams,
  type RegisterAccountParams,
} from './authContext'

function purgeLegacyStoredPins(): void {
  try {
    window.sessionStorage.removeItem('salon_pro_cloud_pin_session')
    window.localStorage.removeItem('salon_pro_cloud_pin_saved')
  } catch {
    // ignore storage errors
  }
}

function readPersistedAuth() {
  purgeLegacyStoredPins()
  return readStoredSession()
}
function persistAuthSession(user: PublicSalonUser, token: string | null, rememberMe: boolean): void {
  purgeLegacyStoredPins()
  storeAuthSession(user, token, rememberMe)
}

class ServerBusinessAuthError extends Error {}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const store = useSalonStore()
  const mutate = store.identityWithRepo ?? store.mutate
  const syncWithRepo = store.identityWithRepo ?? store.syncWithRepo
  const activateWorkspace = store.activateWorkspace
  const [readyScope, setReadyScope] = useState<string | null>(null)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const [currentUser, setCurrentUser] = useState<PublicSalonUser | null>(
    () => readPersistedAuth().user,
  )
  const [localAccounts, setLocalAccounts] = useState<PublicSalonUser[]>([])
  const [sessionToken, setSessionToken] = useState<string | null>(
    () => readPersistedAuth().token,
  )
  const [authReady, setAuthReady] = useState(false)
  const [hasAnyManager, setHasAnyManager] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('checking')

  const scope = currentUser ? workspaceKey(currentUser) : 'signed-out'
  const workspaceUser = useRef(currentUser)
  useEffect(() => { workspaceUser.current = currentUser }, [currentUser])
  useEffect(() => {
    let cancelled = false
    void (activateWorkspace?.(workspaceUser.current) ?? Promise.resolve()).then(() => {
      if (!cancelled) { setWorkspaceError(null); setReadyScope(scope) }
    }).catch(() => { if (!cancelled) setWorkspaceError('Impossible d’ouvrir cet espace local. Aucune donnée n’a été supprimée. Rechargez l’application.') })
    return () => { cancelled = true }
  }, [scope, activateWorkspace])

  const refreshAuthStatus = useCallback(async () => {
    purgeLegacyStoredPins()
    const { hasMgr: localHasManager, accounts } = await syncWithRepo(
      async (repo) => {
        const [hasMgr, allUsers] = await Promise.all([
          repo.hasAnyManagerAccount(),
          repo.listUserAccounts(),
        ])
        if (hasMgr || currentUser) {
          await repo.purgeLegacyMockData()
        }
        return {
          hasMgr,
          accounts: allUsers.filter((u) => u.isActive),
        }
      },
    )
    if (!mounted.current) return
    setLocalAccounts(accounts)

    let remoteHasManager = false
    let cloudReachable = false

    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
      try {
        const resp = await window.fetch('/api/auth/status', { method: 'GET' })
        if (resp.ok) {
          const data = (await resp.json()) as {
            ok?: boolean
            hasManager?: boolean
          }
          if (data.ok) {
            cloudReachable = true
            remoteHasManager = Boolean(data.hasManager)
          }
        }
      } catch {
        // Hors-ligne ou environnement de test sans serveur HTTP
      }
    }

    if (!mounted.current) return
    setHasAnyManager(localHasManager || remoteHasManager)
    setAuthMode(cloudReachable ? 'cloud_neon' : 'local_offline')
    setAuthReady(true)
  }, [currentUser, syncWithRepo])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await refreshAuthStatus()
      if (cancelled) return
    })()
    return () => {
      cancelled = true
    }
  }, [refreshAuthStatus])

  const register = useCallback(
    async (params: RegisterAccountParams): Promise<PublicSalonUser> => {
      const rememberMe = params.rememberMe !== false

      // 1. Tentative sur Neon PostgreSQL via /api/auth/register
      if (
        typeof window !== 'undefined' &&
        typeof window.fetch === 'function' &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        try {
          const resp = await fetchWithSession('/api/auth/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(sessionToken
                ? { Authorization: `Bearer ${sessionToken}` }
                : {}),
            },
            body: JSON.stringify({
              fullName: params.fullName,
              email: params.email,
              phone: params.phone,
              password: params.password,
              role: params.role,
              salonName: params.salonName,
              rememberMe,
            }),
          })

          const data = (await resp.json().catch(() => ({}))) as {
            ok?: boolean
            code?: string
            message?: string
            user?: PublicSalonUser
            recordForCache?: SalonUserAccount
            sessionToken?: string
          }

          if (resp.ok && data.ok && data.user) {
            const refreshedAccounts = await mutate(async (repo) => {
              if (data.recordForCache) {
                await repo.cacheRemoteUserAccount(data.recordForCache)
              }
              if (!hasAnyManager && params.role === 'manager') {
                await repo.updateSalonInfo({
                  ...(params.salonName?.trim()
                    ? { name: params.salonName.trim() }
                    : {}),
                  managerName: params.fullName.trim(),
                  ...(params.phone?.trim()
                    ? { phone: params.phone.trim() }
                    : {}),
                })
              }
              await repo.purgeLegacyMockData()
              return (await repo.listUserAccounts()).filter((u) => u.isActive)
            })
            const nextToken = data.sessionToken ?? null
            setLocalAccounts(refreshedAccounts)
            setCurrentUser(data.user)
            setSessionToken(nextToken)
            setHasAnyManager(true)
            setAuthMode('cloud_neon')
            persistAuthSession(data.user, nextToken, rememberMe)
            return data.user
          }

          if (
            resp.status !== 503 &&
            resp.status !== 502 &&
            resp.status !== 404 &&
            data.code !== 'NETWORK_UNREACHABLE' &&
            data.code !== 'DB_NOT_CONFIGURED'
          ) {
            throw new ServerBusinessAuthError(
              data.message ?? 'Inscription refusée par le serveur.',
            )
          }
        } catch (err) {
          if (err instanceof ServerBusinessAuthError || (err instanceof Error && err.name === 'WorkspaceTenantMismatchError')) {
            throw err
          }
        }
      }

      // 2. Continuité locale Hors-Ligne (IndexedDB)
      const { created: localUser, accounts: updatedLocalAccounts } =
        await mutate(async (repo) => {
          const created = await repo.registerLocalUserAccount({
            fullName: params.fullName,
            email: params.email,
            phone: params.phone,
            password: params.password,
            role: params.role,
            salonName: params.salonName,
            callerIsAuthenticatedManager: currentUser?.role === 'manager',
          })
          await repo.purgeLegacyMockData()
          const accounts = (await repo.listUserAccounts()).filter(
            (u) => u.isActive,
          )
          return { created, accounts }
        })

      setLocalAccounts(updatedLocalAccounts)
      setCurrentUser(localUser)
      setSessionToken(null)
      setHasAnyManager(true)
      setAuthMode('local_offline')
      persistAuthSession(localUser, null, rememberMe)
      return localUser
    },
    [currentUser?.role, hasAnyManager, mutate, sessionToken],
  )

  const login = useCallback(
    async (params: LoginAccountParams): Promise<PublicSalonUser> => {
      const rememberMe = params.rememberMe !== false

      // 1. Tentative sur Neon PostgreSQL via /api/auth/login
      if (
        typeof window !== 'undefined' &&
        typeof window.fetch === 'function' &&
        (typeof navigator === 'undefined' || navigator.onLine !== false)
      ) {
        try {
          const resp = await window.fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: params.email,
              password: params.password,
              rememberMe,
            }),
          })

          const data = (await resp.json().catch(() => ({}))) as {
            ok?: boolean
            code?: string
            message?: string
            user?: PublicSalonUser
            recordForCache?: SalonUserAccount
            sessionToken?: string
          }

          if (resp.ok && data.ok && data.user) {
            const refreshedAccounts = await syncWithRepo(async (repo) => {
              if (data.recordForCache) {
                await repo.cacheRemoteUserAccount(data.recordForCache)
              }
              await repo.purgeLegacyMockData()
              return (await repo.listUserAccounts()).filter((u) => u.isActive)
            })
            const nextToken = data.sessionToken ?? null
            setLocalAccounts(refreshedAccounts)
            setCurrentUser(data.user)
            setSessionToken(nextToken)
            setAuthMode('cloud_neon')
            persistAuthSession(data.user, nextToken, rememberMe)
            return data.user
          }

          if (![503, 502, 404].includes(resp.status) && data.code !== 'NETWORK_UNREACHABLE' && data.code !== 'DB_NOT_CONFIGURED') {
            throw new ServerBusinessAuthError(data.message ?? 'Connexion refusée par le serveur.')
          }

        } catch (err) {
          if (err instanceof ServerBusinessAuthError || (err instanceof Error && err.name === 'WorkspaceTenantMismatchError')) {
            throw err
          }
        }
      }

      // 2. Continuité locale Hors-Ligne (IndexedDB)
      const { authed: localUser, accounts: nextLocalAccounts } =
        await syncWithRepo(async (repo) => {
          const authed = await repo.authenticateLocalUserAccount({
            email: params.email,
            password: params.password,
          })
          await repo.purgeLegacyMockData()
          const accounts = (await repo.listUserAccounts()).filter(
            (u) => u.isActive,
          )
          return { authed, accounts }
        })
      setLocalAccounts(nextLocalAccounts)
      setCurrentUser(localUser)
      setSessionToken(null)
      setAuthMode('local_offline')
      persistAuthSession(localUser, null, rememberMe)
      return localUser
    },
    [syncWithRepo],
  )

  const logout = useCallback(() => {
    setReadyScope(null)
    void activateWorkspace?.(null)
    void logoutServerSession()
    setCurrentUser(null)
    setSessionToken(null)
  }, [activateWorkspace])

  useEffect(() => {
    const update = () => {
      if (!mounted.current) return
      const stored = readStoredSession()
      setSessionToken(stored.token)
      setCurrentUser(stored.user)
    }
    const renew = () => { if (document.visibilityState !== 'hidden') void currentAccessToken() }
    window.addEventListener(SESSION_UPDATED_EVENT, update)
    window.addEventListener('storage', update)
    window.addEventListener('focus', renew)
    document.addEventListener('visibilitychange', renew)
    const timer = window.setInterval(renew, 30_000)
    renew()
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(SESSION_UPDATED_EVENT, update)
      window.removeEventListener('storage', update)
      window.removeEventListener('focus', renew)
      document.removeEventListener('visibilitychange', renew)
    }
  }, [])

  const value = useMemo(
    () => ({
      authEnforced: true,
      authReady: authReady && readyScope === scope,
      hasAnyManager,
      authMode,
      currentUser,
      localAccounts,
      sessionToken,
      refreshAuthStatus,
      login,
      register,
      logout,
    }),
    [
      authReady,
      readyScope,
      scope,
      hasAnyManager,
      authMode,
      currentUser,
      localAccounts,
      sessionToken,
      refreshAuthStatus,
      login,
      register,
      logout,
    ],
  )

  if (workspaceError) return <p role="alert">{workspaceError}</p>
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
