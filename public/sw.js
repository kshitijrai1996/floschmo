// FloSchmo service worker — makes the app work offline.
// It only ever caches the app's own static files. FCS data never touches it:
// samples are read from disk by the page and are not network requests.

const CACHE = 'floschmo-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page sends the URLs it has already loaded so a single visit is enough.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all((event.data.urls || []).map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res);
      } catch { /* offline or blocked — skip */ }
    }));
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page loads: network first (so updates arrive), cached copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true }))
          || (await cache.match('./', { ignoreSearch: true }))
          || Response.error();
      }
    })());
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
