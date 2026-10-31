import { PGlite } from '@electric-sql/pglite'
import { afterEach } from 'vitest'
import type { SqlPoolLike, SqlQueryResult } from '../../server/neonClient'

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
