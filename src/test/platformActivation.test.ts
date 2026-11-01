import { createPostgresTestPool } from './postgresTestPool'
import type { SqlPoolLike } from '../../server/neonClient'
import { beforeEach,expect,it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { runPlatformActivation,parsePlatformActivation } from '../../server/platformActivation'
import { PLATFORM_ACTIVATION_SQL } from '../../server/platformActivationSchema'
import { ESSENTIEL_V1 } from '../domain/subscriptions'
let c:Awaited<ReturnType<typeof setup>>
const role='salon_pro_platform_'+createHash('md5').update('public').digest('hex').slice(0,12)
let owner:string
const command=()=>({activationKey:crypto.randomUUID(),tenantId:c.tenant,billingAnchorAt:'2027-01-31T10:00:00.000Z',periodIndex:0,evidenceNamespace:'verified-bank',externalReference:crypto.randomUUID(),evidenceReference:'restricted-case-reference',verificationReason:'External receipt reviewed by operator',verifiedAmountXof:4900,externalVerificationConfirmed:true})
async function operator<T>(work:()=>Promise<T>){
 await c.pool.query('SET SESSION AUTHORIZATION platform_fixture')
 try{return await work()}finally{await c.pool.query(`SET SESSION AUTHORIZATION "${owner.replaceAll('"','""')}"`)}
}
beforeEach(async()=>{
 c=await setup(false);owner=(await c.pool.query<{name:string}>('SELECT session_user AS name')).rows[0].name
 await c.pool.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated')
 await runMigrations(c.pool,{includePlatformActivation:true})
 await c.pool.query(`CREATE ROLE platform_fixture LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION NOINHERIT; GRANT "${role}" TO platform_fixture`)
})
it('020 sans auto-activation, export exact, aperçu sans écritures',async()=>{
 expect(readFileSync('supabase/optional/020_platform_activation.sql','utf8')).toBe(PLATFORM_ACTIVATION_SQL.trim()+'\n')
 const result=await operator(()=>runPlatformActivation(c.pool,command(),false,'public'))
 expect(result).toMatchObject({outcome:'preview',endsAt:'2027-02-28T10:00:00+00:00',graceEndsAt:'2027-03-03T10:00:00+00:00'})
 for(const table of ['saas_plans','tenant_subscriptions','platform_activation_receipts'])expect((await c.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([])
 await runMigrations(c.pool,{includePlatformActivation:true})
})
it('activation authentifiée, vrai acteur DB, offre exacte et replay sans doublon ni finance',async()=>{
 const input=command(),before=await c.financialState()
 expect((await operator(()=>runPlatformActivation(c.pool,input,true,'public'))).outcome).toBe('activated')
 expect((await operator(()=>runPlatformActivation(c.pool,input,true,'public'))).outcome).toBe('replayed')
 expect((await c.pool.query('SELECT operator_reference FROM tenant_subscriptions')).rows).toEqual([{operator_reference:'platform_fixture'}])
 expect((await c.pool.query('SELECT entitlements FROM saas_plans')).rows[0].entitlements).toEqual(ESSENTIEL_V1.entitlements)
 expect((await c.pool.query('SELECT verified_by FROM platform_activation_receipts')).rows).toEqual([{verified_by:'platform_fixture'}])
 expect((await c.pool.query('SELECT * FROM subscription_events')).rows).toHaveLength(1)
 expect(await c.financialState()).toEqual(before)
})
it('propriétaire/migration refusé, faux montant/acteur/champs refusés',async()=>{
 await expect(runPlatformActivation(c.pool,command(),true,'public')).rejects.toThrow(/restricted platform login/i)
 expect(()=>parsePlatformActivation({...command(),operatorReference:'forged'})).toThrow()
 expect(()=>parsePlatformActivation({...command(),verifiedAmountXof:1})).toThrow()
 await expect(operator(()=>runPlatformActivation(c.pool,{...command(),externalVerificationConfirmed:false},true,'public'))).rejects.toThrow(/attestation/i)
})
it('révocation du rôle immédiate, aucune lecture/écriture directe de finance ou preuve',async()=>{
 await operator(async()=>{
  await expect(c.pool.query('SELECT * FROM revenues')).rejects.toThrow(/permission denied/i)
  await expect(c.pool.query('SELECT * FROM platform_activation_receipts')).rejects.toThrow(/permission denied/i)
 })
 await c.pool.query(`REVOKE "${role}" FROM platform_fixture`)
 await expect(operator(()=>runPlatformActivation(c.pool,command(),true,'public'))).rejects.toThrow(/permission denied/i)
 for(const browser of ['anon','authenticated'])expect((await c.pool.query<{ok:boolean}>("SELECT has_function_privilege($1,'activate_essential_subscription(jsonb,boolean)','EXECUTE') AS ok",[browser])).rows[0].ok).toBe(false)
})
it('clé modifiée, période chevauchante et réutilisation de référence externe refusées',async()=>{
 const input=command();await operator(()=>runPlatformActivation(c.pool,input,true,'public'))
 await expect(operator(()=>runPlatformActivation(c.pool,{...input,verificationReason:'Changed'},true,'public'))).rejects.toThrow(/key conflict/i)
 await expect(operator(()=>runPlatformActivation(c.pool,{...command()},true,'public'))).rejects.toThrow(/Overlapping/i)
 const b=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 await expect(operator(()=>runPlatformActivation(c.pool,{...input,activationKey:crypto.randomUUID(),tenantId:b},true,'public'))).rejects.toThrow(/reused external/i)
})
it('échec audit annule même l’installation du plan et le reçu',async()=>{
 await c.pool.query("CREATE FUNCTION fail_platform_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER fail_platform BEFORE INSERT ON subscription_events FOR EACH ROW EXECUTE FUNCTION fail_platform_audit()")
 await expect(operator(()=>runPlatformActivation(c.pool,command(),true,'public'))).rejects.toThrow(/audit failed/)
 for(const table of ['saas_plans','tenant_subscriptions','platform_activation_receipts'])expect((await c.pool.query(`SELECT * FROM ${table}`)).rows).toEqual([])
})
it('heure locale ambiguë refusée, opérateur sans droit de choisir l’échéance',async()=>{
 await c.pool.query("UPDATE tenants SET timezone='Europe/Paris' WHERE id=$1",[c.tenant])
 await expect(operator(()=>runPlatformActivation(c.pool,{...command(),billingAnchorAt:'2026-08-25T00:30:00.000Z',periodIndex:1},false,'public'))).rejects.toThrow(/Ambiguous/i)
})

it('échec 020 annule rôle/fonction/reçu sans retirer 019',async()=>{
 const pool=createPostgresTestPool().pool;await runMigrations(pool,{includeSubscriptions:true})
 const broken:SqlPoolLike={...pool,connect:async()=>{const db=await pool.connect();return {...db,query:<R>(sql:string,values?:unknown[])=>db.query<R>(sql===PLATFORM_ACTIVATION_SQL?sql+'\nSELECT absent_activation_function();':sql,values)}}}
 await expect(runMigrations(broken,{includePlatformActivation:true})).rejects.toThrow(/absent_activation_function/)
 expect((await pool.query("SELECT to_regclass('platform_activation_receipts') AS name")).rows[0].name).toBeNull()
 expect((await pool.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[role])).rows).toEqual([])
})
