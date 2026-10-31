import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthApiError } from './authEngine.ts'

const REFRESH_COOKIE = 'salon_pro_refresh'
export function readRefreshCookie(req: IncomingMessage): string | undefined {
  const raw = req.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${REFRESH_COOKIE}=`))
  if (!raw) return undefined
  try { return decodeURIComponent(raw.slice(REFRESH_COOKIE.length + 1)) } catch { return undefined }
}
export function writeRefreshCookie(res: ServerResponse, token?: string, rememberMe = true, expiresAt?: string): void {
  const attributes = [`${REFRESH_COOKIE}=${token ?? ''}`, 'HttpOnly', 'SameSite=Strict', 'Path=/api/auth']
  if (process.env.NODE_ENV === 'production') attributes.push('Secure')
  if (!token) attributes.push('Max-Age=0')
  else if (rememberMe && expiresAt) attributes.push(`Max-Age=${Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))}`)
  res.setHeader('Set-Cookie', attributes.join('; '))
}
export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new AuthApiError(403, 'ORIGIN_FORBIDDEN', 'Origine non autorisée.')
  if (origin) {
    try {
      if (new URL(origin).host === req.headers.host) return
    } catch { /* Rejet ci-dessous */ }
    throw new AuthApiError(403, 'ORIGIN_FORBIDDEN', 'Origine non autorisée.')
  }
}
