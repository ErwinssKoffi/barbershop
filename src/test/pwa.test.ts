import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createWorker } from '../../server/pwaBuild'

type WorkerEvent = { request?: unknown; waitUntil(promise: Promise<unknown>): void; respondWith(promise: Promise<Response>): void }
function worker(options: { fail?: boolean } = {}) {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const stores = new Map<string, Map<string, Response>>()
  stores.set('salon-pro-shell-old', new Map())
  stores.set('other-application', new Map())
  const fetcher = vi.fn(async (request: Request) => {
    if (options.fail) throw new Error('Network unavailable')
    return new Response('public shell', { headers: { 'content-type': request.url.endsWith('.js') ? 'text/javascript' : 'text/html' } })
  })
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)!
      return { async put(key: string, value: Response) { store.set(key, value) }, async match(key: string) { return store.get(key)?.clone() } }
    },
    async keys() { return [...stores.keys()] },
    async delete(name: string) { return stores.delete(name) },
  }
  const skipWaiting = vi.fn(); const claim = vi.fn()
  vm.runInNewContext(createWorker('new', ['/index.html', '/assets/app.js']), {
    self: { location: { origin: 'https://salon.example' }, addEventListener(type: string, callback: (event: WorkerEvent) => void) { listeners.set(type, callback) }, skipWaiting, clients: { claim } },
    caches, fetch: fetcher, Request, URL,
  })
  function dispatch(type: string, request?: unknown) {
    let result: Promise<unknown> | undefined
    listeners.get(type)!({ request, waitUntil(promise) { result = promise }, respondWith(promise) { result = promise } })
    return result
  }
  const request = (path: string, extra = {}) => ({ url: `https://salon.example${path}`, method: 'GET', mode: 'cors', headers: new Headers(), ...extra })
  return { stores, fetcher, dispatch, request, skipWaiting, claim }
}

describe('PWA — cache public strict et cycle de mise à jour', () => {
  it('précharge sans credentials et ne force ni activation ni remplacement des pages', async () => {
    const sw = worker()
    await sw.dispatch('install')
    expect(sw.stores.get('salon-pro-shell-new')?.size).toBe(2)
    for (const [request] of sw.fetcher.mock.calls) expect(request.credentials).toBe('omit')
    expect(sw.skipWaiting).not.toHaveBeenCalled()
    await sw.dispatch('activate')
    expect(sw.claim).not.toHaveBeenCalled()
    expect(sw.stores.has('salon-pro-shell-old')).toBe(false)
    expect(sw.stores.has('other-application')).toBe(true)
  })

  it('sert les routes SPA et les chunks connus hors ligne sans réseau ni cache dynamique', async () => {
    const sw = worker(); await sw.dispatch('install'); sw.fetcher.mockClear()
    const navigation = await sw.dispatch('fetch', sw.request('/revenues?date=2026-10-30', { mode: 'navigate' })) as Response
    expect(await navigation.text()).toBe('public shell')
    expect(await sw.dispatch('fetch', sw.request('/assets/app.js'))).toBeInstanceOf(Response)
    expect(sw.fetcher).not.toHaveBeenCalled()
    expect(sw.dispatch('fetch', sw.request('/receipts/customer.pdf'))).toBeUndefined()
    expect(sw.dispatch('fetch', sw.request('/assets/unknown.js'))).toBeUndefined()
    expect(sw.dispatch('fetch', sw.request('/assets/app.js?private=1'))).toBeUndefined()
  })

  it('ne capture aucune API, authentification, origine externe ou mutation', () => {
    const sw = worker()
    for (const path of ['/api', '/api/auth/login', '/api/auth/refresh', '/api/sync/pull?since=1']) {
      expect(sw.dispatch('fetch', sw.request(path, { mode: 'navigate' }))).toBeUndefined()
    }
    expect(sw.dispatch('fetch', sw.request('/assets/app.js', { method: 'POST' }))).toBeUndefined()
    expect(sw.dispatch('fetch', sw.request('/assets/app.js', { headers: new Headers({ Authorization: 'Bearer private' }) }))).toBeUndefined()
    expect(sw.dispatch('fetch', sw.request('/assets/app.js', { url: 'https://other.example/assets/app.js' }))).toBeUndefined()
  })

  it('refuse une installation partielle et conserve le cache précédent en cas de panne', async () => {
    const sw = worker({ fail: true })
    await expect(sw.dispatch('install')).rejects.toThrow('Network unavailable')
    expect(sw.stores.has('salon-pro-shell-new')).toBe(false)
    expect(sw.stores.has('salon-pro-shell-old')).toBe(true)
  })
})
