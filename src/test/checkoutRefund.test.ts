import { expect, it } from 'vitest'
import { setup, command } from './checkoutTestFixtures'
import { apiTestClient } from './apiTestClient'
import { runMigrations } from '../../server/migrations'
import { commitCheckout } from '../../server/checkoutCommit'
import { refundCheckout, refundStatus, parseRefund } from '../../server/checkoutRefund'
import { withTenantClient } from '../../server/tenantContext'
import { syncWithNeonDatabase } from '../../server/syncEngine'
import { calculateRevenueMetrics, calculateConsumedStockCost, calculateEmployeeCommission } from '../domain/calculations/finance'
import type { CheckoutRefundCommand, CheckoutRefundResult } from '../domain/checkoutRefund'
import type { SalonBackupPayload, Employee, ServiceCatalogItem } from '../domain/models'
import type { SqlPoolLike } from '../../server/neonClient'

async function fixture() {
 const context=await setup(true)
 await runMigrations(context.pool,{includeRefunds:true})
 const sale=await commitCheckout(context.pool,context.tenant,context.actorId,command())
 const input:CheckoutRefundCommand={idempotencyKey:'refund-stable-test-key-0001',originalTicketId:sale.result.ticketId,reason:'Retour intégral autorisé',returnLineIds:[sale.result.records.revenues[1].id],cashSessionId:'cash-quote',paymentReferences:[{method:'wave',reference:'Référence de remboursement externe attestée'}]}
 return {...context,sale:sale.result,input}
}
const empty=():SalonBackupPayload => ({format:'SALON_PRO_BACKUP_V1',exportedAt:new Date().toISOString()} as SalonBackupPayload)

it('007 reste volontaire même après opt-in 006 ; la route refuse sans mutation',async () => {
 const {pool,tenant,actorId,manager,financialState}=await setup(true)
 const sale=await commitCheckout(pool,tenant,actorId,command());const before=await financialState()
 const response=await apiTestClient(pool,'POST','/api/checkout/refund',{idempotencyKey:'refund-no-migration-0001',originalTicketId:sale.result.ticketId,reason:'Retour',returnLineIds:[],paymentReferences:[]},manager)
 expect(response.status).toBe(503);expect(response.body.code).toBe('REFUND_MIGRATION_REQUIRED')
 expect(await financialState()).toEqual(before)
 expect((await pool.query("SELECT id FROM schema_migrations WHERE id='007_checkout_refunds'")).rows).toEqual([])
})
it('inverse intégralement paiements/recettes, sort les seules espèces et retourne uniquement la revente sélectionnée',async () => {
 const {pool,tenant,actorId,manager,sale,input}=await fixture()
 const response=await apiTestClient(pool,'POST','/api/checkout/refund',input,manager)
 expect(response.status,JSON.stringify(response.body)).toBe(200)
 const result=response.body.result as CheckoutRefundResult
 expect(result).toMatchObject({status:'refunded',confirmed:true,total:10000,originalTicketId:sale.ticketId,receiptNumber:'SPR-0000000002',paymentExecution:'cash_ledger_and_external_attestation'})
 expect(result.records.revenues.map((row) => row.amount)).toEqual([-9000,-1000])
 expect(result.records.cashMovements.reduce((sum,row) => sum+row.amount,0)).toBe(4000)
 expect(result.records.cashMovements.every((row) => row.type==='out')).toBe(true)
 expect(result.records.cashSession).toMatchObject({totalCashIn:4000,totalCashOut:4000,theoreticalClosingBalance:1000})
 expect(result.records.products[0].quantity).toBe(6) // initial10 - consumables4; revente2 remise en stock
 expect(result.records.stockMovements).toHaveLength(1)
 const original=await withTenantClient(pool,tenant,(db) => db.query<{payload_json:unknown}>('SELECT payload_json FROM revenues WHERE id=$1',[sale.records.revenues[0].id]))
 expect(original.rows[0].payload_json).toEqual(sale.records.revenues[0])
 const all=[...sale.records.revenues,...result.records.revenues]
 expect(calculateRevenueMetrics(all)).toMatchObject({totalRevenue:0,byPaymentMethod:{cash:0,wave:0}})
 expect(calculateConsumedStockCost([...sale.records.stockMovements,...result.records.stockMovements])).toBe(400)
 expect(await refundCheckout(pool,tenant,actorId,input)).toEqual({result,replayed:true})
})
it('rejoue après changement du catalogue sans double effets et refuse une seconde clé ou intention différente',async () => {
 const {pool,tenant,actorId,input,financialState}=await fixture()
 const first=await refundCheckout(pool,tenant,actorId,input);const before=await financialState()
 await withTenantClient(pool,tenant,(db) => db.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{isActive}','false')"))
 const afterCatalog=await financialState()
 expect(await refundCheckout(pool,tenant,actorId,input)).toEqual({...first,replayed:true})
 expect(await financialState()).toEqual(afterCatalog)
 expect(afterCatalog.revenues).toBe(before.revenues)
 await expect(refundCheckout(pool,tenant,actorId,{...input,reason:'Autre motif'})).rejects.toMatchObject({code:'REFUND_IDEMPOTENCY_CONFLICT'})
 await expect(refundCheckout(pool,tenant,actorId,{...input,idempotencyKey:'refund-other-stable-key-0002'})).rejects.toMatchObject({code:'TICKET_ALREADY_REFUNDED'})
})
it('annule toutes les écritures et le compteur sur panne après les inverses financiers',async () => {
 const {pool,tenant,actorId,input,financialState}=await fixture();const before=await financialState()
 const broken:SqlPoolLike={query:pool.query.bind(pool),connect:async () => {const db=await pool.connect();return {release:() => db.release(),query:async (sql,values) => {if(sql.startsWith('INSERT INTO checkout_refund_records')) throw new Error('refund persistence failed');return db.query(sql,values)}}}}
 await expect(refundCheckout(broken,tenant,actorId,input)).rejects.toThrow('refund persistence failed')
 expect(await financialState()).toEqual(before)
 expect((await pool.query('SELECT * FROM checkout_refunds')).rows).toEqual([])
 expect((await refundCheckout(pool,tenant,actorId,input)).result.receiptNumber).toBe('SPR-0000000002')
})
it('exige un Gérant actif, motif, caisse ouverte/fonds et attestation des modes externes',async () => {
 const {pool,tenant,actorId,cashierId,input,sale}=await fixture()
 await expect(refundCheckout(pool,tenant,cashierId,input)).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
 await expect(refundCheckout(pool,tenant,actorId,{...input,paymentReferences:[]})).rejects.toMatchObject({code:'REFUND_PAYMENT_EVIDENCE_REQUIRED'})
 await expect(refundCheckout(pool,tenant,actorId,{...input,returnLineIds:[sale.records.revenues[0].id]})).rejects.toMatchObject({code:'INVALID_REFUND_RETURN'})
 await expect(refundCheckout(pool,tenant,actorId,{...input,cashSessionId:'absent'})).rejects.toMatchObject({code:'REFUND_CASH_SESSION_REQUIRED'})
 const time=new Date().toISOString()
 await syncWithNeonDatabase(pool,{payload:{...empty(),cashSessions:[{id:'refund-empty',status:'open',openingBalance:0,openedAt:time,totalCashIn:0,totalCashOut:0,theoreticalClosingBalance:0,createdAt:time,updatedAt:time}]}},tenant,'manager')
 await expect(refundCheckout(pool,tenant,actorId,{...input,cashSessionId:'refund-empty'})).rejects.toMatchObject({code:'REFUND_CASH_INSUFFICIENT'})
 for(const invalid of [{...input,reason:''},{...input,tenantId:tenant},{...input,returnLineIds:[input.returnLineIds[0],input.returnLineIds[0]]},{...input,payments:[{method:'cash',amount:1}]}]) expect(() => parseRefund(invalid)).toThrow()
})
it('ne recrédite jamais les consommables ni les produits sans décision de retour',async () => {
 const {pool,tenant,actorId,input}=await fixture()
 const {result}=await refundCheckout(pool,tenant,actorId,{...input,returnLineIds:[]})
 expect(result.records.products).toEqual([]);expect(result.records.stockMovements).toEqual([])
 expect((await withTenantClient(pool,tenant,(db) => db.query<{quantity:number}>("SELECT quantity FROM products WHERE id='product-quote'"))).rows[0].quantity).toBe(4)
})
it('protège les inverses de la sync, des tombstones, des faux liens et des UPDATE/DELETE SQL',async () => {
 const {pool,tenant,actorId,input}=await fixture();const {result}=await refundCheckout(pool,tenant,actorId,input)
 const cursor=Number((await withTenantClient(pool,tenant,(db) => db.query<{revision:string}>('SELECT revision FROM sync_state'))).rows[0].revision)
 const payload={...empty(),revenues:[{...result.records.revenues[0],amount:1},{...result.records.revenues[0],id:'forged-refund'}],cashMovements:[{...result.records.cashMovements[0],amount:1}],stockMovements:[{...result.records.stockMovements[0],quantityDelta:100}]}
 const sync=await syncWithNeonDatabase(pool,{payload,cursor},tenant,'manager')
 expect(sync.rejected).toHaveLength(4);expect(sync.rejected.every((row) => row.code==='FINALIZED_CHECKOUT_RECORD')).toBe(true)
 const deletion=await syncWithNeonDatabase(pool,{payload:empty(),cursor,tombstones:[{entityType:'revenue',entityId:result.records.revenues[0].id,deletedAt:new Date().toISOString()}]},tenant,'manager')
 expect(deletion.rejected[0].code).toBe('FINALIZED_CHECKOUT_RECORD')
 for(const [table,id] of [['revenues',result.records.revenues[0].id],['cash_movements',result.records.cashMovements[0].id],['stock_movements',result.records.stockMovements[0].id]]) await expect(withTenantClient(pool,tenant,(db) => db.query(`DELETE FROM ${table} WHERE id=$1`,[id]))).rejects.toThrow('requires a reversal')
})
it('status est en lecture seule et les métadonnées restent isolées par salon',async () => {
 const {pool,tenant,actorId,input,financialState}=await fixture();const before=await financialState()
 expect(await refundStatus(pool,tenant,actorId,{idempotencyKey:input.idempotencyKey})).toMatchObject({status:'not_found'})
 expect(await financialState()).toEqual(before)
 const {result}=await refundCheckout(pool,tenant,actorId,input);const after=await financialState()
 expect(await refundStatus(pool,tenant,actorId,{idempotencyKey:input.idempotencyKey})).toEqual({status:'refunded',result})
 expect(await financialState()).toEqual(after)
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenant])).rows[0].id
 await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[other,actorId])
 await expect(refundCheckout(pool,other,actorId,input)).rejects.toMatchObject({code:'REFUND_TICKET_UNAVAILABLE'})
 await withTenantClient(pool,other,async (db) => {expect((await db.query('SELECT * FROM checkout_refunds')).rows).toEqual([]);expect((await db.query('SELECT * FROM checkout_refund_records')).rows).toEqual([])})
})
it('inverse aussi la commission fixe par quantité sans revaloriser le remboursement en commission positive',async () => {
 const {pool,tenant,actorId,input,sale}=await fixture();const {result}=await refundCheckout(pool,tenant,actorId,input)
 const employee={id:'employee',commissionEnabled:true,commissionRate:10,commissionBasis:'employee_services'} as Employee
 const service={id:sale.records.revenues[0].serviceId!,commissionOverride:{mode:'fixed',value:500}} as ServiceCatalogItem
 const rows=[sale.records.revenues[0],result.records.revenues[0]].map((row) => ({...row,employeeId:employee.id}))
 expect(calculateEmployeeCommission(employee,rows,[service]).commissionAmount).toBe(0)
})
it('utilise une nouvelle caisse ouverte sans réécrire la clôture de la caisse de vente',async () => {
 const {pool,tenant,actorId,input,sale}=await fixture();const time=new Date().toISOString()
 const closed={...sale.records.cashSession!,status:'closed' as const,closedAt:time,countedClosingBalance:5000,discrepancy:0,updatedAt:time}
 const opened={id:'refund-new-drawer',status:'open' as const,openingBalance:4000,openedAt:time,totalCashIn:0,totalCashOut:0,theoreticalClosingBalance:4000,createdAt:time,updatedAt:time}
 const cursor=Number((await withTenantClient(pool,tenant,(db) => db.query<{revision:string}>('SELECT revision FROM sync_state'))).rows[0].revision)
 const closing=await syncWithNeonDatabase(pool,{payload:{...empty(),cashSessions:[closed,opened]},cursor},tenant,'manager')
 expect(closing.rejected).toEqual([])
 const before=(await withTenantClient(pool,tenant,(db) => db.query("SELECT payload_json FROM cash_sessions WHERE id='cash-quote'"))).rows
 await expect(refundCheckout(pool,tenant,actorId,input)).rejects.toMatchObject({code:'REFUND_CASH_SESSION_REQUIRED'})
 const result=await refundCheckout(pool,tenant,actorId,{...input,cashSessionId:opened.id})
 expect(result.result.records.cashSession).toMatchObject({id:opened.id,totalCashOut:4000,theoreticalClosingBalance:0})
 expect((await withTenantClient(pool,tenant,(db) => db.query("SELECT payload_json FROM cash_sessions WHERE id='cash-quote'"))).rows).toEqual(before)
})
it('recalcule le CUMP du retour au coût historique et refuse un Gérant désactivé',async () => {
 const {pool,tenant,actorId,input}=await fixture()
 await withTenantClient(pool,tenant,async (db) => {
  await db.query("UPDATE products SET cost_price=300,payload_json=jsonb_set(payload_json,'{costPrice}','300') WHERE id='product-quote'")
 })
 const {result}=await refundCheckout(pool,tenant,actorId,input)
 expect(result.records.products[0]).toMatchObject({quantity:6,costPrice:233}) // (4*300+2*100)/6 arrondi
 await pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[tenant,actorId])
 await expect(refundCheckout(pool,tenant,actorId,input)).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
 await expect(refundStatus(pool,tenant,actorId,{idempotencyKey:input.idempotencyKey})).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
})
it('relie la file Dexie au vrai contrat API et récupère la réponse perdue sans seconde écriture',async () => {
 const { SalonProDatabase }=await import('../db/database')
 const { workspaceKey }=await import('../db/accountWorkspace')
 const { prepareRefundIntent, operateRefundIntent, readRefundIntent }=await import('../db/checkoutRefundQueue')
 const {pool,tenant,actorId,manager,input,sale,financialState}=await fixture()
 const user={id:actorId,tenantId:tenant,role:'manager' as const,isActive:true,email:'queue-refund@example.invalid',fullName:'Responsable',createdAt:'2026-10-31',updatedAt:'2026-10-31'}
 const database=new SalonProDatabase(`refund-contract-${crypto.randomUUID()}`)
 try {
  await database.open()
  await database.workspaceMeta.bulkPut([{key:'cloudTenantId',value:tenant},{key:'accountScope',value:workspaceKey(user)}])
  const row=await prepareRefundIntent(database,user,sale,input)
  await operateRefundIntent(database,user,sale.ticketId,'send',async (intent) => {
   const response=await apiTestClient(pool,'POST','/api/checkout/refund',intent.command,manager)
   expect(response.status).toBe(200)
   throw new Error('server committed, response lost')
  })
  expect((await readRefundIntent(database,user,sale.ticketId))?.state).toBe('uncertain')
  const after=await financialState()
  await operateRefundIntent(database,user,sale.ticketId,'status',async (intent,operation) => {
   expect(operation).toBe('status');expect(intent.command.idempotencyKey).toBe(row.command.idempotencyKey)
   return apiTestClient(pool,'POST','/api/checkout/refund/status',{idempotencyKey:intent.command.idempotencyKey},manager)
  })
  const recovered=await readRefundIntent(database,user,sale.ticketId)
  expect(recovered?.state).toBe('refunded')
  const { printableRefund }=await import('../lib/refundReceipt')
  expect(printableRefund(recovered!,user)?.receiptNumber).toBe('SPR-0000000002')
  const { exportRefundIntents, restoreRefundIntents }=await import('../db/checkoutRefundRecovery')
  const target=new SalonProDatabase(`refund-contract-restored-${crypto.randomUUID()}`)
  try {
   await target.open()
   await target.workspaceMeta.bulkPut([{key:'cloudTenantId',value:tenant},{key:'accountScope',value:workspaceKey(user)}])
   await restoreRefundIntents(target,user,await exportRefundIntents(database,user))
   expect((await readRefundIntent(target,user,sale.ticketId))?.result).toBeUndefined()
   expect(await target.checkoutOutbox.count()).toBe(0)
   await operateRefundIntent(target,user,sale.ticketId,'status',async (intent) => apiTestClient(pool,'POST','/api/checkout/refund/status',{idempotencyKey:intent.command.idempotencyKey},manager))
   const restored=await readRefundIntent(target,user,sale.ticketId)
   expect(printableRefund(restored!,user)?.receiptNumber).toBe('SPR-0000000002')
   expect(await target.revenues.count()).toBe(0)
  } finally {target.close();await target.delete()}
  expect(await financialState()).toEqual(after)
  expect(await database.revenues.count()).toBe(0)
 } finally {database.close();await database.delete()}
})

it('contrôle canonique en lecture seule puis reprise API atomique avec la même clé et rejeu',async () => {
 const {pool,tenant,actorId,manager,input,sale,financialState}=await fixture()
 const before=await financialState();const counters=await pool.query('SELECT * FROM checkout_counters')
 const response=await apiTestClient(pool,'POST','/api/checkout/refund/review',{command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber},manager)
 expect(response.status,JSON.stringify(response.body)).toBe(200)
 const review=response.body.review as import('../domain/checkoutRefund').CheckoutRefundReview
 expect(review).toMatchObject({status:'reviewed',actorId,tenantId:tenant,total:10000,originalReceiptNumber:sale.receiptNumber,command:input})
 expect(review.lines.map((row) => row.amount)).toEqual([9000,1000]);expect(review.lines.map((row) => row.returned)).toEqual([false,true])
 expect(review.precondition.fingerprint).toMatch(/^[a-f0-9]{64}$/)
 expect(await financialState()).toEqual(before);expect((await pool.query('SELECT * FROM checkout_counters')).rows).toEqual(counters.rows)
 const envelope={command:input,precondition:review.precondition}
 const resumed=await apiTestClient(pool,'POST','/api/checkout/refund/resume',envelope,manager)
 expect(resumed.status,JSON.stringify(resumed.body)).toBe(200);expect(resumed.body.replayed).toBe(false)
 const after=await financialState()
 const replay=await apiTestClient(pool,'POST','/api/checkout/refund/resume',envelope,manager)
 expect(replay.status).toBe(200);expect(replay.body.replayed).toBe(true);expect(replay.body.result).toEqual(resumed.body.result)
 expect(await financialState()).toEqual(after)
})
it('refuse le total ou reçu importé altéré et les champs inattendus du contrôle',async () => {
 const {pool,manager,input,sale,financialState}=await fixture();const before=await financialState()
 const envelope={command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber}
 for(const patch of [{expectedTotal:1},{expectedOriginalReceiptNumber:'SPC-9999'}]) {
  const response=await apiTestClient(pool,'POST','/api/checkout/refund/review',{...envelope,...patch},manager)
  expect(response.status).toBe(409);expect(response.body.code).toBe('REFUND_REVIEW_MISMATCH')
 }
 expect((await apiTestClient(pool,'POST','/api/checkout/refund/review',{...envelope,tenantId:'forged'},manager)).status).toBe(400)
 expect(await financialState()).toEqual(before)
})
it('lie les préconditions au contenu, clé, référence et montant sans effets sur refus',async () => {
 const { reviewRefund, resumeRefund }=await import('../../server/checkoutRefund')
 const {pool,tenant,actorId,input,sale,financialState}=await fixture()
 const review=await reviewRefund(pool,tenant,actorId,{command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber})
 const before=await financialState()
 for(const precondition of [{...review.precondition,total:1},{...review.precondition,originalReceiptNumber:'SPC-999'},{...review.precondition,fingerprint:'0'.repeat(64)}]) await expect(resumeRefund(pool,tenant,actorId,{command:input,precondition})).rejects.toMatchObject({code:'REFUND_REVIEW_MISMATCH'})
 for(const command of [{...input,reason:'Motif changé'},{...input,idempotencyKey:'refund-rekey-forbidden-0001'},{...input,returnLineIds:[]},{...input,paymentReferences:[{method:'wave',reference:'Autre référence'}]}]) await expect(resumeRefund(pool,tenant,actorId,{command,precondition:review.precondition})).rejects.toMatchObject({code:'REFUND_REVIEW_MISMATCH'})
 await expect(resumeRefund(pool,tenant,actorId,{command:input})).rejects.toMatchObject({code:'INVALID_REFUND'})
 expect(await financialState()).toEqual(before)
})
it('revalide les fonds et le Gérant après le contrôle ; ce dernier ne réserve pas la caisse',async () => {
 const { reviewRefund, resumeRefund }=await import('../../server/checkoutRefund')
 const {pool,tenant,actorId,input,sale,financialState}=await fixture()
 const review=await reviewRefund(pool,tenant,actorId,{command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber})
 const time=new Date().toISOString()
 await syncWithNeonDatabase(pool,{payload:{...empty(),cashMovements:[{id:'manual-after-review',categoryCode:'other',sessionId:'cash-quote',type:'out',amount:2000,reason:'Sortie réelle après contrôle',paymentMethod:'cash',occurredAt:time,createdAt:time,updatedAt:time}]}},tenant,'manager')
 const before=await financialState()
 await expect(resumeRefund(pool,tenant,actorId,{command:input,precondition:review.precondition})).rejects.toMatchObject({code:'REFUND_CASH_INSUFFICIENT'})
 expect(await financialState()).toEqual(before)
 await pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[tenant,actorId])
 await expect(resumeRefund(pool,tenant,actorId,{command:input,precondition:review.precondition})).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
})
it('refuse la reprise si un autre remboursement a été confirmé entre contrôle et exécution',async () => {
 const { reviewRefund, resumeRefund }=await import('../../server/checkoutRefund')
 const {pool,tenant,actorId,input,sale,financialState}=await fixture()
 const review=await reviewRefund(pool,tenant,actorId,{command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber})
 await refundCheckout(pool,tenant,actorId,{...input,idempotencyKey:'refund-concurrent-other-0001'})
 const before=await financialState()
 await expect(resumeRefund(pool,tenant,actorId,{command:input,precondition:review.precondition})).rejects.toMatchObject({code:'TICKET_ALREADY_REFUNDED'})
 await expect(reviewRefund(pool,tenant,actorId,{command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber})).rejects.toMatchObject({code:'REFUND_ALREADY_CONFIRMED'})
 expect(await financialState()).toEqual(before)
})
it('review/resume imposent POST, session, migration, Gérant et isolation salon',async () => {
 const { reviewRefund }=await import('../../server/checkoutRefund')
 const {pool,tenant,actorId,cashierId,manager,cashier,input,sale}=await fixture()
 const envelope={command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber}
 for(const path of ['/api/checkout/refund/review','/api/checkout/refund/resume']) {
  expect((await apiTestClient(pool,'POST',path,envelope)).status).toBe(401)
  expect((await apiTestClient(pool,'GET',path,undefined,manager)).status).toBe(405)
 }
 expect((await apiTestClient(pool,'POST','/api/checkout/refund/review',envelope,cashier)).status).toBe(403)
 const review=await reviewRefund(pool,tenant,actorId,envelope)
 await expect((await import('../../server/checkoutRefund')).resumeRefund(pool,tenant,cashierId,{command:input,precondition:review.precondition})).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenant])).rows[0].id
 await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[other,actorId])
 await expect(reviewRefund(pool,other,actorId,envelope)).rejects.toMatchObject({code:'REFUND_TICKET_UNAVAILABLE'})
})
it('refuse le contrôle canonique quand 007 est absente',async () => {
 const legacy=await setup(true)
 const envelope={command:{idempotencyKey:'refund-migration-test-key-0001',originalTicketId:'canonical-ticket',reason:'Retour',returnLineIds:[],paymentReferences:[]},expectedTotal:10000,expectedOriginalReceiptNumber:'SPC-0000000001'}
 expect((await apiTestClient(legacy.pool,'POST','/api/checkout/refund/review',envelope,legacy.manager)).status).toBe(503)
})
it('restaure sur un autre appareil puis reprend le vrai remboursement via contrôle canonique, sans rekey',async () => {
 const { SalonProDatabase }=await import('../db/database');const { workspaceKey }=await import('../db/accountWorkspace')
 const { prepareRefundIntent, operateRefundIntent, readRefundIntent, reviewRestoredRefund }=await import('../db/checkoutRefundQueue')
 const { exportRefundIntents, restoreRefundIntents }=await import('../db/checkoutRefundRecovery')
 const {pool,tenant,actorId,manager,input,sale,financialState}=await fixture()
 const user={id:actorId,tenantId:tenant,role:'manager' as const,isActive:true,email:'resume@example.invalid',fullName:'Responsable',createdAt:'2026-10-31',updatedAt:'2026-10-31'}
 const source=new SalonProDatabase(`source-resume-${crypto.randomUUID()}`);const target=new SalonProDatabase(`target-resume-${crypto.randomUUID()}`)
 try {
  for(const db of [source,target]) {await db.open();await db.workspaceMeta.bulkPut([{key:'cloudTenantId',value:tenant},{key:'accountScope',value:workspaceKey(user)}])}
  const initial=await prepareRefundIntent(source,user,sale,input)
  await restoreRefundIntents(target,user,await exportRefundIntents(source,user))
  const before=await financialState()
  await operateRefundIntent(target,user,sale.ticketId,'status',async (row) => apiTestClient(pool,'POST','/api/checkout/refund/status',{idempotencyKey:row.command.idempotencyKey},manager))
  await reviewRestoredRefund(target,user,sale.ticketId,async (row) => apiTestClient(pool,'POST','/api/checkout/refund/review',{command:row.command,expectedTotal:row.total,expectedOriginalReceiptNumber:row.originalReceiptNumber},manager))
  expect(await financialState()).toEqual(before)
  await operateRefundIntent(target,user,sale.ticketId,'send',async (row) => {
   expect(row.command.idempotencyKey).toBe(initial.command.idempotencyKey)
   const result=await apiTestClient(pool,'POST','/api/checkout/refund/resume',{command:row.command,precondition:row.review!.precondition},manager)
   expect(result.status).toBe(200)
   throw new Error('response lost after resume')
  })
  const after=await financialState()
  await operateRefundIntent(target,user,sale.ticketId,'status',async (row) => apiTestClient(pool,'POST','/api/checkout/refund/status',{idempotencyKey:row.command.idempotencyKey},manager))
  expect((await readRefundIntent(target,user,sale.ticketId))?.state).toBe('refunded')
  expect(await financialState()).toEqual(after);expect(await target.revenues.count()).toBe(0)
 } finally {for(const db of [source,target]) {db.close();await db.delete()}}
})

it('diagnostique caisse clôturée et fonds insuffisants depuis le journal sans aucune correction',async () => {
 const { diagnoseRefund }=await import('../../server/checkoutRefundDiagnostic')
 const {pool,tenant,actorId,input,sale,financialState,manager}=await fixture()
 await withTenantClient(pool,tenant,(db) => db.query("UPDATE cash_sessions SET status='closed',payload_json=jsonb_set(payload_json,'{status}','\"closed\"') WHERE id='cash-quote'"))
 const before=await financialState()
 const sessions=(await pool.query('SELECT payload_json FROM cash_sessions')).rows
 const counters=(await pool.query('SELECT * FROM checkout_counters')).rows
 const response=await apiTestClient(pool,'POST','/api/checkout/refund/diagnostic',{command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber},manager)
 expect(response.status,JSON.stringify(response.body)).toBe(200)
 const result=response.body.diagnostic as import('../domain/checkoutRefund').CheckoutRefundDiagnostic
 expect(result).toMatchObject({cashRequired:4000,cashBalance:5000,blockers:[{code:'CASH_SESSION_CLOSED',entityId:'cash-quote'}]})
 expect(await financialState()).toEqual(before);expect((await pool.query('SELECT payload_json FROM cash_sessions')).rows).toEqual(sessions)
 expect((await pool.query('SELECT * FROM checkout_counters')).rows).toEqual(counters)
 // Deliberately stale cached totals must not override the authoritative movement journal.
 await pool.query("UPDATE cash_sessions SET payload_json=jsonb_set(payload_json,'{theoreticalClosingBalance}','999999') WHERE id='cash-quote'")
 await pool.query("INSERT INTO cash_movements(id,tenant_id,session_id,type,amount,occurred_at,updated_at,payload_json) VALUES('diagnostic-out',$1,'cash-quote','out',3000,now(),now(),'{}')",[tenant])
 const low=await diagnoseRefund(pool,tenant,actorId,{command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber})
 expect(low.cashBalance).toBe(2000);expect(low.blockers.map((row) => row.code)).toEqual(['CASH_SESSION_CLOSED','CASH_INSUFFICIENT'])
})
it('diagnostique les retours impossibles et ne recrée ni produit ni stock',async () => {
 const { diagnoseRefund }=await import('../../server/checkoutRefundDiagnostic')
 const {pool,tenant,actorId,input,sale,financialState}=await fixture()
 const envelope={command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber}
 await withTenantClient(pool,tenant,(db) => db.query("UPDATE products SET quantity=2147483647,payload_json=jsonb_set(payload_json,'{quantity}','2147483647') WHERE id='product-quote'"))
 const before=await financialState()
 expect((await diagnoseRefund(pool,tenant,actorId,envelope)).blockers).toContainEqual(expect.objectContaining({code:'RETURN_QUANTITY_OVERFLOW',entityId:'product-quote'}))
 expect(await financialState()).toEqual(before)
 await pool.query("UPDATE products SET quantity=4,payload_json=jsonb_set(payload_json,'{quantity}','4') WHERE id='product-quote'")
 await withTenantClient(pool,tenant,(db) => db.query("DELETE FROM products WHERE id='product-quote'"))
 expect((await diagnoseRefund(pool,tenant,actorId,envelope)).blockers).toContainEqual(expect.objectContaining({code:'PRODUCT_UNAVAILABLE',entityId:'product-quote'}))
 expect((await pool.query("SELECT * FROM products WHERE id='product-quote'")).rows).toHaveLength(0)
})
it('diagnostic sain n’autorise pas un remboursement et garde les droits/isolations/migrations',async () => {
 const { diagnoseRefund }=await import('../../server/checkoutRefundDiagnostic')
 const {pool,tenant,actorId,cashierId,input,sale,manager,financialState}=await fixture()
 const envelope={command:input,expectedTotal:10000,expectedOriginalReceiptNumber:sale.receiptNumber}
 const before=await financialState()
 const result=await diagnoseRefund(pool,tenant,actorId,envelope)
 expect(result.blockers).toEqual([]);expect(await financialState()).toEqual(before)
 expect((await pool.query('SELECT * FROM checkout_refunds')).rows).toEqual([])
 await expect(diagnoseRefund(pool,tenant,cashierId,envelope)).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
 expect((await apiTestClient(pool,'POST','/api/checkout/refund/diagnostic',envelope)).status).toBe(401)
 expect((await apiTestClient(pool,'GET','/api/checkout/refund/diagnostic',undefined,manager)).status).toBe(405)
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenant])).rows[0].id
 await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[other,actorId])
 await expect(diagnoseRefund(pool,other,actorId,envelope)).rejects.toMatchObject({code:'REFUND_TICKET_UNAVAILABLE'})
 await expect(diagnoseRefund(pool,tenant,actorId,{...envelope,expectedTotal:1})).rejects.toMatchObject({code:'REFUND_REVIEW_MISMATCH'})
})
it('refuse le diagnostic quand 007 est absente',async () => {
 const legacy=await setup(true)
 const envelope={command:{idempotencyKey:'refund-migration-test-key-0001',originalTicketId:'canonical-ticket',reason:'Retour',returnLineIds:[],paymentReferences:[]},expectedTotal:10000,expectedOriginalReceiptNumber:'SPC-0000000001'}
 expect((await apiTestClient(legacy.pool,'POST','/api/checkout/refund/diagnostic',envelope,legacy.manager)).status).toBe(503)
})
