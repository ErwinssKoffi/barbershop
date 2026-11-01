import { expect,it } from 'vitest'
import { readMigrationPlan } from '../../server/migrationPlan'
import { MIGRATIONS } from '../../server/migrations'
import type { SqlPoolLike } from '../../server/neonClient'
function fixture(ids:string[],state={private_schema:true,registry:true},fail=false) {
 const calls:string[]=[];let released=false
 const pool:SqlPoolLike={query:async()=>({rows:[],rowCount:0}),connect:async()=>({release(){released=true},query:async<R>(sql:string)=>{
  calls.push(sql)
  if(sql.includes('pg_namespace'))return {rows:[state] as R[],rowCount:1}
  if(sql.startsWith('SELECT id')){if(fail)throw new Error('private driver secret');return {rows:ids.map(id=>({id})) as R[],rowCount:ids.length}}
  return {rows:[] as R[],rowCount:0}
 }})}
 return {pool,calls,released:()=>released}
}
it('sans configuration : aucune approbation ni connexion fabriquée',async()=>{
 expect(await readMigrationPlan(null)).toMatchObject({status:'missing_configuration',executionAuthorized:false,restoreVerification:'not_established_by_this_check',applied:[],pending:MIGRATIONS.map(m=>m.id)})
})
it('socle distant : inventaire 006–021, transaction lecture seule cohérente',async()=>{
 const f=fixture(MIGRATIONS.slice(0,5).map(m=>m.id));const result=await readMigrationPlan(f.pool)
 expect(result).toMatchObject({status:'inspected',applied:MIGRATIONS.slice(0,5).map(m=>m.id),pending:MIGRATIONS.slice(5).map(m=>m.id),executionAuthorized:false})
 expect(f.calls[0]).toBe('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
 expect(f.calls.at(-1)).toBe('COMMIT');expect(f.released()).toBe(true)
 expect(f.calls.every(s=>/^(BEGIN|SET LOCAL|SELECT|COMMIT)/.test(s))).toBe(true)
})
it('registre complet ne donne aucune preuve de restauration ni autorisation',async()=>{
 const result=await readMigrationPlan(fixture(MIGRATIONS.map(m=>m.id)).pool)
 expect(result).toMatchObject({status:'inspected',pending:[],executionAuthorized:false,restoreVerification:'not_established_by_this_check'})
})
it('aucun fallback sur public si schéma ou registre absent',async()=>{
 for(const [state,status] of [[{private_schema:false,registry:false},'schema_missing'],[{private_schema:true,registry:false},'registry_missing']] as const){
  const f=fixture([],state);expect((await readMigrationPlan(f.pool)).status).toBe(status)
  expect(f.calls.some(c=>c.startsWith('SELECT id'))).toBe(false)
 }
})
it('registre étranger ou doublonné : conflit et aucun contenu inconnu affiché',async()=>{
 const f=fixture([...MIGRATIONS.slice(0,5).map(m=>m.id),'private-unknown-record'])
 const result=await readMigrationPlan(f.pool)
 expect(result).toMatchObject({status:'registry_conflict',unknownCount:1})
 expect(JSON.stringify(result)).not.toContain('private-unknown-record')
 expect((await readMigrationPlan(fixture(['001_baseline','001_baseline']).pool)).status).toBe('registry_conflict')
})
it('socle incomplet refusé ; erreur redigée et rollback/libération garantis',async()=>{
 expect((await readMigrationPlan(fixture(['001_baseline']).pool)).status).toBe('baseline_incomplete')
 const f=fixture([],undefined,true);const result=await readMigrationPlan(f.pool)
 expect(result.status).toBe('check_failed');expect(JSON.stringify(result)).not.toContain('secret')
 expect(f.calls.at(-1)).toBe('ROLLBACK');expect(f.released()).toBe(true)
})
