import type { UserRole, SalonBackupPayload } from '../src/domain/models/index.ts'
import { SYNC_TABLES, type SyncKey } from './syncSchema.ts'
export interface SyncRejection { table: SyncKey; id: string; code: string }
export const CASHIER_SYNC_KEYS: readonly SyncKey[] = ['revenues', 'expenses', 'cashSessions', 'cashMovements', 'stockMovements']
export const CASHIER_READ_KEYS: readonly SyncKey[] = ['salon', 'categories', 'services', 'products', 'employees', 'settings', ...CASHIER_SYNC_KEYS]
export function canReadSync(key: SyncKey, role?: UserRole): boolean { return role !== 'cashier' || CASHIER_READ_KEYS.includes(key) }
export function canWriteSync(key: SyncKey, role?: UserRole): boolean { return role !== 'cashier' || CASHIER_SYNC_KEYS.includes(key) }
const EMPLOYEE_PUBLIC = ['id', 'firstName', 'lastName', 'fullName', 'roleTitle', 'isActive', 'createdAt', 'updatedAt']
const SETTINGS_PUBLIC = ['id', 'theme', 'dateFormat', 'printHeaderNote', 'printCompact', 'receiptFormat', 'receiptFooterNote', 'serviceConfigMode', 'updatedAt']
export function projectSyncRecord(key: SyncKey, record: unknown, role?: UserRole): unknown {
 if (role !== 'cashier' || (key !== 'employees' && key !== 'settings') || !record || typeof record !== 'object') return record
 const allowed = key === 'employees' ? EMPLOYEE_PUBLIC : SETTINGS_PUBLIC
 return Object.fromEntries(Object.entries(record).filter(([field]) => allowed.includes(field)))
}
export function filterSyncPayload(payload: SalonBackupPayload | null, role?: UserRole): Partial<SalonBackupPayload> | null {
 if (!payload || role !== 'cashier') return payload
 return Object.fromEntries(Object.entries(payload).filter(([key]) => key === 'format' || key === 'exportedAt' || (key in SYNC_TABLES && canReadSync(key as SyncKey, role))).map(([key, value]) => [key, Array.isArray(value) ? value.map((row) => projectSyncRecord(key as SyncKey, row, role)) : projectSyncRecord(key as SyncKey, value, role)]))
}

const TOMBSTONE_KEYS: Record<string, SyncKey> = { service: 'services', employee: 'employees', revenue: 'revenues', expense: 'expenses', recurring_expense: 'recurringExpenses', cash_session: 'cashSessions', cash_movement: 'cashMovements', advance: 'advances', bonus: 'bonuses', salary_payment: 'salaryPayments', product: 'products', stock_movement: 'stockMovements', budget: 'budgets', correction_log: 'correctionLogs' }
export function filterSyncTombstones<T extends { entityType: string }>(items: T[], role?: UserRole): T[] {
 return items.filter((item) => TOMBSTONE_KEYS[item.entityType] && canReadSync(TOMBSTONE_KEYS[item.entityType], role))
}
