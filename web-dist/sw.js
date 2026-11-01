// Keeps a copy of the app's own files so it opens even on a bad connection.
// Always tries the network first, so updates show up right away.
const CACHE = 'slake-0.9.0'
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin) return
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(e.request, c)); return r }).catch(() => caches.match(e.request)))
})
