import { afterEach, expect, it, vi } from 'vitest'
import { fetchWithCapturedSession } from '../lib/scopedSyncClient'
import { storeAuthSession } from '../lib/sessionClient'
import type { PublicSalonUser } from '../domain/models'
const user:PublicSalonUser={id:'scope-user',tenantId:'scope-tenant',role:'manager',fullName:'Responsable',email:'scoped@example.invalid',isActive:true,createdAt:'2026-10-31',updatedAt:'2026-10-31'}
function token(account=user) {return `header.${btoa(JSON.stringify({uid:account.id,tid:account.tenantId,sid:'scope-session',exp:Date.now()+3600000}))}.signature`}
afterEach(() => {vi.unstubAllGlobals();window.localStorage.clear();window.sessionStorage.clear()})
it('n’envoie pas un payload préparé sous le jeton d’un nouveau compte',async () => {
 const original=token();const other={...user,id:'other'}
 storeAuthSession(other,token(other),false)
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
 await expect(fetchWithCapturedSession('/api/sync',original,{method:'POST',body:'private business data'})).rejects.toThrow('Session modifiée')
 expect(fetch).not.toHaveBeenCalled()
})
it('utilise le jeton capturé une seule fois, sans retry 401 ni en-tête fourni par le client',async () => {
 const original=token();storeAuthSession(user,original,false)
 const fetch=vi.fn(async () => {const other={...user,id:'other'};storeAuthSession(other,token(other),false);return new Response('{}',{status:401})});vi.stubGlobal('fetch',fetch)
 expect((await fetchWithCapturedSession('/api/sync',original,{method:'POST',headers:{Authorization:'untrusted'},body:'{}'})).status).toBe(401)
 expect(fetch).toHaveBeenCalledTimes(1)
 const args=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect((args[1].headers as Headers).get('Authorization')).toBe(`Bearer ${original}`)
})
it('refuse les destinations extérieures à /api/',async () => {
 await expect(fetchWithCapturedSession('https://example.invalid',token())).rejects.toThrow('hors origine')
})
