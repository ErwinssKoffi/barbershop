import { afterEach, expect, it, vi } from 'vitest'
import { checkCheckoutPreflight } from '../lib/checkoutPreflight'
import type { CheckoutCutoverReport } from '../domain/checkoutCutover'

vi.mock('../lib/sessionClient',() => ({currentAccessToken:async () => 'unit-token',readStoredSession:() => ({token:'unit-token',user:{id:'unit-user',tenantId:'unit-tenant'}}),accessClaims:() => ({uid:'unit-user',tid:'unit-tenant'})}))

afterEach(() => {vi.unstubAllEnvs();vi.unstubAllGlobals();window.localStorage.clear();window.sessionStorage.clear()})
function reply(report:Partial<CheckoutCutoverReport>,status=200) {
 const data={mode:'legacy',checkoutSchemaReady:false,activationApproved:false,canSync:true,blockedCount:0,blockers:[],truncated:false,...report}
 const fetch=vi.fn(async () => new Response(JSON.stringify({ok:status===200,report:data}),{status,headers:{'Content-Type':'application/json'}}));vi.stubGlobal('fetch',fetch);return fetch
}
it('conserve le mode legacy et transmet le delta pré-pull sans rien normaliser',async () => {
 const fetch=reply({blockedCount:2})
 const payload={payload:{format:'SALON_PRO_BACKUP_V1',revenues:[{id:'local-pending'}]},cursor:2}
 expect((await checkCheckoutPreflight(payload,'unit-token')).mode).toBe('legacy')
 const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit]
 expect(url).toBe('/api/checkout/preflight');expect(JSON.parse(init.body as string)).toEqual(payload)
 expect(payload.payload.revenues[0].id).toBe('local-pending')
})
it('bloque un backlog enforced sans autoriser un pull/push ou une conversion de clé',async () => {
 vi.stubEnv('VITE_SERVER_CHECKOUT','true')
 reply({mode:'enforced',checkoutSchemaReady:true,activationApproved:true,canSync:false,blockedCount:2})
 await expect(checkCheckoutPreflight({payload:{}},'unit-token')).rejects.toThrow('Aucun pull/push')
})
it('refuse une installation non prête et un client sans pilote',async () => {
 reply({mode:'enforced',checkoutSchemaReady:false,canSync:false})
 await expect(checkCheckoutPreflight({payload:{}},'unit-token')).rejects.toThrow('non prête')
 reply({mode:'enforced',checkoutSchemaReady:true,activationApproved:true})
 await expect(checkCheckoutPreflight({payload:{}},'unit-token')).rejects.toThrow('client n’a pas le pilote')
 vi.stubEnv('VITE_SERVER_CHECKOUT','true')
 expect((await checkCheckoutPreflight({payload:{}},'unit-token')).canSync).toBe(true)
})
it('ne poursuit pas si le serveur est ancien, injoignable ou répond un rapport invalide',async () => {
 reply({},404)
 await expect(checkCheckoutPreflight({},'unit-token')).rejects.toThrow('Prévol')
 vi.stubGlobal('fetch',vi.fn(async () => new Response('{}',{status:200})))
 await expect(checkCheckoutPreflight({},'unit-token')).rejects.toThrow('Prévol')
 vi.stubGlobal('fetch',vi.fn(async () => {throw new Error('offline')}))
 await expect(checkCheckoutPreflight({},'unit-token')).rejects.toThrow('offline')
})

it('ne transmet pas un backlog avec un autre jeton que celui capturé par le compte',async () => {
 const fetch=reply({})
 await expect(checkCheckoutPreflight({},'different-token')).rejects.toThrow('Session modifiée')
 expect(fetch).not.toHaveBeenCalled()
})
