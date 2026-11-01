import type { SqlQueryable } from './neonClient.ts'
import { effectiveSubscription,type PlanEntitlements } from '../src/domain/subscriptions.ts'
/** Transaction-local, tenant-filtered DB authority. No client dates or cached rights. */
export async function resolveSubscriptionAccess(db:SqlQueryable,tenant:string) {
 const ready=(await db.query<{ready:boolean}>("SELECT to_regclass('tenant_subscriptions') IS NOT NULL AND to_regclass('saas_plans') IS NOT NULL AS ready")).rows[0]?.ready===true
 const clock=(await db.query<{at:Date|string;active:boolean}>("SELECT now() AS at,EXISTS(SELECT 1 FROM tenants WHERE id=$1 AND status='active') AS active",[tenant])).rows[0]
 if(!clock)throw new Error('Database clock unavailable')
 const iso=(value:Date|string)=>new Date(value).toISOString()
 const current=ready?(await db.query<{starts_at:Date|string;ends_at:Date|string;grace_ends_at:Date|string;revoked_at:Date|string|null;entitlements:PlanEntitlements;name:string}>(`SELECT s.starts_at,s.ends_at,s.grace_ends_at,s.revoked_at,p.entitlements,p.name
 FROM tenant_subscriptions s JOIN saas_plans p ON p.id=s.plan_id WHERE s.tenant_id=$1
 ORDER BY CASE WHEN s.revoked_at IS NOT NULL THEN 4 WHEN s.starts_at<=now() AND s.ends_at>now() THEN 0 WHEN s.ends_at<=now() AND s.grace_ends_at>now() THEN 1 WHEN s.starts_at>now() THEN 2 ELSE 3 END,
 CASE WHEN s.starts_at>now() THEN s.starts_at END ASC,s.ends_at DESC,s.id LIMIT 1`,[tenant])).rows[0]:undefined
 const period=current?{startsAt:iso(current.starts_at),endsAt:iso(current.ends_at),graceEndsAt:iso(current.grace_ends_at),revokedAt:current.revoked_at?iso(current.revoked_at):null,entitlements:current.entitlements}:null
 return {ready,access:effectiveSubscription(period,iso(clock.at),clock.active),period,planName:current?.name??null}
}
