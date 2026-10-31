import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSalonApiRequest } from '../../server/apiHandler'
import type { SqlPoolLike } from '../../server/neonClient'

export async function apiTestClient(pool: SqlPoolLike, method: string, url: string, body?: unknown, token?: string, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as IncomingMessage & { body?: unknown }
  req.method = method
  req.url = url
  req.body = body
  req.headers = { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) }
  let status = 200
  let raw = ''
  const responseHeaders: Record<string, string> = {}
  const res = {
    get statusCode() { return status },
    set statusCode(value: number) { status = value },
    setHeader(key: string, value: string) { responseHeaders[key.toLowerCase()] = value },
    end(chunk?: string) { raw += chunk ?? '' },
  } as unknown as ServerResponse
  await handleSalonApiRequest(req, res, { poolOverride: pool, expectedPinOverride: '' })
  return { status, headers: responseHeaders, body: JSON.parse(raw || '{}') as Record<string, unknown> }
}
