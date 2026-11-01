import type { SalonProDatabase } from './database'
import type { PublicSalonUser } from '../domain/models'
import type { QueuedCheckout } from '../domain/checkoutQueue'
import type { CheckoutCommand } from '../domain/checkout'
import { assertCheckoutScope, isCheckoutAcknowledgement, type CheckoutDelivery } from './checkoutQueue'
import { validateCheckoutCommand } from '../domain/checkoutValidation'
import { stableCloudValue } from '../domain/cloudDelta'

export const CHECKOUT_BACKUP_LIMIT = 5 * 1024 * 1024
interface IntentBackup {
 format:'SALON_PRO_CHECKOUT_OUTBOX_V1'; exportedAt:string; scope:string; tenantId:string; actorId:string
 intents:{idempotencyKey:string;command:CheckoutCommand;createdAt:number;previousState:'pending'|'rejected'}[]
}
function object(value: unknown): Record<string,unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sauvegarde de file invalide.')
 return value as Record<string,unknown>
}
function fields(row: Record<string,unknown>, keys: string[]) {
 if (Object.keys(row).some((key) => !keys.includes(key))) throw new Error('Champ inattendu dans la sauvegarde de file.')
}

/** Intents only: never export tokens, leases, purported confirmation results or financial projections. */
export async function exportCheckoutIntents(db: SalonProDatabase,user: PublicSalonUser): Promise<string> {
 return db.transaction('r',[db.workspaceMeta,db.checkoutOutbox],async () => {
  const scope = await assertCheckoutScope(db,user)
  const rows = (await db.checkoutOutbox.toArray()).filter((row) => row.scope === scope && row.state !== 'confirmed')
  if (rows.length > 1000) throw new Error('Plus de 1 000 intentions : sauvegarde opérateur nécessaire, ne supprimez pas les données.')
  const backup: IntentBackup = {format:'SALON_PRO_CHECKOUT_OUTBOX_V1',exportedAt:new Date().toISOString(),scope,tenantId:user.tenantId!,actorId:user.id,intents:rows.map((row) => ({idempotencyKey:row.idempotencyKey,command:row.command,createdAt:row.createdAt,previousState:row.state as 'pending'|'rejected'}))}
  const json = JSON.stringify(backup,null,2)
  if (new TextEncoder().encode(json).byteLength > CHECKOUT_BACKUP_LIMIT) throw new Error('Sauvegarde supérieure à 5 Mo : intervention opérateur nécessaire.')
  return json
 })
}

/** Untrusted backups restore only held intentions with their original keys, never trusted ACKs. */
export async function restoreCheckoutIntents(db: SalonProDatabase,user: PublicSalonUser,json:string): Promise<{added:number;existing:number}> {
 if (new TextEncoder().encode(json).byteLength > CHECKOUT_BACKUP_LIMIT) throw new Error('Sauvegarde limitée à 5 Mo.')
 const input = object(JSON.parse(json))
 fields(input,['format','exportedAt','scope','tenantId','actorId','intents'])
 if (input.format !== 'SALON_PRO_CHECKOUT_OUTBOX_V1' || typeof input.exportedAt !== 'string' || !Number.isFinite(Date.parse(input.exportedAt)) || !Array.isArray(input.intents) || input.intents.length > 1000) throw new Error('Format de sauvegarde de file invalide.')
 const seen = new Set<string>()
 const intents = input.intents.map((raw) => {
  const row = object(raw);fields(row,['idempotencyKey','command','createdAt','previousState'])
  const command = validateCheckoutCommand(row.command)
  if (row.idempotencyKey !== command.idempotencyKey || seen.has(command.idempotencyKey) || typeof row.createdAt !== 'number' || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || !['pending','rejected'].includes(String(row.previousState))) throw new Error('Intention invalide ou clé dupliquée.')
  seen.add(command.idempotencyKey)
  return {command,createdAt:row.createdAt}
 })
 return db.transaction('rw',[db.workspaceMeta,db.checkoutOutbox],async () => {
  const scope = await assertCheckoutScope(db,user)
  if (input.scope !== scope || input.tenantId !== user.tenantId || input.actorId !== user.id) throw new Error('Cette sauvegarde appartient à un autre compte, salon ou rôle.')
  let added=0;let existing=0
  for (const {command,createdAt} of intents) {
   const old = await db.checkoutOutbox.get(command.idempotencyKey)
   if (old) {
    if (old.scope !== scope || stableCloudValue(old.command) !== stableCloudValue(command)) throw new Error('Conflit de clé : aucune intention de cette sauvegarde n’a été restaurée.')
    existing++;continue
   }
   const now = Date.now()
   await db.checkoutOutbox.add({idempotencyKey:command.idempotencyKey,tenantId:user.tenantId!,actorId:user.id,scope,command,state:'pending',paused:true,createdAt,updatedAt:now,attempts:0,nextAttemptAt:now,error:{code:'RESTORED_REVIEW_REQUIRED',message:'Intention restaurée et suspendue : vérifiez le serveur avant toute reprise.'}})
   added++
  }
  return {added,existing}
 })
}

export async function reviewCheckout(db: SalonProDatabase,user: PublicSalonUser,key:string,inspect:(row:QueuedCheckout) => Promise<CheckoutDelivery>,clock:()=>number = Date.now): Promise<string> {
 const claimed = await db.transaction('rw',[db.workspaceMeta,db.checkoutOutbox],async () => {
  const scope = await assertCheckoutScope(db,user)
  const row = await db.checkoutOutbox.get(key)
  if (!row || row.scope !== scope) throw new Error('Intention introuvable dans cet espace.')
  if (row.state === 'confirmed') throw new Error('Cette intention est déjà confirmée.')
  const now=clock()
  if ((row.leaseUntil ?? 0)>now) throw new Error('Envoi ou vérification en cours : attendez la fin du bail avant de vérifier.')
  const next = {...row,paused:true,leaseToken:crypto.randomUUID(),leaseUntil:now+120_000,updatedAt:now}
  await db.checkoutOutbox.put(next);return next
 })
 let delivery: CheckoutDelivery
 try {delivery = await inspect(claimed)}
 catch {delivery={status:0,body:{}}}
 const confirmed = isCheckoutAcknowledgement(claimed,delivery)
 const body = delivery.body
 const absent = delivery.status === 200 && body.ok === true && body.status === 'not_found' && body.idempotencyKey === claimed.idempotencyKey && body.tenantId === claimed.tenantId && body.actorId === claimed.actorId
 const outcome = confirmed ? 'confirmed' : absent ? 'not_found' : delivery.status === 200 ? 'mismatch' : 'unavailable'
 return db.transaction('rw',[db.workspaceMeta,db.checkoutOutbox],async () => {
  await assertCheckoutScope(db,user)
  const row = await db.checkoutOutbox.get(key)
  if (!row || row.leaseToken !== claimed.leaseToken || row.state === 'confirmed') throw new Error('Vérification dépassée par une autre opération ; rechargez la file.')
  const now=clock()
  await db.checkoutOutbox.put({...row,updatedAt:now,leaseToken:undefined,leaseUntil:undefined,paused:!confirmed,
   state:confirmed ? 'confirmed' : row.state,result:confirmed ? body.result : undefined,
   reviewHistory:[...(row.reviewHistory ?? []),{at:now,outcome}],
   error:confirmed ? undefined : row.state === 'rejected' ? row.error : {code:`REVIEW_${outcome.toUpperCase()}`,message:absent ? 'Aucune confirmation trouvée à cet instant. Ce contrôle n’annule rien ; toute reprise gardera la même clé.' : 'Vérification indisponible ou incohérente. La commande reste suspendue ; ne créez pas de vente de remplacement.'},
  })
  return outcome
 })
}

/** Explicit opt-in after a successful read-only absence check; never revive a definitive business refusal. */
export async function resumeCheckout(db: SalonProDatabase,user: PublicSalonUser,key:string): Promise<void> {
 await db.transaction('rw',[db.workspaceMeta,db.checkoutOutbox],async () => {
  const scope=await assertCheckoutScope(db,user);const row=await db.checkoutOutbox.get(key);const now=Date.now()
  if (!row || row.scope !== scope || row.state !== 'pending' || !row.paused || (row.leaseUntil ?? 0)>now || row.reviewHistory?.at(-1)?.outcome !== 'not_found') throw new Error('Reprise interdite : vérifiez d’abord le serveur pour cette intention en attente.')
  await db.checkoutOutbox.put({...row,paused:false,nextAttemptAt:now,updatedAt:now,leaseToken:undefined,leaseUntil:undefined,error:undefined,reviewHistory:[...row.reviewHistory,{at:now,outcome:'resumed'}]})
 })
}
