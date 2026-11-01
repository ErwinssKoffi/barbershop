import { describe, expect, it } from 'vitest'
import { command, setup } from './checkoutTestFixtures'
import { apiTestClient } from './apiTestClient'
import { commitCheckout } from '../../server/checkoutCommit'
import { withTenantClient } from '../../server/tenantContext'
import { syncWithNeonDatabase } from '../../server/syncEngine'
import type { CheckoutResult } from '../domain/checkout'
import type { SalonBackupPayload } from '../domain/models'
import type { SqlPoolLike } from '../../server/neonClient'

const empty = (): SalonBackupPayload => ({ format:'SALON_PRO_BACKUP_V1',exportedAt:new Date().toISOString() } as SalonBackupPayload)

describe('Finalisation PostgreSQL — opt-in, atomique, idempotente', () => {
 it('garde 006 désactivée par défaut et ne finalise pas sans migration approuvée', async () => {
  const { pool,manager,financialState } = await setup()
  const before = await financialState()
  const response = await apiTestClient(pool,'POST','/api/checkout/commit',command(),manager)
  expect(response.status).toBe(503); expect(response.body.code).toBe('CHECKOUT_MIGRATION_REQUIRED')
  expect(await financialState()).toEqual(before)
 })
 it('écrit ventes, consommables, revente, espèces et total de caisse ; rejeu après déconnexion identique sans doublons', async () => {
  const { pool,tenant,manager,actorId,financialState } = await setup(true)
  const first = await apiTestClient(pool,'POST','/api/checkout/commit',command(),manager)
  expect(first.status,JSON.stringify(first.body)).toBe(200)
  const result = first.body.result as CheckoutResult
  expect(result).toMatchObject({status:'confirmed',confirmed:true,actorId,receiptNumber:'SPC-0000000001'})
  expect(result.records.revenues).toHaveLength(2)
  expect(result.records.revenues.map((row) => row.amount)).toEqual([9000,1000])
  expect(result.records.revenues.flatMap((row) => row.paymentSplits ?? []).reduce((sum,p) => sum + p.amount,0)).toBe(10000)
  expect(result.records.products[0].quantity).toBe(4)
  expect(result.records.stockMovements.map((row) => row.quantityDelta)).toEqual([-4,-2])
  expect(result.records.cashMovements.reduce((sum,row) => sum + row.amount,0)).toBe(4000)
  expect(result.records.cashSession).toMatchObject({totalCashIn:4000,totalCashOut:0,theoreticalClosingBalance:5000})
  const beforeReplay = await financialState()
  const replay = await apiTestClient(pool,'POST','/api/checkout/commit',command(),manager)
  expect(replay.body).toEqual({ok:true,result,replayed:true})
  expect(await financialState()).toEqual(beforeReplay)
  const metadata = await withTenantClient(pool,tenant,async (db) => (await db.query('SELECT (SELECT count(*) FROM checkout_commands)::int AS commands, (SELECT count(*) FROM checkout_records)::int AS records')).rows[0])
  expect(metadata).toEqual({commands:1,records:5})
 })
 it('refuse la réutilisation de clé avec un autre contenu ou un autre acteur ; manager et caissier partagent le moteur', async () => {
  const { pool,tenant,actorId,cashierId,cashier } = await setup(true)
  const first = await apiTestClient(pool,'POST','/api/checkout/commit',command(),cashier)
  expect(first.status,JSON.stringify(first.body)).toBe(200)
  expect((first.body.result as CheckoutResult).actorId).toBe(cashierId)
  const changed = {...command(),clientName:'Autre client'}
  await expect(commitCheckout(pool,tenant,cashierId,changed)).rejects.toMatchObject({status:409,code:'IDEMPOTENCY_CONFLICT'})
  await expect(commitCheckout(pool,tenant,actorId,command())).rejects.toMatchObject({status:409,code:'CHECKOUT_ACTOR_CONFLICT'})
  const second = {...command(),idempotencyKey:'checkout-second-key-0002',lines:[{kind:'product' as const,catalogId:'product-quote',quantity:1}],payments:[{method:'wave',amount:500}],expectedTotal:500}
  delete second.amountTendered; delete second.cashSessionId
  const committed = await commitCheckout(pool,tenant,actorId,second)
  expect(committed.result.receiptNumber).toBe('SPC-0000000002')
  expect(committed.result.records.cashMovements).toEqual([])
  expect(committed.result.records.cashSession).toBeUndefined()
 })
 it('annule toutes les écritures et le compteur si une erreur survient après les mouvements de caisse', async () => {
  const { pool,tenant,actorId,financialState } = await setup(true)
  const before = await financialState()
  const broken: SqlPoolLike = { query:pool.query.bind(pool),connect:async () => {
   const client = await pool.connect()
   return { release:() => client.release(),query:async (sql,values) => {
    if (sql.startsWith('INSERT INTO checkout_records')) throw new Error('injected persistence failure')
    return client.query(sql,values)
   } }
  } }
  await expect(commitCheckout(broken,tenant,actorId,command())).rejects.toThrow('injected persistence failure')
  expect(await financialState()).toEqual(before)
  expect((await pool.query('SELECT * FROM checkout_commands')).rows).toEqual([])
  expect((await pool.query('SELECT * FROM checkout_counters')).rows).toEqual([])
  const retry = await commitCheckout(pool,tenant,actorId,command())
  expect(retry.result.receiptNumber).toBe('SPC-0000000001')
 })
 it('rejette un stock insuffisant sans réserver de reçu et rejoue sans relire le catalogue modifié', async () => {
  const { pool,tenant,actorId,financialState } = await setup(true)
  const before = await financialState()
  const invalid = command(); invalid.lines[0].quantity = 10; invalid.expectedTotal = 46000; invalid.payments = [{method:'wave',amount:46000}]; delete invalid.amountTendered
  await expect(commitCheckout(pool,tenant,actorId,invalid)).rejects.toMatchObject({code:'INSUFFICIENT_STOCK'})
  expect(await financialState()).toEqual(before)
  const first = await commitCheckout(pool,tenant,actorId,command())
  await withTenantClient(pool,tenant,(db) => db.query("UPDATE services_catalog SET payload_json = jsonb_set(payload_json,'{isActive}','false')"))
  expect(await commitCheckout(pool,tenant,actorId,command())).toEqual({...first,replayed:true})
 })
 it('protège les lignes confirmées, les références forgées et les tombstones contre la synchronisation historique', async () => {
  const { pool,tenant,actorId } = await setup(true)
  const { result } = await commitCheckout(pool,tenant,actorId,command())
  const state = async () => Number((await withTenantClient(pool,tenant,(db) => db.query<{revision:string}>('SELECT revision FROM sync_state'))).rows[0].revision)
  const payload = empty()
  payload.revenues = [{...result.records.revenues[0],amount:1},{...result.records.revenues[0],id:'forged-revenue'}]
  payload.stockMovements = [{...result.records.stockMovements[0],quantityDelta:100},{...result.records.stockMovements[0],id:'forged-stock'}]
  payload.cashMovements = [{...result.records.cashMovements[0],amount:1},{...result.records.cashMovements[0],id:'forged-cash'}]
  const sync = await syncWithNeonDatabase(pool,{payload,cursor:await state()},tenant,'manager')
  expect(sync.rejected).toHaveLength(6)
  expect(sync.rejected.every((r) => r.code === 'FINALIZED_CHECKOUT_RECORD')).toBe(true)
  const tombstones = [
   {id:'del-rev',entityType:'revenue' as const,entityId:result.records.revenues[0].id,deletedAt:new Date().toISOString()},
   {id:'del-stock',entityType:'stock_movement' as const,entityId:result.records.stockMovements[0].id,deletedAt:new Date().toISOString()},
   {id:'del-cash',entityType:'cash_movement' as const,entityId:result.records.cashMovements[0].id,deletedAt:new Date().toISOString()},
   {id:'del-session',entityType:'cash_session' as const,entityId:'cash-quote',deletedAt:new Date().toISOString()},
  ]
  const deletion = await syncWithNeonDatabase(pool,{payload:empty(),tombstones,cursor:await state()},tenant,'manager')
  expect(deletion.rejected).toHaveLength(4)
  const noop = await syncWithNeonDatabase(pool,{payload:{...empty(),...result.records,cashSessions:[result.records.cashSession!]},cursor:await state()},tenant,'manager')
  expect(noop.rejected).toEqual([])
  await expect(withTenantClient(pool,tenant,(db) => db.query('DELETE FROM revenues WHERE id = $1',[result.records.revenues[0].id]))).rejects.toThrow('requires a reversal')
  for (const [table,id] of [['revenues',result.records.revenues[0].id],['cash_movements',result.records.cashMovements[0].id],['stock_movements',result.records.stockMovements[0].id]]) {
   await expect(withTenantClient(pool,tenant,(db) => db.query(`UPDATE ${table} SET payload_json = jsonb_set(payload_json,'{forged}','true') WHERE id = $1`,[id]))).rejects.toThrow('requires a reversal')
  }
  await expect(withTenantClient(pool,tenant,(db) => db.query("DELETE FROM cash_sessions WHERE id = 'cash-quote'"))).rejects.toThrow('requires a correction')

 })
 it('recalcule les totaux de caisse depuis le journal, sans accepter de fond de caisse modifié', async () => {
  const {pool,tenant,actorId} = await setup(true)
  const {result} = await commitCheckout(pool,tenant,actorId,command())
  const cursor = async () => Number((await withTenantClient(pool,tenant,(db) => db.query<{revision:string}>('SELECT revision FROM sync_state'))).rows[0].revision)
  const payload = {...empty(),cashSessions:[{...result.records.cashSession!,totalCashIn:1,theoreticalClosingBalance:1}]}
  const normalized = await syncWithNeonDatabase(pool,{payload,cursor:await cursor()},tenant,'manager')
  expect(normalized.rejected).toEqual([])
  const row = await withTenantClient(pool,tenant,(db) => db.query<{payload_json:unknown}>("SELECT payload_json FROM cash_sessions WHERE id = 'cash-quote'"))
  expect(row.rows[0].payload_json).toMatchObject({totalCashIn:4000,theoreticalClosingBalance:5000})
  payload.cashSessions[0].openingBalance = 0
  const rejected = await syncWithNeonDatabase(pool,{payload,cursor:await cursor()},tenant,'manager')
  expect(rejected.rejected).toContainEqual({table:'cashSessions',id:'cash-quote',code:'FINALIZED_CHECKOUT_RECORD'})
  const legacy = {...result.records.cashMovements[0],id:'legacy-out',type:'out' as const,amount:100,linkedRevenueId:undefined}
  await syncWithNeonDatabase(pool,{payload:{...empty(),cashMovements:[legacy]},cursor:await cursor()},tenant,'manager')
  const balance = async () => (await withTenantClient(pool,tenant,(db) => db.query<{payload_json:{theoreticalClosingBalance:number}}>("SELECT payload_json FROM cash_sessions WHERE id = 'cash-quote'"))).rows[0].payload_json.theoreticalClosingBalance
  expect(await balance()).toBe(4900)
  await syncWithNeonDatabase(pool,{payload:empty(),cursor:await cursor(),tombstones:[{entityType:'cash_movement',entityId:legacy.id,deletedAt:new Date().toISOString()}]},tenant,'manager')
  expect(await balance()).toBe(5000)

 })
 it('utilise la même clé et le même numéro dans deux salons sans partager stock ni résultat', async () => {
  const {pool,tenant,actorId,snapshot} = await setup(true)
  const first = await commitCheckout(pool,tenant,actorId,command())
  const otherTenant = (await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id = $1 RETURNING id',[tenant])).rows[0].id
  await pool.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'manager')",[otherTenant,actorId])
  const other = {id:actorId,tenantId:otherTenant}
  await syncWithNeonDatabase(pool,{payload:snapshot},other.tenantId,'manager')
  const second = await commitCheckout(pool,other.tenantId,other.id,command())
  expect(second.result.receiptNumber).toBe(first.result.receiptNumber)
  expect(second.result.ticketId).not.toBe(first.result.ticketId)
  expect(second.result.records.products[0].quantity).toBe(4)
  expect(await commitCheckout(pool,tenant,actorId,command())).toEqual({...first,replayed:true})
 })
 it('isole les métadonnées par salon et refuse une appartenance inactive, une session absente et un tenant injecté', async () => {
  const {pool,tenant,actorId,manager} = await setup(true)
  expect((await apiTestClient(pool,'POST','/api/checkout/commit',command())).status).toBe(401)
  expect((await apiTestClient(pool,'POST','/api/checkout/commit',{...command(),tenantId:tenant},manager)).status).toBe(400)
  await commitCheckout(pool,tenant,actorId,command())
  const other = (await pool.query<{id:string}>('INSERT INTO tenants(org_id) SELECT org_id FROM tenants WHERE id = $1 RETURNING id',[tenant])).rows[0].id
  await withTenantClient(pool,other,async (db) => {
   expect((await db.query('SELECT * FROM checkout_commands')).rows).toEqual([])
   expect((await db.query('SELECT * FROM checkout_records')).rows).toEqual([])
   expect((await db.query('SELECT * FROM checkout_counters')).rows).toEqual([])
  })
  await withTenantClient(pool,tenant,(db) => db.query('UPDATE memberships SET is_active = false WHERE user_id = $1',[actorId]))
  await expect(commitCheckout(pool,tenant,actorId,command())).rejects.toMatchObject({code:'TENANT_ACCESS_DENIED'})
 })
})
