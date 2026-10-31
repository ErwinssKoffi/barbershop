import type { SalonBackupPayload } from './models'
export const CLOUD_LOCAL_TABLES = ['salon', 'settings', 'categories', 'services', 'employees', 'revenues', 'expenses', 'recurringExpenses', 'cashSessions', 'cashMovements', 'advances', 'bonuses', 'salaryPayments', 'products', 'stockMovements', 'budgets', 'correctionLogs'] as const
export type CloudTable = typeof CLOUD_LOCAL_TABLES[number]
export interface CloudDeltaPage {
 cursor: number; hasMore: boolean
 payload?: Partial<SalonBackupPayload> | null
 changes?: Partial<Record<CloudTable, unknown[]>>
 deleted?: { table: CloudTable; id: string }[]
 tombstones?: { entityType: string; entityId: string; deletedAt: string }[]
 rejected?: { table: CloudTable; id: string; code: string }[]
}
export function stableCloudValue(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(stableCloudValue).join(',')}]`
 if (value && typeof value === 'object') return `{${Object.entries(value).filter(([key]) => !['updatedAt', 'dataHygieneVersion', 'mockPurgeCompletedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableCloudValue(item)}`).join(',')}}`
 return JSON.stringify(value)
}
export function cloudRows(payload: Partial<SalonBackupPayload>, key: CloudTable): Record<string, unknown>[] {
 const value = payload[key]
 return (Array.isArray(value) ? value : value ? [value] : []) as unknown as Record<string, unknown>[]
}
