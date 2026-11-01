import { MIGRATIONS } from './migrations.ts'
import { OFFICIAL_DATABASE_TARGET } from './officialDatabaseTarget.ts'
import type { SqlPoolLike,SqlClientLike } from './neonClient.ts'
export interface MigrationPlan {
 status:'missing_configuration'|'check_failed'|'schema_missing'|'registry_missing'|'baseline_incomplete'|'registry_conflict'|'inspected'
 expectedProjectRef:string;schema:'salon_pro';applied:string[];pending:string[];unknownCount:number
 executionAuthorized:false;restoreVerification:'not_established_by_this_check'
}
/** Read-only inventory. A matching registry is NOT proof of backup, restored data or SQL integrity. */
export async function readMigrationPlan(pool:SqlPoolLike|null):Promise<MigrationPlan> {
 const result:MigrationPlan={status:'missing_configuration',expectedProjectRef:OFFICIAL_DATABASE_TARGET.projectRef,schema:'salon_pro',applied:[],pending:MIGRATIONS.map(m=>m.id),unknownCount:0,executionAuthorized:false,restoreVerification:'not_established_by_this_check'}
 if(!pool)return result
 let db:SqlClientLike|undefined
 try {
  db=await pool.connect()
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await db.query("SET LOCAL statement_timeout='5000ms'")
  const state=(await db.query<{private_schema:boolean;registry:boolean}>("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='salon_pro') AS private_schema,to_regclass('salon_pro.schema_migrations') IS NOT NULL AS registry")).rows[0]
  if(!state?.private_schema || !state.registry){await db.query('COMMIT');return {...result,status:state?.private_schema?'registry_missing':'schema_missing'}}
  const rows=(await db.query<{id:string}>('SELECT id FROM salon_pro.schema_migrations ORDER BY id LIMIT 502')).rows
  await db.query('COMMIT')
  const known=new Set<string>(MIGRATIONS.map(m=>m.id)),ids=new Set(rows.map(r=>r.id))
  result.applied=MIGRATIONS.filter(m=>ids.has(m.id)).map(m=>m.id)
  result.pending=MIGRATIONS.filter(m=>!ids.has(m.id)).map(m=>m.id)
  result.unknownCount=rows.filter(r=>!known.has(r.id)).length
  const baseline=MIGRATIONS.slice(0,5).every(m=>ids.has(m.id))
  result.status=rows.length>501 || ids.size!==rows.length || result.unknownCount>0?'registry_conflict':baseline?'inspected':'baseline_incomplete'
  return result
 } catch {
  try{await db?.query('ROLLBACK')}catch{/* No driver details, connection URL or rows in diagnostics. */}
  return {...result,status:'check_failed',applied:[],pending:MIGRATIONS.map(m=>m.id),unknownCount:0}
 } finally {db?.release()}
}
