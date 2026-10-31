import { describe, expect, it } from 'vitest'
import { MIGRATIONS, runMigrations } from '../../server/migrations'
import type { SqlPoolLike } from '../../server/neonClient'
import { createSecuritySqlHarness } from './securitySqlHarness'

function migrationPool(failOnce = false) {
  const calls: string[] = []
  const security = createSecuritySqlHarness()
  let released = 0
  const query = async <R>(text: string, values: unknown[] = []) => {
    const sql = text.replace(/\s+/g, ' ').trim()
    calls.push(sql)
    if (failOnce && text === MIGRATIONS[1].sql) { failOnce = false; throw new Error('migration failure') }
    return security<R>(sql, values) ?? { rows: [] as R[], rowCount: 0 }
  }
  const pool: SqlPoolLike = { query, connect: async () => ({ query, release: () => { released++ } }) }
  return { pool, calls, released: () => released }
}

describe('Migrations PostgreSQL versionnées', () => {
  it('maintient un registre ordonné, unique et sans jeux de données', () => {
    const ids = MIGRATIONS.map((migration) => migration.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([...ids].sort())
    expect(MIGRATIONS[0].sql.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(19)
    expect(MIGRATIONS[1].sql).toContain('auth_rate_limits')
    expect(MIGRATIONS[2].sql).toContain('FORCE ROW LEVEL SECURITY')
  })

  it('ne rejoue pas les migrations appliquées et libère les connexions', async () => {
    const { pool, calls, released } = migrationPool()
    await runMigrations(pool)
    await runMigrations(pool)
    expect(calls.filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(MIGRATIONS.length)
    expect(calls.filter((sql) => sql === 'COMMIT')).toHaveLength(2)
    expect(released()).toBe(2)
  })

  it('verrouille le schéma avant de lire le registre', async () => {
    const { pool, calls } = migrationPool()
    await runMigrations(pool)
    expect(calls.findIndex((sql) => sql.startsWith('SELECT pg_advisory_xact_lock'))).toBeLessThan(calls.findIndex((sql) => sql.startsWith('SELECT id FROM schema_migrations')))
    expect(calls[0]).toBe('BEGIN')
  })

  it('annule toute la série en cas d’échec et peut réessayer proprement', async () => {
    const { pool, calls, released } = migrationPool(true)
    await expect(runMigrations(pool)).rejects.toThrow('migration failure')
    expect(calls.at(-1)).toBe('ROLLBACK')
    expect(calls).not.toContain('COMMIT')
    expect(released()).toBe(1)
    const retryStart = calls.length
    await runMigrations(pool)
    expect(calls.slice(retryStart).filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(MIGRATIONS.length)
    expect(calls.at(-1)).toBe('COMMIT')
  })
})
