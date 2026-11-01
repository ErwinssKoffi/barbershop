import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import sharp from 'sharp'
import { createPostgresTestPool } from './postgresTestPool'
import { runMigrations } from '../../server/migrations'
import { defaultTenantId,withTenantClient } from '../../server/tenantContext'
import { createMemoryMediaTestStorage,type PrivateMediaStorage } from '../../server/mediaStorage'
import { processStoredMedia } from '../../server/processStoredMedia'
import { originalMediaKey } from '../domain/media'
import { ESSENTIEL_V1 } from '../domain/subscriptions'
import type { MediaProcessingPolicy } from '../../server/mediaProcessingPolicy'
import type { SqlPoolLike } from '../../server/neonClient'
const policy:MediaProcessingPolicy={input:{maxBytes:1048576,maxPixels:65536,maxDimension:256},maxOutputBytes:1048576,maxOutputDimension:16,quality:80,wallTimeoutMs:5000}
let pool:SqlPoolLike,tenantId:string,mediaId:string,profileId:string,bytes:Buffer,store:ReturnType<typeof createMemoryMediaTestStorage>
beforeEach(async()=>{
 pool=createPostgresTestPool().pool;await runMigrations(pool,{includePublicAccessEnforcement:true})
 tenantId=await defaultTenantId(pool);mediaId=crypto.randomUUID()
 profileId=(await pool.query<{id:string}>("INSERT INTO salon_public_profiles(tenant_id) VALUES($1) RETURNING id",[tenantId])).rows[0].id
 const p=ESSENTIEL_V1,plan=(await pool.query<{id:string}>('INSERT INTO saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id',[p.code,p.version,p.name,p.priceXof,p.currency,p.periodKind,p.graceSeconds,JSON.stringify(p.entitlements)])).rows[0].id
 await pool.query(`INSERT INTO tenant_subscriptions(tenant_id,plan_id,activation_key,billing_anchor_at,period_index,billing_timezone,starts_at,ends_at,grace_ends_at,amount_xof,external_reference,evidence_reference,operator_reference)
 VALUES($1,$2,$3,date_trunc('month',now()),0,'Africa/Abidjan',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',date_trunc('month',now())+interval '1 month 72 hours',4900,'external-test','private-test-evidence','test-operator')`,[tenantId,plan,crypto.randomUUID()])
 bytes=await sharp({create:{width:32,height:16,channels:3,background:'#245678'}}).png().toBuffer()
 await withTenantClient(pool,tenantId,db=>db.query(`INSERT INTO salon_media(tenant_id,id,profile_id,purpose,original_key,declared_mime,declared_bytes,upload_expires_at) VALUES($1,$2,$3,'gallery',$4,'image/png',$5,now()+interval '1 hour')`,[tenantId,mediaId,profileId,originalMediaKey(tenantId,mediaId),bytes.length]))
 store=createMemoryMediaTestStorage(tenantId,10,1048576);store.putTestOriginal({tenantId,mediaId},bytes)
})
afterEach(()=>vi.unstubAllEnvs())
const scope=()=>({tenantId,mediaId})
it('worker privé décode vraiment, insère variante et preuve puis ready/audit sans publier',async()=>{
 expect(await processStoredMedia(pool,store.storage,scope(),policy)).toMatchObject({outcome:'ready',mediaId,version:3})
 expect((await pool.query('SELECT state,actual_mime,actual_bytes,width,height FROM salon_media')).rows[0]).toMatchObject({state:'ready',actual_mime:'image/png',actual_bytes:bytes.length,width:32,height:16})
 const variant=(await pool.query<{id:string;mime:string;width:number;height:number}>('SELECT id,mime,width,height FROM salon_media_variants')).rows[0]
 expect(variant).toMatchObject({mime:'image/webp',width:16,height:8});expect(store.hasTestVariant(scope(),variant.id)).toBe(true)
 expect((await pool.query('SELECT to_state FROM salon_media_events ORDER BY at,to_state')).rows.map(r=>r.to_state).sort()).toEqual(['pending','processing','ready'])
 expect((await pool.query('SELECT * FROM salon_public_media_projection')).rows).toHaveLength(0)
 expect((await pool.query('SELECT * FROM salon_public_visibility')).rows).toHaveLength(0)
 expect((await processStoredMedia(pool,store.storage,scope(),policy)).outcome).toBe('already_ready')
 expect((await pool.query('SELECT * FROM salon_media_variants')).rows).toHaveLength(1)
})
it('audit défaillant annule état, variante et réservations supplémentaires ; compensation objet',async()=>{
 await pool.query("CREATE FUNCTION fail_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='ready' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_ready BEFORE UPDATE ON salon_media FOR EACH ROW EXECUTE FUNCTION fail_ready()")
 await expect(processStoredMedia(pool,store.storage,scope(),policy)).rejects.toThrow(/unavailable/)
 expect((await pool.query('SELECT state FROM salon_media')).rows[0].state).toBe('pending')
 expect((await pool.query('SELECT * FROM salon_media_variants')).rows).toHaveLength(0)
 expect((await pool.query('SELECT * FROM salon_media_events')).rows).toHaveLength(1)
 expect(store.objectCount()).toBe(1)
 expect((await pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='uploads'")).rows[0].used).toBe(1)
})
it('contenu corrompu rejeté atomiquement, quota libéré, original jamais diffusé',async()=>{
 const broken=createMemoryMediaTestStorage(tenantId,10,1048576)
 broken.putTestOriginal(scope(),bytes.subarray(0,8))
 expect((await processStoredMedia(pool,broken.storage,scope(),policy)).outcome).toBe('rejected')
 expect((await pool.query('SELECT state FROM salon_media')).rows[0].state).toBe('rejected')
 expect((await pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='uploads'")).rows[0].used).toBe(0)
 expect(broken.objectCount()).toBe(1)
})
it('défaut stockage ou taille/hash d’accusé faux ne produit jamais ready ; reprise possible',async()=>{
 const bad:PrivateMediaStorage={...store.storage,putVariantOnce:async(...args)=>{await store.storage.putVariantOnce(...args);return {byteSize:1,sha256:'wrong'}}}
 await expect(processStoredMedia(pool,bad,scope(),policy)).rejects.toThrow(/unavailable/)
 expect(store.objectCount()).toBe(1)
 expect((await pool.query('SELECT state FROM salon_media')).rows[0].state).toBe('pending')
 expect((await processStoredMedia(pool,store.storage,scope(),policy)).outcome).toBe('ready')
})
it('COMMIT réussi mais accusé perdu : variante conservée, reprise sans duplication',async()=>{
 const ambiguous:SqlPoolLike={...pool,connect:async()=>{const db=await pool.connect();return {...db,query:async<R>(sql:string,values?:unknown[])=>{const result=await db.query<R>(sql,values);if(sql==='COMMIT')throw new Error('lost acknowledgement');return result}}}}
 await expect(processStoredMedia(ambiguous,store.storage,scope(),policy)).rejects.toThrow(/uncertain/)
 expect((await pool.query('SELECT state FROM salon_media')).rows[0].state).toBe('ready')
 expect(store.objectCount()).toBe(2)
 expect((await processStoredMedia(pool,store.storage,scope(),policy)).outcome).toBe('already_ready')
 expect((await pool.query('SELECT * FROM salon_media_variants')).rows).toHaveLength(1)
})
it('tenant étranger, droit révoqué et adaptateur test en production refusés',async()=>{
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenantId])).rows[0].id
 await expect(processStoredMedia(pool,store.storage,{tenantId:other,mediaId},policy)).rejects.toThrow(/unavailable/)
 await pool.query("UPDATE tenant_subscriptions SET revoked_at=now(),revoked_by='operator',revocation_reason='withdrawn'")
 await expect(processStoredMedia(pool,store.storage,scope(),policy)).rejects.toThrow(/unavailable/)
 expect((await pool.query('SELECT state FROM salon_media')).rows[0].state).toBe('pending')
 vi.stubEnv('NODE_ENV','production')
 await expect(processStoredMedia(pool,store.storage,scope(),policy)).rejects.toThrow(/forbidden/)
})
it('intention expirée fermée sans décodage ni stockage supplémentaire',async()=>{
 // Pending insert schema permits a short deadline; identity cannot be edited afterwards.
 const expiredId=crypto.randomUUID()
 await pool.query(`INSERT INTO salon_media(tenant_id,id,profile_id,purpose,original_key,declared_mime,declared_bytes,created_at,upload_expires_at)
 VALUES($1,$2,$3,'gallery',$4,'image/png',10,now()-interval '2 hours',now()-interval '1 hour')`,[tenantId,expiredId,profileId,originalMediaKey(tenantId,expiredId)])
 expect((await processStoredMedia(pool,store.storage,{tenantId,mediaId:expiredId},policy)).outcome).toBe('rejected')
 expect(store.objectCount()).toBe(1)
 expect((await pool.query<{used:number}>("SELECT used::int FROM salon_public_quota_usage WHERE resource='uploads'")).rows[0].used).toBe(1)
})
