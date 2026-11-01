import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import { hasCheckoutSchema, hasRefundSchema } from './checkoutLedger.ts'
import { assertRefundManager } from './checkoutRefund.ts'
import type { SqlPoolLike } from './neonClient.ts'
import type { CheckoutResult } from '../src/domain/checkout.ts'
import type { CheckoutHistoryQuery, CheckoutHistoryPage, CheckoutHistoryDetail } from '../src/domain/checkoutHistory.ts'

function invalid():never {throw new AuthApiError(400,'INVALID_TICKET_SEARCH','Recherche de ticket invalide.')}
function object(value:unknown):Record<string,unknown> {if(!value || typeof value!=='object' || Array.isArray(value)) invalid();return value as Record<string,unknown>}
function date(value:unknown):string {
 if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) invalid()
 return value
}
function ticket(value:unknown):string {if(typeof value!=='string' || !value.trim() || value.length>200) invalid();return value}
export function parseHistoryQuery(input:unknown):CheckoutHistoryQuery {
 const row=object(input)
 if(Object.keys(row).some((key) => !['receiptNumber','from','to','cursor'].includes(key))) invalid()
 const query:CheckoutHistoryQuery={}
 if(row.receiptNumber!==undefined) {
  if(typeof row.receiptNumber!=='string' || !/^SPC-\d{1,20}$/.test(row.receiptNumber)) invalid()
  query.receiptNumber=row.receiptNumber
 }
 if(row.from!==undefined || row.to!==undefined) {
  query.from=date(row.from);query.to=date(row.to)
  const span=Date.parse(query.to)-Date.parse(query.from)
  if(span<0 || span>365*86400000) invalid()
 }
 if(row.cursor!==undefined) {
  const cursor=object(row.cursor)
  if(Object.keys(cursor).some((key) => !['createdAt','ticketId'].includes(key)) || typeof cursor.createdAt!=='string' || cursor.createdAt.length>40 || !Number.isFinite(Date.parse(cursor.createdAt))) invalid()
  query.cursor={createdAt:cursor.createdAt,ticketId:ticket(cursor.ticketId)}
 }
 return query
}
async function ready(pool:SqlPoolLike) {if(!await hasCheckoutSchema(pool)) throw new AuthApiError(503,'CHECKOUT_MIGRATION_REQUIRED','Migration volontaire 006 requise pour consulter les tickets canoniques.')}
const refundExpression=(available:boolean) => available ? 'EXISTS(SELECT 1 FROM checkout_refunds r WHERE r.tenant_id=c.tenant_id AND r.original_ticket_id=c.ticket_id)' : 'NULL::boolean'
const status=(value:boolean|null) => value===null ? 'unavailable' as const : value ? 'refunded' as const : 'not_refunded' as const
/** Stable keyset pagination, exact receipt or bounded UTC date range. No legacy sales, no projection. */
export async function searchCheckoutHistory(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown):Promise<CheckoutHistoryPage> {
 const query=parseHistoryQuery(input);await ready(pool)
 return withTenantClient(pool,tenantId,async (db) => {
  await assertRefundManager(db,tenantId,actorId)
  const refunds=await hasRefundSchema(db)
  const values:unknown[]=[];const clauses:string[]=[]
  const value=(item:unknown) => {values.push(item);return `$${values.length}`}
  if(query.receiptNumber) clauses.push(`c.receipt_number=${value(query.receiptNumber)}`)
  if(query.from && query.to) {
   clauses.push(`c.created_at>=(${value(query.from)}::date::timestamp AT TIME ZONE 'UTC')`)
   clauses.push(`c.created_at<((${value(query.to)}::date+1)::timestamp AT TIME ZONE 'UTC')`)
  }
  if(query.cursor) clauses.push(`(c.created_at,c.ticket_id)<(${value(query.cursor.createdAt)}::timestamptz,${value(query.cursor.ticketId)}::text)`)
  const rows=(await db.query<{ticket_id:string;receipt_number:string;cursor_at:string;actor_id:string;confirmed_at:string;total:string|number;refunded:boolean|null}>(`SELECT c.ticket_id,c.receipt_number,to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,c.actor_id,c.result_json->>'confirmedAt' AS confirmed_at,c.result_json->'quote'->>'total' AS total,${refundExpression(refunds)} AS refunded FROM checkout_commands c ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY c.created_at DESC,c.ticket_id DESC LIMIT 21`,values)).rows
  const page=rows.slice(0,20);const last=page.at(-1)
  return {tenantId,rows:page.map((row) => ({ticketId:row.ticket_id,receiptNumber:row.receipt_number,confirmedAt:row.confirmed_at,actorId:row.actor_id,total:Number(row.total),refundStatus:status(row.refunded)})),nextCursor:rows.length>20 && last ? {createdAt:last.cursor_at,ticketId:last.ticket_id} : null}
 })
}
export async function readCheckoutHistory(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown):Promise<CheckoutHistoryDetail> {
 const row=object(input)
 if(Object.keys(row).some((key) => key!=='ticketId')) invalid()
 const ticketId=ticket(row.ticketId);await ready(pool)
 return withTenantClient(pool,tenantId,async (db) => {
  await assertRefundManager(db,tenantId,actorId)
  const refunds=await hasRefundSchema(db)
  const original=(await db.query<{result_json:CheckoutResult;refunded:boolean|null}>(`SELECT c.result_json,${refundExpression(refunds)} AS refunded FROM checkout_commands c WHERE c.ticket_id=$1`,[ticketId])).rows[0]
  if(!original) throw new AuthApiError(404,'CHECKOUT_TICKET_NOT_FOUND','Ticket canonique absent de cet établissement.')
  return {tenantId,result:original.result_json,refundStatus:status(original.refunded)}
 })
}
