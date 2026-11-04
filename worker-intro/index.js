// Slake's own "introduction server".
//
// Before two devices can talk directly, they have to find each other. Slake
// does that by dropping little "I'm here" notes on a shared message board
// (the Nostr protocol). Free public boards turn out to be unreliable: they ban
// phone networks, refuse strangers, or just go down. This is our own board.
//
// It remembers nothing. It passes each note along to whoever is listening for
// that space's meeting point, and forgets it. Messages and files never touch
// it; they go directly between devices.

export default {
  async fetch (request, env) {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('Slake introduction server. Nothing to see here.', { headers: { 'content-type': 'text/plain' } })
    }
    return env.HUB.get(env.HUB.idFromName('main')).fetch(request)
  }
}

export class Hub {
  constructor () { this.socks = new Set() }

  async fetch () {
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()
    const me = { ws: server, subs: new Map() }
    this.socks.add(me)
    server.addEventListener('message', (e) => { try { this.onMessage(me, e.data) } catch {} })
    const done = () => { this.socks.delete(me) }
    server.addEventListener('close', done)
    server.addEventListener('error', done)
    return new Response(null, { status: 101, webSocket: client })
  }

  onMessage (me, raw) {
    if (typeof raw !== 'string' || raw.length > 65536) return
    const m = JSON.parse(raw)
    if (m[0] === 'REQ') {
      if (me.subs.size >= 100) { me.ws.send(JSON.stringify(['CLOSED', m[1], 'error: too many subscriptions'])); return }
      me.subs.set(m[1], m.slice(2))
      me.ws.send(JSON.stringify(['EOSE', m[1]]))
    } else if (m[0] === 'CLOSE') {
      me.subs.delete(m[1])
    } else if (m[0] === 'EVENT') {
      const ev = m[1]
      if (!ev || typeof ev.id !== 'string') return
      me.ws.send(JSON.stringify(['OK', ev.id, true, '']))
      for (const s of this.socks) {
        for (const [id, filters] of s.subs) {
          if (filters.some((f) => matches(f, ev))) {
            try { s.ws.send(JSON.stringify(['EVENT', id, ev])) } catch {}
          }
        }
      }
    }
  }
}

function matches (f, ev) {
  if (f.kinds && !f.kinds.includes(ev.kind)) return false
  if (f.ids && !f.ids.includes(ev.id)) return false
  if (f.authors && !f.authors.includes(ev.pubkey)) return false
  for (const k of Object.keys(f)) {
    if (k[0] !== '#') continue
    const name = k.slice(1)
    if (!(ev.tags || []).some((t) => t[0] === name && f[k].includes(t[1]))) return false
  }
  return true
}
