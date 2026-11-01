import { afterEach, expect, it, vi } from 'vitest'
import { setup, command } from './checkoutTestFixtures'
import { apiTestClient } from './apiTestClient'
import { syncWithNeonDatabase } from '../../server/syncEngine'
import { commitCheckout } from '../../server/checkoutCommit'
import { preflightCheckout } from '../../server/checkoutCutover'
import { withTenantClient } from '../../server/tenantContext'
import type { SalonBackupPayload, RevenueEntry, CashMovement, StockMovement } from '../domain/models'

afterEach(() => vi.unstubAllEnvs())
const payload=():SalonBackupPayload => ({format:'SALON_PRO_BACKUP_V1',exportedAt:new Date().toISOString()} as SalonBackupPayload)
function enforce() {vi.stubEnv('SALON_CHECKOUT_SYNC_MODE','enforced');vi.stubEnv('SALON_CHECKOUT_CUTOVER_APPROVED','true')}
const revenue=():RevenueEntry => ({id:'legacy-revenue',ticketId:'local-ticket',receiptNumber:'LOCAL-1',date:new Date().toISOString(),label:'Vente locale',categoryCode:'hair_service',amount:1000,paymentMethod:'wave',sourceModule:'revenue',isArchived:false,createdAt:'2026-10-31',updatedAt:'2026-10-31'})

it('prévol en legacy : diagnostic sans mutation ni activation de 006',async () => {
 const {pool,tenant,actorId,manager,financialState}=await setup()
 const before=await financialState()
 const request={payload:{...payload(),revenues:[revenue()]}}
 const response=await apiTestClient(pool,'POST','/api/checkout/preflight',request,manager)
 expect(response.status).toBe(200)
 expect(response.body.report).toMatchObject({mode:'legacy',checkoutSchemaReady:false,canSync:true,blockedCount:1,blockers:[{table:'revenues',id:'legacy-revenue',operation:'write'}]})
 expect(JSON.stringify(response.body)).not.toContain('Vente locale')
 expect(await financialState()).toEqual(before)
 expect((await preflightCheckout(pool,tenant,actorId,request)).blockedCount).toBe(1)
 await syncWithNeonDatabase(pool,request,tenant,'manager') // legacy behaviour remains unchanged
 expect((await financialState()).revenues).toBe(1)
})
it.each(['manager','cashier'] as const)('enforced : annule tout le push %s, y compris ses changements non financiers',async (role) => {
 const {pool,tenant,actorId,snapshot,financialState}=await setup(true)
 enforce();const before=await financialState()
 const request={payload:{...payload(),revenues:[revenue()],cashSessions:[{...snapshot.cashSessions[0],openingBalance:9999}],services:[{...snapshot.services[0],name:'Changed alongside blocked sale'}]}}
 await expect(syncWithNeonDatabase(pool,request,tenant,role)).rejects.toMatchObject({status:409,code:'LEGACY_SALE_WRITE_BLOCKED'})
 expect(await financialState()).toEqual(before)
 const actual=await withTenantClient(pool,tenant,async (db) => (await db.query<{payload_json:{openingBalance:number}}>("SELECT payload_json FROM cash_sessions WHERE id='cash-quote'")).rows[0].payload_json)
 expect(actual.openingBalance).toBe(1000)
 const committed=await commitCheckout(pool,tenant,actorId,command())
 expect(committed.result.receiptNumber).toBe('SPC-0000000001')
})
it('refuse les effets de vente sans recette jointe et reconnaît les anciennes références inverses',async () => {
 const {pool,tenant,snapshot}=await setup(true)
 const time=new Date().toISOString()
 const cash:CashMovement={id:'legacy-cash',sessionId:'cash-quote',type:'in',amount:1000,reason:'Historique',categoryCode:'hair_service',paymentMethod:'cash',occurredAt:time,createdAt:time,updatedAt:time}
 const stock:StockMovement={id:'legacy-stock',productId:'product-quote',type:'adjustment',quantityDelta:-1,quantityAfter:9,unitCost:100,reason:'Historique',occurredAt:time,createdAt:time}
 const rev={...revenue(),cashMovementId:cash.id,linkedStockMovementId:stock.id}
 await syncWithNeonDatabase(pool,{payload:{...payload(),revenues:[rev],cashMovements:[cash],stockMovements:[stock]}},tenant,'manager')
 enforce()
 const report=await preflightCheckout(pool,tenant,(await pool.query<{id:string}>("SELECT id FROM salon_users WHERE role='manager'")).rows[0].id,{payload:{...payload(),cashMovements:[{...cash,amount:1}],stockMovements:[{...stock,quantityDelta:-9}]}})
 expect(report.blockedCount).toBe(2)
 const freshCash={...cash,id:'new-linked-cash',linkedRevenueId:'missing-revenue'}
 const freshStock={...stock,id:'new-stock-sale',type:'sale' as const}
 await expect(syncWithNeonDatabase(pool,{payload:{...payload(),cashMovements:[freshCash],stockMovements:[freshStock],products:[{...snapshot.products[0],quantity:0}]}},tenant,'manager')).rejects.toMatchObject({code:'LEGACY_SALE_WRITE_BLOCKED'})
})
it('permet les snapshots identiques et les deltas non commerciaux ; bloque édition et tombstones historiques',async () => {
 const {pool,tenant,actorId,financialState,snapshot}=await setup(true)
 const row=revenue();await syncWithNeonDatabase(pool,{payload:{...payload(),revenues:[row]}},tenant,'manager')
 enforce()
 expect((await preflightCheckout(pool,tenant,actorId,{payload:{...payload(),revenues:[{...row,updatedAt:'different timestamp'}]}})).blockedCount).toBe(0)
 const before=await financialState()
 await syncWithNeonDatabase(pool,{payload:{...payload(),revenues:[row]}},tenant,'manager')
 expect(await financialState()).toEqual(before)
 const cursor=Number((await financialState()).revision)
 const result=await syncWithNeonDatabase(pool,{cursor,payload:{...payload(),services:[{...snapshot.services[0],name:'Configuration réelle actualisée'}]}},tenant,'manager')
 expect(result.rejected).toEqual([])
 await expect(syncWithNeonDatabase(pool,{cursor:result.cursor,payload:{...payload(),revenues:[{...row,amount:1}]}},tenant,'manager')).rejects.toMatchObject({code:'LEGACY_SALE_WRITE_BLOCKED'})
 await expect(syncWithNeonDatabase(pool,{cursor:result.cursor,payload:payload(),tombstones:[{entityType:'revenue',entityId:row.id,deletedAt:new Date().toISOString()}]},tenant,'manager')).rejects.toMatchObject({code:'LEGACY_SALE_WRITE_BLOCKED'})
})
it('échoue fermé sans approbation, sans 006, ou sur mode inconnu',async () => {
 const {pool,tenant,actorId,financialState}=await setup()
 const before=await financialState();enforce()
 const report=await preflightCheckout(pool,tenant,actorId,{payload:payload()})
 expect(report.canSync).toBe(false)
 await expect(syncWithNeonDatabase(pool,{payload:payload()},tenant,'manager')).rejects.toMatchObject({code:'CHECKOUT_CUTOVER_NOT_READY'})
 vi.stubEnv('SALON_CHECKOUT_SYNC_MODE','typo')
 await expect(syncWithNeonDatabase(pool,{payload:payload()},tenant,'manager')).rejects.toMatchObject({code:'CHECKOUT_CUTOVER_CONFIG_INVALID'})
 expect(await financialState()).toEqual(before)
})
it('exige une session ; valide le payload et ne lit pas les ventes d’un autre tenant',async () => {
 const {pool,tenant,actorId,manager}=await setup(true)
 expect((await apiTestClient(pool,'POST','/api/checkout/preflight',{payload:payload()})).status).toBe(401)
 for(const input of [null,{}, {payload:{format:'wrong'}},{payload:{...payload(),revenues:{id:'bad'}}}]) expect((await apiTestClient(pool,'POST','/api/checkout/preflight',input,manager)).status).toBe(400)
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenant])).rows[0].id
 await syncWithNeonDatabase(pool,{payload:{...payload(),revenues:[revenue()]}},other,'manager')
 const report=await preflightCheckout(pool,tenant,actorId,{payload:{...payload(),revenues:[revenue()]}})
 expect(report.blockedCount).toBe(1) // would be a new row here, not a no-op in the other salon
 expect(report.blockers[0].id).toBe('legacy-revenue')
})
it('borne le diagnostic transmis sans exposer de montant ni de libellé',async () => {
 const {pool,tenant,actorId}=await setup(true)
 const revenues=Array.from({length:101},(_,i) => ({...revenue(),id:`unsent-${i}`}))
 const report=await preflightCheckout(pool,tenant,actorId,{payload:{...payload(),revenues}})
 expect(report.blockedCount).toBe(101);expect(report.blockers).toHaveLength(100);expect(report.truncated).toBe(true)
 expect(JSON.stringify(report)).not.toContain('amount')
})
it('approbation absente : aucune écriture même avec 006 déjà installée',async () => {
 const {pool,tenant,actorId,financialState}=await setup(true)
 vi.stubEnv('SALON_CHECKOUT_SYNC_MODE','enforced');vi.stubEnv('SALON_CHECKOUT_CUTOVER_APPROVED','false')
 const before=await financialState()
 const response=await preflightCheckout(pool,tenant,actorId,{payload:payload()})
 expect(response).toMatchObject({activationApproved:false,checkoutSchemaReady:true,canSync:false})
 await expect(syncWithNeonDatabase(pool,{payload:payload()},tenant,'manager')).rejects.toMatchObject({code:'CHECKOUT_CUTOVER_NOT_READY'})
 expect(await financialState()).toEqual(before)
})
