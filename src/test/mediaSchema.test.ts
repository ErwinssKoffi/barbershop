import { beforeEach, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'
import { MEDIA_SQL } from '../../server/mediaSchema'
import { defaultTenantId, withTenantClient } from '../../server/tenantContext'
import { originalMediaKey, variantMediaKey } from '../domain/media'
import type { SqlClientLike, SqlPoolLike } from '../../server/neonClient'

let pool: SqlPoolLike
let a: string
let b: string
let pa: string
let pb: string
const digest='a'.repeat(64)
const tables=['salon_media','salon_media_variants','salon_public_media_projection','salon_media_events']
async function role<T>(name: 'media'|'public',tenant: string,work: (db: SqlClientLike) => Promise<T>) {
  const db=await pool.connect()
  try {
    await db.query('BEGIN')
    await db.query("SELECT set_config('role',$1 || substr(md5(current_schema()),1,12),true)",[`salon_pro_${name}_`])
    await db.query("SELECT set_config('app.tenant_id',$1,true)",[tenant])
    const result=await work(db); await db.query('COMMIT'); return result
  } catch(error) { await db.query('ROLLBACK'); throw error } finally { db.release() }
}
async function asset(tenant=a,profile=pa) {
  const id=crypto.randomUUID()
  await withTenantClient(pool,tenant,db => db.query(`INSERT INTO salon_media(tenant_id,id,profile_id,purpose,original_key,declared_mime,declared_bytes,upload_expires_at)
    VALUES($1,$2,$3,'gallery',$4,'image/png',100,now()+interval '1 hour')`,[tenant,id,profile,originalMediaKey(tenant,id)]))
  return id
}
async function variant(media: string,tenant=a,profile=pa) {
  const id=crypto.randomUUID()
  await role('media',tenant,db => db.query(`INSERT INTO salon_media_variants(tenant_id,id,profile_id,media_id,object_key,mime,byte_size,width,height,sha256)
    VALUES($1,$2,$3,$4,$5,'image/webp',50,20,10,$6)`,[tenant,id,profile,media,variantMediaKey(tenant,media,id),digest]))
  return id
}
async function ready(media: string,tenant=a,profile=pa) {
  await role('media',tenant,db => db.query("UPDATE salon_media SET state='processing' WHERE id=$1",[media]))
  const id=await variant(media,tenant,profile)
  await role('media',tenant,db => db.query("UPDATE salon_media SET state='ready',actual_mime='image/png',actual_bytes=100,width=40,height=20,sha256=$2 WHERE id=$1",[media,digest]))
  return id
}
async function publish(media: string,optimized: string,tenant=a,profile=pa,purpose='gallery',position=0) {
  return pool.query(`INSERT INTO salon_public_media_projection(tenant_id,profile_id,media_id,variant_id,purpose,sort_order,alt_text,renderable,revision)
    VALUES($1,$2,$3,$4,$5,$6,'Image publiée de recette',true,1) RETURNING id`,[tenant,profile,media,optimized,purpose,position])
}
beforeEach(async () => {
  pool=createPostgresTestPool().pool
  await runMigrations(pool)
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
  await runMigrations(pool,{includeMedia:true})
  a=await defaultTenantId(pool)
  b=(await pool.query<{ id: string }>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[a])).rows[0].id
  for (const [tenant,slug] of [[a,'profil-a'],[b,'profil-b']]) {
    const id=(await pool.query<{ id: string }>('INSERT INTO salon_public_profiles(tenant_id) VALUES($1) RETURNING id',[tenant])).rows[0].id
    if (tenant===a) pa=id; else pb=id
    await pool.query("INSERT INTO salon_public_visibility(tenant_id,profile_id,published,allowed_from,allowed_until) VALUES($1,$2,true,now()-interval '1 day',now()+interval '1 day')",[tenant,id])
    await pool.query("INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision) VALUES($1,$2,$3,'Salon de recette','','Ville','',1)",[tenant,id,slug])
  }
})
it('012 implique 009 seulement, sans seed ni opération objet, export identique et réexécution sûre',async () => {
  expect((await pool.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(row => row.id)).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','009_marketplace_profiles','012_marketplace_media'])
  for (const table of tables) expect((await pool.query(`SELECT * FROM ${table}`)).rows).toEqual([])
  await runMigrations(pool,{includeMedia:true})
  expect((await pool.query('SELECT id FROM schema_migrations')).rows).toHaveLength(7)
  expect(readFileSync('supabase/optional/012_marketplace_media.sql','utf8')).toBe(MEDIA_SQL.trim()+'\n')
})
it('isole les médias par tenant, FK cross-tenant refusées, aucun worker hors contexte',async () => {
  await asset(); await asset(b,pb)
  expect((await withTenantClient(pool,a,db => db.query('SELECT * FROM salon_media'))).rows).toHaveLength(1)
  expect((await role('media',a,db => db.query("UPDATE salon_media SET state='deleted' WHERE tenant_id=$1",[b]))).rowCount).toBe(0)
  await expect(asset(a,pb)).rejects.toThrow(/foreign key/i)
  expect((await role('media','',db => db.query('SELECT * FROM salon_media'))).rows).toEqual([])
  const rls=await pool.query<{ relforcerowsecurity: boolean }>('SELECT relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[])',[tables])
  expect(rls.rows).toHaveLength(4); expect(rls.rows.every(row => row.relforcerowsecurity)).toBe(true)
})
it('runtime ne peut pas simuler ready, créer variante, modifier chemin ou publier',async () => {
  const id=await asset()
  for (const sql of ["UPDATE salon_media SET state='ready'","UPDATE salon_media SET original_key='forged'",'DELETE FROM salon_media','DELETE FROM salon_media_variants','DELETE FROM salon_public_media_projection']) {
    await expect(withTenantClient(pool,a,db => db.query(sql))).rejects.toThrow(/permission denied/i)
  }
  await expect(withTenantClient(pool,a,db => db.query(`INSERT INTO salon_media(tenant_id,profile_id,purpose,original_key,declared_mime,declared_bytes,upload_expires_at,state)
    VALUES($1,$2,'gallery','bad','image/png',100,now()+interval '1 hour','processing')`,[a,pa]))).rejects.toThrow()
  await withTenantClient(pool,a,db => db.query("UPDATE salon_media SET alt_text='Brouillon',credit_text='Auteur' WHERE id=$1",[id]))
  await expect(role('media',a,db => db.query('SELECT * FROM revenues'))).rejects.toThrow(/permission denied/i)
})
it('cycle SQL : processing avant variante, ready exige preuves et variante, pas de résurrection',async () => {
  const id=await asset()
  await expect(variant(id)).rejects.toThrow(/processing/i)
  await expect(role('media',a,db => db.query("UPDATE salon_media SET state='ready' WHERE id=$1",[id]))).rejects.toThrow(/transition/i)
  await role('media',a,db => db.query("UPDATE salon_media SET state='processing' WHERE id=$1",[id]))
  await expect(role('media',a,db => db.query("UPDATE salon_media SET state='ready' WHERE id=$1",[id]))).rejects.toThrow(/variant/i)
  await variant(id)
  await expect(role('media',a,db => db.query("UPDATE salon_media SET state='ready' WHERE id=$1",[id]))).rejects.toThrow(/check/i)
  await role('media',a,db => db.query("UPDATE salon_media SET state='ready',actual_mime='image/png',actual_bytes=100,width=40,height=20,sha256=$2 WHERE id=$1",[id,digest]))
  await expect(role('media',a,db => db.query('UPDATE salon_media SET width=99 WHERE id=$1',[id]))).rejects.toThrow(/immutable/i)
  await role('media',a,db => db.query("UPDATE salon_media SET state='deleted' WHERE id=$1",[id]))
  await expect(role('media',a,db => db.query("UPDATE salon_media SET state='processing' WHERE id=$1",[id]))).rejects.toThrow(/transition/i)
})
it('seules variantes optimisées ready publiables ; dimensions dérivées, original privé',async () => {
  const id=await asset()
  await role('media',a,db => db.query("UPDATE salon_media SET state='processing' WHERE id=$1",[id]))
  const v=await variant(id)
  await expect(publish(id,v)).rejects.toThrow(/ready/i)
  await role('media',a,db => db.query("UPDATE salon_media SET state='ready',actual_mime='image/png',actual_bytes=100,width=40,height=20,sha256=$2 WHERE id=$1",[id,digest]))
  await publish(id,v)
  const rows=(await role('public',a,db => db.query<{ width: number; height: number; mime: string }>('SELECT width,height,mime FROM salon_public_media_projection'))).rows
  expect(rows).toEqual([{width:20,height:10,mime:'image/webp'}])
  for (const table of ['salon_media','salon_media_variants','salon_public_profiles','employees']) await expect(role('public',a,db => db.query(`SELECT * FROM ${table}`))).rejects.toThrow(/permission denied/i)
})
it('suppression logique ferme la projection ; purge variante seulement après fermeture et jamais annulable',async () => {
  const id=await asset(); const v=await ready(id); await publish(id,v)
  await expect(role('media',a,db => db.query('UPDATE salon_media_variants SET purged_at=now() WHERE id=$1',[v]))).rejects.toThrow(/Close media/i)
  await role('media',a,db => db.query("UPDATE salon_media SET state='deleted' WHERE id=$1",[id]))
  expect((await role('public',a,db => db.query('SELECT * FROM salon_public_media_projection'))).rows).toHaveLength(0)
  await role('media',a,db => db.query('UPDATE salon_media_variants SET purged_at=now() WHERE id=$1',[v]))
  await expect(role('media',a,db => db.query('UPDATE salon_media_variants SET purged_at=NULL WHERE id=$1',[v]))).rejects.toThrow(/restored/i)
  await pool.query('UPDATE salon_public_media_projection SET renderable=true')
  expect((await role('public',a,db => db.query('SELECT * FROM salon_public_media_projection'))).rows).toHaveLength(0)
})
it('FK variantes cross-tenant, chemins et formats invalides rejetés',async () => {
  const id=await asset(); const v=await ready(id)
  await expect(publish(id,v,b,pb)).rejects.toThrow()
  const other=crypto.randomUUID()
  await expect(withTenantClient(pool,a,db => db.query(`INSERT INTO salon_media(tenant_id,id,profile_id,purpose,original_key,declared_mime,declared_bytes,upload_expires_at)
    VALUES($1,$2,$3,'gallery','https://untrusted.invalid/image','image/png',100,now()+interval '1 hour')`,[a,other,pa]))).rejects.toThrow(/check/i)
  await expect(pool.query("UPDATE salon_media SET declared_mime='image/svg+xml' WHERE id=$1",[id])).rejects.toThrow()
  await expect(pool.query("UPDATE salon_media_variants SET object_key='elsewhere' WHERE id=$1",[v])).rejects.toThrow(/immutable/i)
})
it('dépublication, expiration et suspension masquent les médias ; un seul logo/couverture',async () => {
  const first=await asset(); const v1=await ready(first); await publish(first,v1,a,pa,'cover',0)
  const second=await asset(); const v2=await ready(second)
  await expect(publish(second,v2,a,pa,'cover',1)).rejects.toThrow(/unique/i)
  await publish(second,v2,a,pa,'gallery',1)
  await pool.query('UPDATE salon_public_visibility SET published=false WHERE tenant_id=$1',[a])
  expect((await role('public',a,db => db.query('SELECT * FROM salon_public_media_projection'))).rows).toHaveLength(0)
  await pool.query("UPDATE salon_public_visibility SET published=true,allowed_from=now()-interval '2 days',allowed_until=now()-interval '1 day' WHERE tenant_id=$1",[a])
  expect((await role('public',a,db => db.query('SELECT * FROM salon_public_media_projection'))).rows).toHaveLength(0)
  await pool.query("UPDATE salon_public_visibility SET allowed_from=now()-interval '1 day',allowed_until=now()+interval '1 day' WHERE tenant_id=$1",[a])
  await pool.query("UPDATE tenants SET status='suspended' WHERE id=$1",[a])
  expect((await role('public',a,db => db.query('SELECT * FROM salon_public_media_projection'))).rows).toHaveLength(0)
})
it('defaults grants navigateur révoqués et worker NOLOGIN sans héritage ni accès public',async () => {
  const worker=(await pool.query<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean; rolinherit: boolean }>("SELECT rolcanlogin,rolbypassrls,rolsuper,rolinherit FROM pg_roles WHERE rolname='salon_pro_media_' || substr(md5(current_schema()),1,12)")).rows[0]
  expect(worker).toEqual({rolcanlogin:false,rolbypassrls:false,rolsuper:false,rolinherit:false})
  await expect(role('media',a,db => db.query('SELECT * FROM salon_public_media_projection'))).rejects.toThrow(/permission denied/i)
  for (const browser of ['anon','authenticated']) {
    for (const table of tables) expect((await pool.query<{ allowed: boolean }>("SELECT has_table_privilege($1,$2,'SELECT') AS allowed",[browser,table])).rows[0].allowed).toBe(false)
    for (const fn of ['validate_media_lifecycle()','validate_media_variant_insert()','protect_media_variant()','derive_public_media_renderable()','close_public_media()','record_media_lifecycle_event()','protect_media_event()']) expect((await pool.query<{ allowed: boolean }>("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",[browser,fn])).rows[0].allowed).toBe(false)
  }
})
it('échec 012 annule DDL et rôle worker sans retirer 009 ; rôle préexistant refusé',async () => {
  const isolated=createPostgresTestPool().pool
  await runMigrations(isolated,{includeMarketplace:true})
  const broken: SqlPoolLike={...isolated,connect:async () => {
    const db=await isolated.connect()
    return {...db,query:<R>(text: string, values?: unknown[]) => db.query<R>(text===MEDIA_SQL ? text+'\nSELECT absent_media_function();' : text,values)}
  }}
  await expect(runMigrations(broken,{includeMedia:true})).rejects.toThrow(/absent_media_function/)
  expect((await isolated.query("SELECT to_regclass('salon_media') AS name")).rows[0].name).toBeNull()
  expect((await isolated.query("SELECT rolname FROM pg_roles WHERE rolname='salon_pro_media_' || substr(md5(current_schema()),1,12)")).rows).toEqual([])
  await isolated.query("DO $role$ BEGIN EXECUTE format('CREATE ROLE %I NOLOGIN','salon_pro_media_' || substr(md5(current_schema()),1,12)); END $role$")
  await expect(runMigrations(isolated,{includeMedia:true})).rejects.toThrow(/already exists/i)
})
it('journal transactionnel immuable, isolé et sans privilège écriture runtime/worker',async () => {
  const id=await asset(); await ready(id)
  const events=await role('media',a,db => db.query<{ from_state: string | null; to_state: string; actor_db_role: string }>('SELECT from_state,to_state,actor_db_role FROM salon_media_events WHERE media_id=$1 ORDER BY at',[id]))
  expect(events.rows.map(row => [row.from_state,row.to_state])).toEqual([[null,'pending'],['pending','processing'],['processing','ready']])
  expect(events.rows[0].actor_db_role).toMatch(/^salon_pro_runtime_/)
  expect(events.rows[1].actor_db_role).toMatch(/^salon_pro_media_/)
  expect((await role('media',b,db => db.query('SELECT * FROM salon_media_events'))).rows).toEqual([])
  await expect(role('media',a,db => db.query('DELETE FROM salon_media_events'))).rejects.toThrow(/permission denied/i)
  await expect(withTenantClient(pool,a,db => db.query('DELETE FROM salon_media_events'))).rejects.toThrow(/permission denied/i)
  await expect(pool.query("UPDATE salon_media_events SET to_state='deleted'")).rejects.toThrow(/immutable/i)
  await expect(role('media',a,db => db.query("UPDATE salon_media SET state='pending' WHERE id=$1",[id]))).rejects.toThrow(/transition/i)
  expect((await pool.query('SELECT * FROM salon_media_events WHERE media_id=$1',[id])).rows).toHaveLength(3)
})
