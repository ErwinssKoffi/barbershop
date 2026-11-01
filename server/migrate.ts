import { marketplaceMigrationOptions } from './migrationOptions.ts'
import { loadServerEnvironment } from './serverEnvironment.ts'
import { getNeonPool } from './neonClient.ts'
import { runMigrations } from './migrations.ts'

loadServerEnvironment()
const pool = getNeonPool()
if (!pool) {
  console.error('Configurez SUPABASE_DATABASE_URL ou DATABASE_URL côté serveur.')
  process.exitCode = 1
} else {
  try {
    const includeRefunds = process.argv.includes('--include-refunds')
    if (includeRefunds && (process.env.SALON_REFUNDS_BACKUP_VERIFIED !== 'true' || process.env.SALON_CHECKOUT_BACKUP_VERIFIED !== 'true')) throw new Error('Refund backup approval required')
    const includeCheckout = process.argv.includes('--include-checkout')
    if (includeCheckout && process.env.SALON_CHECKOUT_BACKUP_VERIFIED !== 'true') throw new Error('Backup verification approval required')
    const includeBooking = process.argv.includes('--include-booking')
    if (includeBooking && process.env.SALON_BOOKING_BACKUP_VERIFIED !== 'true') throw new Error('Booking backup approval required')
    const marketplace = marketplaceMigrationOptions(process.argv, process.env.SALON_MARKETPLACE_BACKUP_VERIFIED, process.env.SALON_BOOKING_BACKUP_VERIFIED)
    await runMigrations(pool, { includeCheckout, includeRefunds, includeBooking, ...marketplace })
    console.info('Migrations PostgreSQL appliquées.')
  } catch {
    console.error('Échec des migrations. --include-appointment-services exige aussi SALON_BOOKING_BACKUP_VERIFIED=true ; Vérifiez connexion/droits ; --include-checkout exige SALON_CHECKOUT_BACKUP_VERIFIED=true après sauvegarde et restauration vérifiées ; --include-refunds exige aussi SALON_REFUNDS_BACKUP_VERIFIED=true ; --include-booking exige SALON_BOOKING_BACKUP_VERIFIED=true après sauvegarde/restauration vérifiées ; --include-marketplace, --include-scheduling ou --include-public-catalog ou --include-media ou --include-notifications ou --include-appointment-services ou --include-schedule-blocks ou --include-profile-details ou --include-visibility-editor ou --include-visibility-unpublish ou --include-subscriptions ou --include-platform-activation ou --include-public-access-enforcement ou --include-text-publication exige SALON_MARKETPLACE_BACKUP_VERIFIED=true après sauvegarde/restauration vérifiées.')
    process.exitCode = 1
  } finally {
    await pool.end?.()
  }
}
