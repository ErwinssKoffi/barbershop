import { expect, it } from 'vitest'
import { setup, command } from './checkoutTestFixtures'
import { apiTestClient } from './apiTestClient'
import { commitCheckout } from '../../server/checkoutCommit'
import { searchCheckoutHistory, readCheckoutHistory, parseHistoryQuery } from '../../server/checkoutHistory'
import { runMigrations } from '../../server/migrations'
import { refundCheckout } from '../../server/checkoutRefund'
import { withTenantClient } from '../../server/tenantContext'

it('retrouve la vente du Caissier depuis le Gérant, sans projection ni changement financier',async () => {
 const {pool,tenant,actorId,cashierId,manager,financialState}=await setup(true)
 const sale=(await commitCheckout(pool,tenant,cashierId,command())).result
 const before=await financialState()
 const search=await apiTestClient(pool,'POST','/api/checkout/history/search',{receiptNumber:sale.receiptNumber},manager)
 expect(search.status).toBe(200)
 expect(search.body.rows).toEqual([{ticketId:sale.ticketId,receiptNumber:sale.receiptNumber,confirmedAt:sale.confirmedAt,actorId:cashierId,total:10000,refundStatus:'unavailable'}])
 const detail=await readCheckoutHistory(pool,tenant,actorId,{ticketId:sale.ticketId})
 expect(detail).toEqual({tenantId:tenant,result:sale,refundStatus:'unavailable'})
 expect(await financialState()).toEqual(before)
 expect((await searchCheckoutHistory(pool,tenant,actorId,{receiptNumber:'SPC-9999'})).rows).toEqual([])
 await expect(readCheckoutHistory(pool,tenant,actorId,{ticketId:'unknown'})).rejects.toMatchObject({code:'CHECKOUT_TICKET_NOT_FOUND'})
})
it('pagine sans doublon ni perte à précision microseconde et filtre les jours UTC inclusivement',async () => {
 const {pool,tenant,actorId}=await setup(true)
 await withTenantClient(pool,tenant,(db) => db.query("UPDATE services_catalog SET payload_json=jsonb_set(payload_json,'{defaultConsumables}','[]')"))
 const ids:string[]=[]
 for(let i=0;i<22;i++) {
  const input={idempotencyKey:`history-key-stable-${String(i).padStart(4,'0')}`,lines:[{kind:'service' as const,catalogId:'service-quote',variantId:'variant-long',quantity:1}],payments:[{method:'wave',amount:4500}],expectedTotal:4500}
  ids.push((await commitCheckout(pool,tenant,actorId,input)).result.ticketId)
 }
 await pool.query("UPDATE checkout_commands SET created_at='2026-10-31T23:59:59.123456Z'::timestamptz WHERE tenant_id=$1",[tenant])
 const first=await searchCheckoutHistory(pool,tenant,actorId,{from:'2026-10-31',to:'2026-10-31'})
 expect(first.rows).toHaveLength(20);expect(first.nextCursor?.createdAt).toBe('2026-10-31T23:59:59.123456Z')
 const next=await searchCheckoutHistory(pool,tenant,actorId,{from:'2026-10-31',to:'2026-10-31',cursor:first.nextCursor!})
 expect(next.rows).toHaveLength(2);expect(next.nextCursor).toBeNull()
 const all=[...first.rows,...next.rows].map((row) => row.ticketId)
 expect(new Set(all).size).toBe(22);expect([...all].sort()).toEqual([...ids].sort())
 expect((await searchCheckoutHistory(pool,tenant,actorId,{from:'2026-11-01',to:'2026-11-01'})).rows).toEqual([])
})
it('annote les remboursements sans modifier la vente ni masquer le ticket original',async () => {
 const {pool,tenant,actorId}=await setup(true);await runMigrations(pool,{includeRefunds:true})
 const sale=(await commitCheckout(pool,tenant,actorId,command())).result
 expect((await readCheckoutHistory(pool,tenant,actorId,{ticketId:sale.ticketId})).refundStatus).toBe('not_refunded')
 await refundCheckout(pool,tenant,actorId,{idempotencyKey:'history-refund-stable-0001',originalTicketId:sale.ticketId,reason:'Remboursement autorisé',returnLineIds:[],cashSessionId:'cash-quote',paymentReferences:[{method:'wave',reference:'attestation externe'}]})
 const detail=await readCheckoutHistory(pool,tenant,actorId,{ticketId:sale.ticketId})
 expect(detail.result).toEqual(sale);expect(detail.refundStatus).toBe('refunded')
 expect((await searchCheckoutHistory(pool,tenant,actorId,{})).rows).toHaveLength(1)
 expect((await searchCheckoutHistory(pool,tenant,actorId,{})).rows[0].refundStatus).toBe('refunded')
})
it('exige POST, session, migration et Gérant actif et isole les salons',async () => {
 const {pool,tenant,actorId,manager,cashier,cashierId}=await setup(true)
 const sale=(await commitCheckout(pool,tenant,actorId,command())).result
 for(const path of ['/api/checkout/history/search','/api/checkout/history/detail']) {
  expect((await apiTestClient(pool,'POST',path,{})).status).toBe(401)
  expect((await apiTestClient(pool,'GET',path,undefined,manager)).status).toBe(405)
 }
 expect((await apiTestClient(pool,'POST','/api/checkout/history/search',{},cashier)).status).toBe(403)
 await expect(readCheckoutHistory(pool,tenant,cashierId,{ticketId:sale.ticketId})).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id=$1 RETURNING id',[tenant])).rows[0].id
 await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[other,actorId])
 expect((await searchCheckoutHistory(pool,other,actorId,{})).rows).toEqual([])
 await expect(readCheckoutHistory(pool,other,actorId,{ticketId:sale.ticketId})).rejects.toMatchObject({code:'CHECKOUT_TICKET_NOT_FOUND'})
 await pool.query('UPDATE memberships SET is_active=false WHERE tenant_id=$1 AND user_id=$2',[tenant,actorId])
 await expect(searchCheckoutHistory(pool,tenant,actorId,{})).rejects.toMatchObject({code:'REFUND_MANAGER_REQUIRED'})
})
it('refuse la recherche serveur quand 006 est absente',async () => {
 const legacy=await setup(false)
 expect((await apiTestClient(legacy.pool,'POST','/api/checkout/history/search',{},legacy.manager)).status).toBe(503)
})
it.each([null,[],{tenantId:'forged'},{limit:1000},{receiptNumber:"SPC-1' OR true"},{receiptNumber:'SPR-1'},{from:'2026-01-01'},{from:'2026-02-30',to:'2026-03-01'},{from:'2026-11-01',to:'2026-10-31'},{from:'2020-01-01',to:'2026-01-01'},{cursor:{createdAt:'bad',ticketId:'id'}},{cursor:{createdAt:'2026-10-31',ticketId:'id',tenantId:'forged'}}])('refuse la recherche invalide %j',input => {
 expect(() => parseHistoryQuery(input)).toThrow()
})
