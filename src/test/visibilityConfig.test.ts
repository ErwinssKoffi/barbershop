import { withTenantClient } from '../../server/tenantContext'
import { readFileSync } from 'node:fs'
import { createPostgresTestPool } from './postgresTestPool'
import { VISIBILITY_EDITOR_SQL } from '../../server/visibilityEditorSchema'
import type { SqlPoolLike } from '../../server/neonClient'
import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { saveVisibilityDraft } from '../../server/visibility'
import { readVisibilityConfig,saveVisibilityConfig } from '../../server/visibilityConfig'
import { emptyVisibilityWeek } from '../domain/visibilityConfig'
import { apiTestClient } from './apiTestClient'
let c:Awaited<ReturnType<typeof setup>>
const command=()=>({expectedVersion:1,services:[{serviceId:'service-quote',variantId:null}],weekly:emptyVisibilityWeek().map(d=>d.isoWeekday===1?{...d,windows:[{startMinute:540,endMinute:720}]}:d),exceptions:[{localDate:'2026-12-25',windows:[]}]})
beforeEach(async()=>{
 vi.stubEnv('SALON_VISIBILITY_ENABLED','true');c=await setup(false)
 await runMigrations(c.pool,{includeVisibilityEditor:true})
 await saveVisibilityDraft(c.pool,c.tenant,c.actorId,{displayName:'Profil',description:'',city:'Abidjan',commune:'',publicPhone:null,expectedVersion:0})
})
afterEach(()=>vi.unstubAllEnvs())
it('lecture et sauvegarde véritables, catalogue authentique, horaires multiranges et audit sans finance',async()=>{
 const before=await c.financialState()
 const initial=await readVisibilityConfig(c.pool,c.tenant,c.actorId,{})
 expect(initial.config.timezone).toBe('Africa/Abidjan');expect(initial.config.services).toEqual([])
 expect(initial.config.offers).toEqual(expect.arrayContaining([expect.objectContaining({serviceId:'service-quote',priceXof:3000}),expect.objectContaining({variantId:'variant-long',priceXof:4500})]))
 const saved=await saveVisibilityConfig(c.pool,c.tenant,c.actorId,command())
 expect(saved.config).toMatchObject({...command(),expectedVersion:2})
 expect((await c.pool.query('SELECT profile_version FROM salon_public_profile_events ORDER BY profile_version')).rows).toEqual([{profile_version:1},{profile_version:2}])
 expect(await c.financialState()).toEqual(before)
})
it('désélection préserve copie publiée et notes privées des exceptions retenues',async()=>{
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,command())
 const profile=(await c.pool.query<{id:string}>('SELECT id FROM salon_public_profiles')).rows[0].id
 const service=(await c.pool.query<{id:string}>('SELECT id FROM salon_public_services')).rows[0].id
 const stamp=(await c.pool.query<{updated_at:string}>("SELECT updated_at FROM services_catalog WHERE id='service-quote'")).rows[0].updated_at
 await c.pool.query('INSERT INTO salon_public_visibility(tenant_id,profile_id) VALUES($1,$2)',[c.tenant,profile])
 await c.pool.query("INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision) VALUES($1,$2,'profil-test','Profil','','Abidjan','',1)",[c.tenant,profile])
 await c.pool.query("INSERT INTO salon_public_service_projection(tenant_id,id,profile_id,source_service_id,source_updated_at,source_available,display_name,description,price_xof,duration_minutes,booking_requested,revision) VALUES($1,$2,$3,'service-quote',$4,true,'Publié','',3000,30,false,1)",[c.tenant,service,profile,stamp])
 await c.pool.query("UPDATE schedule_exceptions SET private_note='Note confidentielle'")
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,{...command(),expectedVersion:2,services:[]})
 expect((await c.pool.query('SELECT display_name,revision FROM salon_public_service_projection')).rows).toEqual([{display_name:'Publié',revision:1}])
 expect((await c.pool.query('SELECT private_note FROM schedule_exceptions')).rows).toEqual([{private_note:'Note confidentielle'}])
 expect(JSON.stringify(await readVisibilityConfig(c.pool,c.tenant,c.actorId,{}))).not.toContain('Note confidentielle')
})
it('API authentifiée Gérant, version partagée profil et valeurs injectées refusées',async()=>{
 expect((await apiTestClient(c.pool,'POST','/api/visibility/config/read',{})).status).toBe(401)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/config/save',command(),c.cashier)).status).toBe(403)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/config/save',command(),c.manager)).status).toBe(200)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/config/save',command(),c.manager)).status).toBe(409)
 await expect(saveVisibilityConfig(c.pool,c.tenant,c.actorId,{...command(),expectedVersion:2,services:[{serviceId:'service-quote',variantId:null,priceXof:1}]})).rejects.toMatchObject({status:400})
})
it('sources inactives/variante inconnue/tenant étranger refusés sans changement',async()=>{
 await expect(saveVisibilityConfig(c.pool,c.tenant,c.actorId,{...command(),services:[{serviceId:'service-quote',variantId:'missing'}]})).rejects.toMatchObject({status:409})
 await c.pool.query('UPDATE services_catalog SET is_active=false')
 await expect(saveVisibilityConfig(c.pool,c.tenant,c.actorId,command())).rejects.toMatchObject({status:409})
 const b=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 await expect(readVisibilityConfig(c.pool,b,c.actorId,{})).rejects.toMatchObject({status:403})
 expect((await c.pool.query('SELECT version FROM salon_public_profiles')).rows[0].version).toBe(1)
})
it('échec audit annule sélection, horaires, exceptions et version',async()=>{
 await c.pool.query("CREATE FUNCTION fail_config_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_config BEFORE INSERT ON salon_public_profile_events FOR EACH ROW EXECUTE FUNCTION fail_config_event()")
 await expect(saveVisibilityConfig(c.pool,c.tenant,c.actorId,command())).rejects.toThrow(/audit failed/)
 for(const table of ['salon_service_selections','salon_public_services','salon_opening_hours','schedule_exceptions'])expect((await c.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([])
 expect((await c.pool.query('SELECT version FROM salon_public_profiles')).rows[0].version).toBe(1)
})
it('retirer une exception restaure semaine type ; migration 017 absente explicite',async()=>{
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,command())
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,{...command(),expectedVersion:2,exceptions:[]})
 expect((await c.pool.query('SELECT * FROM schedule_exceptions')).rows).toEqual([])
 await c.pool.query('DROP TABLE salon_service_selections')
 await expect(readVisibilityConfig(c.pool,c.tenant,c.actorId,{})).rejects.toMatchObject({code:'VISIBILITY_EDITOR_MIGRATION_REQUIRED'})
})

it('017 export exact, réexécution sûre, RLS/FK et lecteur public sans sélection privée',async()=>{
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,command())
 await runMigrations(c.pool,{includeVisibilityEditor:true})
 expect(readFileSync('supabase/optional/017_visibility_editor.sql','utf8')).toBe(VISIBILITY_EDITOR_SQL.trim()+'\n')
 const b=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 expect((await withTenantClient(c.pool,b,db=>db.query('SELECT * FROM salon_service_selections'))).rows).toEqual([])
 const profile=(await c.pool.query<{id:string}>('INSERT INTO salon_public_profiles(tenant_id) VALUES($1) RETURNING id',[b])).rows[0].id
 const service=(await c.pool.query<{id:string}>('SELECT id FROM salon_public_services')).rows[0].id
 await expect(c.pool.query('INSERT INTO salon_service_selections(tenant_id,profile_id,service_id) VALUES($1,$2,$3)',[b,profile,service])).rejects.toThrow(/foreign key/i)
 expect((await c.pool.query<{forced:boolean}>("SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname='salon_service_selections'")).rows[0].forced).toBe(true)
 const reader=(await c.pool.query<{name:string}>("SELECT 'salon_pro_public_' || substr(md5(current_schema()),1,12) AS name")).rows[0].name
 expect((await c.pool.query<{ok:boolean}>("SELECT has_table_privilege($1,'salon_service_selections','SELECT') AS ok",[reader])).rows[0].ok).toBe(false)
})
it('échec DDL 017 annule table et contrainte ajoutée, sans retirer 011 préexistante',async()=>{
 const pool=createPostgresTestPool().pool
 await runMigrations(pool,{includePublicCatalog:true})
 const broken:SqlPoolLike={...pool,connect:async()=>{const db=await pool.connect();return {...db,query:<R>(sql:string,values?:unknown[])=>db.query<R>(sql===VISIBILITY_EDITOR_SQL?sql+'\nSELECT absent_editor_function();':sql,values)}}}
 await expect(runMigrations(broken,{includeVisibilityEditor:true})).rejects.toThrow(/absent_editor_function/)
 expect((await pool.query("SELECT to_regclass('salon_service_selections') AS name")).rows[0].name).toBeNull()
 expect((await pool.query("SELECT conname FROM pg_constraint WHERE conname='service_selection_profile_key'")).rows).toEqual([])
})
