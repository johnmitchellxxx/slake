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
    const url = new URL(request.url)
    if (url.pathname.startsWith('/push/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
      const res = await env.PUSH.get(env.PUSH.idFromName('main')).fetch(request)
      const h = new Headers(res.headers)
      for (const [k, v] of Object.entries(CORS)) h.set(k, v)
      return new Response(res.body, { status: res.status, headers: h })
    }
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('Slake introduction server. Nothing to see here.', { headers: { 'content-type': 'text/plain' } })
    }
    return env.HUB.get(env.HUB.idFromName('main')).fetch(request)
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type'
}

// ---- Phone wake-ups (Web Push) ----
// A space's messages go straight between devices, so a phone with the app
// closed can't hear them. This keeps a tiny list of "this phone wants a nudge
// about these spaces" and, when someone posts, sends an EMPTY nudge through the
// phone maker's own push service. The phone then asks us who/where and shows
// "Sender · Space". Message text never comes here.
const PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/, /(^|\.)fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/
]
const SPACE_RE = /^[A-Za-z0-9_-]{1,80}$/
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

async function keyHash (endpoint) {
  return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))).slice(0, 24)
}

function goodEndpoint (e) {
  try {
    const u = new URL(e)
    return u.protocol === 'https:' && e.length < 1000 && PUSH_HOSTS.some((r) => r.test(u.hostname))
  } catch { return false }
}

export class Push {
  constructor (state) {
    this.state = state
    this.last = new Map()
  }

  async vapid () {
    if (this._v) return this._v
    let v = await this.state.storage.get('vapid')
    if (!v) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
      const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
      v = { jwk, pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) }
      await this.state.storage.put('vapid', v)
    }
    this._v = { pub: v.pub, key: await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) }
    return this._v
  }

  async fetch (request) {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === '/push/key') return json({ key: (await this.vapid()).pub })
    if (request.method !== 'POST') return json({ error: 'post only' }, 405)
    let body
    try { body = JSON.parse(await request.text()) } catch { return json({ error: 'bad json' }, 400) }
    if (path === '/push/subscribe') return this.subscribe(body)
    if (path === '/push/unsubscribe') return this.unsubscribe(body)
    if (path === '/push/notify') return this.notify(body)
    if (path === '/push/pending') return this.pending(body)
    return json({ error: 'not found' }, 404)
  }

  async subscribe (b) {
    const sub = b && b.sub
    if (!sub || !goodEndpoint(sub.endpoint)) return json({ error: 'bad subscription' }, 400)
    const spaces = Array.isArray(b.spaces) ? b.spaces.filter((x) => typeof x === 'string' && SPACE_RE.test(x)).slice(0, 50) : []
    const id = await keyHash(sub.endpoint)
    const count = (await this.state.storage.list({ prefix: 'sub:', limit: 600 })).size
    const exists = await this.state.storage.get('sub:' + id)
    if (!exists && count >= 500) return json({ error: 'full' }, 507)
    await this.state.storage.put('sub:' + id, { endpoint: sub.endpoint, spaces })
    return json({ ok: true })
  }

  async unsubscribe (b) {
    if (!b || typeof b.endpoint !== 'string') return json({ error: 'bad' }, 400)
    const id = await keyHash(b.endpoint)
    await this.state.storage.delete(['sub:' + id, 'n:' + id])
    return json({ ok: true })
  }

  async notify (b) {
    if (!b || typeof b.space !== 'string' || !SPACE_RE.test(b.space)) return json({ error: 'bad' }, 400)
    const name = String(b.name || 'Someone').replace(/[\u0000-\u001f<>]/g, '').slice(0, 40) || 'Someone'
    const now = Date.now()
    const key = b.space
    if (now - (this.last.get(key) || 0) < 2500) return json({ ok: true, skipped: true })
    this.last.set(key, now)
    if (this.last.size > 2000) this.last.clear()
    const selfId = typeof b.self === 'string' ? await keyHash(b.self) : null
    const all = await this.state.storage.list({ prefix: 'sub:' })
    const v = await this.vapid()
    let sent = 0
    for (const [k, s] of all) {
      const id = k.slice(4)
      if (id === selfId || !s.spaces.includes(b.space)) continue
      const notes = (await this.state.storage.get('n:' + id)) || []
      notes.push({ name, space: String(b.label || '').slice(0, 60), t: now })
      await this.state.storage.put('n:' + id, notes.slice(-10))
      const res = await this.send(v, s.endpoint)
      if (res === 'gone') await this.state.storage.delete([k, 'n:' + id])
      else if (res === 'ok') sent++
    }
    return json({ ok: true, sent })
  }

  async send (v, endpoint) {
    try {
      const aud = new URL(endpoint).origin
      const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)))
      const head = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:slake@pantheon.live' })
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, new TextEncoder().encode(head))
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: 'vapid t=' + head + '.' + b64u(sig) + ', k=' + v.pub, ttl: '3600', urgency: 'high' }
      })
      if (res.status === 404 || res.status === 410) return 'gone'
      return res.ok ? 'ok' : 'fail'
    } catch { return 'fail' }
  }

  async pending (b) {
    if (!b || typeof b.endpoint !== 'string') return json({ error: 'bad' }, 400)
    const id = await keyHash(b.endpoint)
    const notes = (await this.state.storage.get('n:' + id)) || []
    if (notes.length) await this.state.storage.delete('n:' + id)
    return json({ notes })
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
