import { SYNC_REVISIONS_SQL } from './syncSchema.ts'
import { SESSIONS_SQL } from './sessionSchema.ts'
import { TENANCY_SQL } from './tenancySchema.ts'
import { NEON_SCHEMA_SQL } from './neonSchema.ts'
import type { SqlPoolLike } from './neonClient.ts'

export const MIGRATION_REGISTRY_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`

export const AUTH_SECURITY_SQL = `
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expiry ON auth_rate_limits (expires_at);
`

export const MIGRATIONS = [
  { id: '001_baseline', sql: NEON_SCHEMA_SQL },
  { id: '002_auth_security', sql: AUTH_SECURITY_SQL },
  { id: '003_tenancy', sql: TENANCY_SQL },
  { id: '004_sessions', sql: SESSIONS_SQL },
  { id: '005_sync_revisions', sql: SYNC_REVISIONS_SQL },
] as const

/** Un seul client et verrou transactionnel : pas de migration concurrente entre instances. */
export async function runMigrations(pool: SqlPoolLike): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':salon-pro-migrations'))")
    await client.query(MIGRATION_REGISTRY_SQL)
    const result = await client.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')
    const applied = new Set(result.rows.map((row) => row.id))
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue
      await client.query(migration.sql)
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
