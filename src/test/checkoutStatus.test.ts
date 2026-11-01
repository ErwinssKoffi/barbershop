import { expect, it } from 'vitest'
import { setup, command } from './checkoutTestFixtures'
import { apiTestClient } from './apiTestClient'
import { checkoutStatus } from '../../server/checkoutStatus'
import { withTenantClient } from '../../server/tenantContext'

it('refuse la vérification sans session ou sans migration 006',async () => {
 const {pool,manager,financialState}=await setup()
 const before=await financialState()
 expect((await apiTestClient(pool,'POST','/api/checkout/status',{idempotencyKey:command().idempotencyKey})).status).toBe(401)
 const unavailable=await apiTestClient(pool,'POST','/api/checkout/status',{idempotencyKey:command().idempotencyKey},manager)
 expect(unavailable.status).toBe(503);expect(unavailable.body.code).toBe('CHECKOUT_MIGRATION_REQUIRED')
 expect(await financialState()).toEqual(before)
})
it('consulte une clé absente puis confirmée sans consommer reçu, stock ni révision',async () => {
 const {pool,manager,tenant,actorId,financialState}=await setup(true)
 const input={idempotencyKey:command().idempotencyKey};const before=await financialState()
 const absent=await apiTestClient(pool,'POST','/api/checkout/status',input,manager)
 expect(absent.status).toBe(200)
 expect(absent.body).toEqual({ok:true,status:'not_found',...input,tenantId:tenant,actorId})
 expect(await financialState()).toEqual(before)
 expect((await pool.query('SELECT * FROM checkout_commands')).rows).toEqual([])
 expect((await pool.query('SELECT * FROM checkout_counters')).rows).toEqual([])
 const committed=await apiTestClient(pool,'POST','/api/checkout/commit',command(),manager)
 expect(committed.status).toBe(200)
 expect(committed.body.result).toMatchObject({receiptNumber:'SPC-0000000001'})
 const after=await financialState()
 const found=await apiTestClient(pool,'POST','/api/checkout/status',input,manager)
 expect(found.body).toEqual({ok:true,status:'confirmed',result:committed.body.result})
 expect(await financialState()).toEqual(after)
})
it('ne livre pas le résultat à un autre acteur et refuse champs forgés, compte inactif ou mauvaise méthode',async () => {
 const {pool,manager,cashier,tenant,actorId}=await setup(true)
 await apiTestClient(pool,'POST','/api/checkout/commit',command(),manager)
 const input={idempotencyKey:command().idempotencyKey}
 const forbidden=await apiTestClient(pool,'POST','/api/checkout/status',input,cashier)
 expect(forbidden.status).toBe(403);expect(forbidden.body).not.toHaveProperty('result')
 for(const value of [null,{},[],{...input,tenantId:tenant},{...input,actorId}, {idempotencyKey:'short'}]) expect((await apiTestClient(pool,'POST','/api/checkout/status',value,manager)).status).toBe(400)
 expect((await apiTestClient(pool,'GET','/api/checkout/status',undefined,manager)).status).toBe(405)
 await withTenantClient(pool,tenant,(db) => db.query('UPDATE memberships SET is_active = false WHERE user_id = $1',[actorId]))
 await expect(checkoutStatus(pool,tenant,actorId,input)).rejects.toMatchObject({status:403,code:'TENANT_ACCESS_DENIED'})
})
it('isole une même clé dans un autre salon du même acteur sans créer de commande',async () => {
 const {pool,manager,tenant,actorId,financialState}=await setup(true)
 await apiTestClient(pool,'POST','/api/checkout/commit',command(),manager)
 const before=await financialState()
 const other=(await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id = $1 RETURNING id',[tenant])).rows[0].id
 await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[other,actorId])
 expect(await checkoutStatus(pool,other,actorId,{idempotencyKey:command().idempotencyKey})).toMatchObject({status:'not_found',tenantId:other})
 await withTenantClient(pool,other,async (db) => {
  expect((await db.query('SELECT * FROM checkout_commands')).rows).toEqual([])
  expect((await db.query('SELECT * FROM checkout_counters')).rows).toEqual([])
 })
 expect(await financialState()).toEqual(before)
})
