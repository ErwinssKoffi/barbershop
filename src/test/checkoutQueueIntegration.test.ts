import { afterEach, expect, it } from 'vitest'
import { setup, command } from './checkoutTestFixtures'
import { apiTestClient } from './apiTestClient'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { enqueueCheckout, drainCheckoutQueue } from '../db/checkoutQueue'
import { commitCheckout } from '../../server/checkoutCommit'
import { syncWithNeonDatabase } from '../../server/syncEngine'
import type { PublicSalonUser } from '../domain/models'
import type { CheckoutResult } from '../domain/checkout'
import type { CloudDeltaPage } from '../domain/cloudDelta'

let local: SalonProDatabase | undefined
afterEach(async () => {if(local) {local.close();await local.delete();local=undefined}})
it('de Dexie à PostgreSQL : réponse perdue, autre vente, rejeu historique et delta sans double débit ni stock périmé', async () => {
 const {pool,tenant,actorId,manager,snapshot,financialState} = await setup(true)
 const user: PublicSalonUser = {id:actorId,tenantId:tenant,role:'manager',fullName:'Responsable',email:'integration@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
 local = new SalonProDatabase(`queue-integration-${crypto.randomUUID()}`)
 const repo = new SalonRepositoryHub(local);await repo.ensureInitialized(false)
 await local.workspaceMeta.bulkPut([{key:'accountScope',value:workspaceKey(user)},{key:'cloudTenantId',value:tenant}])
 const initial = await syncWithNeonDatabase(pool,{payload:snapshot},tenant,'manager')
 await repo.mergeCloudDelta(initial)
 const job = await enqueueCheckout(local,user,command());let now = Date.now()+10
 let lose = true
 const send = async () => {
  const response = await apiTestClient(pool,'POST','/api/checkout/commit',job.command,manager)
  expect(response.status).toBe(200)
  if (lose) {lose=false;throw new Error('response lost after commit')}
  expect(response.body.replayed).toBe(true)
  return {status:response.status,body:response.body as {ok:boolean;result:CheckoutResult}}
 }
 await drainCheckoutQueue(local,user,send,{now:() => now})
 expect((await local.checkoutOutbox.get(job.idempotencyKey))?.state).toBe('pending')
 const another = {...command(),idempotencyKey:`checkout-${crypto.randomUUID()}`,lines:[{kind:'product' as const,catalogId:'product-quote',quantity:1}],payments:[{method:'wave',amount:500}],expectedTotal:500}
 delete another.amountTendered;delete another.cashSessionId
 await commitCheckout(pool,tenant,actorId,another)
 const pull = await apiTestClient(pool,'GET',`/api/sync/pull?since=${await repo.cloudSyncCursor()}`,undefined,manager)
 await repo.mergeCloudDelta(pull.body as unknown as CloudDeltaPage)
 expect((await local.products.get('product-quote'))?.quantity).toBe(3)
 const cursor = await repo.cloudSyncCursor()
 now += 5000
 expect(await drainCheckoutQueue(local,user,send,{now:() => now})).toMatchObject({confirmed:1})
 const saved = await local.checkoutOutbox.get(job.idempotencyKey)
 expect(saved?.result?.records.products[0].quantity).toBe(4) // historical replay snapshot
 expect((await local.products.get('product-quote'))?.quantity).toBe(3) // never overwritten by that ACK
 expect(await repo.cloudSyncCursor()).toBe(cursor)
 expect(await local.revenues.count()).toBe(3)
 expect((await local.revenues.toArray()).map((row) => row.categoryCode)).toEqual(expect.arrayContaining(['hair_service','product_sale']))
 expect((await local.cashMovements.toArray()).reduce((sum,row) => sum+row.amount,0)).toBe(4000)
 const before = await financialState();await drainCheckoutQueue(local,user,send)
 expect(await financialState()).toEqual(before)
 expect(before).toMatchObject({revenues:3,movements:3,cash:1,quantity:3})
 const delta = await repo.buildCloudDeltaEnvelope()
 expect(delta.payload.revenues).toEqual([]);expect(delta.payload.stockMovements).toEqual([]);expect(delta.payload.cashMovements).toEqual([]);expect(delta.payload.products).toEqual([])
})
