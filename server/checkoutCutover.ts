import { AuthApiError } from './authEngine.ts'
import { hasCheckoutSchema } from './checkoutLedger.ts'
import { withTenantClient } from './tenantContext.ts'
import { lockSyncState } from './syncProtocol.ts'
import type { SqlPoolLike, SqlQueryable } from './neonClient.ts'
import type { CheckoutCutoverReport } from '../src/domain/checkoutCutover.ts'

export function checkoutSyncMode(): 'legacy'|'enforced' {
 const mode=process.env.SALON_CHECKOUT_SYNC_MODE?.trim() || 'legacy'
 if(mode !== 'legacy' && mode !== 'enforced') throw new AuthApiError(503,'CHECKOUT_CUTOVER_CONFIG_INVALID','Mode de bascule checkout invalide ; aucune synchronisation appliquée.')
 return mode
}
function record(value:unknown):Record<string,unknown> {
 if(!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthApiError(400,'INVALID_PAYLOAD','Prévol : objet de synchronisation invalide.')
 return value as Record<string,unknown>
}
function canonical(value:unknown):string {
 if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
 if(value && typeof value === 'object') return `{${Object.entries(value).filter(([key]) => key !== 'updatedAt').sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
 return JSON.stringify(value)
}
const tables={revenues:'revenues',cashMovements:'cash_movements',stockMovements:'stock_movements'} as const
const entities={revenue:'revenues',cash_movement:'cashMovements',stock_movement:'stockMovements'} as const
function saleReference(row:Record<string,unknown> | undefined):boolean {
 return Boolean(row && (row.linkedRevenueId || row.ticketId || row.receiptNumber || row.type === 'sale' || row.type === 'use'))
}
async function referencedByRevenue(db:SqlQueryable,key:keyof typeof tables,id:string):Promise<boolean> {
 if(key === 'revenues') return true
 const field=key === 'cashMovements' ? 'cashMovementId' : 'linkedStockMovementId'
 const list=key === 'cashMovements' ? 'paymentSplits' : 'consumablesUsed'
 const nested=key === 'cashMovements' ? 'cashMovementId' : 'stockMovementId'
 return (await db.query(`SELECT id FROM revenues WHERE payload_json->>'${field}' = $1 OR EXISTS (
  SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(payload_json->'${list}') = 'array' THEN payload_json->'${list}' ELSE '[]'::jsonb END) part
  WHERE part->>'${nested}' = $1) LIMIT 1`,[id])).rows.length>0
}

/** Diagnose only caller-supplied IDs; no financial snapshots leave this function. */
export async function analyzeCheckoutCutover(db:SqlQueryable,input:unknown):Promise<CheckoutCutoverReport> {
 const incoming=record(input);const payload=record(incoming.payload)
 if(payload.format !== 'SALON_PRO_BACKUP_V1') throw new AuthApiError(400,'INVALID_PAYLOAD','Format de synchronisation invalide.')
 const mode=checkoutSyncMode();const checkoutSchemaReady=await hasCheckoutSchema(db)
 const activationApproved=process.env.SALON_CHECKOUT_CUTOVER_APPROVED === 'true'
 const blockers:CheckoutCutoverReport['blockers']=[];let blockedCount=0;let examined=0
 const block=(table:keyof typeof tables,id:string,operation:'write'|'delete') => {
  blockedCount++;if(blockers.length<100) blockers.push({table,id,operation,code:'LEGACY_SALE_WRITE_BLOCKED'})
 }
 for(const [key,table] of Object.entries(tables) as [keyof typeof tables,string][]) {
  const rows=payload[key] ?? []
  if(!Array.isArray(rows)) throw new AuthApiError(400,'INVALID_PAYLOAD','Prévol : table invalide.')
  for(const raw of rows) {
   if(++examined>10000) throw new AuthApiError(413,'PREFLIGHT_TOO_LARGE','Prévol limité à 10 000 écritures financières.')
   const row=record(raw)
   if(typeof row.id !== 'string' || !row.id || row.id.length>200) throw new AuthApiError(400,'INVALID_PAYLOAD','Prévol : identifiant invalide.')
   const current=(await db.query<{payload_json:Record<string,unknown>}>(`SELECT payload_json FROM ${table} WHERE id = $1`,[row.id])).rows[0]?.payload_json
   if(current && canonical(current) === canonical(row)) continue
   if(key === 'revenues' || saleReference(row) || saleReference(current) || await referencedByRevenue(db,key,row.id)) block(key,row.id,'write')
  }
 }
 const tombstones=incoming.tombstones ?? []
 if(!Array.isArray(tombstones)) throw new AuthApiError(400,'INVALID_PAYLOAD','Prévol : suppressions invalides.')
 for(const raw of tombstones) {
  if(++examined>10000) throw new AuthApiError(413,'PREFLIGHT_TOO_LARGE','Prévol trop volumineux.')
  const item=record(raw)
  if(typeof item.entityType !== 'string' || typeof item.entityId !== 'string' || !item.entityId || item.entityId.length>200) throw new AuthApiError(400,'INVALID_PAYLOAD','Prévol : suppression invalide.')
  if(!Object.hasOwn(entities,item.entityType)) continue
  const key=entities[item.entityType as keyof typeof entities]
  if(!key) continue
  if((await db.query('SELECT entity_id FROM sync_tombstones WHERE entity_type = $1 AND entity_id = $2',[item.entityType,item.entityId])).rows.length) continue
  const current=(await db.query<{payload_json:Record<string,unknown>}>(`SELECT payload_json FROM ${tables[key]} WHERE id = $1`,[item.entityId])).rows[0]?.payload_json
  if(key === 'revenues' || saleReference(current) || await referencedByRevenue(db,key,item.entityId)) block(key,item.entityId,'delete')
 }
 return {mode,checkoutSchemaReady,activationApproved,canSync:mode === 'legacy' || (checkoutSchemaReady && activationApproved && blockedCount===0),blockedCount,blockers,truncated:blockedCount>blockers.length}
}

export async function enforceCheckoutCutover(db:SqlQueryable,input:unknown):Promise<void> {
 if(checkoutSyncMode() === 'legacy') return
 const report=await analyzeCheckoutCutover(db,input)
 if(!report.checkoutSchemaReady || !report.activationApproved) throw new AuthApiError(503,'CHECKOUT_CUTOVER_NOT_READY','Bascule demandée sans migration 006 ou approbation opérateur ; aucun élément de cet envoi n’a été écrit.')
 if(report.blockedCount) throw new AuthApiError(409,'LEGACY_SALE_WRITE_BLOCKED',`${report.blockedCount} écriture(s) de vente historique bloquée(s). Envoi intégralement annulé ; conservez les données locales et examinez /api/checkout/preflight. Ne recréez pas ces ventes sous de nouvelles clés.`)
}

export async function preflightCheckout(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown):Promise<CheckoutCutoverReport> {
 return withTenantClient(pool,tenantId,async (db) => {
  await lockSyncState(db)
  const active=await db.query('SELECT m.user_id FROM memberships m JOIN salon_users u ON u.id = m.user_id WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.is_active AND u.is_active',[tenantId,actorId])
  if(!active.rows.length) throw new AuthApiError(403,'TENANT_ACCESS_DENIED','Appartenance active requise.')
  return analyzeCheckoutCutover(db,input)
 })
}
