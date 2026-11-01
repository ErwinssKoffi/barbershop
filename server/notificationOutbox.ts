import type { SqlClientLike, SqlPoolLike } from './neonClient.ts'
import { validateTenantId, withTenantClient } from './tenantContext.ts'

export interface NotificationClaim {
  id: string; resource_id: string; event_type: 'booking_confirmation' | 'booking_reminder' | 'booking_cancellation'
  channel: 'email' | 'sms' | 'whatsapp'; lease_token: string; attempts: number; lease_until: string | Date
}
function bounded(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value<1 || value>max) throw new Error('Invalid outbox bound')
}
async function worker<T>(pool: SqlPoolLike, tenantId: string, work: (db: SqlClientLike) => Promise<T>): Promise<T> {
  return withTenantClient(pool,tenantId,async db => {
    await db.query("SELECT set_config('role','salon_pro_notify_' || substr(md5(current_schema()),1,12),true)")
    return work(db)
  })
}
/** Internal server primitive, NOT an API or sender. Explicit lease and bounded batch required. */
export async function claimNotifications(pool: SqlPoolLike, tenantId: string, limit: number, leaseSeconds: number): Promise<NotificationClaim[]> {
  bounded(limit,100); bounded(leaseSeconds,3600)
  return worker(pool,tenantId,async db => (await db.query<NotificationClaim>(`
    WITH due AS (
      SELECT tenant_id,id FROM notification_outbox
      WHERE state='pending' AND available_at<=now() AND expires_at>now() AND attempts<max_attempts
      ORDER BY available_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_outbox n SET state='processing',attempts=n.attempts+1,
      lease_token=gen_random_uuid(),leased_at=now(),lease_until=LEAST(n.expires_at,now()+$2*interval '1 second'),updated_at=now()
    FROM due WHERE n.tenant_id=due.tenant_id AND n.id=due.id
    RETURNING n.id,n.resource_id,n.event_type,n.channel,n.lease_token,n.attempts,n.lease_until`,[limit,leaseSeconds])).rows)
}
/** Token fencing prevents late completion after recovery/reclaim; delivery is not exactly-once. */
export async function settleNotification(pool: SqlPoolLike, tenantId: string, id: string, token: string, outcome: 'sent' | 'dead' | 'retry', retryAt?: string): Promise<boolean> {
  validateTenantId(id); validateTenantId(token)
  if (!['sent','dead','retry'].includes(outcome)) throw new Error('Invalid outbox outcome')
  if (outcome==='retry' && (typeof retryAt!=='string' || !Number.isFinite(Date.parse(retryAt)))) throw new Error('Explicit retry instant required')
  return worker(pool,tenantId,async db => {
    const result=await db.query(`UPDATE notification_outbox SET
      state=$3,available_at=COALESCE($4::timestamptz,available_at),lease_token=NULL,leased_at=NULL,lease_until=NULL,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND state='processing' AND lease_until>now() AND expires_at>now()
      RETURNING id`,[id,token,outcome==='retry'?'pending':outcome,outcome==='retry'?retryAt:null])
    return result.rows.length===1
  })
}
/** Reclaim eligibility only. No timer/job loop is registered and no transport is invoked. */
export async function recoverExpiredNotifications(pool: SqlPoolLike, tenantId: string, limit: number): Promise<number> {
  bounded(limit,100)
  return worker(pool,tenantId,async db => {
    const result=await db.query(`WITH expired AS (
      SELECT tenant_id,id FROM notification_outbox WHERE
        (state='processing' AND lease_until<=now()) OR (state='pending' AND (expires_at<=now() OR attempts>=max_attempts))
      ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
    ) UPDATE notification_outbox n SET
      state=CASE WHEN n.state='processing' AND n.expires_at>now() AND n.attempts<n.max_attempts THEN 'pending' ELSE 'dead' END,
      available_at=CASE WHEN n.expires_at>now() THEN now() ELSE n.available_at END,lease_token=NULL,leased_at=NULL,lease_until=NULL,updated_at=now()
      FROM expired WHERE n.tenant_id=expired.tenant_id AND n.id=expired.id RETURNING n.id`,[limit])
    return result.rows.length
  })
}
