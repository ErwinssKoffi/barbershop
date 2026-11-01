import { loadServerEnvironment } from './serverEnvironment.ts'
import { getNeonPool, type SqlPoolLike } from './neonClient.ts'
import { checkDatabase } from './checkDatabase.ts'

let pool:SqlPoolLike|null=null
try {
 loadServerEnvironment()
 pool=getNeonPool()
 const result=await checkDatabase(pool)
 console.info(JSON.stringify(result))
 if(result.status!=='ready') process.exitCode=1
} catch {
 console.error('Vérification impossible : contrôlez la configuration serveur privée, les droits et le réseau. Aucun secret affiché et aucune migration appliquée.')
 process.exitCode=1
} finally {await pool?.end?.()}
