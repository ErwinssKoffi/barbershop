import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'

/** No runtime caching: only public, build-time application files are eligible. */
export function createWorker(version: string, files: string[], integrity: Record<string, string> = {}): string {
  return `/* SALON PRO — generated public application shell. No API/data cache. */
const CACHE = ${JSON.stringify(`salon-pro-shell-${version}`)};
const FILES = ${JSON.stringify(files)};
const INTEGRITY = ${JSON.stringify(integrity)};
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await Promise.all(FILES.map(async file => {
        const response = await fetch(new Request(new URL(file, self.location.origin), { cache: 'reload', credentials: 'omit', redirect: 'error', integrity: INTEGRITY[file] }));
        if (!response.ok || response.type === 'opaque') throw new Error('Incomplete application shell');
        const type = response.headers.get('content-type') || '';
        if ((file.endsWith('.js') && !type.includes('javascript')) || (file.endsWith('.css') && !type.includes('text/css')) || (file === '/index.html' && !type.includes('text/html'))) throw new Error('Unexpected application content');
        await cache.put(file, response);
      }));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
  // Intentionally no skipWaiting: all old windows must close before activation.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('salon-pro-shell-') && key !== CACHE) await caches.delete(key);
    }
  })());
  // No clients.claim: never replace a loaded page's application version.
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/') || request.headers.has('authorization')) return;
  const navigation = request.mode === 'navigate';
  if (!navigation && (url.search || !FILES.includes(url.pathname))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const response = await cache.match(navigation ? '/index.html' : url.pathname);
    return response || fetch(request);
  })());
});
`
}

export function applicationPwaPlugin(): Plugin {
  let output = ''
  return {
    name: 'salon-pro-public-shell',
    apply: 'build',
    configResolved(config) { output = path.resolve(config.root, config.build.outDir) },
    async writeBundle() {
      const files: string[] = []
      const scan = async (directory: string) => {
        for (const item of await readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, item.name)
          if (item.isDirectory()) await scan(file)
          else {
            const relative = '/' + path.relative(output, file).split(path.sep).join('/')
            if (relative === '/index.html' || relative === '/manifest.webmanifest' || relative === '/barber-icon.svg' || /^\/(assets|icons|images)\/.*\.(js|css|woff2?|png|svg|webp|jpg|jpeg|ico)$/.test(relative)) files.push(relative)
          }
        }
      }
      await scan(output)
      files.sort()
      const integrity: Record<string, string> = {}
      for (const file of files) integrity[file] = 'sha256-' + createHash('sha256').update(await readFile(path.join(output, file))).digest('base64')
      const version = createHash('sha256').update(createWorker('build', files, integrity)).digest('hex').slice(0, 20)
      await writeFile(path.join(output, 'sw.js'), createWorker(version, files, integrity))
    },
  }
}
