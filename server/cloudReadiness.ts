import type { SqlClientLike, SqlPoolLike } from './neonClient.ts'
import { checkDatabase, type DatabaseCheck } from './checkDatabase.ts'
import { TENANT_BUSINESS_TABLES } from './tenancySchema.ts'

export type CloudProfile = 'baseline' | 'financial'
export interface CloudSecurityCheck {
 status: 'verified' | 'failed' | 'not_checked'
 forcedRls: boolean
 runtimeRole: boolean
 financialGuards: boolean
}
export interface CloudReadiness {
 profile: CloudProfile
 status: 'ready' | 'blocked'
 database: DatabaseCheck
 security: CloudSecurityCheck
 blockers: string[]
 // Technical checks never attest to an operator's backup/restore or multi-device acceptance.
 productionApproved: false
 manualChecks: string[]
}
const unchecked: CloudSecurityCheck = { status:'not_checked', forcedRls:false, runtimeRole:false, financialGuards:false }

/** Catalogs only; no business data, writes, migrations or tenant context fabrication. */
export async function checkCloudSecurity(pool: SqlPoolLike, profile: CloudProfile): Promise<CloudSecurityCheck> {
 let db: SqlClientLike | undefined
 try {
  db = await pool.connect()
  await db.query('BEGIN READ ONLY')
  await db.query("SET LOCAL statement_timeout = '5000ms'")
  const tables: string[] = [...TENANT_BUSINESS_TABLES, 'sync_state', 'sync_changes']
  if (profile === 'financial') tables.push('checkout_counters','checkout_commands','checkout_records','checkout_refunds','checkout_refund_records')
  const relations = await db.query<{ name:string; protected:boolean }>(`SELECT c.relname AS name,
   (c.relrowsecurity AND c.relforcerowsecurity AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_isolation')) AS protected
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname=ANY($1::text[])`, [tables])
  const forcedRls = tables.every((name) => relations.rows.some((row) => row.name===name && row.protected))
  const guards = profile !== 'financial' || (await db.query<{ count:number }>(`SELECT count(DISTINCT c.relname)::int AS count
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname=current_schema() AND t.tgname='protect_checkout' AND t.tgenabled IN ('O','A')
   AND c.relname=ANY($1::text[])`, [['revenues','stock_movements','cash_movements','cash_sessions']])).rows[0]?.count===4
  // Exercise the same role switch as tenantContext, without selecting any salon or business row.
  await db.query("SELECT set_config('role', 'salon_pro_runtime_' || substr(md5(current_schema()), 1, 12), true)")
  const role = (await db.query<{ safe:boolean }>(`SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AS safe
   FROM pg_roles WHERE rolname=current_user`)).rows[0]?.safe===true
  await db.query('ROLLBACK') // Resets role and all local settings, even after success.
  return { status: forcedRls && role && guards ? 'verified' : 'failed', forcedRls, runtimeRole:role, financialGuards:guards }
 } catch {
  try { await db?.query('ROLLBACK') } catch { /* No raw error/connection string output. */ }
  return { status:'failed', forcedRls:false, runtimeRole:false, financialGuards:false }
 } finally { db?.release() }
}

export function evaluateCloudReadiness(environment: NodeJS.ProcessEnv, database: DatabaseCheck, security: CloudSecurityCheck, profile: CloudProfile): CloudReadiness {
 const blockers: string[] = []
 if ((environment.SALON_AUTH_SECRET?.trim().length ?? 0)<32) blockers.push('AUTH_SECRET_MISSING_OR_SHORT')
 if (['VITE_DATABASE_URL','VITE_SUPABASE_DATABASE_URL','VITE_SALON_AUTH_SECRET','VITE_SALON_SYNC_PIN'].some((key) => Boolean(environment[key]?.trim()))) blockers.push('PUBLIC_SECRET_VARIABLE')
 if (database.status!=='ready') blockers.push('DATABASE_NOT_READY')
 if (security.status!=='verified') blockers.push('DATABASE_SECURITY_NOT_VERIFIED')
 const mode = environment.SALON_CHECKOUT_SYNC_MODE?.trim() || 'legacy'
 const approved = environment.SALON_CHECKOUT_CUTOVER_APPROVED === 'true'
 const frontend = environment.VITE_SERVER_CHECKOUT === 'true'
 if (!['legacy','enforced'].includes(mode)) blockers.push('INVALID_CHECKOUT_MODE')
 for (const key of ['SALON_CHECKOUT_CUTOVER_APPROVED','VITE_SERVER_CHECKOUT']) {
  if (environment[key]!==undefined && !['true','false'].includes(environment[key]!)) blockers.push('INVALID_CHECKOUT_FLAG')
 }
 if (profile==='financial' || frontend || mode==='enforced' || approved) {
  if (!database.checkoutReady || !database.refundsReady) blockers.push('FINANCIAL_MIGRATIONS_REQUIRED')
  if (mode!=='enforced' || !approved || !frontend) blockers.push('FINANCIAL_FLAGS_NOT_ALIGNED')
  if (profile!=='financial') blockers.push('FINANCIAL_PROFILE_REQUIRED')
 }
 return { profile,status:blockers.length ? 'blocked' : 'ready',database,security,blockers:[...new Set(blockers)],productionApproved:false,
  manualChecks:['VERIFIED_BACKUP_AND_RESTORE','HTTPS_AUTHENTICATION_AND_SESSION_REVOCATION','MULTI_DEVICE_AND_OFFLINE_RECOVERY','FINANCIAL_RECONCILIATION_AND_OPERATOR_APPROVAL'] }
}

export async function checkCloudReadiness(pool: SqlPoolLike | null, environment: NodeJS.ProcessEnv, profile: CloudProfile = 'baseline'): Promise<CloudReadiness> {
 const database = await checkDatabase(pool)
 const security = pool && database.status==='ready' ? await checkCloudSecurity(pool,profile) : unchecked
 return evaluateCloudReadiness(environment,database,security,profile)
}
