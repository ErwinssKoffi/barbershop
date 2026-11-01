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
    expect(calls.filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(MIGRATIONS.filter((m) => !['006_checkout','007_checkout_refunds','008_booking','009_marketplace_profiles','010_marketplace_scheduling','011_public_catalog','012_marketplace_media','013_notification_outbox','014_appointment_services','015_schedule_blocks','016_profile_details','017_visibility_editor','018_visibility_unpublish','019_saas_subscriptions','020_platform_activation','021_public_access_enforcement','022_publish_profile_text'].includes(m.id)).length)
    expect(calls.filter((sql) => sql === 'COMMIT')).toHaveLength(2)
    expect(released()).toBe(2)
  })

  it('exige un opt-in explicite pour appliquer 006', async () => {
    const {pool,calls} = migrationPool()
    await runMigrations(pool)
    expect(calls.some((sql) => sql.includes('CREATE TABLE checkout_commands'))).toBe(false)
    await runMigrations(pool,{includeCheckout:true})
    expect(calls.filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(MIGRATIONS.length-16)
  })

  it('008 reste optionnelle et indépendante des migrations financières',async () => {
    const {pool,calls}=migrationPool()
    await runMigrations(pool)
    expect(calls.some((sql) => sql.includes('CREATE TABLE bookings'))).toBe(false)
    await runMigrations(pool,{includeBooking:true})
    expect(calls.some((sql) => sql.includes('CREATE TABLE bookings'))).toBe(true)
    expect(calls.some((sql) => sql.includes('CREATE TABLE checkout_commands'))).toBe(false)
  })

  it('009 exige un opt-in et ne dépend ni de la caisse ni du booking',async () => {
    const {pool,calls}=migrationPool()
    await runMigrations(pool)
    expect(calls.some((sql) => sql.includes('CREATE TABLE salon_public_profiles'))).toBe(false)
    await runMigrations(pool,{includeMarketplace:true})
    expect(calls.some((sql) => sql.includes('CREATE TABLE salon_public_profiles'))).toBe(true)
    expect(calls.some((sql) => sql.includes('CREATE TABLE bookings'))).toBe(false)
    expect(calls.some((sql) => sql.includes('CREATE TABLE checkout_commands'))).toBe(false)
    const count=calls.filter((sql) => sql.startsWith('INSERT INTO schema_migrations')).length
    await runMigrations(pool,{includeMarketplace:true})
    expect(calls.filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(count)
  })

  it('010 exige son opt-in, implique 009 seulement et reste idempotente',async () => {
    const {pool,calls}=migrationPool()
    await runMigrations(pool,{includeMarketplace:true})
    expect(calls.some(sql => sql.includes('CREATE TABLE salon_opening_hours'))).toBe(false)
    await runMigrations(pool,{includeScheduling:true})
    expect(calls.some(sql => sql.includes('CREATE TABLE salon_opening_hours'))).toBe(true)
    expect(calls.some(sql => sql.includes('CREATE TABLE bookings'))).toBe(false)
    expect(calls.some(sql => sql.includes('CREATE TABLE checkout_commands'))).toBe(false)
    const count=calls.filter(sql => sql.startsWith('INSERT INTO schema_migrations')).length
    await runMigrations(pool,{includeScheduling:true})
    expect(calls.filter(sql => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(count)
  })

  it('011 reste séparée de 010/008/finance et implique 009 seulement',async () => {
    const {pool,calls}=migrationPool()
    await runMigrations(pool,{includeMarketplace:true,includeScheduling:true})
    expect(calls.some(sql => sql.includes('CREATE TABLE salon_public_services'))).toBe(false)
    const fresh=migrationPool()
    await runMigrations(fresh.pool,{includePublicCatalog:true})
    expect(fresh.calls.some(sql => sql.includes('CREATE TABLE salon_public_profiles'))).toBe(true)
    expect(fresh.calls.some(sql => sql.includes('CREATE TABLE salon_public_services'))).toBe(true)
    expect(fresh.calls.some(sql => sql.includes('CREATE TABLE salon_opening_hours'))).toBe(false)
    expect(fresh.calls.some(sql => sql.includes('CREATE TABLE bookings'))).toBe(false)
    expect(fresh.calls.some(sql => sql.includes('CREATE TABLE checkout_commands'))).toBe(false)
  })

  it('012 exige un opt-in distinct et implique 009 seulement',async () => {
    const base=migrationPool()
    await runMigrations(base.pool,{includeMarketplace:true,includeScheduling:true,includePublicCatalog:true})
    expect(base.calls.some(sql => sql.includes('CREATE TABLE salon_media ('))).toBe(false)
    const media=migrationPool()
    await runMigrations(media.pool,{includeMedia:true})
    expect(media.calls.some(sql => sql.includes('CREATE TABLE salon_media ('))).toBe(true)
    expect(media.calls.some(sql => sql.includes('CREATE TABLE salon_public_profiles'))).toBe(true)
    for (const sql of ['CREATE TABLE bookings','CREATE TABLE checkout_commands','CREATE TABLE salon_opening_hours','CREATE TABLE salon_public_services']) {
      expect(media.calls.some(call => call.includes(sql))).toBe(false)
    }
    const count=media.calls.filter(sql => sql.startsWith('INSERT INTO schema_migrations')).length
    await runMigrations(media.pool,{includeMedia:true})
    expect(media.calls.filter(sql => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(count)
  })

  it('013 ne dépend pas de 009/booking/finance et reste désactivée pour tous les anciens opt-ins',async () => {
    const previous=migrationPool()
    await runMigrations(previous.pool,{includeMarketplace:true,includeScheduling:true,includePublicCatalog:true,includeMedia:true,includeBooking:true,includeRefunds:true})
    expect(previous.calls.some(sql=>sql.includes('CREATE TABLE notification_outbox ('))).toBe(false)
    const fresh=migrationPool()
    await runMigrations(fresh.pool,{includeNotifications:true})
    expect(fresh.calls.some(sql=>sql.includes('CREATE TABLE notification_outbox ('))).toBe(true)
    for(const table of ['salon_public_profiles','bookings','checkout_commands','salon_media']) expect(fresh.calls.some(sql=>sql.includes(`CREATE TABLE ${table} (`))).toBe(false)
    const count=fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations')).length
    await runMigrations(fresh.pool,{includeNotifications:true})
    expect(fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(count)
  })

  it('014 implique 008 seulement et n’est activée par aucun ancien opt-in',async () => {
    const previous=migrationPool()
    await runMigrations(previous.pool,{includeBooking:true,includeMedia:true,includeNotifications:true,includePublicCatalog:true,includeScheduling:true,includeRefunds:true})
    expect(previous.calls.some(sql=>sql.includes('CREATE TABLE appointment_services ('))).toBe(false)
    const fresh=migrationPool()
    await runMigrations(fresh.pool,{includeAppointmentServices:true})
    expect(fresh.calls.some(sql=>sql.includes('CREATE TABLE appointment_services ('))).toBe(true)
    expect(fresh.calls.some(sql=>sql.includes('CREATE TABLE bookings ('))).toBe(true)
    for(const table of ['salon_public_profiles','checkout_commands','notification_outbox']) expect(fresh.calls.some(sql=>sql.includes(`CREATE TABLE ${table} (`))).toBe(false)
    const count=fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations')).length
    await runMigrations(fresh.pool,{includeAppointmentServices:true})
    expect(fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(count)
  })

  it('015 est indépendante de tous les autres modules optionnels et idempotente',async () => {
    const previous=migrationPool()
    await runMigrations(previous.pool,{includeAppointmentServices:true,includeScheduling:true,includePublicCatalog:true,includeMedia:true,includeNotifications:true,includeRefunds:true})
    expect(previous.calls.some(sql=>sql.includes('CREATE TABLE schedule_blocks ('))).toBe(false)
    const fresh=migrationPool()
    await runMigrations(fresh.pool,{includeScheduleBlocks:true})
    expect(fresh.calls.some(sql=>sql.includes('CREATE TABLE schedule_blocks ('))).toBe(true)
    for(const table of ['bookings','salon_public_profiles','checkout_commands','notification_outbox']) expect(fresh.calls.some(sql=>sql.includes(`CREATE TABLE ${table} (`))).toBe(false)
    const count=fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations')).length
    await runMigrations(fresh.pool,{includeScheduleBlocks:true})
    expect(fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(count)
  })

  it('016 exige son opt-in, implique 009 seulement et reste idempotente',async () => {
    const previous=migrationPool()
    await runMigrations(previous.pool,{includeMarketplace:true,includeScheduleBlocks:true,includeAppointmentServices:true,includePublicCatalog:true,includeScheduling:true,includeNotifications:true,includeMedia:true})
    expect(previous.calls.some(sql=>sql.includes('CREATE TABLE salon_profile_details ('))).toBe(false)
    const fresh=migrationPool()
    await runMigrations(fresh.pool,{includeProfileDetails:true})
    expect(fresh.calls.some(sql=>sql.includes('CREATE TABLE salon_profile_details ('))).toBe(true)
    expect(fresh.calls.some(sql=>sql.includes('CREATE TABLE salon_public_profiles ('))).toBe(true)
    for(const table of ['bookings','salon_public_services','checkout_commands','salon_media']) expect(fresh.calls.some(sql=>sql.includes(`CREATE TABLE ${table} (`))).toBe(false)
    const count=fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations')).length
    await runMigrations(fresh.pool,{includeProfileDetails:true})
    expect(fresh.calls.filter(sql=>sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(count)
  })

  it('017 implique 009/010/011/016 uniquement, indépendante de finance/booking/médias',async()=>{
    const previous=migrationPool()
    await runMigrations(previous.pool,{includeScheduling:true,includePublicCatalog:true,includeProfileDetails:true})
    expect(previous.calls.some(s=>s.includes('CREATE TABLE salon_service_selections ('))).toBe(false)
    const fresh=migrationPool();await runMigrations(fresh.pool,{includeVisibilityEditor:true})
    for(const table of ['salon_public_profiles','salon_opening_hours','salon_public_services','salon_profile_details','salon_service_selections'])expect(fresh.calls.some(s=>s.includes(`CREATE TABLE ${table} (`))).toBe(true)
    for(const table of ['bookings','checkout_commands','salon_media','notification_outbox'])expect(fresh.calls.some(s=>s.includes(`CREATE TABLE ${table} (`))).toBe(false)
  })

  it('018 implique 009 seulement et n’est pas activée par les anciens opt-ins',async()=>{
    const previous=migrationPool();await runMigrations(previous.pool,{includeVisibilityEditor:true,includeMedia:true})
    expect(previous.calls.some(s=>s.includes('CREATE FUNCTION unpublish_salon_profile'))).toBe(false)
    const fresh=migrationPool();await runMigrations(fresh.pool,{includeVisibilityPublication:true})
    expect(fresh.calls.some(s=>s.includes('CREATE FUNCTION unpublish_salon_profile'))).toBe(true)
    expect(fresh.calls.some(s=>s.includes('CREATE TABLE salon_public_profiles ('))).toBe(true)
    for(const table of ['bookings','checkout_commands','salon_media','salon_profile_details'])expect(fresh.calls.some(s=>s.includes(`CREATE TABLE ${table} (`))).toBe(false)
  })

  it('019 indépendante, optionnelle et sans activation par les anciens opt-ins',async()=>{
    const previous=migrationPool();await runMigrations(previous.pool,{includeVisibilityEditor:true,includeVisibilityPublication:true})
    expect(previous.calls.some(s=>s.includes('CREATE TABLE saas_plans ('))).toBe(false)
    const fresh=migrationPool();await runMigrations(fresh.pool,{includeSubscriptions:true})
    expect(fresh.calls.some(s=>s.includes('CREATE TABLE saas_plans ('))).toBe(true)
    for(const table of ['salon_public_profiles','bookings','checkout_commands'])expect(fresh.calls.some(s=>s.includes(`CREATE TABLE ${table} (`))).toBe(false)
  })

  it('020 exige son opt-in et implique 019 uniquement, sans rôle attribué automatiquement',async()=>{
    const previous=migrationPool();await runMigrations(previous.pool,{includeSubscriptions:true,includeVisibilityEditor:true})
    expect(previous.calls.some(s=>s.includes('CREATE TABLE platform_activation_receipts ('))).toBe(false)
    const fresh=migrationPool();await runMigrations(fresh.pool,{includePlatformActivation:true})
    expect(fresh.calls.some(s=>s.includes('CREATE TABLE platform_activation_receipts ('))).toBe(true)
    expect(fresh.calls.some(s=>s.includes('CREATE TABLE tenant_subscriptions ('))).toBe(true)
    for(const table of ['salon_public_profiles','bookings','checkout_commands'])expect(fresh.calls.some(s=>s.includes(`CREATE TABLE ${table} (`))).toBe(false)
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
    expect(calls.slice(retryStart).filter((sql) => sql.startsWith('INSERT INTO schema_migrations'))).toHaveLength(MIGRATIONS.filter((m) => !['006_checkout','007_checkout_refunds','008_booking','009_marketplace_profiles','010_marketplace_scheduling','011_public_catalog','012_marketplace_media','013_notification_outbox','014_appointment_services','015_schedule_blocks','016_profile_details','017_visibility_editor','018_visibility_unpublish','019_saas_subscriptions','020_platform_activation','021_public_access_enforcement','022_publish_profile_text'].includes(m.id)).length)
    expect(calls.at(-1)).toBe('COMMIT')
  })
})
