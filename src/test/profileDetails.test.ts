import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPostgresTestPool } from './postgresTestPool'
import type { SqlPoolLike } from '../../server/neonClient'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { readVisibilityDraft,saveVisibilityDraft } from '../../server/visibility'
import { PROFILE_DETAILS_SQL } from '../../server/profileDetailsSchema'
import { withTenantClient } from '../../server/tenantContext'
import { emptyProfileDetails,parseProfileDetails } from '../domain/profileDetails'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
let c:Awaited<ReturnType<typeof setup>>
const input=()=>({displayName:'Profil de recette',description:'',city:'Abidjan',commune:'',publicPhone:null,expectedVersion:0,details:{...emptyProfileDetails(),slogan:'Slogan',category:'Coiffure',publicAddress:'Adresse publique',whatsapp:'+2250102030405',publicEmail:'contact@example.invalid',website:'https://example.invalid/',instagram:'https://www.instagram.com/profil/'}})
describe('profil détaillé PostgreSQL',()=>{
beforeEach(async()=>{vi.stubEnv('SALON_VISIBILITY_ENABLED','true');c=await setup(false);await c.pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated');await runMigrations(c.pool,{includeProfileDetails:true})})
afterEach(()=>vi.unstubAllEnvs())
it('016 implique uniquement 009, sans seed, export exact et garde backup',async()=>{
  expect((await c.pool.query<{id:string}>('SELECT id FROM schema_migrations ORDER BY id')).rows.map(r=>r.id)).toEqual(['001_baseline','002_auth_security','003_tenancy','004_sessions','005_sync_revisions','009_marketplace_profiles','016_profile_details'])
  expect((await c.pool.query('SELECT * FROM salon_profile_details')).rows).toEqual([])
  expect(readFileSync('supabase/optional/016_profile_details.sql','utf8')).toBe(PROFILE_DETAILS_SQL.trim()+'\n')
  await runMigrations(c.pool,{includeProfileDetails:true})
  expect(()=>marketplaceMigrationOptions(['--include-profile-details'],undefined)).toThrow(/backup/)
  expect(marketplaceMigrationOptions(['--include-profile-details'],'true')).toEqual({includeMarketplace:true,includeProfileDetails:true})
})
it('save/read réels de tous les champs, omission ancienne préservée et effacement explicite',async()=>{
  const before=await c.financialState()
  const saved=await saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())
  expect(saved.draft?.details).toEqual(input().details)
  const {details:omitted,...legacy}=input();expect(omitted.slogan).toBe('Slogan')
  await saveVisibilityDraft(c.pool,c.tenant,c.actorId,{...legacy,expectedVersion:1})
  expect((await readVisibilityDraft(c.pool,c.tenant,c.actorId,{})).draft?.details).toEqual(input().details)
  await saveVisibilityDraft(c.pool,c.tenant,c.actorId,{...input(),expectedVersion:2,details:emptyProfileDetails()})
  expect((await readVisibilityDraft(c.pool,c.tenant,c.actorId,{})).draft?.details).toEqual(emptyProfileDetails())
  expect(await c.financialState()).toEqual(before)
  expect((await c.pool.query('SELECT * FROM salon_public_projection')).rows).toEqual([])
})
it('RLS, FK cross-tenant et grants navigateur/public reader stricts',async()=>{
  const saved=await saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())
  const b=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
  expect((await withTenantClient(c.pool,b,db=>db.query('SELECT * FROM salon_profile_details'))).rows).toEqual([])
  expect((await withTenantClient(c.pool,b,db=>db.query("UPDATE salon_profile_details SET slogan='forged'"))).rowCount).toBe(0)
  await expect(c.pool.query('INSERT INTO salon_profile_details(tenant_id,profile_id) VALUES($1,$2)',[b,saved.draft!.id])).rejects.toThrow(/foreign key/i)
  expect((await c.pool.query<{forced:boolean}>("SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname='salon_profile_details'")).rows[0].forced).toBe(true)
  const reader=(await c.pool.query<{name:string}>("SELECT 'salon_pro_public_' || substr(md5(current_schema()),1,12) AS name")).rows[0].name
  for(const name of ['anon','authenticated',reader]) expect((await c.pool.query<{ok:boolean}>("SELECT has_table_privilege($1,'salon_profile_details','SELECT') AS ok",[name])).rows[0].ok).toBe(false)
})
it('échec audit annule profil et détails atomiquement ; migration absente explicite',async()=>{
  await c.pool.query("CREATE FUNCTION fail_details_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_details BEFORE INSERT ON salon_public_profile_events FOR EACH ROW EXECUTE FUNCTION fail_details_audit()")
  await expect(saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())).rejects.toThrow(/audit failed/)
  expect((await c.pool.query('SELECT * FROM salon_profile_details')).rows).toEqual([])
  expect((await c.pool.query('SELECT * FROM salon_public_profiles')).rows).toEqual([])
  await c.pool.query('DROP TABLE salon_profile_details')
  await expect(readVisibilityDraft(c.pool,c.tenant,c.actorId,{})).rejects.toMatchObject({code:'VISIBILITY_DETAILS_MIGRATION_REQUIRED'})
})
it('validation détails refuse l’injection sans modifier le brouillon',async()=>{
  await saveVisibilityDraft(c.pool,c.tenant,c.actorId,input())
  await expect(saveVisibilityDraft(c.pool,c.tenant,c.actorId,{...input(),expectedVersion:1,details:{...input().details,website:'javascript:alert(1)'}})).rejects.toMatchObject({status:400})
  expect((await readVisibilityDraft(c.pool,c.tenant,c.actorId,{})).draft?.version).toBe(1)
})
})
it('liens normalisés, contacts facultatifs et aucune identité par défaut',()=>{
  expect(parseProfileDetails(emptyProfileDetails())).toEqual(emptyProfileDetails())
  expect(parseProfileDetails({...emptyProfileDetails(),website:'https://EXAMPLE.invalid',slogan:'  Slogan  '})).toMatchObject({website:'https://example.invalid/',slogan:'Slogan'})
})
it.each([
  {website:'http://example.invalid'},{website:'javascript:alert(1)'},{website:'data:text/html,test'},{website:'https://user:password@example.invalid/'},
  {website:'https://example.invalid:8080'},{website:'https://example.invalid/a b'},{website:'https://example.invalid\\evil'},
  {instagram:'https://instagram.com.evil.invalid/'},{facebook:'https://unrelated.invalid/'},{tiktok:'https://tiktok.com@evil.invalid/'},
  {publicEmail:'invalid'},{publicEmail:'a@example.invalid\r\nBcc:x'},{whatsapp:'01020304'},{whatsapp:'+00012345678'},
  {slogan:'a'.repeat(161)},{publicAddress:'a'.repeat(501)},{category:'a'.repeat(121)},{tenantId:'forged'},{slogan:'line\nline'},
])('refuse détails invalides %j',change=>{expect(()=>parseProfileDetails({...emptyProfileDetails(),...change})).toThrow()})

it('rollback DDL 016 préserve 009 déjà appliquée',async()=>{
  const pool=createPostgresTestPool().pool
  await runMigrations(pool,{includeMarketplace:true})
  const broken:SqlPoolLike={...pool,connect:async()=>{
    const db=await pool.connect()
    return {...db,query:<R>(sql:string,values?:unknown[])=>db.query<R>(sql===PROFILE_DETAILS_SQL?sql+'\nSELECT absent_details_function();':sql,values)}
  }}
  await expect(runMigrations(broken,{includeProfileDetails:true})).rejects.toThrow(/absent_details_function/)
  expect((await pool.query("SELECT to_regclass('salon_profile_details') AS name")).rows[0].name).toBeNull()
  expect((await pool.query("SELECT to_regclass('salon_public_profiles') AS name")).rows[0].name).toBe('salon_public_profiles')
})
