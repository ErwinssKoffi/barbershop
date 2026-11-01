import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SalonProDatabase } from '../db/database'
import { SalonRepositoryHub } from '../db/repositories/salonRepositories'
import { workspaceKey } from '../db/accountWorkspace'
import { enqueueCheckout, drainCheckoutQueue } from '../db/checkoutQueue'
import { deliverCheckout } from '../lib/checkoutClient'
import { storeAuthSession } from '../lib/sessionClient'
import type { CheckoutCommand, CheckoutResult } from '../domain/checkout'
import type { PublicSalonUser } from '../domain/models'
import type { QueuedCheckout } from '../domain/checkoutQueue'

const dbs = new Set<SalonProDatabase>()
afterEach(async () => {vi.unstubAllGlobals(); vi.unstubAllEnvs();window.localStorage.clear();window.sessionStorage.clear();for (const db of dbs) db.close();for (const db of dbs) await db.delete();dbs.clear()})
const user: PublicSalonUser = {id:'queue-user',tenantId:'queue-tenant',role:'manager',fullName:'Compte Caisse',email:'queue@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
const command = (): CheckoutCommand => ({idempotencyKey:`checkout-${crypto.randomUUID()}`,lines:[{kind:'service',catalogId:'service-queue',quantity:1,expectedUnitPrice:500}],payments:[{method:'wave',amount:500}],expectedTotal:500})
async function fixture() {
 const db = new SalonProDatabase(`queue-${crypto.randomUUID()}`); dbs.add(db)
 const repo = new SalonRepositoryHub(db);await repo.ensureInitialized(false)
 await db.workspaceMeta.bulkPut([{key:'cloudTenantId',value:user.tenantId!},{key:'accountScope',value:workspaceKey(user)}])
 return {db,repo}
}
function result(job: QueuedCheckout): CheckoutResult {
 return {tenantId:job.tenantId,status:'confirmed',confirmed:true,ticketId:'checkout-ticket-server',receiptNumber:'SPC-0000000001',actorId:job.actorId,confirmedAt:new Date().toISOString(),command:job.command,
 quote:{status:'quoted',confirmed:false,currency:'XOF',idempotencyKey:job.idempotencyKey,quotedAt:new Date().toISOString(),lines:[],subtotal:500,discount:0,total:500,payments:job.command.payments,cashAmount:0,change:0,stockRequired:[]},records:{revenues:[],products:[],cashMovements:[],stockMovements:[]}}
}
const success = (job: QueuedCheckout) => ({status:200,body:{ok:true,result:result(job)}})

describe('File durable encaissement — IndexedDB', () => {
 it('persiste une intention immuable sans projection métier ni export dans la sync financière', async () => {
  const {db,repo} = await fixture();const input = command()
  const first = await enqueueCheckout(db,user,input)
  expect(first.state).toBe('pending');expect(first).not.toHaveProperty('result')
  expect(await enqueueCheckout(db,user,input)).toEqual(first)
  await expect(enqueueCheckout(db,user,{...input,clientName:'Modification'})).rejects.toThrow('autre contenu')
  input.lines[0].quantity = 100
  db.close();await db.open()
  expect((await db.checkoutOutbox.get(first.idempotencyKey))?.command.lines[0].quantity).toBe(1)
  const envelope = await repo.buildCloudDeltaEnvelope()
  expect(envelope.payload).not.toHaveProperty('checkoutOutbox')
  expect(await db.revenues.count()).toBe(0);expect(await db.cashMovements.count()).toBe(0);expect(await db.stockMovements.count()).toBe(0)
  await expect(enqueueCheckout(db,user,{...command(),lines:[{kind:'service',catalogId:'x',quantity:1.5}]})).rejects.toThrow()
 })
 it('ajoute la version 6 sans effacer les écritures déjà présentes en version 5', async () => {
  const name = `queue-upgrade-${crypto.randomUUID()}`
  const legacy = new Dexie(name);legacy.version(5).stores({revenues:'id',workspaceMeta:'key'})
  await legacy.table('revenues').put({id:'preserved-revenue',amount:7300})
  legacy.close()
  const upgraded = new SalonProDatabase(name);dbs.add(upgraded)
  expect(await upgraded.revenues.get('preserved-revenue')).toMatchObject({amount:7300})
  expect(await upgraded.checkoutOutbox.count()).toBe(0)
 })
 it('bloque la clôture tant que le ticket espèces est inconnu ou son journal non chargé', async () => {
  const {db,repo} = await fixture();const cash = await repo.openCashSession(0)
  const input = {...command(),payments:[{method:'cash',amount:500}],cashSessionId:cash.id}
  const job = await enqueueCheckout(db,user,input)
  await expect(repo.closeCashSession({sessionId:cash.id,countedClosingBalance:500})).rejects.toThrow('confirmation')
  const ack = result(job)
  ack.records.cashMovements = [{id:'server-cash',sessionId:cash.id,type:'in',amount:500,reason:'Ticket confirmé',categoryCode:'hair_service',paymentMethod:'cash',occurredAt:'2026-10-31',createdAt:'2026-10-31',updatedAt:'2026-10-31'}]
  await drainCheckoutQueue(db,user,async () => ({status:200,body:{ok:true,result:ack}}))
  repo.clearDuplicateGuard()
  await expect(repo.closeCashSession({sessionId:cash.id,countedClosingBalance:500})).rejects.toThrow('mouvements confirmés')
  await db.cashMovements.bulkPut(ack.records.cashMovements)
  repo.clearDuplicateGuard()
  expect(await repo.closeCashSession({sessionId:cash.id,countedClosingBalance:500})).toMatchObject({status:'closed',discrepancy:0})
  await expect(enqueueCheckout(db,user,{...input,idempotencyKey:`checkout-${crypto.randomUUID()}`})).rejects.toThrow('Ouvrez une caisse')
 })
 it('refuse un autre compte, rôle ou salon sans déplacer les intentions', async () => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command())
  for (const other of [{...user,id:'other'},{...user,tenantId:'other'},{...user,role:'cashier' as const},{...user,isActive:false}]) {
   await expect(enqueueCheckout(db,other,command())).rejects.toThrow('espace Cloud')
   await expect(drainCheckoutQueue(db,other,async () => success(job))).rejects.toThrow('espace Cloud')
  }
  expect(await db.checkoutOutbox.count()).toBe(1)
 })
 it('réessaie la même clé après réponse perdue, survit à la fermeture et acquitte sans écraser le cache/cursor', async () => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command());let now = Date.now()+10
  await db.workspaceMeta.put({key:'syncCursor',value:'25'})
  const send = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockImplementation(async (row) => success(row))
  expect(await drainCheckoutQueue(db,user,send,{now:() => now})).toMatchObject({pending:1})
  db.close();await db.open()
  await drainCheckoutQueue(db,user,send,{now:() => now});expect(send).toHaveBeenCalledTimes(1)
  now += 5000
  expect(await drainCheckoutQueue(db,user,send,{now:() => now})).toMatchObject({confirmed:1})
  expect(send.mock.calls.map(([row]) => row.idempotencyKey)).toEqual([job.idempotencyKey,job.idempotencyKey])
  const row = await db.checkoutOutbox.get(job.idempotencyKey)
  expect(row?.state).toBe('confirmed');expect(row?.result?.receiptNumber).toBe('SPC-0000000001')
  expect((await db.workspaceMeta.get('syncCursor'))?.value).toBe('25')
  expect(await db.revenues.count()).toBe(0)
  await drainCheckoutQueue(db,user,send,{now:() => now+10_000});expect(send).toHaveBeenCalledTimes(2)
 })
 it.each([401,403,429,500,503])('conserve une commande récupérable après erreur %s', async (status) => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command())
  await drainCheckoutQueue(db,user,async () => ({status,body:{code:status === 503 ? 'CHECKOUT_MIGRATION_REQUIRED' : 'TEMPORARY'},retryAfterMs:60_000}))
  const stored = await db.checkoutOutbox.get(job.idempotencyKey)
  expect(stored?.state).toBe('pending');expect(stored?.result).toBeUndefined()
  expect(stored!.nextAttemptAt-stored!.updatedAt).toBe(60_000)
 })
 it('conserve un refus métier et ne recrée jamais une vente sous une nouvelle clé', async () => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command())
  const send = vi.fn(async () => ({status:409,body:{code:'INSUFFICIENT_STOCK',message:'Stock insuffisant.'}}))
  await drainCheckoutQueue(db,user,send);await drainCheckoutQueue(db,user,send)
  expect(send).toHaveBeenCalledTimes(1)
  expect(await db.checkoutOutbox.get(job.idempotencyKey)).toMatchObject({state:'rejected',error:{code:'INSUFFICIENT_STOCK'}})
  expect(await db.checkoutOutbox.count()).toBe(1);expect(await db.revenues.count()).toBe(0)
 })
 it('sérialise deux onglets et ignore une vieille réponse après expiration du bail', async () => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command());let now = Date.now()+10
  let started!: () => void;const called = new Promise<void>((resolve) => {started=resolve})
  let release!: () => void;const response = new Promise<void>((resolve) => {release=resolve})
  const slow = vi.fn(async () => {started();await response;return {status:409,body:{code:'INSUFFICIENT_STOCK'}}})
  const first = drainCheckoutQueue(db,user,slow,{now:() => now});await called
  const fast = vi.fn(async (row) => success(row))
  await drainCheckoutQueue(db,user,fast,{now:() => now});expect(fast).not.toHaveBeenCalled()
  now += 120_001
  await drainCheckoutQueue(db,user,fast,{now:() => now});expect(fast).toHaveBeenCalledTimes(1)
  release();await first
  expect(await db.checkoutOutbox.get(job.idempotencyKey)).toMatchObject({state:'confirmed'})
 })
 it.each(['actor','tenant','command','body'])('ne confirme pas un acquittement incohérent (%s)', async (kind) => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command());const ack = result(job)
  if (kind === 'actor') ack.actorId = 'other'
  if (kind === 'tenant') ack.tenantId = 'other'
  if (kind === 'command') ack.command = {...ack.command,expectedTotal:1}
  await drainCheckoutQueue(db,user,async () => ({status:200,body:kind === 'body' ? {} : {ok:true,result:ack}}))
  expect((await db.checkoutOutbox.get(job.idempotencyKey))?.state).toBe('pending')
 })
 it('bloque import/reset si résultat inconnu et conserve les acquittements après réinitialisation', async () => {
  const {db,repo} = await fixture();const job = await enqueueCheckout(db,user,command());const backup = await repo.exportBackupPayload()
  await expect(repo.importBackupPayload(backup)).rejects.toThrow('confirmation serveur')
  await expect(repo.resetAllDataWithConfirmation('SUPPRIMER')).rejects.toThrow('confirmation serveur')
  await drainCheckoutQueue(db,user,async (row) => success(row))
  await repo.resetAllDataWithConfirmation('SUPPRIMER')
  expect((await db.checkoutOutbox.get(job.idempotencyKey))?.state).toBe('confirmed')
 })
})

function token(account: PublicSalonUser, uid = account.id): string {return `header.${btoa(JSON.stringify({uid,tid:account.tenantId,sid:'queue-session',exp:Date.now()+3_600_000}))}.signature`}
describe('Transport checkout lié au compte', () => {
 it('ne transmet pas la file d’un compte avec le jeton d’un autre, même dans le même salon', async () => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command())
  const fetch = vi.fn();vi.stubGlobal('fetch',fetch)
  const other = {...user,id:'other'};storeAuthSession(other,token(other),false)
  await expect(deliverCheckout(job)).rejects.toThrow('Session incompatible')
  storeAuthSession(user,token(user,'forged-other'),false)
  await expect(deliverCheckout(job)).rejects.toThrow('Session incompatible')
  expect(fetch).not.toHaveBeenCalled()
 })
 it('envoie uniquement le DTO sous un jeton fixe et ne rejoue pas automatiquement un 401', async () => {
  const {db} = await fixture();const job = await enqueueCheckout(db,user,command());const access = token(user)
  storeAuthSession(user,access,false)
  const fetch = vi.fn(async () => {
   const other = {...user,id:'other'};storeAuthSession(other,token(other),false)
   return new Response(JSON.stringify({ok:false,code:'SESSION_REQUIRED'}),{status:401,headers:{'Content-Type':'application/json'}})
  });vi.stubGlobal('fetch',fetch)
  expect((await deliverCheckout(job)).status).toBe(401)
  expect(fetch).toHaveBeenCalledTimes(1)
  const [url,init] = fetch.mock.calls[0] as unknown as [string,RequestInit]
  expect(url).toBe('/api/checkout/commit');expect(init.body).toBe(JSON.stringify(job.command))
  expect((init.headers as Record<string,string>).Authorization).toBe(`Bearer ${access}`)
 })
})
