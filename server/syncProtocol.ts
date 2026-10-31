import { AuthApiError } from './authEngine.ts'
import type { SqlQueryable } from './neonClient.ts'
import type { SalonBackupPayload, UserRole } from '../src/domain/models/index.ts'
import type { CloudSyncEnvelope, SyncTombstone } from './syncEngine.ts'
import { SYNC_TABLES, type SyncKey } from './syncSchema.ts'
import { projectSyncRecord, canReadSync, canWriteSync, type SyncRejection } from './syncPolicy.ts'

export function parseSyncCursor(value: unknown): number | undefined {
 if (value === undefined || value === null) return undefined
 if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new AuthApiError(400, 'INVALID_CURSOR', 'Curseur de synchronisation invalide.')
 return value
}
export async function lockSyncState(db: SqlQueryable): Promise<number> {
 await db.query("INSERT INTO sync_state (tenant_id) VALUES (NULLIF(current_setting('app.tenant_id', true), '')::uuid) ON CONFLICT DO NOTHING")
 const result = await db.query<{ revision: string | number }>('SELECT revision FROM sync_state FOR UPDATE')
 return Number(result.rows[0].revision)
}
function canonical(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
 if (value && typeof value === 'object') return `{${Object.entries(value).filter(([key]) => key !== 'updatedAt').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
 return JSON.stringify(value)
}
const immutable: readonly SyncKey[] = ['stockMovements', 'bonuses', 'correctionLogs']
const entityKeys: Record<string, SyncKey> = { service: 'services', employee: 'employees', revenue: 'revenues', expense: 'expenses', recurring_expense: 'recurringExpenses', cash_session: 'cashSessions', cash_movement: 'cashMovements', advance: 'advances', bonus: 'bonuses', salary_payment: 'salaryPayments', product: 'products', stock_movement: 'stockMovements', budget: 'budgets', correction_log: 'correctionLogs' }

export async function prepareSync(db: SqlQueryable, incoming: CloudSyncEnvelope, role: UserRole | undefined, now: string): Promise<{ payload: SalonBackupPayload; tombstones: SyncTombstone[]; rejected: SyncRejection[] }> {
 const cursor = parseSyncCursor(incoming.cursor)
 const rejected: SyncRejection[] = []
 const payload: Record<string, unknown> = { format: 'SALON_PRO_BACKUP_V1', exportedAt: now }
 const tombstoneRows = await db.query<{ entity_type: string; entity_id: string }>('SELECT entity_type, entity_id FROM sync_tombstones')
 const deleted = new Set(tombstoneRows.rows.map((r) => `${entityKeys[r.entity_type]}:${r.entity_id}`))
 for (const [key, table] of Object.entries(SYNC_TABLES) as [SyncKey, string][]) {
  const source = incoming.payload[key]
  const singleton = key === 'salon' || key === 'settings'
  const rows = singleton ? (source ? [source] : []) : source ?? []
  if (!Array.isArray(rows)) throw new AuthApiError(400, 'INVALID_PAYLOAD', 'Table de synchronisation invalide.')
  const accepted: Record<string, unknown>[] = []
  for (const raw of rows) {
   if (!raw || typeof raw !== 'object' || !('id' in raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 200) throw new AuthApiError(400, 'INVALID_PAYLOAD', 'Enregistrement de synchronisation invalide.')
   const row = raw as unknown as Record<string, unknown> & { id: string }
   if (!canWriteSync(key, role)) { rejected.push({ table: key, id: row.id, code: 'WRITE_FORBIDDEN_FOR_ROLE' }); continue }
   const existing = await db.query<{ payload_json: unknown }>(`SELECT payload_json FROM ${table} WHERE id = $1`, [row.id])
   const current = existing.rows[0]?.payload_json
   if (role === 'cashier' && (key === 'expenses' || key === 'cashMovements')) {
    const protectedRow = (value: unknown) => value && typeof value === 'object' && ('sourceModule' in value && value.sourceModule === 'payroll' || 'categoryCode' in value && ['salaries', 'bonuses'].includes(String(value.categoryCode)))
    let payroll = protectedRow(row) || protectedRow(current)
    if (key === 'cashMovements') {
      for (const value of [row, current]) {
        if (value && typeof value === 'object' && 'linkedExpenseId' in value && value.linkedExpenseId) {
          const linked = await db.query<{ payload_json: unknown }>('SELECT payload_json FROM expenses WHERE id = $1', [value.linkedExpenseId])
          payroll ||= protectedRow(linked.rows[0]?.payload_json)
        }
      }
    }
    if (payroll && (!current || canonical(current) !== canonical(row))) { rejected.push({ table: key, id: row.id, code: 'WRITE_FORBIDDEN_FOR_ROLE' }); continue }
   }
   if (current && canonical(current) === canonical(row)) continue
   let code: string | undefined
   if (deleted.has(`${key}:${row.id}`)) code = 'RECORD_DELETED'
   else if (current) {
    const revision = await db.query<{ seq: string | number | null }>('SELECT max(seq) AS seq FROM sync_changes WHERE table_name = $1 AND row_id = $2', [key, row.id])
    if (cursor === undefined) code = 'BASE_CURSOR_REQUIRED'
    else if (Number(revision.rows[0]?.seq ?? 0) > cursor) code = 'STALE_REVISION'
    else if (immutable.includes(key)) code = 'IMMUTABLE_RECORD'
   }
   if (code) { rejected.push({ table: key, id: row.id, code }); continue }
   accepted.push({ ...row, ...(immutable.includes(key) ? {} : { updatedAt: now }) })
  }
  payload[key] = singleton ? accepted[0] : accepted
 }
 const tombstones: SyncTombstone[] = []
 for (const item of incoming.tombstones ?? []) {
  const key = entityKeys[item.entityType]
  if (!key || typeof item.entityId !== 'string') throw new AuthApiError(400, 'INVALID_PAYLOAD', 'Suppression de synchronisation invalide.')
  if (role === 'cashier') { rejected.push({ table: key, id: item.entityId, code: 'DELETE_FORBIDDEN_FOR_ROLE' }); continue }
  if (deleted.has(`${key}:${item.entityId}`)) continue
  const rev = await db.query<{ seq: string | number | null }>('SELECT max(seq) AS seq FROM sync_changes WHERE table_name = $1 AND row_id = $2', [key, item.entityId])
  if (Number(rev.rows[0]?.seq ?? 0) > (cursor ?? -1)) {
   rejected.push({ table: key, id: item.entityId, code: 'STALE_REVISION' }); continue
  }
  tombstones.push({ ...item, deletedAt: now })
 }
 return { payload: payload as unknown as SalonBackupPayload, tombstones, rejected }
}

export interface SyncDelta {
 cursor: number; hasMore: boolean; changes: Partial<Record<SyncKey, unknown[]>>
 deleted: { table: SyncKey; id: string }[]
}
export async function readSyncDelta(db: SqlQueryable, since: number, role?: UserRole, limit = 500): Promise<SyncDelta> {
 const state = await db.query<{ revision: string | number }>('SELECT revision FROM sync_state')
 const head = Number(state.rows[0]?.revision ?? 0)
 if (since > head) throw new AuthApiError(409, 'CURSOR_AHEAD', 'Le curseur dépasse la révision du salon. Reconnexion de la synchronisation nécessaire.')
 const result = await db.query<{ seq: string | number; table_name: SyncKey; row_id: string; op: string; payload_json: unknown }>('SELECT seq, table_name, row_id, op, payload_json FROM sync_changes WHERE seq > $1 AND seq <= $2 ORDER BY seq LIMIT $3', [since, head, limit + 1])
 const page = result.rows.slice(0, limit)
 const condensed = new Map<string, typeof page[number]>()
 for (const row of page) if (canReadSync(row.table_name, role)) condensed.set(`${row.table_name}:${row.row_id}`, row)
 const changes: SyncDelta['changes'] = {}; const deleted: SyncDelta['deleted'] = []
 for (const row of condensed.values()) {
  if (row.op === 'delete') deleted.push({ table: row.table_name, id: row.row_id })
  else (changes[row.table_name] ??= []).push(projectSyncRecord(row.table_name, row.payload_json, role))
 }
 return { cursor: page.length ? Number(page.at(-1)!.seq) : head, hasMore: result.rows.length > limit, changes, deleted }
}
