import { OFFICIAL_DATABASE_TARGET } from './officialDatabaseTarget.ts'
import { loadServerEnvironment } from './serverEnvironment.ts'
import { getNeonPool,resolveCloudDatabaseUrl,type SqlPoolLike } from './neonClient.ts'
import { readMigrationPlan } from './migrationPlan.ts'
let pool:SqlPoolLike|null=null
try {
 if(process.argv.length!==2)throw new Error('No arguments accepted')
 loadServerEnvironment()
 if(resolveCloudDatabaseUrl() && process.env.SALON_SUPABASE_PROJECT_REF!==OFFICIAL_DATABASE_TARGET.projectRef)throw new Error('Official target guard required')
 pool=getNeonPool()
 const plan=await readMigrationPlan(pool)
 console.info(JSON.stringify(plan))
 if(plan.status!=='inspected')process.exitCode=1
} catch {
 console.error('Plan indisponible : vérifiez la configuration serveur privée, la cible et les droits. Aucune migration exécutée ; aucune preuve de restauration déduite.')
 process.exitCode=1
} finally {await pool?.end?.()}
