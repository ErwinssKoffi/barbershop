import { expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { databasePoolConfig } from '../../server/neonClient'
import { checkCloudReadiness, checkCloudSecurity, evaluateCloudReadiness, type CloudSecurityCheck } from '../../server/cloudReadiness'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'

const environment = (): NodeJS.ProcessEnv => ({ SALON_AUTH_SECRET:randomBytes(32).toString('hex'), SALON_CHECKOUT_SYNC_MODE:'legacy', SALON_CHECKOUT_CUTOVER_APPROVED:'false', VITE_SERVER_CHECKOUT:'false' })
const baseline = {status:'ready' as const,checkoutReady:false,refundsReady:false}
const security: CloudSecurityCheck = {status:'verified',forcedRls:true,runtimeRole:true,financialGuards:true}

it.each([
 'postgresql://localhost-password@db.invalid/db',
 'postgresql://account@localhost.attacker.invalid/db',
 'postgresql://account@db.invalid/db?host=localhost&sslmode=disable&ssl=false',
 'postgresql://account@db.invalid/db?sslmode=no-verify&options=-c%20search_path=public',
 'postgresql://account@db.invalid/db?sslrootcert=system&sslcert=ignored&sslkey=ignored',
])('impose TLS vérifié au vrai hôte distant malgré les paramètres pg : %s', (url) => {
 const config=databasePoolConfig(url)
 expect(config.ssl).toEqual({rejectUnauthorized:true})
 const client=new pg.Client(config)
 // Verify pg's effective parameters, not just our input object. No network connection.
 const effective=(client as unknown as {connectionParameters:{ssl:unknown;host:string}}).connectionParameters
 expect(effective.ssl).toEqual({rejectUnauthorized:true})
 expect(effective.host).not.toBe('localhost')
 expect([...new URL(config.connectionString!).searchParams.keys()]).toEqual([])
})
it.each(['localhost','127.0.0.1','[::1]'])('permet la base locale explicite %s sans dépendre du contenu du mot de passe',host => {
 expect(databasePoolConfig(`postgresql://account@${host}/db`).ssl).toBe(false)
})
it('préserve le schéma privé Supabase et masque les erreurs URL',() => {
 const config=databasePoolConfig('postgresql://account@db.project.supabase.co/db?options=-c%20search_path=public&application_name=salon')
 expect(config.options).toBe('-c search_path=salon_pro')
 expect(new URL(config.connectionString!).searchParams.get('application_name')).toBe('salon')
 expect(() => databasePoolConfig('https://private-value.invalid')).toThrow('Configuration PostgreSQL invalide.')
 expect(() => databasePoolConfig('private-value')).toThrow('Configuration PostgreSQL invalide.')
})
it('bloque sans base/clé sans exposer les valeurs privées',async () => {
 const env=environment();env.VITE_DATABASE_URL='private-value'
 const report=await checkCloudReadiness(null,env)
 expect(report.status).toBe('blocked')
 expect(report.blockers).toContain('PUBLIC_SECRET_VARIABLE')
 expect(report.blockers).toContain('DATABASE_NOT_READY')
 expect(report.productionApproved).toBe(false)
 expect(JSON.stringify(report)).not.toContain('private-value')
 expect(JSON.stringify(report)).not.toContain(env.SALON_AUTH_SECRET)
 expect(evaluateCloudReadiness({},baseline,security,'baseline').blockers).toContain('AUTH_SECRET_MISSING_OR_SHORT')
})
it('distingue préparation technique baseline et approbation de production',() => {
 const report=evaluateCloudReadiness(environment(),baseline,security,'baseline')
 expect(report.status).toBe('ready');expect(report.productionApproved).toBe(false)
 expect(report.manualChecks).toContain('VERIFIED_BACKUP_AND_RESTORE')
 expect(evaluateCloudReadiness(environment(),baseline,security,'financial').status).toBe('blocked')
})
it('exige migrations et alignement explicite des trois pilotes financiers',() => {
 const env={...environment(),SALON_CHECKOUT_SYNC_MODE:'enforced',SALON_CHECKOUT_CUTOVER_APPROVED:'true',VITE_SERVER_CHECKOUT:'true'}
 const db={...baseline,checkoutReady:true,refundsReady:true}
 expect(evaluateCloudReadiness(env,db,security,'financial').status).toBe('ready')
 expect(evaluateCloudReadiness(env,db,security,'baseline').blockers).toContain('FINANCIAL_PROFILE_REQUIRED')
 expect(evaluateCloudReadiness(env,baseline,security,'financial').blockers).toContain('FINANCIAL_MIGRATIONS_REQUIRED')
 for(const key of ['SALON_CHECKOUT_SYNC_MODE','SALON_CHECKOUT_CUTOVER_APPROVED','VITE_SERVER_CHECKOUT']) {
  expect(evaluateCloudReadiness({...env,[key]:'false'},db,security,'financial').status).toBe('blocked')
 }
 expect(evaluateCloudReadiness({...env,VITE_SERVER_CHECKOUT:'TRUE'},db,security,'financial').blockers).toContain('INVALID_CHECKOUT_FLAG')
})
it('vérifie les catalogues et le changement de rôle sans migration ni contexte persistant',async () => {
 const {pool}=createPostgresTestPool();await runMigrations(pool)
 const before=(await pool.query('SELECT current_user AS role')).rows
 const ids=(await pool.query('SELECT id FROM schema_migrations ORDER BY id')).rows
 expect((await checkCloudReadiness(pool,environment())).status).toBe('ready')
 expect((await pool.query('SELECT current_user AS role')).rows).toEqual(before)
 expect((await pool.query('SELECT id FROM schema_migrations ORDER BY id')).rows).toEqual(ids)
 await pool.query('ALTER TABLE revenues NO FORCE ROW LEVEL SECURITY')
 const insecure=await checkCloudSecurity(pool,'baseline')
 expect(insecure.status).toBe('failed');expect(insecure.forcedRls).toBe(false)
})
it('vérifie les protections financières réelles et détecte un trigger désactivé',async () => {
 const {pool}=createPostgresTestPool();await runMigrations(pool,{includeRefunds:true})
 expect((await checkCloudSecurity(pool,'financial')).status).toBe('verified')
 await pool.query('ALTER TABLE cash_movements DISABLE TRIGGER protect_checkout')
 expect(await checkCloudSecurity(pool,'financial')).toMatchObject({status:'failed',financialGuards:false})
})
it('échoue fermé si le rôle runtime ne peut plus être activé, sans fuite d’erreur',async () => {
 const {pool}=createPostgresTestPool();await runMigrations(pool)
 const failing={...pool,connect:async () => {
  const client=await pool.connect()
  return {...client,query:async <R>(sql:string,values?:unknown[]) => {
   if(sql.includes("set_config('role'")) throw new Error('private database address')
   return client.query<R>(sql,values)
  }}
 }}
 const result=await checkCloudSecurity(failing,'baseline')
 expect(result.status).toBe('failed')
 expect(JSON.stringify(result)).not.toContain('private database address')
 expect((await pool.query('SELECT current_user AS role')).rows[0]).toHaveProperty('role')
})
