import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { saveVisibilityDraft } from '../../server/visibility'
import { saveVisibilityConfig } from '../../server/visibilityConfig'
import { publishVisibilityText } from '../../server/publishProfile'
import { readVisibilityPublication,unpublishVisibility } from '../../server/visibilityPublication'
import { withTenantClient } from '../../server/tenantContext'
import { ESSENTIEL_V1 } from '../domain/subscriptions'
import { emptyProfileDetails } from '../domain/profileDetails'
import { emptyVisibilityWeek } from '../domain/visibilityConfig'
import { parseTextPublicationCommand } from '../domain/textPublication'
import { PUBLISH_PROFILE_SQL } from '../../server/publishProfileSchema'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
import { apiTestClient } from './apiTestClient'
let c:Awaited<ReturnType<typeof setup>>
const intent=()=>({idempotencyKey:crypto.randomUUID(),expectedVersion:2,slug:'salon-recette',confirmedWithoutPhotos:true})
async function grant(){
 const p=ESSENTIEL_V1
 const plan=(await c.pool.query<{id:string}>('INSERT INTO saas_plans(code,version,name,price_xof,currency,period_kind,grace_seconds,entitlements) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id',[p.code,p.version,p.name,p.priceXof,p.currency,p.periodKind,p.graceSeconds,JSON.stringify(p.entitlements)])).rows[0].id
 await c.pool.query(`INSERT INTO tenant_subscriptions(tenant_id,plan_id,activation_key,billing_anchor_at,period_index,billing_timezone,starts_at,ends_at,grace_ends_at,amount_xof,external_reference,evidence_reference,operator_reference)
 VALUES($1,$2,$3,date_trunc('month',now()),0,'Africa/Abidjan',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',date_trunc('month',now())+interval '1 month 72 hours',4900,'external-test','private-evidence','test-operator')`,[c.tenant,plan,crypto.randomUUID()])
}
beforeEach(async()=>{
 vi.stubEnv('SALON_VISIBILITY_ENABLED','true');vi.stubEnv('SALON_TEXT_PUBLICATION_ENABLED','true');c=await setup(false)
 await c.pool.query('CREATE ROLE anon; CREATE ROLE authenticated')
 await runMigrations(c.pool,{includeTextPublication:true})
 await saveVisibilityDraft(c.pool,c.tenant,c.actorId,{displayName:'Profil de recette',description:'Description publique',city:'Abidjan',commune:'',publicPhone:null,details:{...emptyProfileDetails(),slogan:'Slogan de recette',whatsapp:'+2250700000000'},expectedVersion:0})
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,{expectedVersion:1,services:[{serviceId:'service-quote',variantId:'variant-long'}],weekly:emptyVisibilityWeek().map(d=>d.isoWeekday===1?{...d,windows:[{startMinute:540,endMinute:720}]}:d),exceptions:[{localDate:'2026-12-25',windows:[]}]})
 await c.pool.query("UPDATE schedule_exceptions SET private_note='CONFIDENTIAL_NOTE'")
})
afterEach(()=>vi.unstubAllEnvs())
async function publicRead(table:string){
 const db=await c.pool.connect()
 try{await db.query('BEGIN');await db.query("SELECT set_config('role','salon_pro_public_' || substr(md5(current_schema()),1,12),true)");const rows=(await db.query(`SELECT * FROM ${table}`)).rows;await db.query('COMMIT');return rows}catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
it('publie profil/détails/prestations/semaine/exceptions atomiquement, sans finance ni réservation',async()=>{
 await grant();const finance=await c.financialState()
 expect((await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status.canPublish).toBe(true)
 const result=(await publishVisibilityText(c.pool,c.tenant,c.actorId,intent())).result
 expect(result).toMatchObject({outcome:'published',version:3,revision:1,slug:'salon-recette'})
 expect(await publicRead('salon_public_projection')).toHaveLength(1)
 expect(await publicRead('salon_public_details')).toEqual([expect.objectContaining({details:expect.objectContaining({slogan:'Slogan de recette',whatsapp:'+2250700000000'})})])
 expect(await publicRead('salon_public_service_projection')).toEqual([expect.objectContaining({display_name:'Prestation — Long',price_xof:4500,booking_requested:false})])
 expect(await publicRead('salon_public_opening_hours')).toHaveLength(7)
 expect(JSON.stringify(await publicRead('salon_public_schedule_exceptions'))).not.toContain('CONFIDENTIAL_NOTE')
 expect(await publicRead('salon_public_schedule_exceptions')).toHaveLength(1)
 expect(await publicRead('salon_public_booking_rules')).toHaveLength(0)
 expect(await c.financialState()).toEqual(finance)
 expect((await readVisibilityPublication(c.pool,c.tenant,c.actorId,{})).status).toMatchObject({visibility:'visible',publishedRevision:1,version:3})
})
it('rejeu même intention sans duplication ; conflit puis dépublication ne ressuscite pas',async()=>{
 await grant();const cmd=intent()
 await publishVisibilityText(c.pool,c.tenant,c.actorId,cmd)
 expect((await publishVisibilityText(c.pool,c.tenant,c.actorId,cmd)).result.outcome).toBe('replayed')
 expect((await c.pool.query("SELECT id FROM salon_public_profile_events WHERE event_type='published'")).rows).toHaveLength(1)
 await expect(publishVisibilityText(c.pool,c.tenant,c.actorId,{...cmd,slug:'autre-slug'})).rejects.toMatchObject({status:409})
 await unpublishVisibility(c.pool,c.tenant,c.actorId,{expectedVersion:3})
 await publishVisibilityText(c.pool,c.tenant,c.actorId,cmd)
 expect(await publicRead('salon_public_projection')).toHaveLength(0)
})
it('sans droit et source désactivée refusés ; aucune copie partielle',async()=>{
 await expect(publishVisibilityText(c.pool,c.tenant,c.actorId,intent())).rejects.toMatchObject({status:409})
 await grant();await c.pool.query("UPDATE services_catalog SET is_active=false WHERE id='service-quote'")
 await expect(publishVisibilityText(c.pool,c.tenant,c.actorId,intent())).rejects.toMatchObject({status:409})
 for(const table of ['salon_public_visibility','salon_public_projection','salon_public_details','salon_publication_receipts'])expect((await c.pool.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0)
})
it('republication relit prix ERP et augmente révision ; échec audit conserve la copie antérieure',async()=>{
 await grant();await publishVisibilityText(c.pool,c.tenant,c.actorId,intent())
 await c.pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{variants,0,price}','5500'::jsonb) WHERE id='service-quote'")
 const cmd={...intent(),expectedVersion:3}
 expect((await publishVisibilityText(c.pool,c.tenant,c.actorId,cmd)).result).toMatchObject({version:4,revision:2})
 expect((await publicRead('salon_public_service_projection'))[0]).toMatchObject({price_xof:5500,revision:2})
 await c.pool.query("CREATE FUNCTION fail_publish_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='published' THEN RAISE EXCEPTION 'audit failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_publish BEFORE INSERT ON salon_public_profile_events FOR EACH ROW EXECUTE FUNCTION fail_publish_audit()")
 await expect(publishVisibilityText(c.pool,c.tenant,c.actorId,{...intent(),expectedVersion:4})).rejects.toThrow(/audit failed/)
 expect((await publicRead('salon_public_projection'))[0]).toMatchObject({revision:2})
 expect((await c.pool.query('SELECT version FROM salon_public_profiles')).rows[0]).toEqual({version:4})
 expect((await c.pool.query('SELECT * FROM salon_publication_receipts')).rows).toHaveLength(2)
})
it('révocation masque toutes les copies ; ancienne intention ne réactive pas le gate',async()=>{
 await grant();const cmd=intent();await publishVisibilityText(c.pool,c.tenant,c.actorId,cmd)
 await c.pool.query("UPDATE tenant_subscriptions SET revoked_at=now(),revoked_by='operator',revocation_reason='withdrawn'")
 for(const table of ['salon_public_projection','salon_public_details','salon_public_service_projection','salon_public_opening_hours','salon_public_schedule_exceptions'])expect(await publicRead(table)).toHaveLength(0)
 expect((await publishVisibilityText(c.pool,c.tenant,c.actorId,cmd)).result.outcome).toBe('replayed')
 await expect(publishVisibilityText(c.pool,c.tenant,c.actorId,{...intent(),expectedVersion:3})).rejects.toMatchObject({status:409})
})
it('aucun grant direct runtime ou navigateur, acteur Caissier refusé, API et flag stricts',async()=>{
 await grant()
 await expect(publishVisibilityText(c.pool,c.tenant,c.cashierId,intent())).rejects.toMatchObject({status:403})
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query("UPDATE salon_public_visibility SET published=true"))).rejects.toThrow(/permission/)
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query('SELECT * FROM salon_publication_receipts'))).rejects.toThrow(/permission/)
 for(const role of ['anon','authenticated'])expect((await c.pool.query<{ok:boolean}>("SELECT has_function_privilege($1,'publish_salon_profile_text(text,uuid,integer,text,boolean)','EXECUTE') AS ok",[role])).rows[0].ok).toBe(false)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/publication/publish',intent())).status).toBe(401)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/publication/publish',intent(),c.cashier)).status).toBe(403)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/publication/publish',intent(),c.manager)).status).toBe(200)
 vi.stubEnv('SALON_TEXT_PUBLICATION_ENABLED','false')
 await expect(publishVisibilityText(c.pool,c.tenant,c.actorId,intent())).rejects.toMatchObject({status:503})
})
it('022 opt-in sauvegarde, export exact, pas de plateforme 020 ou seed ; intention stricte',async()=>{
 expect(()=>marketplaceMigrationOptions(['--include-text-publication'],undefined)).toThrow(/backup/)
 expect(marketplaceMigrationOptions(['--include-text-publication'],'true').includeTextPublication).toBe(true)
 expect(readFileSync('supabase/optional/022_publish_profile_text.sql','utf8')).toBe(PUBLISH_PROFILE_SQL.trim()+'\n')
 expect((await c.pool.query("SELECT id FROM schema_migrations WHERE id='020_platform_activation'")).rows).toHaveLength(0)
 expect((await c.pool.query('SELECT * FROM tenant_subscriptions')).rows).toHaveLength(0)
 const cmd=intent()
 for(const patch of [{confirmedWithoutPhotos:false},{priceXof:1},{tenantId:c.tenant},{expectedVersion:0},{slug:'../evil'},{idempotencyKey:'new'}])expect(()=>parseTextPublicationCommand({...cmd,...patch})).toThrow()
 await runMigrations(c.pool,{includeTextPublication:true})
})
it('quota de sélection appliqué dans la transaction, brouillon de onze prestations conservé',async()=>{
 await grant()
 const variants=Array.from({length:11},(_,i)=>({id:`v${i}`,label:`Variante ${i}`,price:3000}))
 await c.pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{variants}',$1::jsonb) WHERE id='service-quote'",[JSON.stringify(variants)])
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,{expectedVersion:2,services:variants.map(v=>({serviceId:'service-quote',variantId:v.id})),weekly:emptyVisibilityWeek(),exceptions:[]})
 await expect(publishVisibilityText(c.pool,c.tenant,c.actorId,{...intent(),expectedVersion:3})).rejects.toMatchObject({status:409})
 expect((await c.pool.query('SELECT * FROM salon_service_selections')).rows).toHaveLength(11)
 expect((await c.pool.query('SELECT * FROM salon_public_projection')).rows).toHaveLength(0)
})
it('SQL ne fait confiance ni à un acteur inter-tenant ni à une confirmation NULL',async()=>{
 await grant()
 const other=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 await expect(withTenantClient(c.pool,other,db=>db.query("SELECT publish_salon_profile_text($1,$2,2,'other-salon',true)",[c.actorId,crypto.randomUUID()]))).rejects.toThrow(/manager/i)
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query("SELECT publish_salon_profile_text($1,$2,2,'salon-recette',NULL)",[c.actorId,crypto.randomUUID()]))).rejects.toThrow(/intent/i)
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query("SELECT publish_salon_profile_text($1,$2,2,'salon-recette',true)",[c.cashierId,crypto.randomUUID()]))).rejects.toThrow(/manager/i)
 expect((await c.pool.query('SELECT * FROM salon_publication_receipts')).rows).toHaveLength(0)
})
