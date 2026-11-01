import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll } from 'vitest'
import type { SqlPoolLike, SqlQueryResult } from '../../server/neonClient'

// Compile the WASM engine in fixture setup, not inside the first business assertion's 5s budget.
// Per-test databases/migrations remain isolated; no fixture data or connection is reused.
beforeAll(async () => {
  const engine = new PGlite()
  try { await engine.query('SELECT 1') } finally { await engine.close() }
}, 15_000)

const databases = new Set<PGlite>()
afterEach(async () => {
  for (const db of databases) await db.close()
  databases.clear()
})

/** PostgreSQL WASM réel (policies, rôles et contraintes), sans service externe ni données persistantes. */
export function createPostgresTestPool() {
  const db = new PGlite()
  databases.add(db)
  const query = async <R>(text: string, values: unknown[] = []): Promise<SqlQueryResult<R>> => {
    if (!values.length && text.includes(';')) {
      const results = await db.exec(text)
      const result = results.at(-1)
      return { rows: (result?.rows ?? []) as R[], rowCount: result?.affectedRows ?? 0 }
    }
    const result = await db.query(text, values)
    return { rows: result.rows as R[], rowCount: result.affectedRows ?? 0 }
  }
  const pool: SqlPoolLike = { query, connect: async () => ({ query, release() {} }) }
  return { pool, db }
}
