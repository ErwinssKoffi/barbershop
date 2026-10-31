import { workspaceKey } from '../db/accountWorkspace'
import { useAuth } from './authContext'
import type { SalonBackupPayload } from '../domain/models'
import type { CloudDeltaPage } from '../domain/cloudDelta'
import { accessClaims, currentAccessToken, fetchWithSession } from '../lib/sessionClient'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { LocalSyncTombstone } from '../db/repositories/salonRepositories'
import { useSalonStore } from '../hooks/salonStoreContext'
import { useToast } from '../hooks/toastContext'
import { CloudSyncContext, type CloudSyncStatus } from './cloudSyncContext'

const PREFS_KEY = 'salon_pro_cloud_sync_prefs'

interface StoredSyncPrefs {
  enabled: boolean
  autoSync: boolean
  lastSyncedAt: string | null
  remoteRecordsCount: number | null
}

function purgeLegacyPinStorage(): void {
  try {
    window.sessionStorage.removeItem('salon_pro_cloud_pin_session')
    window.localStorage.removeItem('salon_pro_cloud_pin_saved')
  } catch {
    // ignore
  }
}

function readStoredPrefs(key: string): StoredSyncPrefs {
  purgeLegacyPinStorage()
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      return {
        enabled: false,
        autoSync: true,
        lastSyncedAt: null,
        remoteRecordsCount: null,
      }
    }
    const parsed = JSON.parse(raw) as Partial<StoredSyncPrefs>
    return {
      enabled: Boolean(parsed.enabled),
      autoSync: parsed.autoSync !== false,
      lastSyncedAt: parsed.lastSyncedAt ?? null,
      remoteRecordsCount:
        typeof parsed.remoteRecordsCount === 'number'
          ? parsed.remoteRecordsCount
          : null,
    }
  } catch {
    return {
      enabled: false,
      autoSync: true,
      lastSyncedAt: null,
      remoteRecordsCount: null,
    }
  }
}

function writeStoredPrefs(prefs: StoredSyncPrefs, key: string): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(prefs))
  } catch {
    // ignore storage quota errors
  }
}

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { mutationCount, syncWithRepo } = useSalonStore()
  const { currentUser, sessionToken } = useAuth()
  const prefsKey = `${PREFS_KEY}:${currentUser ? encodeURIComponent(workspaceKey(currentUser)) : 'signed-out'}`
  const toast = useToast()
  const bootstrapStarted = useRef(false)

  const [prefs, setPrefs] = useState<StoredSyncPrefs>(() => readStoredPrefs(prefsKey))
  const [status, setStatus] = useState<CloudSyncStatus>(() =>
    readStoredPrefs(prefsKey).enabled ? 'idle' : 'disabled',
  )
  const [lastError, setLastError] = useState<string | null>(null)
  const [databaseConfiguredOnServer, setDatabaseConfiguredOnServer] = useState<
    boolean | null
  >(null)

  const syncInFlightRef = useRef(false)

  const checkServerHealth = useCallback(async () => {
    purgeLegacyPinStorage()
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
      return
    }
    try {
      const resp = await window.fetch('/api/health', { method: 'GET' })
      if (!resp.ok) return
      const json = (await resp.json()) as {
        databaseConfigured?: boolean
      }
      setDatabaseConfiguredOnServer(Boolean(json.databaseConfigured))
    } catch {
      // Hors-ligne ou mode test jsdom sans serveur HTTP
    }
  }, [])

  const runBidirectionalSync = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      if (syncInFlightRef.current) return false
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setStatus('offline')
        setLastError(
          'Appareil hors-ligne : vos opérations sont sécurisées dans IndexedDB et seront synchronisées dès le retour d’Internet.',
        )
        return false
      }

      syncInFlightRef.current = true
      setStatus('syncing')
      setLastError(null)

      try {
        const savedSessionToken = await currentAccessToken()
        const tokenTenant = accessClaims(savedSessionToken)?.tid
        let conflictCount = 0
        const drain = async (sent?: Partial<SalonBackupPayload>) => {
          let cursor = await syncWithRepo((repo) => repo.cloudSyncCursor())
          if (cursor === undefined) return
          for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
            const response = await fetchWithSession(`/api/sync/pull?since=${cursor}&limit=500`)
            const page = await response.json() as CloudDeltaPage & { message?: string }
            if (!response.ok) throw new Error(page.message ?? 'Lecture Cloud refusée.')
            const merged = await syncWithRepo((repo) => repo.mergeCloudDelta(page, sent))
            conflictCount += merged.conflicts
            cursor = page.cursor
            if (!page.hasMore) return
          }
          throw new Error('Synchronisation volumineuse : relancez pour continuer la pagination.')
        }
        await syncWithRepo((repo) => repo.assertCloudWorkspace(tokenTenant))
        await drain()
        const envelope = await syncWithRepo(async (repo) => {
          await repo.assertCloudWorkspace(tokenTenant)
          return repo.buildCloudDeltaEnvelope()
        })

        const resp = await fetchWithSession('/api/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(savedSessionToken
              ? { Authorization: `Bearer ${savedSessionToken}` }
              : {}),
          },
          body: JSON.stringify(envelope),
        })

        const data = (await resp.json().catch(() => ({}))) as CloudDeltaPage & {
          ok?: boolean
          code?: string
          message?: string
          syncedAt?: string
          stats?: { totalRemoteRecords?: number }
          tombstones?: LocalSyncTombstone[]
        }

        if (!resp.ok || !data.ok) {
          if (resp.status === 401) {
            setStatus('unauthorized')
            const msg =
              data.message ??
              'Session utilisateur requise pour synchroniser avec Neon PostgreSQL.'
            setLastError(msg)
            if (!options?.silent) toast.error(msg)
            return false
          }

          if (resp.status === 503 && data.code === 'NETWORK_UNREACHABLE') {
            setStatus('offline')
            const msg =
              data.message ??
              'Base Neon momentanément injoignable : continuité locale active.'
            setLastError(msg)
            if (!options?.silent) toast.warning(msg)
            return false
          }

          setStatus('error')
          const msg =
            data.message ?? 'Échec de la synchronisation Cloud Neon PostgreSQL.'
          setLastError(msg)
          if (!options?.silent) toast.error(msg)
          return false
        }

        const merged = await syncWithRepo((repo) => repo.mergeCloudDelta(data, envelope.payload, envelope.tombstones))
        conflictCount += merged.conflicts
        if (data.hasMore) await drain(envelope.payload)
        if (conflictCount) {
          const message = `${conflictCount} conflit(s) ou écriture(s) refusée(s). Les versions locales sont conservées dans le journal de conflits, téléchargeable dans les paramètres Cloud.`
          setStatus('error'); setLastError(message)
          if (!options?.silent) toast.warning(message)
          return false
        }

        const syncedAt = data.syncedAt ?? new Date().toISOString()
        const remoteRecordsCount =
          typeof data.stats?.totalRemoteRecords === 'number'
            ? data.stats.totalRemoteRecords
            : null

        setPrefs((prev) => {
          const next: StoredSyncPrefs = {
            ...prev,
            enabled: true,
            lastSyncedAt: syncedAt,
            remoteRecordsCount,
          }
          writeStoredPrefs(next, prefsKey)
          return next
        })
        setStatus('synced')
        setDatabaseConfiguredOnServer(true)

        if (!options?.silent) {
          toast.success('Synchronisation Neon PostgreSQL réussie.')
        }
        return true
      } catch (error) {
        setStatus(navigator.onLine === false ? 'offline' : 'error')
        const msg = error instanceof Error ? error.message : 'Connexion réseau indisponible : vos données restent protégées localement (IndexedDB).'
        setLastError(msg)
        if (!options?.silent) toast.warning(msg)
        return false
      } finally {
        syncInFlightRef.current = false
      }
    },
    [syncWithRepo, toast, prefsKey],
  )

  const syncNow = useCallback(
    async (options?: { silent?: boolean }) => {
      return runBidirectionalSync(options)
    },
    [runBidirectionalSync],
  )

  const configureAndConnect = useCallback(
    async (params: {
      autoSync: boolean
    }): Promise<{ ok: boolean; message: string }> => {
      purgeLegacyPinStorage()
      const nextPrefs: StoredSyncPrefs = {
        ...prefs,
        enabled: true,
        autoSync: params.autoSync,
      }
      setPrefs(nextPrefs)
      writeStoredPrefs(nextPrefs, prefsKey)

      const ok = await runBidirectionalSync({ silent: true })
      if (ok) {
        return {
          ok: true,
          message:
            'Mode Hybride activé et synchronisé avec votre base Neon PostgreSQL.',
        }
      }
      return {
        ok: false,
        message:
          'Mode Hybride configuré localement (la synchronisation reprendra dès que Neon PostgreSQL sera joignable).',
      }
    },
    [prefs, runBidirectionalSync, prefsKey],
  )

  const setAutoSync = useCallback((enabled: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev, autoSync: enabled }
      writeStoredPrefs(next, prefsKey)
      return next
    })
  }, [prefsKey])

  const disconnectCloudSync = useCallback(() => {
    purgeLegacyPinStorage()
    setLastError(null)
    setStatus('disabled')
    setPrefs((prev) => {
      const next: StoredSyncPrefs = { ...prev, enabled: false }
      writeStoredPrefs(next, prefsKey)
      return next
    })
  }, [prefsKey])

  useEffect(() => {
    if (bootstrapStarted.current || !currentUser?.tenantId || !sessionToken) return
    const timer = window.setTimeout(() => { bootstrapStarted.current = true; void runBidirectionalSync({ silent: true }) }, 0)
    return () => window.clearTimeout(timer)
  }, [currentUser?.tenantId, sessionToken, runBidirectionalSync])

  useEffect(() => {
    if (!prefs.enabled || !prefs.autoSync) return
    const timer = window.setTimeout(() => void runBidirectionalSync({ silent: true }), 0)
    return () => window.clearTimeout(timer)
  }, [prefs.enabled, prefs.autoSync, runBidirectionalSync])

  useEffect(() => {
    if (!prefs.enabled || !prefs.autoSync || mutationCount === 0) return
    const timer = window.setTimeout(() => {
      void runBidirectionalSync({ silent: true })
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [mutationCount, prefs.enabled, prefs.autoSync, runBidirectionalSync])

  useEffect(() => {
    if (!prefs.enabled) return
    const handleOnline = () => {
      void runBidirectionalSync({ silent: true })
    }
    const handleOffline = () => {
      setStatus('offline')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [prefs.enabled, runBidirectionalSync])

  const value = useMemo(
    () => ({
      syncEnabled: prefs.enabled,
      autoSync: prefs.autoSync,
      status,
      lastSyncedAt: prefs.lastSyncedAt,
      remoteRecordsCount: prefs.remoteRecordsCount,
      lastError,
      databaseConfiguredOnServer,
      checkServerHealth,
      configureAndConnect,
      syncNow,
      setAutoSync,
      disconnectCloudSync,
    }),
    [
      prefs.enabled,
      prefs.autoSync,
      prefs.lastSyncedAt,
      prefs.remoteRecordsCount,
      status,
      lastError,
      databaseConfiguredOnServer,
      checkServerHealth,
      configureAndConnect,
      syncNow,
      setAutoSync,
      disconnectCloudSync,
    ],
  )

  return (
    <CloudSyncContext.Provider value={value}>
      {children}
    </CloudSyncContext.Provider>
  )
}
