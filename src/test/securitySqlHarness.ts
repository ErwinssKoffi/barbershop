import type { SqlQueryResult } from '../../server/neonClient'

/** Complément aux simulateurs métier : migrations et compteurs persistants SQL. */
export function createSecuritySqlHarness() {
  let applied = new Set<string>()
  let snapshot = new Set<string>()
  const tenantId = crypto.randomUUID()
  const buckets = new Map<string, { attempts: number; expiresAt: number }>()
  return function query<R>(sql: string, values: unknown[]): SqlQueryResult<R> | null {
    if (sql === 'BEGIN') snapshot = new Set(applied)
    if (sql === 'ROLLBACK') applied = new Set(snapshot)
    if (sql.startsWith('SELECT tenant_id FROM tenant_bootstrap')) return { rows: [{ tenant_id: tenantId }] as R[], rowCount: 1 }
    if (sql.startsWith("SELECT set_config('")) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT id FROM tenants')) return { rows: [{ id: String(values[0]) }] as R[], rowCount: 1 }
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('SELECT id FROM schema_migrations')) {
      return { rows: Array.from(applied, (id) => ({ id })) as R[], rowCount: applied.size }
    }
    if (sql.startsWith('INSERT INTO schema_migrations')) {
      applied.add(String(values[0]))
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('INSERT INTO auth_rate_limits')) {
      const key = String(values[0])
      let bucket = buckets.get(key)
      if (!bucket || bucket.expiresAt <= Date.now()) bucket = { attempts: 0, expiresAt: Date.now() + Number(values[1]) * 1000 }
      bucket.attempts++
      buckets.set(key, bucket)
      return { rows: [{ attempts: bucket.attempts, retry_after: Math.ceil((bucket.expiresAt - Date.now()) / 1000) }] as R[], rowCount: 1 }
    }
    if (sql.startsWith('DELETE FROM auth_rate_limits WHERE bucket')) {
      const deleted = buckets.delete(String(values[0]))
      return { rows: [], rowCount: deleted ? 1 : 0 }
    }
    return null
  }
}
