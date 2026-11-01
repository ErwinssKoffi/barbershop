import { resolveSubscriptionAccess } from './subscriptionAccess.ts'
import { AuthApiError } from './authEngine.ts'
import { withTenantClient } from './tenantContext.ts'
import type { SqlPoolLike } from './neonClient.ts'
import { parsePlanEntitlements,type PlanEntitlements } from '../src/domain/subscriptions.ts'
export async function readSubscriptionAccess(pool:SqlPoolLike,tenant:string,actor:string,input:unknown) {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)throw new AuthApiError(400,'INVALID_SUBSCRIPTION','Lecture sans filtre requise.')
  return withTenantClient(pool,tenant,async db=>{
    const member=(await db.query("SELECT m.user_id FROM memberships m JOIN salon_users u ON u.id=m.user_id WHERE m.tenant_id=$1 AND m.user_id=$2 AND m.role='manager' AND m.is_active AND u.is_active",[tenant,actor])).rows[0]
    if(!member)throw new AuthApiError(403,'SUBSCRIPTION_MANAGER_REQUIRED','Consultation réservée au Gérant actif.')
    if(!(await db.query<{ready:boolean}>("SELECT to_regclass('tenant_subscriptions') IS NOT NULL AND to_regclass('saas_plans') IS NOT NULL AS ready")).rows[0].ready)throw new AuthApiError(503,'SUBSCRIPTION_MIGRATION_REQUIRED','Migration volontaire 019 requise.')
    const {access,period,planName}=await resolveSubscriptionAccess(db,tenant)
    const catalog=(await db.query<{code:string;version:number;name:string;price_xof:string|number;grace_seconds:number;entitlements:PlanEntitlements}>('SELECT code,version,name,price_xof,grace_seconds,entitlements FROM saas_plans ORDER BY code,version LIMIT 101')).rows
    if(catalog.length>100)throw new AuthApiError(409,'SUBSCRIPTION_CATALOG_LIMIT','Catalogue trop volumineux pour cet écran.')
    return {subscription:{...access,planName,startsAt:period?.startsAt??null,endsAt:period?.endsAt??null,graceEndsAt:period?.graceEndsAt??null},catalog:catalog.map(p=>({code:p.code,version:p.version,name:p.name,priceXof:Number(p.price_xof),currency:'XOF' as const,graceSeconds:p.grace_seconds,entitlements:parsePlanEntitlements(p.entitlements)}))}
  })
}
