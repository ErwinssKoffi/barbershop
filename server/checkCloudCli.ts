import { loadServerEnvironment, resolveServerEnvironment } from './serverEnvironment.ts'
import { getNeonPool, type SqlPoolLike } from './neonClient.ts'
import { checkCloudReadiness } from './cloudReadiness.ts'

let pool: SqlPoolLike | null = null
try {
 const args = process.argv.slice(2)
 if (args.length>1 || (args.length===1 && args[0]!=='--financial')) throw new Error('Invalid arguments')
 const mode=process.env.NODE_ENV ?? 'development'
 const environment=resolveServerEnvironment({mode})
 loadServerEnvironment({mode})
 pool = getNeonPool()
 const result = await checkCloudReadiness(pool,environment,args[0]==='--financial' ? 'financial' : 'baseline')
 console.info(JSON.stringify(result,null,2))
 if (result.status!=='ready') process.exitCode=1
} catch {
 console.error('Contrôle Cloud impossible. Vérifiez la configuration privée et les arguments. Aucun secret affiché, aucune migration appliquée.')
 process.exitCode=1
} finally { await pool?.end?.() }
