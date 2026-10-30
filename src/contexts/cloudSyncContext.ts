import { createContext, useContext } from 'react'

export type CloudSyncStatus =
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'unauthorized'
  | 'error'

export interface CloudSyncContextValue {
  syncEnabled: boolean
  autoSync: boolean
  status: CloudSyncStatus
  lastSyncedAt: string | null
  remoteRecordsCount: number | null
  lastError: string | null
  databaseConfiguredOnServer: boolean | null
  checkServerHealth: () => Promise<void>
  configureAndConnect: (params: {
    autoSync: boolean
  }) => Promise<{ ok: boolean; message: string }>
  syncNow: (options?: { silent?: boolean }) => Promise<boolean>
  setAutoSync: (enabled: boolean) => void
  disconnectCloudSync: () => void
}

const FALLBACK_CLOUD_SYNC: CloudSyncContextValue = {
  syncEnabled: false,
  autoSync: true,
  status: 'disabled',
  lastSyncedAt: null,
  remoteRecordsCount: null,
  lastError: null,
  databaseConfiguredOnServer: null,
  checkServerHealth: async () => {},
  configureAndConnect: async () => ({ ok: false, message: 'Non initialisé' }),
  syncNow: async () => false,
  setAutoSync: () => {},
  disconnectCloudSync: () => {},
}

export const CloudSyncContext = createContext<CloudSyncContextValue | null>(
  null,
)

export function useCloudSync(): CloudSyncContextValue {
  return useContext(CloudSyncContext) ?? FALLBACK_CLOUD_SYNC
}
