import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { readVisibilityDraft,saveVisibilityDraft } from '../../server/visibility'
import { apiTestClient } from './apiTestClient'
import { parseVisibilityDraft } from '../domain/visibility'
let c:Awaited<ReturnType<typeof setup>>
const input=()=>({displayName:'Salon réel de recette',description:'Description',city:'Abidjan',commune:'',publicPhone:null,expectedVersion:0})
beforeEach(async()=>{vi.stubEnv('SALON_VISIBILITY_ENABLED','true');c=await setup(false);await runMigrations(c.pool,{includeProfileDetails:true})})
afterEach(()=>vi.unstubAllEnvs())
it('création, modification versionnée, audit et aucun effet financier/public',async()=>{
  const before=await c.financialState()
  expect(await readVisibilityDraft(c.pool,c.tenant,c.actorId,{})).toEqual({draft:null})
  const first=await saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())
  expect(first.draft).toMatchObject({displayName:input().displayName,version:1,tenantId:c.tenant})
  const second=await saveVisibilityDraft(c.pool,c.tenant,c.actorId,{...input(),expectedVersion:1,city:'Autre ville'})
  expect(second.draft).toMatchObject({version:2,city:'Autre ville'})
  expect((await c.pool.query('SELECT event_type,profile_version FROM salon_public_profile_events ORDER BY profile_version')).rows).toEqual([{event_type:'draft_saved',profile_version:1},{event_type:'draft_saved',profile_version:2}])
  expect((await c.pool.query('SELECT * FROM salon_public_projection')).rows).toEqual([])
  expect(await c.financialState()).toEqual(before)
  await expect(saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())).rejects.toMatchObject({status:409})
})
it('API session/Gérant/POST/origine, read et save effectifs',async()=>{
  expect((await apiTestClient(c.pool,'POST','/api/visibility/read',{})).status).toBe(401)
  expect((await apiTestClient(c.pool,'POST','/api/visibility/save',input(),c.cashier)).status).toBe(403)
  expect((await apiTestClient(c.pool,'GET','/api/visibility/read',{},c.manager)).status).toBe(405)
  expect((await apiTestClient(c.pool,'POST','/api/visibility/save',input(),c.manager,{host:'erp.invalid',origin:'https://other.invalid'})).status).toBe(403)
  expect((await apiTestClient(c.pool,'POST','/api/visibility/save',input(),c.manager)).status).toBe(200)
  const read=await apiTestClient(c.pool,'POST','/api/visibility/read',{},c.manager)
  expect(read.body.draft).toMatchObject({version:1,displayName:input().displayName})
})
it('permission relue et tenant externe refusé sans rattachement bootstrap',async()=>{
  const other=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
  await expect(saveVisibilityDraft(c.pool,other,c.actorId,input())).rejects.toMatchObject({status:403})
  await c.pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[c.tenant,c.actorId])
  await expect(saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())).rejects.toMatchObject({status:403})
})
it('désactivation conservatrice et données non autorisées rejetées',async()=>{
  vi.stubEnv('SALON_VISIBILITY_ENABLED','false')
  await expect(readVisibilityDraft(c.pool,c.tenant,c.actorId,{})).rejects.toMatchObject({code:'VISIBILITY_DISABLED'})
  for(const change of [{tenantId:c.tenant},{published:true},{expectedVersion:-1},{displayName:'a'.repeat(161)},{description:'\u0000'}]) expect(()=>parseVisibilityDraft({...input(),...change})).toThrow()
})
it('absence de 009 retourne une erreur explicite',async()=>{
  await c.pool.query('DROP TABLE salon_profile_details,salon_public_profile_events,salon_public_projection,salon_public_visibility,salon_public_profiles CASCADE')
  await expect(readVisibilityDraft(c.pool,c.tenant,c.actorId,{})).rejects.toMatchObject({code:'VISIBILITY_MIGRATION_REQUIRED'})
})
it('échec audit annule la création du brouillon',async()=>{
  await c.pool.query("CREATE FUNCTION fail_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_draft BEFORE INSERT ON salon_public_profile_events FOR EACH ROW EXECUTE FUNCTION fail_draft_audit()")
  await expect(saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())).rejects.toThrow(/audit failed/)
  expect((await c.pool.query('SELECT * FROM salon_public_profiles')).rows).toEqual([])
})
