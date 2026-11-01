import type { SqlPoolLike, SqlClientLike } from './neonClient.ts'

export interface DatabaseCheck {
 status:'missing_configuration'|'check_failed'|'schema_missing'|'baseline_incomplete'|'ready'
 checkoutReady:boolean
 refundsReady:boolean
}
/** Live, read-only verification; never migrates, seeds, changes roles or prints connection details. */
export async function checkDatabase(pool:SqlPoolLike|null):Promise<DatabaseCheck> {
 const unavailable={checkoutReady:false,refundsReady:false}
 if(!pool) return {status:'missing_configuration',...unavailable}
 let db:SqlClientLike|undefined
 try {
  db=await pool.connect()
  await db.query('BEGIN READ ONLY')
  await db.query('SELECT 1')
  const registry=(await db.query<{available:boolean}>("SELECT to_regclass('schema_migrations') IS NOT NULL AS available")).rows[0]?.available
  if(!registry) {await db.query('COMMIT');return {status:'schema_missing',...unavailable}}
  const ids=new Set((await db.query<{id:string}>('SELECT id FROM schema_migrations ORDER BY id')).rows.map((row) => row.id))
  await db.query('COMMIT')
  const ready=['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions'].every((id) => ids.has(id))
  return {status:ready ? 'ready' : 'baseline_incomplete',checkoutReady:ready && ids.has('006_checkout'),refundsReady:ready && ids.has('006_checkout') && ids.has('007_checkout_refunds')}
 } catch {
  try {await db?.query('ROLLBACK')} catch { /* Do not expose connection errors/URLs. */ }
  return {status:'check_failed',...unavailable}
 } finally {db?.release()}
}
