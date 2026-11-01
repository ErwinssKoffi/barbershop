import { accessClaims, currentAccessToken, readStoredSession } from './sessionClient'
import { workspaceKey } from '../db/accountWorkspace'
import type { QueuedCheckout } from '../domain/checkoutQueue'
import type { CheckoutDelivery } from '../db/checkoutQueue'

/** Opt-in pilot, not a fallback when server validation fails. Not a secret. */
export function serverCheckoutEnabled(): boolean { return import.meta.env.VITE_SERVER_CHECKOUT === 'true' }

async function requestCheckout(row: QueuedCheckout, path: '/api/checkout/commit' | '/api/checkout/status', input: unknown): Promise<CheckoutDelivery> {
 const token = await currentAccessToken()
 const session = readStoredSession()
 const claims = accessClaims(token)
 if (!token || token !== session.token || !session.user || workspaceKey(session.user) !== row.scope || claims?.tid !== row.tenantId || claims.uid !== row.actorId) throw new Error('Session incompatible avec cette commande.')
 // A fixed token: never retry an old account's command with a newly signed-in account's token.
 const controller = new AbortController()
 const timeout = window.setTimeout(() => controller.abort(),20_000)
 try {
 const response = await window.fetch(path,{signal:controller.signal,method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input)})
 const body = await response.json()
 if (!body || typeof body !== 'object') throw new Error('Réponse de confirmation invalide.')
 const retry = Number(response.headers.get('Retry-After'))
 return {status:response.status,body,retryAfterMs:Number.isFinite(retry) && retry>0 ? retry*1000 : undefined}
 } finally {window.clearTimeout(timeout)}
}

export function deliverCheckout(row: QueuedCheckout): Promise<CheckoutDelivery> {
 return requestCheckout(row,'/api/checkout/commit',row.command)
}
export function inspectCheckout(row: QueuedCheckout): Promise<CheckoutDelivery> {
 return requestCheckout(row,'/api/checkout/status',{idempotencyKey:row.idempotencyKey})
}
