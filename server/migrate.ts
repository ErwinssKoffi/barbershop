import 'dotenv/config'
import { getNeonPool } from './neonClient.ts'
import { runMigrations } from './migrations.ts'

const pool = getNeonPool()
if (!pool) {
  console.error('Configurez SUPABASE_DATABASE_URL ou DATABASE_URL côté serveur.')
  process.exitCode = 1
} else {
  try {
    await runMigrations(pool)
    console.info('Migrations PostgreSQL appliquées.')
  } catch {
    console.error('Échec des migrations PostgreSQL. Vérifiez la connexion et les droits du rôle de migration.')
    process.exitCode = 1
  } finally {
    await pool.end?.()
  }
}
