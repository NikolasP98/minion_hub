/// <reference lib="webworker" />
import { build, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const prefix = 'minion-hub-offline-';
const cacheName = `${prefix}${version}`;
const fallback = '/offline.html';
// Only content-addressed application assets are eligible. Never cache HTML,
// API data, version.json, redirects, or the route data protocol.
const immutable = new Set(
  build.filter((path) => path.startsWith('/_app/immutable/') && !path.endsWith('.html')),
);

worker.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      const response = await fetch(fallback, { cache: 'no-store', credentials: 'omit' });
      if (!response.ok || response.redirected) throw new Error('Offline document unavailable');
      await cache.put(fallback, response);
      // Cache assets lazily: preloading every module would undo the boot diet.
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
      }
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== worker.location.origin ||
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(async () => {
        const offline = await (await caches.open(cacheName)).match(fallback);
        return offline ?? new Response('Offline', { status: 503 });
      }),
    );
    return;
  }
  if (!immutable.has(url.pathname) || url.search) return;
  event.respondWith(
    (async () => {
      let cache: Cache | undefined;
      try {
        cache = await caches.open(cacheName);
        const hit = await cache.match(request);
        if (hit) return hit;
      } catch {
        /* Optional cache storage must never break a live asset. */
      }
      const response = await fetch(request);
      if (
        response.ok &&
        !response.redirected &&
        !response.headers.get('content-type')?.includes('text/html')
      ) {
        try {
          await cache?.put(request, response.clone());
        } catch {
          /* Quota/disabled storage: use network response. */
        }
      }
      return response;
    })(),
  );
});
