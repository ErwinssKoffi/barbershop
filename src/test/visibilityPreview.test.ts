import { beforeEach,afterEach,expect,it,vi } from 'vitest'
import { setup } from './checkoutTestFixtures'
import { runMigrations } from '../../server/migrations'
import { saveVisibilityDraft } from '../../server/visibility'
import { saveVisibilityConfig } from '../../server/visibilityConfig'
import { readVisibilityPreview } from '../../server/visibilityPreview'
import { emptyVisibilityWeek } from '../domain/visibilityConfig'
import { emptyProfileDetails } from '../domain/profileDetails'
import { parseVisibilityPreview } from '../domain/visibilityPreview'
import { withTenantClient } from '../../server/tenantContext'
import { apiTestClient } from './apiTestClient'
let c:Awaited<ReturnType<typeof setup>>
beforeEach(async()=>{
 vi.stubEnv('SALON_VISIBILITY_ENABLED','true');c=await setup(false)
 await runMigrations(c.pool,{includeVisibilityEditor:true})
 await saveVisibilityDraft(c.pool,c.tenant,c.actorId,{displayName:'Profil réel de recette',description:'Description publique',city:'Abidjan',commune:'',publicPhone:'+2250700000000',details:{...emptyProfileDetails(),slogan:'Slogan de recette',publicAddress:'Adresse publique'},expectedVersion:0})
 await saveVisibilityConfig(c.pool,c.tenant,c.actorId,{expectedVersion:1,services:[{serviceId:'service-quote',variantId:'variant-long'}],weekly:emptyVisibilityWeek().map(d=>d.isoWeekday===1?{...d,windows:[{startMinute:540,endMinute:720},{startMinute:840,endMinute:1080}]}:d),exceptions:[{localDate:'2026-12-25',windows:[]}]})
})
afterEach(()=>vi.unstubAllEnvs())
it('snapshot complet des données enregistrées, prix ERP et aucun secret métier exposé',async()=>{
 await c.pool.query("UPDATE schedule_exceptions SET private_note='PRIVATE_NOTE_MUST_NOT_LEAK'")
 const finance=await c.financialState(),events=(await c.pool.query('SELECT id FROM salon_public_profile_events')).rows
 const {preview}=await readVisibilityPreview(c.pool,c.tenant,c.actorId,{})
 expect(preview).toMatchObject({version:2,published:false,onlineBooking:false,media:'not_connected',selectedServiceCount:1,timezone:'Africa/Abidjan',warnings:[],profile:{details:{slogan:'Slogan de recette',publicAddress:'Adresse publique'}}})
 expect(preview.services).toEqual([expect.objectContaining({displayName:'Prestation — Long',priceXof:4500,durationMinutes:null})])
 expect(preview.weekly[0].windows).toHaveLength(2)
 expect(preview.exceptions).toEqual([{localDate:'2026-12-25',windows:[]}])
 for(const text of ['PRIVATE_NOTE_MUST_NOT_LEAK','commissionOverride','defaultConsumables','payload_json','tenantId','external_reference'])expect(JSON.stringify(preview)).not.toContain(text)
 expect(await c.financialState()).toEqual(finance)
 expect((await c.pool.query('SELECT id FROM salon_public_profile_events')).rows).toEqual(events)
 expect((await c.pool.query('SELECT * FROM salon_public_visibility')).rows).toHaveLength(0)
 expect(parseVisibilityPreview(preview)).toEqual(preview)
})
it('source désactivée explicitement signalée sans prix ou durée de remplacement',async()=>{
 await c.pool.query("UPDATE services_catalog SET is_active=false WHERE id='service-quote'")
 expect((await readVisibilityPreview(c.pool,c.tenant,c.actorId,{})).preview).toMatchObject({services:[],selectedServiceCount:1,warnings:['SOURCE_UNAVAILABLE']})
})
it('sources relues après modification, corps sans prix/tenant/date arbitraires',async()=>{
 await c.pool.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{variants,0,price}','5500'::jsonb) WHERE id='service-quote'")
 expect((await readVisibilityPreview(c.pool,c.tenant,c.actorId,{})).preview.services[0].priceXof).toBe(5500)
 await expect(readVisibilityPreview(c.pool,c.tenant,c.actorId,{priceXof:1})).rejects.toMatchObject({status:400})
 await expect(readVisibilityPreview(c.pool,c.tenant,c.cashierId,{})).rejects.toMatchObject({status:403})
 const other=(await c.pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[c.tenant])).rows[0].id
 await expect(readVisibilityPreview(c.pool,other,c.actorId,{})).rejects.toMatchObject({status:403})
})
it('API privée, origine, POST et Gérant ; absence de migration expliquée',async()=>{
 expect((await apiTestClient(c.pool,'POST','/api/visibility/preview/read',{})).status).toBe(401)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/preview/read',{},c.cashier)).status).toBe(403)
 expect((await apiTestClient(c.pool,'GET','/api/visibility/preview/read',{},c.manager)).status).toBe(405)
 expect((await apiTestClient(c.pool,'POST','/api/visibility/preview/read',{},c.manager,{host:'erp.invalid',origin:'https://foreign.invalid'})).status).toBe(403)
 const response=await apiTestClient(c.pool,'POST','/api/visibility/preview/read',{},c.manager)
 expect(response.status).toBe(200);expect(response.body.preview).toMatchObject({version:2,published:false})
 await c.pool.query('DROP TABLE salon_service_selections')
 await expect(readVisibilityPreview(c.pool,c.tenant,c.actorId,{})).rejects.toMatchObject({status:503,code:'VISIBILITY_EDITOR_MIGRATION_REQUIRED'})
})
it('mode snapshot impose réellement READ ONLY et conserve le contexte tenant',async()=>{
 await expect(withTenantClient(c.pool,c.tenant,db=>db.query("UPDATE salon_public_profiles SET city='Changed'"),{readOnlySnapshot:true})).rejects.toThrow(/read.only/i)
 expect((await readVisibilityPreview(c.pool,c.tenant,c.actorId,{})).preview.profile.city).toBe('Abidjan')
})
it('DTO refuse fausse publication, réservation, doublons et données incohérentes',async()=>{
 const p=(await readVisibilityPreview(c.pool,c.tenant,c.actorId,{})).preview
 for(const changes of [{published:true},{onlineBooking:true},{services:[...p.services,...p.services]},{capturedAt:'not-a-date'},{timezone:'invalid/timezone'},{selectedServiceCount:0},{warnings:['unknown']},{services:[{...p.services[0],priceXof:-1}]}])expect(()=>parseVisibilityPreview({...p,...changes})).toThrow()
 const extra=parseVisibilityPreview({...p,private_note:'secret',services:[{...p.services[0],commissionOverride:99}]})
 expect(JSON.stringify(extra)).not.toContain('private_note');expect(JSON.stringify(extra)).not.toContain('commissionOverride')
})
