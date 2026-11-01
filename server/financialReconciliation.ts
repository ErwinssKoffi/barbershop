import { AuthApiError } from './authEngine.ts'
import { setTenantContext, validateTenantId } from './tenantContext.ts'
import { hasCheckoutSchema, hasRefundSchema } from './checkoutLedger.ts'
import type { SqlPoolLike } from './neonClient.ts'
import { RECONCILIATION_CHECKS, validateFinancialReconciliation, type FinancialReconciliation } from '../src/domain/financialReconciliation.ts'

/** One coherent, read-only tenant snapshot. No locks, reconciliation writes, counters or repairs. */
export async function reconcileFinancialState(pool:SqlPoolLike,tenantId:string,actorId:string,input:unknown):Promise<FinancialReconciliation> {
 validateTenantId(tenantId)
 if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length) throw new AuthApiError(400,'INVALID_RECONCILIATION','Objet vide requis ; le salon provient de la session.')
 const db=await pool.connect()
 try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await db.query("SET LOCAL statement_timeout='5000ms'")
  await setTenantContext(db,tenantId)
  // No FOR SHARE: row locks are forbidden in this strictly read-only transaction.
  const actor=(await db.query<{role:string}>(`SELECT m.role FROM memberships m JOIN salon_users u ON u.id=m.user_id
   WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.is_active AND u.is_active`,[tenantId,actorId])).rows[0]
  if(actor?.role!=='manager') throw new AuthApiError(403,'RECONCILIATION_MANAGER_REQUIRED','Rapprochement réservé au Gérant actif.')
  if(!await hasCheckoutSchema(db)) throw new AuthApiError(503,'CHECKOUT_MIGRATION_REQUIRED','Migration volontaire 006 requise ; aucun rapprochement complet disponible.')
  const refunds=await hasRefundSchema(db)
  const row=(await db.query<Record<string,string>>(`WITH documents AS (
   SELECT ticket_id,receipt_number,result_json,1 AS sign,result_json->'quote'->>'total' AS total,result_json->'command'->'payments' AS payments FROM checkout_commands
   ${refunds ? "UNION ALL SELECT refund_ticket_id,receipt_number,result_json,-1,result_json->>'total',result_json->'payments' FROM checkout_refunds" : ''}
  ), owners AS (
   SELECT ticket_id,table_name,row_id FROM checkout_records
   ${refunds ? 'UNION ALL SELECT ticket_id,table_name,row_id FROM checkout_refund_records' : ''}
  ), expected AS (
   SELECT d.ticket_id,d.receipt_number,k.kind,r.record FROM documents d
   CROSS JOIN (VALUES ('revenues','revenues'),('cash_movements','cashMovements'),('stock_movements','stockMovements')) k(kind,field)
   CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.result_json->'records'->k.field,'[]'::jsonb)) r(record)
  ), actual AS (
   SELECT id,'revenues' AS kind,payload_json,
    (amount IS NOT DISTINCT FROM (payload_json->>'amount')::numeric AND ticket_id IS NOT DISTINCT FROM payload_json->>'ticketId' AND receipt_number IS NOT DISTINCT FROM payload_json->>'receiptNumber') AS scalars_match FROM revenues
   UNION ALL SELECT id,'cash_movements',payload_json,
    (amount IS NOT DISTINCT FROM (payload_json->>'amount')::numeric AND session_id IS NOT DISTINCT FROM payload_json->>'sessionId' AND type IS NOT DISTINCT FROM payload_json->>'type') FROM cash_movements
   UNION ALL SELECT id,'stock_movements',payload_json,
    (quantity_delta IS NOT DISTINCT FROM (payload_json->>'quantityDelta')::numeric AND quantity_after IS NOT DISTINCT FROM (payload_json->>'quantityAfter')::numeric AND unit_cost IS NOT DISTINCT FROM (payload_json->>'unitCost')::numeric AND product_id IS NOT DISTINCT FROM payload_json->>'productId' AND type IS NOT DISTINCT FROM payload_json->>'type') FROM stock_movements
  ), cash_totals AS (
   SELECT session_id,SUM(CASE WHEN type IN ('in','correction_in') THEN amount ELSE 0 END) AS incoming,
    SUM(CASE WHEN type IN ('out','correction_out') THEN amount ELSE 0 END) AS outgoing FROM cash_movements GROUP BY session_id
  ) SELECT
   (SELECT count(*) FROM documents)::text AS documents,
   (SELECT count(*) FROM cash_sessions)::text AS sessions,
   (SELECT count(*) FROM documents d WHERE d.total IS NULL OR d.total::numeric<0 OR d.total::numeric>9007199254740991 OR trunc(d.total::numeric)<>d.total::numeric
    OR d.result_json->>'tenantId' IS DISTINCT FROM $1 OR d.result_json->>'ticketId' IS DISTINCT FROM d.ticket_id OR d.result_json->>'receiptNumber' IS DISTINCT FROM d.receipt_number
    OR (SELECT COALESCE(sum(r.amount),0) FROM revenues r WHERE r.ticket_id=d.ticket_id)<>d.sign*d.total::numeric
    OR d.payments IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(d.payments) p WHERE p->>'amount' IS NULL OR (p->>'amount')::numeric<0 OR (p->>'amount')::numeric>9007199254740991 OR trunc((p->>'amount')::numeric)<>(p->>'amount')::numeric)
    OR (SELECT COALESCE(sum((p->>'amount')::numeric),0) FROM jsonb_array_elements(d.payments) p)<>d.total::numeric)::text AS "documentTotals",
   (SELECT count(*) FROM expected e LEFT JOIN actual a ON a.kind=e.kind AND a.id=e.record->>'id'
    LEFT JOIN owners o ON o.ticket_id=e.ticket_id AND o.table_name=e.kind AND o.row_id=e.record->>'id'
    WHERE a.id IS NULL OR o.row_id IS NULL OR a.payload_json IS DISTINCT FROM e.record OR NOT a.scalars_match)::text AS "canonicalRecords",
   (SELECT count(*) FROM owners o LEFT JOIN expected e ON e.ticket_id=o.ticket_id AND e.kind=o.table_name AND e.record->>'id'=o.row_id
    WHERE e.record IS NULL)::text AS "recordOwnership",
   (SELECT count(*) FROM cash_sessions s LEFT JOIN cash_totals t ON t.session_id=s.id WHERE
    s.opening_balance<0 OR s.opening_balance>9007199254740991 OR ABS(s.theoretical_closing_balance::numeric)>9007199254740991
    OR COALESCE(t.incoming,0)>9007199254740991 OR COALESCE(t.outgoing,0)>9007199254740991
    OR s.opening_balance IS DISTINCT FROM (s.payload_json->>'openingBalance')::numeric
    OR s.theoretical_closing_balance<>s.opening_balance+COALESCE(t.incoming,0)-COALESCE(t.outgoing,0)
    OR (s.payload_json->>'theoreticalClosingBalance')::numeric IS DISTINCT FROM s.theoretical_closing_balance
    OR (s.payload_json->>'totalCashIn')::numeric IS DISTINCT FROM COALESCE(t.incoming,0)
    OR (s.payload_json->>'totalCashOut')::numeric IS DISTINCT FROM COALESCE(t.outgoing,0)
    OR s.status IS DISTINCT FROM s.payload_json->>'status'
    OR (s.status='closed' AND (s.counted_closing_balance IS NULL OR s.discrepancy IS DISTINCT FROM s.counted_closing_balance-s.theoretical_closing_balance
     OR (s.payload_json->>'countedClosingBalance')::numeric IS DISTINCT FROM s.counted_closing_balance
     OR (s.payload_json->>'discrepancy')::numeric IS DISTINCT FROM s.discrepancy)))::text AS "cashSessionBalances",
   (SELECT count(*) FROM cash_movements m LEFT JOIN cash_sessions s ON s.id=m.session_id WHERE s.id IS NULL)::text AS "orphanCashMovements",
   (SELECT count(*) FROM cash_movements m WHERE m.type NOT IN ('in','out','correction_in','correction_out') OR m.amount<0 OR m.amount>9007199254740991
    OR m.amount IS DISTINCT FROM (m.payload_json->>'amount')::numeric OR m.session_id IS DISTINCT FROM m.payload_json->>'sessionId' OR m.type IS DISTINCT FROM m.payload_json->>'type')::text AS "invalidCashMovements"`,[tenantId])).rows[0]
  if(!row) throw new Error('Missing reconciliation aggregate')
  const checks=Object.fromEntries(RECONCILIATION_CHECKS.map((key) => [key,Number(row[key])])) as FinancialReconciliation['checks']
  const report=validateFinancialReconciliation({tenantId,checkedAt:new Date().toISOString(),status:RECONCILIATION_CHECKS.some((key) => checks[key]>0) ? 'discrepancies' : refunds ? 'balanced' : 'incomplete',refundsAvailable:refunds,documentsChecked:Number(row.documents),cashSessionsChecked:Number(row.sessions),checks,readOnly:true},tenantId)
  await db.query('ROLLBACK')
  return report
 } catch(error) {
  try {await db.query('ROLLBACK')} catch { /* Original error remains private. */ }
  if(error instanceof AuthApiError) throw error
  throw new AuthApiError(503,'RECONCILIATION_UNAVAILABLE','Contrôle financier indisponible ou données non vérifiables. Aucune correction appliquée.')
 } finally {db.release()}
}
