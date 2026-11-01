import { AuthApiError } from './authEngine.ts'
import type { SqlQueryable } from './neonClient.ts'
import type { CashSession } from '../src/domain/models/index.ts'

export async function hasCheckoutSchema(db: SqlQueryable): Promise<boolean> {
 return (await db.query<{ available: boolean }>("SELECT to_regclass('checkout_commands') IS NOT NULL AS available")).rows[0]?.available === true
}
export async function hasRefundSchema(db:SqlQueryable):Promise<boolean> {
 return (await db.query<{available:boolean}>("SELECT to_regclass('checkout_refunds') IS NOT NULL AS available")).rows[0]?.available === true
}
export async function isCheckoutRecord(db: SqlQueryable, table: string, id: string): Promise<boolean> {
 return (await db.query('SELECT row_id FROM checkout_records WHERE table_name = $1 AND row_id = $2', [table,id])).rows.length > 0 || (await hasRefundSchema(db) && (await db.query('SELECT row_id FROM checkout_refund_records WHERE table_name=$1 AND row_id=$2',[table,id])).rows.length>0)
}
export async function isCheckoutSession(db: SqlQueryable, id: string): Promise<boolean> {
 return (await db.query("SELECT c.row_id FROM checkout_records c JOIN cash_movements m ON m.id = c.row_id AND m.tenant_id = c.tenant_id WHERE c.table_name = 'cash_movements' AND m.session_id = $1 LIMIT 1", [id])).rows.length > 0 || (await hasRefundSchema(db) && (await db.query("SELECT c.row_id FROM checkout_refund_records c JOIN cash_movements m ON m.id=c.row_id AND m.tenant_id=c.tenant_id WHERE c.table_name='cash_movements' AND m.session_id=$1 LIMIT 1",[id])).rows.length>0)
}
export async function reconcileCheckoutCash(db: SqlQueryable, id: string, now: string): Promise<CashSession> {
 const session = (await db.query<{ payload_json: CashSession }>('SELECT payload_json FROM cash_sessions WHERE id = $1 FOR UPDATE', [id])).rows[0]?.payload_json
 if (!session) throw new AuthApiError(409,'CASH_SESSION_UNAVAILABLE','Session de caisse absente.')
 const safe = (value: number, nonnegative = true) => {
  if (!Number.isSafeInteger(value) || (nonnegative && value < 0)) throw new AuthApiError(409,'INVALID_CASH_BALANCE','Montant de caisse hors limite.')
  return value
 }
 const movements = await db.query<{ type: string; amount: string | number }>('SELECT type, amount FROM cash_movements WHERE session_id = $1', [id])
 let totalCashIn = 0; let totalCashOut = 0
 for (const row of movements.rows) {
  if (['in','correction_in'].includes(row.type)) totalCashIn = safe(totalCashIn + safe(Number(row.amount)))
  if (['out','correction_out'].includes(row.type)) totalCashOut = safe(totalCashOut + safe(Number(row.amount)))
 }
 const theoreticalClosingBalance = safe(safe(session.openingBalance) + totalCashIn - totalCashOut, false)
 const discrepancy = session.status === 'closed' && session.countedClosingBalance !== undefined ? safe(safe(session.countedClosingBalance) - theoreticalClosingBalance,false) : session.discrepancy
 if (session.totalCashIn === totalCashIn && session.totalCashOut === totalCashOut && session.theoreticalClosingBalance === theoreticalClosingBalance && session.discrepancy === discrepancy) return session
 const next = { ...session,totalCashIn,totalCashOut,theoreticalClosingBalance,discrepancy,updatedAt:now }
 await db.query('UPDATE cash_sessions SET theoretical_closing_balance = $2, discrepancy = $3, updated_at = $4, payload_json = $5::jsonb WHERE id = $1', [id,theoreticalClosingBalance,discrepancy ?? null,now,JSON.stringify(next)])
 return next
}
