// Bump CACHE on every deployment — the changed byte triggers a new SW install
const CACHE = 'vendrpro-20260522b';
const SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Never cache API calls
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }
  // App shell — cache first, fall back to network, store new responses
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
    ).catch(() => caches.match('/index.html'))
  );
});
