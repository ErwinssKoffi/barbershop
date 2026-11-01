import { accessClaims, currentAccessToken, readStoredSession } from './sessionClient'

/** Never send an already-built business payload under a replacement account/token. */
export async function fetchWithCapturedSession(url:string,expectedToken:string,init:RequestInit = {}):Promise<Response> {
 if(!url.startsWith('/api/')) throw new Error('Appel de synchronisation hors origine refusé.')
 const token=await currentAccessToken();const session=readStoredSession();const claims=accessClaims(token)
 if(!token || token!==expectedToken || token!==session.token || !session.user || claims?.uid!==session.user.id || claims.tid!==session.user.tenantId) throw new Error('Session modifiée pendant la synchronisation. Aucun nouvel envoi : reconnectez le compte de cet espace.')
 const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${token}`)
 return window.fetch(url,{...init,credentials:'same-origin',headers})
}
