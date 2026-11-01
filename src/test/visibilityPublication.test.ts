import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { saveVisibilityDraft } from '../../server/visibility'
import { readVisibilityPublication,unpublishVisibility } from '../../server/visibilityPublication'
import { VISIBILITY_PUBLICATION_SQL } from '../../server/visibilityPublicationSchema'
import { withTenantClient } from '../../server/tenantContext'
import { apiTestClient } from './apiTestClient'
import { createPostgresTestPool } from './postgresTestPool'
import type { SqlPoolLike } from '../../server/neonClient'
let c:Awaited<ReturnType<typeof setup>>
let profile:string
async function published() {
 await c.pool.query("INSERT INTO salon_public_visibility(tenant_id,profile_id,published,allowed_from,allowed_until) VALUES($1,$2,true,now()-interval '1 day',now()+interval '1 day')",[c.tenant,profile])
 await c.pool.query("INSERT INTO salon_public_projection(tenant_id,profile_id,slug,display_name,description,city,commune,revision) VALUES($1,$2,'profil-recette','Profil','','Abidjan','',1)",[c.tenant,profile])
}
async function visiblePublicRows(){
 const db=await c.pool.connect()
 try {
  await db.query('BEGIN READ ONLY')
  await db.query("SELECT set_config('role','salon_pro_public_' || substr(md5(current_schema()),1,12),true)")
  const rows=(await db.query('SELECT * FROM salon_public_projection')).rows
  await db.query('COMMIT');return rows
 } catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
}
beforeEach(async()=>{
 vi.stubEnv('SALON_VISIBILITY_ENABLED','true');c=await setup(false)
 await c.pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
 await runMigrations(c.pool,{includeProfileDetails:true,includeVisibilityPublication:true})
 profile=(await saveVisibilityDraft(c.pool,c.tenant,c.actorId,{displayName:'Profil',description:'',city:'Abidjan',commune:'',publicPhone:null,expectedVersion:0})).draft!.id
})
afterEach(()=>vi.unstubAllEnvs())
it('état gate exact, publication toujours fermée même avec profil valide',async()=>{
 expect((await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status).toMatchObject({visibility:'not_visible',canPublish:false,publicationRequested:false})
 await published()
 expect((await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status).toMatchObject({visibility:'visible',canPublish:false,publicationRequested:true,publishedRevision:1})
 await c.pool.query("UPDATE salon_public_visibility SET allowed_until=now()-interval '1 hour',allowed_from=now()-interval '2 days'")
 expect((await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status.visibility).toBe('not_visible')
})
it('dépublication réelle ferme gate, version et événement atomiques, copie/historique/finance conservés',async()=>{
 await published();expect(await visiblePublicRows()).toHaveLength(1);const before=await c.financialState()
 expect((await unpublishVisibility(c.pool,c.tenant,c.actorId,{expectedVersion:1})).result).toEqual({version:2,changed:true})
 expect((await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status).toMatchObject({visibility:'not_visible',publicationRequested:false,version:2,publishedRevision:1})
 expect((await c.pool.query('SELECT * FROM salon_public_projection')).rows).toHaveLength(1)
 expect(await visiblePublicRows()).toHaveLength(0)
 expect((await c.pool.query("SELECT event_type FROM salon_public_profile_events WHERE event_type='unpublished'")).rows).toHaveLength(1)
 expect(await c.financialState()).toEqual(before)
 expect((await unpublishVisibility(c.pool,c.tenant,c.actorId,{expectedVersion:2})).result).toEqual({version:2,changed:false})
 await expect(unpublishVisibility(c.pool,c.tenant,c.actorId,{expectedVersion:1})).rejects.toMatchObject({status:409})
})
it('session, POST, origine et Gérant requis ; aucun endpoint publish',async()=>{
 await published()
 expect((await apiTestClient(c.pool,'POST','/api/visibility/publication/read',{})).status).toBe(401)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/publication/unpublish',{expectedVersion:1},c.cashier)).status).toBe(403)
 expect((await apiTestClient(c.pool,'GET','/api/visibility/publication/read',{},c.manager)).status).toBe(405)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/publication/unpublish',{expectedVersion:1},c.manager,{host:'erp.invalid',origin:'https://foreign.invalid'})).status).toBe(403)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/publication/unpublish',{expectedVersion:1},c.manager)).status).toBe(200)
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query('UPDATE salon_public_visibility SET published=true'))).rejects.toThrow(/permission denied/i)
})
it('fonction étroite refuse acteur Caissier/cross-tenant ; EXECUTE navigateur révoqué',async()=>{
 await published()
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query('SELECT * FROM unpublish_salon_profile($1,1)',[c.cashierId]))).rejects.toThrow(/manager/i)
 const b=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 await expect(withTenantClient(c.pool,b,db=>db.query('SELECT * FROM unpublish_salon_profile($1,1)',[c.actorId]))).rejects.toThrow(/manager/i)
 for(const name of ['anon','authenticated'])expect((await c.pool.query<{ok:boolean}>("SELECT has_function_privilege($1,'unpublish_salon_profile(text,integer)','EXECUTE') AS ok",[name])).rows[0].ok).toBe(false)
 expect(readFileSync('supabase/optional/018_visibility_unpublish.sql','utf8')).toBe(VISIBILITY_PUBLICATION_SQL.trim()+'\n')
 await runMigrations(c.pool,{includeVisibilityPublication:true})
})
it('échec audit annule fermeture et version ; migration absente explicite',async()=>{
 await published()
 await c.pool.query("CREATE FUNCTION fail_unpublish_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_unpublish BEFORE INSERT ON salon_public_profile_events FOR EACH ROW EXECUTE FUNCTION fail_unpublish_audit()")
 await expect(unpublishVisibility(c.pool,c.tenant,c.actorId,{expectedVersion:1})).rejects.toThrow(/audit failed/)
 expect((await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status).toMatchObject({visibility:'visible',version:1})
 await c.pool.query('DROP FUNCTION unpublish_salon_profile(TEXT,INTEGER)')
 await expect(unpublishVisibility(c.pool,c.tenant,c.actorId,{expectedVersion:1})).rejects.toMatchObject({code:'VISIBILITY_UNPUBLISH_MIGRATION_REQUIRED'})
})
it('fonction DDL 018 rollback sans retirer 009 préexistante',async()=>{
 const pool=createPostgresTestPool().pool;await runMigrations(pool,{includeMarketplace:true})
 const broken:SqlPoolLike={...pool,connect:async()=>{const db=await pool.connect();return {...db,query:<R>(sql:string,values?:unknown[])=>db.query<R>(sql===VISIBILITY_PUBLICATION_SQL?sql+'\nSELECT absent_unpublish_function();':sql,values)}}}
 await expect(runMigrations(broken,{includeVisibilityPublication:true})).rejects.toThrow(/absent_unpublish_function/)
 expect((await pool.query("SELECT to_regprocedure('unpublish_salon_profile(text,integer)') AS name")).rows[0].name).toBeNull()
})
it('droits absents refusés sans empêcher la dépublication et brouillons préservés',async()=>{
 let status=(await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status
 expect(status.blockers.map(b=>b.code)).toContain('SUBSCRIPTION_MIGRATION_REQUIRED')
 await runMigrations(c.pool,{includeSubscriptions:true})
 status=(await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status
 expect(status.blockers.map(b=>b.code)).toContain('SUBSCRIPTION_PUBLICATION_DENIED')
 expect(status.canPublish).toBe(false)
 await published()
 expect((await unpublishVisibility(c.pool,c.tenant,c.actorId,{expectedVersion:1})).result.changed).toBe(true)
 expect((await c.pool.query('SELECT id FROM salon_public_profiles')).rows).toHaveLength(1)
})
