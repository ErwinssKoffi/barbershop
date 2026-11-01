import { afterEach, expect, it, vi } from 'vitest'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { enqueueCheckout } from '../db/checkoutQueue'
import { checkCheckoutPreflight } from '../lib/checkoutPreflight'
import type { PublicSalonUser } from '../domain/models'

vi.mock('../lib/sessionClient',() => ({currentAccessToken:async () => 'unit-token',readStoredSession:() => ({token:'unit-token',user:{id:'unit-user',tenantId:'unit-tenant'}}),accessClaims:() => ({uid:'unit-user',tid:'unit-tenant'})}))
const databases=new Set<SalonProDatabase>()
afterEach(async () => {vi.unstubAllGlobals();for(const db of databases) db.close();for(const db of databases) await db.delete();databases.clear()})
const account:PublicSalonUser={id:'unit-user',tenantId:'unit-tenant',role:'manager',fullName:'Responsable',email:'cutover@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
const revenue=() => ({date:'2026-10-31',label:'Vente antérieure',categoryCode:'hair_service',amount:1000,paymentMethod:'wave' as const})
async function fixture() {
 const db=new SalonProDatabase(`cutover-local-${crypto.randomUUID()}`);databases.add(db)
 const repo=new SalonRepositoryHub(db);await repo.ensureInitialized(false)
 await db.workspaceMeta.bulkPut([{key:'accountScope',value:workspaceKey(account)},{key:'cloudTenantId',value:account.tenantId!}])
 return {db,repo}
}
it('désactive les quatre mutations locales héritées après diagnostic enforced, sans toucher la vente antérieure',async () => {
 const {db,repo}=await fixture();const row=await repo.addRevenue(revenue())
 const before=await db.revenues.toArray()
 await db.workspaceMeta.put({key:'checkoutCutoverReport',value:JSON.stringify({mode:'enforced',scope:workspaceKey(account)})})
 await expect(repo.addRevenue(revenue())).rejects.toThrow('caisse autoritaire')
 await expect(repo.createCheckoutTicket({date:'2026-10-31',paymentMethod:'wave',lines:[{kind:'service',label:'Ligne',categoryCode:'hair_service',quantity:1,unitPrice:1000}]})).rejects.toThrow('caisse autoritaire')
 await expect(repo.updateRevenue({...revenue(),id:row.id,reason:'Correction'})).rejects.toThrow('caisse autoritaire')
 await expect(repo.archiveRevenue(row.id)).rejects.toThrow('caisse autoritaire')
 expect(await db.revenues.toArray()).toEqual(before)
 const queued=await enqueueCheckout(db,account,{idempotencyKey:`checkout-${crypto.randomUUID()}`,lines:[{kind:'service',catalogId:'catalog',quantity:1}],payments:[{method:'wave',amount:1000}]})
 expect(queued.state).toBe('pending');expect(await db.revenues.toArray()).toEqual(before)
})
it('ne réutilise pas un diagnostic étranger et respecte un retour opérateur au mode legacy',async () => {
 const {db,repo}=await fixture()
 await db.workspaceMeta.put({key:'checkoutCutoverReport',value:JSON.stringify({mode:'enforced',scope:'another-account'})})
 expect((await repo.addRevenue(revenue())).amount).toBe(1000)
 repo.clearDuplicateGuard()
 await db.workspaceMeta.put({key:'checkoutCutoverReport',value:JSON.stringify({mode:'legacy',scope:workspaceKey(account)})})
 expect((await repo.addRevenue({...revenue(),label:'Autre écriture'})).amount).toBe(1000)
})
it('conserve un backlog local et son curseur quand le prévol le bloque, avec diagnostic persistant',async () => {
 const {db,repo}=await fixture();const row=await repo.addRevenue(revenue())
 await db.workspaceMeta.put({key:'syncCursor',value:'45'})
 const envelope=await repo.buildCloudDeltaEnvelope()
 const report={mode:'enforced',checkoutSchemaReady:true,activationApproved:true,canSync:false,blockedCount:1,blockers:[{table:'revenues',id:row.id,operation:'write',code:'LEGACY_SALE_WRITE_BLOCKED'}],truncated:false}
 const fetch=vi.fn(async () => new Response(JSON.stringify({ok:true,report}),{status:200,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch)
 await expect(checkCheckoutPreflight(envelope,'unit-token',async (value) => {await db.workspaceMeta.put({key:'checkoutCutoverReport',value:JSON.stringify({...value,scope:workspaceKey(account)})})})).rejects.toThrow('Aucun pull/push')
 expect(await db.revenues.get(row.id)).toEqual(row)
 expect(await repo.cloudSyncCursor()).toBe(45)
 expect(await db.checkoutOutbox.count()).toBe(0)
 expect(JSON.parse((await db.workspaceMeta.get('checkoutCutoverReport'))!.value).blockedCount).toBe(1)
 expect(fetch).toHaveBeenCalledTimes(1)
})
