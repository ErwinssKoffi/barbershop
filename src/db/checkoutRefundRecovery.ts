import type { SalonProDatabase } from './database'
import type { PublicSalonUser } from '../domain/models'
import type { CheckoutRefundCommand } from '../domain/checkoutRefund'
import { stableCloudValue } from '../domain/cloudDelta'
import { assertCheckoutScope } from './checkoutQueue'
import { readRefundIntent, type RefundIntent } from './checkoutRefundQueue'

export const REFUND_BACKUP_LIMIT=5*1024*1024
const PREFIX='refundIntent:'
function object(value:unknown):Record<string,unknown> {
 if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Sauvegarde remboursement invalide.')
 return value as Record<string,unknown>
}
function fields(row:Record<string,unknown>,allowed:string[]) {
 if(Object.keys(row).some((key) => !allowed.includes(key))) throw new Error('Champ inattendu dans la sauvegarde remboursement.')
}
function text(value:unknown,max:number):string {
 if(typeof value!=='string' || !value.trim() || value.length>max) throw new Error('Champ remboursement invalide.')
 return value.trim()
}
function command(value:unknown):CheckoutRefundCommand {
 const row=object(value);fields(row,['idempotencyKey','originalTicketId','reason','returnLineIds','cashSessionId','paymentReferences'])
 const idempotencyKey=text(row.idempotencyKey,128)
 if(!/^[a-zA-Z0-9:_-]{16,128}$/.test(idempotencyKey) || !Array.isArray(row.returnLineIds) || row.returnLineIds.length>100 || !Array.isArray(row.paymentReferences) || row.paymentReferences.length>20) throw new Error('Commande remboursement invalide.')
 const returnLineIds=row.returnLineIds.map((id) => text(id,200)).sort()
 if(new Set(returnLineIds).size!==returnLineIds.length) throw new Error('Retour produit dupliqué.')
 const paymentReferences=row.paymentReferences.map((raw) => {
  const ref=object(raw);fields(ref,['method','reference'])
  const method=text(ref.method,80)
  if(method==='cash') throw new Error('Référence externe espèces interdite.')
  return {method,reference:text(ref.reference,200)}
 }).sort((a,b) => a.method.localeCompare(b.method))
 if(new Set(paymentReferences.map((ref) => ref.method)).size!==paymentReferences.length) throw new Error('Mode de remboursement dupliqué.')
 return {idempotencyKey,originalTicketId:text(row.originalTicketId,200),reason:text(row.reason,500),returnLineIds,paymentReferences,...(row.cashSessionId!==undefined ? {cashSessionId:text(row.cashSessionId,200)} : {})}
}
async function account(db:SalonProDatabase,user:PublicSalonUser) {
 if(user.role!=='manager') throw new Error('Reprise remboursement réservée au Gérant.')
 return assertCheckoutScope(db,user)
}
export async function listRefundIntents(db:SalonProDatabase,user:PublicSalonUser):Promise<RefundIntent[]> {
 await account(db,user)
 const saved=await db.workspaceMeta.where('key').startsWith(PREFIX).limit(1001).toArray()
 if(saved.length>1000) throw new Error('Plus de 1 000 intentions : intervention opérateur nécessaire ; ne supprimez rien.')
 const rows:RefundIntent[]=[]
 for(const item of saved) rows.push((await readRefundIntent(db,user,item.key.slice(PREFIX.length)))!)
 return rows
}
/** All intentions, including confirmed ones, but NEVER their results, states or financial snapshots. */
export async function exportRefundIntents(db:SalonProDatabase,user:PublicSalonUser):Promise<string> {
 return db.transaction('r',db.workspaceMeta,async () => {
 const scope=await account(db,user);const rows=await listRefundIntents(db,user)
 const json=JSON.stringify({format:'SALON_PRO_REFUND_INTENTS_V1',exportedAt:new Date().toISOString(),scope,tenantId:user.tenantId!,actorId:user.id,intents:rows.map((row) => ({originalReceiptNumber:row.originalReceiptNumber,total:row.total,command:command(row.command)}))},null,2)
 if(new TextEncoder().encode(json).byteLength>REFUND_BACKUP_LIMIT) throw new Error('Sauvegarde remboursement limitée à 5 Mo ; intervention opérateur nécessaire.')
 return json
 })
}
/** Untrusted input can only add held intentions. Import is atomic and never sends or confirms anything. */
export async function restoreRefundIntents(db:SalonProDatabase,user:PublicSalonUser,json:string):Promise<{added:number;existing:number}> {
 if(new TextEncoder().encode(json).byteLength>REFUND_BACKUP_LIMIT) throw new Error('Sauvegarde remboursement limitée à 5 Mo.')
 const input=object(JSON.parse(json));fields(input,['format','exportedAt','scope','tenantId','actorId','intents'])
 if(input.format!=='SALON_PRO_REFUND_INTENTS_V1' || typeof input.exportedAt!=='string' || !Number.isFinite(Date.parse(input.exportedAt)) || !Array.isArray(input.intents) || input.intents.length>1000) throw new Error('Format de sauvegarde remboursement invalide.')
 const keys=new Set<string>();const tickets=new Set<string>()
 const rows=input.intents.map((raw) => {
  const row=object(raw);fields(row,['originalReceiptNumber','total','command'])
  const parsed=command(row.command)
  if(typeof row.originalReceiptNumber!=='string' || !/^SPC-\d+$/.test(row.originalReceiptNumber) || typeof row.total!=='number' || !Number.isSafeInteger(row.total) || row.total<0 || keys.has(parsed.idempotencyKey) || tickets.has(parsed.originalTicketId)) throw new Error('Intention invalide ou doublonnée.')
  keys.add(parsed.idempotencyKey);tickets.add(parsed.originalTicketId)
  return {command:parsed,total:row.total,originalReceiptNumber:row.originalReceiptNumber}
 })
 return db.transaction('rw',db.workspaceMeta,async () => {
 const scope=await account(db,user)
 if(input.scope!==scope || input.tenantId!==user.tenantId || input.actorId!==user.id) throw new Error('Sauvegarde d’un autre compte, salon ou rôle.')
 const existingRows=await listRefundIntents(db,user)
 const byKey=new Map(existingRows.map((row) => [row.command.idempotencyKey,row.command.originalTicketId]))
 let added=0;let existing=0
 for(const row of rows) {
  const old=await readRefundIntent(db,user,row.command.originalTicketId)
  const owner=byKey.get(row.command.idempotencyKey)
  if((owner && owner!==row.command.originalTicketId) || (old && (old.total!==row.total || old.originalReceiptNumber!==row.originalReceiptNumber || stableCloudValue(old.command)!==stableCloudValue(row.command)))) throw new Error('Conflit de clé ou de ticket : aucune intention restaurée. Conservez les fichiers pour contrôle manuel.')
  if(old) {existing++;continue}
  if(existingRows.length+added>=1000) throw new Error('Limite de 1 000 intentions : aucune restauration ; intervention opérateur nécessaire.')
  const restored:RefundIntent={...row,scope,tenantId:user.tenantId!,actorId:user.id,verificationOnly:true,state:'uncertain',message:'Intention restaurée et suspendue. Vérifiez le serveur avant toute reprise ; aucune confirmation importée.'}
  await db.workspaceMeta.add({key:PREFIX+row.command.originalTicketId,value:JSON.stringify(restored)})
  added++
 }
 return {added,existing}
 })
}
