import { createHash, randomUUID } from 'node:crypto'
import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import { lockSyncState } from './syncProtocol.ts'
import { hasRefundSchema, reconcileCheckoutCash } from './checkoutLedger.ts'
import type { SqlPoolLike, SqlQueryable } from './neonClient.ts'
import type { CheckoutResult } from '../src/domain/checkout.ts'
import type { CheckoutRefundCommand, CheckoutRefundResult, CheckoutRefundReview, RefundPrecondition } from '../src/domain/checkoutRefund.ts'
import type { ProductItem, RevenueEntry } from '../src/domain/models/index.ts'

function fail(code:string,message:string,status=409):never {throw new AuthApiError(status,code,message)}
function text(value:unknown,max=200):string {if(typeof value !== 'string' || !value.trim() || value.length>max) fail('INVALID_REFUND','Champ de remboursement invalide.',400);return value.trim()}
function whole(value:number):number {if(!Number.isSafeInteger(value) || value<0) fail('INVALID_REFUND_AMOUNT','Montant ou stock non sûr.');return value}
export function parseRefund(input:unknown):CheckoutRefundCommand {
 if(!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_REFUND','Objet requis.',400)
 const row=input as Record<string,unknown>
 if(Object.keys(row).some((key) => !['idempotencyKey','originalTicketId','reason','returnLineIds','cashSessionId','paymentReferences'].includes(key))) fail('INVALID_REFUND','Champ non autorisé.',400)
 const idempotencyKey=text(row.idempotencyKey,128)
 if(!/^[a-zA-Z0-9:_-]{16,128}$/.test(idempotencyKey)) fail('INVALID_REFUND','Clé stable requise.',400)
 if(!Array.isArray(row.returnLineIds) || row.returnLineIds.length>100 || !Array.isArray(row.paymentReferences) || row.paymentReferences.length>20) fail('INVALID_REFUND','Retours et références requis.',400)
 const returnLineIds=row.returnLineIds.map((id) => text(id)).sort()
 if(new Set(returnLineIds).size!==returnLineIds.length) fail('INVALID_REFUND','Retour dupliqué.',400)
 const methods=new Set<string>()
 const paymentReferences=row.paymentReferences.map((raw) => {
  if(!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('INVALID_REFUND','Référence invalide.',400)
  const value=raw as Record<string,unknown>
  if(Object.keys(value).some((key) => !['method','reference'].includes(key))) fail('INVALID_REFUND','Référence invalide.',400)
  const method=text(value.method,80)
  if(method==='cash' || methods.has(method)) fail('INVALID_REFUND','Référence non espèces unique requise.',400)
  methods.add(method);return {method,reference:text(value.reference,200)}
 }).sort((a,b) => a.method.localeCompare(b.method))
 return {idempotencyKey,originalTicketId:text(row.originalTicketId),reason:text(row.reason,500),returnLineIds,paymentReferences,...(row.cashSessionId!==undefined ? {cashSessionId:text(row.cashSessionId)} : {})}
}
export async function assertRefundManager(db:SqlQueryable,tenantId:string,actorId:string) {
 const row=(await db.query<{role:string}>('SELECT m.role FROM memberships m JOIN salon_users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.is_active AND u.is_active FOR SHARE OF m,u',[tenantId,actorId])).rows[0]
 if(row?.role!=='manager') fail('REFUND_MANAGER_REQUIRED','Remboursement réservé au Gérant actif.',403)
}

/** Full refund, once per original ticket. External payments are ATTESTED, never executed by this API. */
export async function refundCheckout(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown,precondition?:RefundPrecondition):Promise<{result:CheckoutRefundResult;replayed:boolean}> {
 const command=parseRefund(input)
 if(!await hasRefundSchema(pool)) fail('REFUND_MIGRATION_REQUIRED','Migration volontaire 007 non installée.',503)
 const hash=createHash('sha256').update(JSON.stringify(command)).digest('hex')
 return withTenantClient(pool,tenantId,async (db) => {
  await lockSyncState(db);await assertRefundManager(db,tenantId,actorId)
  const prior=(await db.query<{request_hash:string;actor_id:string;result_json:CheckoutRefundResult}>('SELECT request_hash,actor_id,result_json FROM checkout_refunds WHERE idempotency_key=$1',[command.idempotencyKey])).rows[0]
  if(prior) {
   if(prior.actor_id!==actorId || prior.request_hash!==hash) fail('REFUND_IDEMPOTENCY_CONFLICT','Clé déjà utilisée pour une autre intention ou un autre acteur.')
   if(precondition) {
    const original=(await db.query<{result_json:CheckoutResult}>('SELECT result_json FROM checkout_commands WHERE ticket_id=$1',[command.originalTicketId])).rows[0]?.result_json
    if(!original) fail('REFUND_TICKET_UNAVAILABLE','Ticket canonique absent.')
    assertPrecondition(tenantId,actorId,command,original,precondition)
   }
   return {result:prior.result_json,replayed:true}
  }
  if((await db.query('SELECT refund_ticket_id FROM checkout_refunds WHERE original_ticket_id=$1',[command.originalTicketId])).rows.length) fail('TICKET_ALREADY_REFUNDED','Ce ticket a déjà été remboursé intégralement.')
  const original=(await db.query<{result_json:CheckoutResult}>('SELECT result_json FROM checkout_commands WHERE ticket_id=$1',[command.originalTicketId])).rows[0]?.result_json
  if(!original) fail('REFUND_TICKET_UNAVAILABLE','Ticket canonique absent de cet établissement.')
  if(precondition) assertPrecondition(tenantId,actorId,command,original,precondition)
  const sales=new Map(original.records.revenues.map((row) => [row.id,row]))
  for(const id of command.returnLineIds) if(!sales.get(id)?.productId) fail('INVALID_REFUND_RETURN','Seules les lignes de produits vendus peuvent être remises en stock ; jamais les consommables utilisés.')
  const payments=original.command.payments.map((row) => ({...row,amount:whole(row.amount)}))
  const external=payments.filter((row) => row.method!=='cash')
  if(external.length!==command.paymentReferences.length || external.some((row) => !command.paymentReferences.some((ref) => ref.method===row.method))) fail('REFUND_PAYMENT_EVIDENCE_REQUIRED','Attestez chaque remboursement non espèces dans son mode d’origine.')
  const cash=payments.find((row) => row.method==='cash')?.amount ?? 0
  const now=new Date().toISOString()
  if(cash) {
   const session=(await db.query<{payload_json:{status:string}}>('SELECT payload_json FROM cash_sessions WHERE id=$1 FOR UPDATE',[command.cashSessionId ?? ''])).rows[0]?.payload_json
   if(session?.status!=='open') fail('REFUND_CASH_SESSION_REQUIRED','Une caisse ouverte est requise pour rembourser les espèces.')
   if((await reconcileCheckoutCash(db,command.cashSessionId!,now)).theoreticalClosingBalance<cash) fail('REFUND_CASH_INSUFFICIENT','Solde espèces insuffisant dans cette caisse.')
  } else if(command.cashSessionId) fail('INVALID_REFUND','Pas de caisse pour un remboursement entièrement non espèces.',400)
  const sequence=Number((await db.query<{last_receipt:string}>('INSERT INTO checkout_counters(tenant_id,last_receipt) VALUES($1,1) ON CONFLICT(tenant_id) DO UPDATE SET last_receipt=checkout_counters.last_receipt+1 RETURNING last_receipt',[tenantId])).rows[0].last_receipt)
  const receiptNumber=`SPR-${String(whole(sequence)).padStart(10,'0')}`;const ticketId=`refund-${randomUUID()}`
  const records:CheckoutResult['records']={revenues:[],products:[],stockMovements:[],cashMovements:[]}
  const products=new Map<string,ProductItem>()
  for(const old of original.records.revenues) {
   const row:RevenueEntry={...old,id:`rev-${randomUUID()}`,ticketId,receiptNumber,date:now,label:`Remboursement — ${old.label}`,amount:-whole(old.amount),quantity:-whole(old.quantity ?? 1),paymentSplits:(old.paymentSplits ?? []).map((split) => ({method:split.method,amount:-whole(split.amount)})),reversalOfRevenueId:old.id,reversalOfTicketId:original.ticketId,
    consumablesUsed:undefined,linkedStockMovementId:undefined,cashMovementId:undefined,createdAt:now,updatedAt:now,isArchived:false,note:command.reason}
   if(command.returnLineIds.includes(old.id)) {
    const movement=original.records.stockMovements.find((item) => item.id===old.linkedStockMovementId && item.type==='sale' && item.productId===old.productId)
    if(!movement) fail('REFUND_STOCK_SNAPSHOT_MISSING','Sortie produit canonique absente.')
    if(!products.has(movement.productId)) {
     const current=(await db.query<{payload_json:ProductItem}>('SELECT payload_json FROM products WHERE id=$1 FOR UPDATE',[movement.productId])).rows[0]?.payload_json
     if(!current) fail('REFUND_PRODUCT_UNAVAILABLE','Produit absent ; aucun retour de stock appliqué.')
     products.set(current.id,{...current})
    }
    const product=products.get(movement.productId)!;const quantity=whole(-movement.quantityDelta);const previous=whole(product.quantity);const next=whole(previous+quantity)
    if(next>2147483647 || !quantity) fail('INVALID_REFUND_AMOUNT','Quantité de retour hors limite.')
    const weighted=BigInt(previous)*BigInt(whole(product.costPrice))+BigInt(quantity)*BigInt(whole(movement.unitCost))
    product.costPrice=whole(Number((weighted+BigInt(Math.floor(next/2)))/BigInt(next)));product.quantity=next;product.updatedAt=now
    const id=`sm-${randomUUID()}`;row.linkedStockMovementId=id
    records.stockMovements.push({id,reversalOfStockMovementId:movement.id,productId:product.id,type:'adjustment',quantityDelta:quantity,quantityAfter:next,unitCost:movement.unitCost,reason:`Retour ${receiptNumber} — ${command.reason}`,linkedRevenueId:row.id,occurredAt:now,createdAt:now})
   }
   const cashAmount=(old.paymentSplits ?? []).find((split) => split.method==='cash')?.amount ?? 0
   if(cashAmount) {
    const id=`cm-${randomUUID()}`;row.cashMovementId=id
    const split=row.paymentSplits!.find((item) => item.method==='cash')!;split.cashMovementId=id
    records.cashMovements.push({id,sessionId:command.cashSessionId!,type:'out',amount:whole(cashAmount),reason:`Remboursement ${original.receiptNumber}`,categoryCode:old.categoryCode,paymentMethod:'cash',linkedRevenueId:row.id,occurredAt:now,createdAt:now,updatedAt:now})
   }
   records.revenues.push(row)
  }
  records.products=[...products.values()]
  for(const product of records.products) await db.query('UPDATE products SET quantity=$2,cost_price=$3,updated_at=$4,payload_json=$5::jsonb WHERE id=$1',[product.id,product.quantity,product.costPrice,now,JSON.stringify(product)])
  for(const row of records.revenues) await db.query('INSERT INTO revenues(id,ticket_id,receipt_number,date,label,category_code,employee_id,amount,payment_method,is_archived,updated_at,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$4,$10::jsonb)',[row.id,ticketId,receiptNumber,now,row.label,row.categoryCode,row.employeeId ?? null,row.amount,row.paymentMethod,JSON.stringify(row)])
  for(const row of records.stockMovements) await db.query('INSERT INTO stock_movements(id,product_id,type,quantity_delta,quantity_after,unit_cost,occurred_at,created_at,payload_json) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8::jsonb)',[row.id,row.productId,row.type,row.quantityDelta,row.quantityAfter,row.unitCost,now,JSON.stringify(row)])
  for(const row of records.cashMovements) await db.query('INSERT INTO cash_movements(id,session_id,type,amount,occurred_at,updated_at,payload_json) VALUES($1,$2,$3,$4,$5,$5,$6::jsonb)',[row.id,row.sessionId,row.type,row.amount,now,JSON.stringify(row)])
  if(cash) records.cashSession=await reconcileCheckoutCash(db,command.cashSessionId!,now)
  const result:CheckoutRefundResult={status:'refunded',confirmed:true,tenantId,actorId,confirmedAt:now,ticketId,receiptNumber,originalTicketId:original.ticketId,originalReceiptNumber:original.receiptNumber,command,total:whole(original.quote.total),payments,paymentExecution:'cash_ledger_and_external_attestation',records}
  await db.query('INSERT INTO checkout_refunds(tenant_id,idempotency_key,request_hash,actor_id,original_ticket_id,refund_ticket_id,receipt_number,result_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[tenantId,command.idempotencyKey,hash,actorId,original.ticketId,ticketId,receiptNumber,JSON.stringify(result)])
  for(const [table,rows] of [['revenues',records.revenues],['cash_movements',records.cashMovements],['stock_movements',records.stockMovements]] as const) for(const row of rows) await db.query('INSERT INTO checkout_refund_records(tenant_id,table_name,row_id,ticket_id) VALUES($1,$2,$3,$4)',[tenantId,table,row.id,ticketId])
  return {result:JSON.parse(JSON.stringify(result)) as CheckoutRefundResult,replayed:false}
 })
}

export async function refundStatus(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown) {
 if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some((key) => key!=='idempotencyKey') || !('idempotencyKey' in input)) fail('INVALID_REFUND','Clé seule requise.',400)
 const key=text(input.idempotencyKey,128)
 if(!/^[a-zA-Z0-9:_-]{16,128}$/.test(key)) fail('INVALID_REFUND','Clé invalide.',400)
 if(!await hasRefundSchema(pool)) fail('REFUND_MIGRATION_REQUIRED','Migration 007 requise.',503)
 return withTenantClient(pool,tenantId,async (db) => {
  await lockSyncState(db);await assertRefundManager(db,tenantId,actorId)
  const row=(await db.query<{actor_id:string;result_json:CheckoutRefundResult}>('SELECT actor_id,result_json FROM checkout_refunds WHERE idempotency_key=$1',[key])).rows[0]
  if(row && row.actor_id!==actorId) fail('REFUND_ACTOR_CONFLICT','Clé d’un autre acteur.',403)
  return row ? {status:'refunded' as const,result:row.result_json} : {status:'not_found' as const,idempotencyKey:key,tenantId,actorId}
 })
}


function fingerprint(tenantId:string,actorId:string,command:CheckoutRefundCommand,original:CheckoutResult):string {
 return createHash('sha256').update(JSON.stringify({tenantId,actorId,command,original})).digest('hex')
}
function assertPrecondition(tenantId:string,actorId:string,command:CheckoutRefundCommand,original:CheckoutResult,expected:RefundPrecondition) {
 if(expected.total!==original.quote.total || expected.originalReceiptNumber!==original.receiptNumber || expected.fingerprint!==fingerprint(tenantId,actorId,command,original)) fail('REFUND_REVIEW_MISMATCH','Le ticket ou la commande diffère du contrôle canonique. Aucun remboursement exécuté.')
}
function recoveryEnvelope(input:unknown,mode:'review'|'resume') {
 if(!input || typeof input!=='object' || Array.isArray(input)) fail('INVALID_REFUND','Objet de reprise requis.',400)
 const row=input as Record<string,unknown>
 const allowed=mode==='review' ? ['command','expectedTotal','expectedOriginalReceiptNumber'] : ['command','precondition']
 if(Object.keys(row).some((key) => !allowed.includes(key))) fail('INVALID_REFUND','Champ de reprise interdit.',400)
 const command=parseRefund(row.command)
 if(mode==='review') {
  if(typeof row.expectedTotal!=='number') fail('INVALID_REFUND','Total attendu requis.',400)
  return {command,expected:{total:whole(row.expectedTotal),originalReceiptNumber:text(row.expectedOriginalReceiptNumber),fingerprint:''}}
 }
 const raw=row.precondition
 if(!raw || typeof raw!=='object' || Array.isArray(raw)) fail('INVALID_REFUND','Précondition requise.',400)
 const expected=raw as Record<string,unknown>
 if(Object.keys(expected).some((key) => !['total','originalReceiptNumber','fingerprint'].includes(key)) || typeof expected.total!=='number' || typeof expected.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(expected.fingerprint)) fail('INVALID_REFUND','Précondition invalide.',400)
 return {command,expected:{total:whole(expected.total),originalReceiptNumber:text(expected.originalReceiptNumber),fingerprint:expected.fingerprint}}
}
/** Read-only canonical review: no counters, movements, stock or cash reconciliation writes. */
export async function reviewRefund(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown):Promise<CheckoutRefundReview> {
 const {command,expected}=recoveryEnvelope(input,'review')
 if(!await hasRefundSchema(pool)) fail('REFUND_MIGRATION_REQUIRED','Migration 007 requise.',503)
 return withTenantClient(pool,tenantId,async (db) => {
  await lockSyncState(db);await assertRefundManager(db,tenantId,actorId)
  if((await db.query('SELECT idempotency_key FROM checkout_refunds WHERE idempotency_key=$1 OR original_ticket_id=$2',[command.idempotencyKey,command.originalTicketId])).rows.length) fail('REFUND_ALREADY_CONFIRMED','Une clé ou ce ticket est déjà remboursé. Vérifiez le statut, sans nouvelle exécution.')
  const original=(await db.query<{result_json:CheckoutResult}>('SELECT result_json FROM checkout_commands WHERE ticket_id=$1',[command.originalTicketId])).rows[0]?.result_json
  if(!original) fail('REFUND_TICKET_UNAVAILABLE','Ticket canonique absent de cet établissement.')
  if(original.quote.total!==expected.total || original.receiptNumber!==expected.originalReceiptNumber) fail('REFUND_REVIEW_MISMATCH','Montant ou référence du fichier différent du ticket canonique.')
  if(command.returnLineIds.some((id) => !original.records.revenues.some((row) => row.id===id && row.productId))) fail('INVALID_REFUND_RETURN','Retour produit non canonique.')
  const payments=original.command.payments.map((row) => ({method:row.method,amount:whole(row.amount)}))
  const external=payments.filter((row) => row.method!=='cash')
  if(external.length!==command.paymentReferences.length || external.some((row) => !command.paymentReferences.some((ref) => ref.method===row.method))) fail('REFUND_PAYMENT_EVIDENCE_REQUIRED','Références externes incompatibles avec les modes d’origine.')
  if(payments.some((row) => row.method==='cash' && row.amount>0) ? !command.cashSessionId : Boolean(command.cashSessionId)) fail('INVALID_REFUND','Caisse incompatible avec les modes d’origine.',400)
  return {status:'reviewed',tenantId,actorId,command,originalTicketId:original.ticketId,originalReceiptNumber:original.receiptNumber,total:whole(original.quote.total),payments,
   lines:original.records.revenues.map((row) => ({id:row.id,label:row.label,quantity:row.quantity ?? 1,amount:row.amount,...(row.productId ? {productId:row.productId} : {}),returned:command.returnLineIds.includes(row.id)})),
   precondition:{total:original.quote.total,originalReceiptNumber:original.receiptNumber,fingerprint:fingerprint(tenantId,actorId,command,original)}}
 })
}
export async function resumeRefund(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown) {
 const {command,expected}=recoveryEnvelope(input,'resume')
 return refundCheckout(pool,tenantId,actorId,command,expected)
}
