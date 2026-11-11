// Keeps a copy of the app's own files so it opens even on a bad connection.
// Always tries the network first, so updates show up right away.
const CACHE = 'slake-0.9.5'
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin) return
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(e.request, c)); return r }).catch(() => caches.match(e.request)))
})

// Phone buzz: the nudge is empty. Ask the introduction server who/where, then show it.
const PUSH = 'https://slake-intro.xjohnmitchell.workers.dev/push/pending'
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const sub = await self.registration.pushManager.getSubscription()
    let notes = []
    if (sub) {
      try { notes = (await (await fetch(PUSH, { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) })).json()).notes || [] } catch (err) {}
    }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return
    if (!notes.length) notes = [{ name: 'Someone', space: '' }]
    const last = notes[notes.length - 1]
    const title = notes.length > 1 ? notes.length + ' new messages' : last.name + (last.space ? ' · ' + last.space : '')
    await self.registration.showNotification(title, { body: notes.length > 1 ? 'Open Slake to read them' : 'New message', tag: 'slake', renotify: true, icon: 'icon-192.png', data: { space: last.space } })
  })())
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    if (ws.length) return ws[0].focus()
    return self.clients.openWindow('./')
  }))
})
