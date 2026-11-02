// Keeps a copy of the app so it opens offline. Network first, so updates show up right away.
const C = 'slake-2'
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())))
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin) return
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(C).then((k) => k.put(e.request, c)); return r }).catch(() => caches.match(e.request)))
})
