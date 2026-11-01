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
    await runMigrations(pool, { includeCheckout, includeRefunds })
    console.info('Migrations PostgreSQL appliquées.')
  } catch {
    console.error('Échec des migrations. Vérifiez connexion/droits ; --include-checkout exige SALON_CHECKOUT_BACKUP_VERIFIED=true après sauvegarde et restauration vérifiées ; --include-refunds exige aussi SALON_REFUNDS_BACKUP_VERIFIED=true.')
    process.exitCode = 1
  } finally {
    await pool.end?.()
  }
}
