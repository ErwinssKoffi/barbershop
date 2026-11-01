/** Destructive fixtures ONLY in a random schema on an explicit local Unix-socket test DB. */
import assert from 'node:assert/strict'
import { createHash,randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { runMigrations } from '../server/migrations.ts'
import type { SqlPoolLike } from '../server/neonClient.ts'
import { ESSENTIEL_V1 } from '../src/domain/subscriptions.ts'
const socket=process.env.SALON_TEST_PG_SOCKET
if(!socket || !socket.startsWith('/') || !lstatSync(socket).isDirectory() || (lstatSync(socket).mode&0o077)!==0)throw new Error('Explicit private local test socket directory required')
const schema='quota_test_'+randomUUID().replaceAll('-',''),port=Number(process.env.SALON_TEST_PG_PORT??55432)
const admin=new pg.Pool({host:socket,port,database:'postgres',user:process.env.USER,max:1})
const pool=new pg.Pool({host:socket,port,database:'postgres',user:process.env.USER,options:`-c search_path=${schema}`,max:12})
const roleSuffix=createHash('md5').update(schema).digest('hex').slice(0,12)
try {
 await admin.query(`CREATE SCHEMA ${schema}`)
 await runMigrations(pool as unknown as SqlPoolLike,{includePublicAccessEnforcement:true})
 const tenant=(await pool.query('SELECT tenant_id FROM tenant_bootstrap')).rows[0].tenant_id
 const profile=(await pool.query("INSERT INTO salon_public_profiles(tenant_id,display_name,city) VALUES($1,'Concurrency test','Abidjan') RETURNING id",[tenant])).rows[0].id
 const p=ESSENTIEL_V1
 const plan=(await pool.query('INSERT INTO saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[p.code,p.version,p.name,p.priceXof,p.currency,p.periodKind,p.graceSeconds,p.entitlements])).rows[0].id
 await pool.query(`INSERT INTO tenant_subscriptions(tenant_id,plan_id,activation_key,billing_anchor_at,period_index,billing_timezone,starts_at,ends_at,grace_ends_at,amount_xof,external_reference,evidence_reference,operator_reference)
 VALUES($1,$2,$3,date_trunc('month',now()),0,'Africa/Abidjan',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',date_trunc('month',now())+interval '1 month 72 hours',4900,'test-external','test-case','test-operator')`,[tenant,plan,randomUUID()])
 const insert=(db:pg.Pool|pg.PoolClient)=>{
  const id=randomUUID()
  return db.query("INSERT INTO salon_media(tenant_id,id,profile_id,purpose,original_key,declared_mime,declared_bytes,upload_expires_at) VALUES($1::uuid,$2::uuid,$3,'gallery',$1::uuid::text || '/' || $2::uuid::text || '/original','image/jpeg',100,now()+interval '1 hour')",[tenant,id,profile])
 }
 const used=async()=>Number((await pool.query("SELECT used FROM salon_public_quota_usage WHERE tenant_id=$1 AND resource='uploads'",[tenant])).rows[0]?.used??0)
 const close=()=>pool.query("UPDATE salon_media SET state='deleted' WHERE state NOT IN ('deleted','rejected')")
 await insert(pool);await insert(pool)
 const a=await pool.connect(),b=await pool.connect()
 try {
  await a.query('BEGIN');await insert(a)
  await b.query('BEGIN')
  const pid=(await b.query('SELECT pg_backend_pid() AS id')).rows[0].id
  const pending=insert(b).then(()=>({code:'unexpected-success'}),(e:Error&{code?:string})=>e)
  let blocked=false
  for(let i=0;i<50;i++){
   if((await pool.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[pid])).rows[0].blocked){blocked=true;break}
   await delay(20)
  }
  assert.equal(blocked,true,'second writer must actually wait on first transaction')
  await a.query('COMMIT')
  assert.equal((await pending).code,'23514')
  await b.query('ROLLBACK');assert.equal(await used(),3)
  console.info('PASS READ COMMITTED: competing fourth upload rejected after actual lock wait')
  await close();assert.equal(await used(),0)
  await insert(pool);await insert(pool)
  await b.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await b.query('SELECT * FROM salon_public_quota_usage')
  await a.query('BEGIN');await insert(a);await a.query('COMMIT')
  await assert.rejects(insert(b),(error:unknown)=>(error as {code:string}).code==='40001')
  await b.query('ROLLBACK');assert.equal(await used(),3)
  console.info('PASS REPEATABLE READ: stale snapshot aborts with serialization conflict')
  await close()
  const results=await Promise.allSettled(Array.from({length:8},()=>insert(pool)))
  assert.equal(results.filter(r=>r.status==='fulfilled').length,3);assert.equal(await used(),3)
  console.info('PASS parallel burst: exactly 3 of 8 independent connections reserve slots')
  await close()
  await a.query('BEGIN');await insert(a);await a.query('ROLLBACK');assert.equal(await used(),0)
  console.info('PASS explicit rollback: reservation and media audit both rolled back')
 } finally {await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release()}
} finally {
 await pool.end()
 await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
 for(const prefix of ['salon_pro_public_','salon_pro_runtime_'])await admin.query(`DROP ROLE IF EXISTS ${prefix}${roleSuffix}`)
 await admin.end()
}
