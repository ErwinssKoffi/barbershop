import { afterEach, describe, expect, it, vi } from 'vitest'
import { databaseConnectionOptions, resolveCloudDatabaseUrl } from '../../server/neonClient'
import { readFileSync } from 'node:fs'

afterEach(() => vi.unstubAllEnvs())

describe('Configuration PostgreSQL Neon / Supabase', () => {
  it('donne priorité à la connexion Supabase serveur sans toucher à la compatibilité Neon', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user@db.neon.tech/app')
    vi.stubEnv('SUPABASE_DATABASE_URL', '')
    expect(resolveCloudDatabaseUrl()).toBe('postgresql://user@db.neon.tech/app')
    vi.stubEnv('SUPABASE_DATABASE_URL', 'postgresql://user@db.project.supabase.co/postgres')
    expect(resolveCloudDatabaseUrl()).toContain('supabase.co')
  })
  it('isole Supabase dans salon_pro sans résolution implicite vers public', () => {
    expect(databaseConnectionOptions('postgresql://user@db.project.supabase.co/postgres')).toEqual({ options: '-c search_path=salon_pro' })
    expect(databaseConnectionOptions('postgresql://user@aws-0-eu-west-1.pooler.supabase.com/postgres')).toEqual({ options: '-c search_path=salon_pro' })
    expect(databaseConnectionOptions('postgresql://user@db.neon.tech/app')).toEqual({})
  })
  it('livre une migration sans seed, avec les 19 tables et sans accès navigateur', () => {
    const migration = readFileSync('supabase/migrations/20261030000100_salon_pro_baseline.sql', 'utf8')
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(19)
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(19)
    expect(migration).toContain('REVOKE ALL ON SCHEMA salon_pro FROM PUBLIC, anon, authenticated')
    expect(migration).not.toMatch(/INSERT INTO|DROP TABLE/i)
  })
})
