import { afterEach, expect, it, vi } from 'vitest'
import { SalonProDatabase } from '../db/database'
import { workspaceKey } from '../db/accountWorkspace'
import { enqueueCheckout, drainCheckoutQueue } from '../db/checkoutQueue'
import { exportCheckoutIntents, restoreCheckoutIntents, reviewCheckout, resumeCheckout, CHECKOUT_BACKUP_LIMIT } from '../db/checkoutRecovery'
import { inspectCheckout } from '../lib/checkoutClient'
import { storeAuthSession } from '../lib/sessionClient'
import type { PublicSalonUser } from '../domain/models'
import type { CheckoutCommand, CheckoutResult } from '../domain/checkout'
import type { QueuedCheckout } from '../domain/checkoutQueue'

const databases=new Set<SalonProDatabase>()
afterEach(async () => {vi.unstubAllGlobals();window.sessionStorage.clear();window.localStorage.clear();for(const db of databases) db.close();for(const db of databases) await db.delete();databases.clear()})
const user:PublicSalonUser={id:'recovery-user',tenantId:'recovery-tenant',role:'manager',fullName:'Responsable',email:'recovery@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
function command():CheckoutCommand {return {idempotencyKey:`checkout-${crypto.randomUUID()}`,lines:[{kind:'service',catalogId:'catalog-service',quantity:1}],payments:[{method:'wave',amount:1000}]}}
async function fixture() {
 const db=new SalonProDatabase(`recovery-${crypto.randomUUID()}`);databases.add(db)
 await db.workspaceMeta.bulkPut([{key:'cloudTenantId',value:user.tenantId!},{key:'accountScope',value:workspaceKey(user)}])
 const job=await enqueueCheckout(db,user,command())
 return {db,job}
}
function confirmed(row:QueuedCheckout) {
 const result:CheckoutResult={tenantId:row.tenantId,actorId:row.actorId,confirmed:true,status:'confirmed',ticketId:'server-ticket',receiptNumber:'SPC-0000000001',confirmedAt:'2026-10-31',command:row.command,
 quote:{status:'quoted',confirmed:false,currency:'XOF',idempotencyKey:row.idempotencyKey,quotedAt:'2026-10-31',lines:[],subtotal:1000,discount:0,total:1000,payments:row.command.payments,cashAmount:0,change:0,stockRequired:[]},records:{revenues:[],products:[],cashMovements:[],stockMovements:[]}}
 return {status:200,body:{ok:true,status:'confirmed',result}}
}
const absent=(row:QueuedCheckout) => ({status:200,body:{ok:true,status:'not_found',tenantId:row.tenantId,actorId:row.actorId,idempotencyKey:row.idempotencyKey}})

it('exporte seulement les intentions non confirmées, sans résultat, jeton ni bail',async () => {
 const {db,job}=await fixture()
 await db.checkoutOutbox.update(job.idempotencyKey,{leaseToken:'private-lease',leaseUntil:Date.now()+120000})
 const second=await enqueueCheckout(db,user,command())
 await db.checkoutOutbox.update(second.idempotencyKey,{state:'confirmed',result:confirmed(second).body.result})
 const backup=await exportCheckoutIntents(db,user)
 expect(backup).not.toContain('private-lease');expect(backup).not.toContain('result');expect(backup).not.toContain(second.idempotencyKey)
 const parsed=JSON.parse(backup)
 expect(parsed.intents).toHaveLength(1);expect(parsed.intents[0].command).toEqual(job.command)
})
it('restaure sur un autre appareil du même compte sans confirmer ni envoyer, clés intactes',async () => {
 const {db,job}=await fixture();const backup=await exportCheckoutIntents(db,user)
 const destination=await fixture();await destination.db.checkoutOutbox.clear()
 expect(await restoreCheckoutIntents(destination.db,user,backup)).toEqual({added:1,existing:0})
 expect(await restoreCheckoutIntents(destination.db,user,backup)).toEqual({added:0,existing:1})
 const saved=await destination.db.checkoutOutbox.get(job.idempotencyKey)
 expect(saved).toMatchObject({state:'pending',paused:true,command:job.command,attempts:0})
 expect(saved).not.toHaveProperty('result')
 const send=vi.fn(async (row) => confirmed(row));await drainCheckoutQueue(destination.db,user,send)
 expect(send).not.toHaveBeenCalled();expect(await destination.db.revenues.count()).toBe(0)
 await expect(resumeCheckout(destination.db,user,job.idempotencyKey)).rejects.toThrow('vérifiez')
})
it('refuse un fichier étranger et les confirmations falsifiées sans écriture partielle',async () => {
 const {db}=await fixture();const backup=JSON.parse(await exportCheckoutIntents(db,user));const before=await db.checkoutOutbox.toArray()
 for(const input of [{...backup,scope:'other'},{...backup,tenantId:'other'},{...backup,actorId:'other'},{...backup,result:{confirmed:true}},{...backup,intents:[{...backup.intents[0],result:{confirmed:true}}]},{...backup,intents:[{...backup.intents[0],previousState:'confirmed'}]},{...backup,intents:[backup.intents[0],backup.intents[0]]}]) await expect(restoreCheckoutIntents(db,user,JSON.stringify(input))).rejects.toThrow()
 expect(await db.checkoutOutbox.toArray()).toEqual(before)
 await expect(restoreCheckoutIntents(db,user,' '.repeat(CHECKOUT_BACKUP_LIMIT+1))).rejects.toThrow('5 Mo')
 await expect(restoreCheckoutIntents(db,user,'not json')).rejects.toThrow()
})
it('annule toute restauration si une clé existante porte un autre contenu et préserve les ACK existants',async () => {
 const {db,job}=await fixture();const backup=JSON.parse(await exportCheckoutIntents(db,user))
 const newCommand=command()
 backup.intents.unshift({idempotencyKey:newCommand.idempotencyKey,command:newCommand,createdAt:Date.now(),previousState:'pending'})
 backup.intents[1].command.clientName='Changed'
 await expect(restoreCheckoutIntents(db,user,JSON.stringify(backup))).rejects.toThrow('Conflit de clé')
 expect(await db.checkoutOutbox.count()).toBe(1)
 const original=await exportCheckoutIntents(db,user)
 await drainCheckoutQueue(db,user,async (row) => confirmed(row))
 const before=await db.checkoutOutbox.get(job.idempotencyKey)
 expect(await restoreCheckoutIntents(db,user,original)).toEqual({added:0,existing:1})
 expect(await db.checkoutOutbox.get(job.idempotencyKey)).toEqual(before)
})
it('une vérification absente suspend sans renvoyer ; seule la reprise explicite réactive la même clé',async () => {
 const {db,job}=await fixture();const beforeCommand=job.command
 const inspect=vi.fn(async (row) => absent(row))
 expect(await reviewCheckout(db,user,job.idempotencyKey,inspect)).toBe('not_found')
 const send=vi.fn(async (row) => confirmed(row));await drainCheckoutQueue(db,user,send)
 expect(send).not.toHaveBeenCalled()
 expect((await db.checkoutOutbox.get(job.idempotencyKey))?.command).toEqual(beforeCommand)
 await resumeCheckout(db,user,job.idempotencyKey)
 await drainCheckoutQueue(db,user,send)
 expect(send).toHaveBeenCalledTimes(1)
 expect(send.mock.calls[0][0].idempotencyKey).toBe(job.idempotencyKey)
 expect((await db.checkoutOutbox.get(job.idempotencyKey))?.reviewHistory?.map((entry) => entry.outcome)).toEqual(['not_found','resumed'])
})
it('récupère un ACK depuis status sans toucher le curseur ni les projections financières',async () => {
 const {db,job}=await fixture();await db.workspaceMeta.put({key:'syncCursor',value:'42'})
 expect(await reviewCheckout(db,user,job.idempotencyKey,async (row) => confirmed(row))).toBe('confirmed')
 expect(await db.checkoutOutbox.get(job.idempotencyKey)).toMatchObject({state:'confirmed',paused:false,result:{receiptNumber:'SPC-0000000001'}})
 expect((await db.workspaceMeta.get('syncCursor'))?.value).toBe('42')
 expect(await db.revenues.count()).toBe(0)
 await expect(resumeCheckout(db,user,job.idempotencyKey)).rejects.toThrow('interdite')
})
it.each(['network','503','wrong_tenant','wrong_actor','wrong_key','wrong_command'])('suspend sans reprise autorisée si vérification incohérente : %s',async (kind) => {
 const {db,job}=await fixture()
 const inspect=async (row:QueuedCheckout) => {
  if(kind==='network') throw new Error('offline')
  if(kind==='503') return {status:503,body:{}}
  if(kind==='wrong_command') {const response=confirmed(row);response.body.result.command={...row.command,clientName:'changed'};return response}
  const response=absent(row)
  if(kind==='wrong_tenant') response.body.tenantId='other'
  if(kind==='wrong_actor') response.body.actorId='other'
  if(kind==='wrong_key') response.body.idempotencyKey='other'
  return response
 }
 const outcome=await reviewCheckout(db,user,job.idempotencyKey,inspect)
 expect(['mismatch','unavailable']).toContain(outcome)
 expect(await db.checkoutOutbox.get(job.idempotencyKey)).toMatchObject({state:'pending',paused:true})
 await expect(resumeCheckout(db,user,job.idempotencyKey)).rejects.toThrow('interdite')
})
it('ne réactive pas un rejet métier même si le serveur ne connaît pas sa clé',async () => {
 const {db,job}=await fixture()
 await drainCheckoutQueue(db,user,async () => ({status:409,body:{code:'INSUFFICIENT_STOCK',message:'Stock insuffisant'}}))
 await reviewCheckout(db,user,job.idempotencyKey,async (row) => absent(row))
 expect(await db.checkoutOutbox.get(job.idempotencyKey)).toMatchObject({state:'rejected',error:{code:'INSUFFICIENT_STOCK'}})
 await expect(resumeCheckout(db,user,job.idempotencyKey)).rejects.toThrow('interdite')
})
it('refuse une vérification concurrente et une réponse tardive ne dégrade pas un ACK plus récent',async () => {
 const {db,job}=await fixture();let now=Date.now()+10
 let start!:()=>void;const started=new Promise<void>((resolve) => {start=resolve})
 let release!:()=>void;const gate=new Promise<void>((resolve) => {release=resolve})
 const first=reviewCheckout(db,user,job.idempotencyKey,async () => {start();await gate;return {status:503,body:{}}},() => now)
 await started
 await expect(reviewCheckout(db,user,job.idempotencyKey,async (row) => absent(row),() => now)).rejects.toThrow('bail')
 now+=120001
 await reviewCheckout(db,user,job.idempotencyKey,async (row) => confirmed(row),() => now)
 release();await expect(first).rejects.toThrow('dépassée')
 expect((await db.checkoutOutbox.get(job.idempotencyKey))?.state).toBe('confirmed')
})
it('utilise une requête status dédiée avec la clé seule et le jeton fixe du compte',async () => {
 const {job}=await fixture()
 const token=`header.${btoa(JSON.stringify({uid:user.id,tid:user.tenantId,sid:'session',exp:Date.now()+3600000}))}.signature`
 storeAuthSession(user,token,false)
 const fetch=vi.fn(async () => new Response(JSON.stringify(absent(job).body),{status:200,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch)
 expect((await inspectCheckout(job)).body.status).toBe('not_found')
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/checkout/status');expect(JSON.parse(init.body as string)).toEqual({idempotencyKey:job.idempotencyKey})
 expect((init.headers as Record<string,string>).Authorization).toBe(`Bearer ${token}`)
})
