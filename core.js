// Slake engine: everything that isn't the window.
// No servers. Each copy keeps the whole group history and passes along
// anything new to whoever else is online.

const Hyperswarm = require('hyperswarm')
const hc = require('hypercore-crypto')
const nodeCrypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

const MAX_TEXT = 4000
const MAX_LINE = 4 * 1024 * 1024
const CHANNEL_RE = /^[a-z0-9-]{1,32}$/
const HEX = (n) => new RegExp('^[0-9a-f]{' + n + '}$')

function hmac (key, data) {
  return nodeCrypto.createHmac('sha256', key).update(data).digest()
}

// The exact bytes a message's signature covers.
function signable (m) {
  return Buffer.from(JSON.stringify(['slake/1', m.channel, m.author, m.name, m.text, m.ts]))
}

function messageId (m) {
  return nodeCrypto.createHash('sha256').update(signable(m)).update(m.sig).digest('hex')
}

function validMessage (m) {
  if (!m || typeof m !== 'object') return false
  if (typeof m.channel !== 'string' || !CHANNEL_RE.test(m.channel)) return false
  if (typeof m.author !== 'string' || !HEX(64).test(m.author)) return false
  if (typeof m.sig !== 'string' || !HEX(128).test(m.sig)) return false
  if (typeof m.name !== 'string' || m.name.length < 1 || m.name.length > 40) return false
  if (typeof m.text !== 'string' || m.text.length < 1 || m.text.length > MAX_TEXT) return false
  if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return false
  if (m.id !== messageId(m)) return false
  return hc.verify(signable(m), Buffer.from(m.sig, 'hex'), Buffer.from(m.author, 'hex'))
}

// Invite format: slake:<url-encoded group name>:<64 hex chars of group secret>
function makeInvite (name, secretHex) {
  return 'slake:' + encodeURIComponent(name) + ':' + secretHex
}

function parseInvite (str) {
  const m = /^slake:([^:]*):([0-9a-f]{64})$/.exec(String(str).trim())
  if (!m) return null
  return { name: decodeURIComponent(m[1]) || 'Slake', secret: m[2] }
}

class Slake extends EventEmitter {
  constructor ({ dataDir, makeSwarm } = {}) {
    super()
    this.dataDir = dataDir
    // Lets tests swap in a private network; real use goes to the public one.
    this.makeSwarm = makeSwarm || (() => new Hyperswarm())
    this.identity = null
    this.group = null
    this.messages = new Map()
    this.peers = new Set()
    this.swarm = null
    fs.mkdirSync(dataDir, { recursive: true })
  }

  _file (name) { return path.join(this.dataDir, name) }

  _readJSON (name) {
    try { return JSON.parse(fs.readFileSync(this._file(name), 'utf8')) } catch { return null }
  }

  _writeJSON (name, obj, mode) {
    fs.writeFileSync(this._file(name), JSON.stringify(obj, null, 2), { mode })
  }

  async start () {
    this.identity = this._readJSON('identity.json')
    if (!this.identity) {
      const kp = hc.keyPair()
      this.identity = {
        publicKey: kp.publicKey.toString('hex'),
        secretKey: kp.secretKey.toString('hex'),
        name: null
      }
      this._writeJSON('identity.json', this.identity, 0o600)
    }
    this.group = this._readJSON('group.json')
    this._loadMessages()
    if (this.group) await this._join()
  }

  _loadMessages () {
    let raw = ''
    try { raw = fs.readFileSync(this._file('messages.ndjson'), 'utf8') } catch { return }
    for (const line of raw.split('\n')) {
      if (!line) continue
      try {
        const m = JSON.parse(line)
        if (validMessage(m)) this.messages.set(m.id, m)
      } catch {}
    }
  }

  get me () {
    return { publicKey: this.identity.publicKey, name: this.identity.name }
  }

  setName (name) {
    name = String(name || '').trim().slice(0, 40)
    if (!name) throw new Error('Name required')
    this.identity.name = name
    this._writeJSON('identity.json', this.identity, 0o600)
  }

  async createGroup (name) {
    if (this.group) throw new Error('Already in a group')
    const secret = hc.randomBytes(32).toString('hex')
    this.group = { name: String(name || 'Slake').trim().slice(0, 40) || 'Slake', secret }
    this._writeJSON('group.json', this.group, 0o600)
    await this._join()
  }

  async joinGroup (invite) {
    if (this.group) throw new Error('Already in a group')
    const parsed = parseInvite(invite)
    if (!parsed) throw new Error("That doesn't look like a Slake invite")
    this.group = parsed
    this._writeJSON('group.json', this.group, 0o600)
    await this._join()
  }

  get invite () {
    return this.group ? makeInvite(this.group.name, this.group.secret) : null
  }

  async _join () {
    this._secret = Buffer.from(this.group.secret, 'hex')
    // The public "phone book" only ever sees a scrambled fingerprint of the secret.
    this.topic = hc.discoveryKey(this._secret)
    this.swarm = this.makeSwarm()
    this.swarm.on('connection', (conn) => this._onConnection(conn))
    const discovery = this.swarm.join(this.topic, { server: true, client: true })
    await discovery.flushed()
  }

  // Each side proves it knows the group secret without ever sending it.
  // The proof is tied to this one connection and to which side we are,
  // so it can't be replayed or bounced back.
  _proof (conn, initiator) {
    return hmac(this._secret, Buffer.concat([conn.handshakeHash, Buffer.from(initiator ? 'I' : 'R')]))
  }

  _onConnection (conn) {
    const peer = { conn, authed: false, buf: '', key: conn.remotePublicKey.toString('hex') }
    conn.on('error', () => {})
    conn.on('close', () => {
      if (this.peers.delete(peer)) this.emit('peers', this.peers.size)
    })
    conn.on('data', (d) => {
      peer.buf += d.toString('utf8')
      if (peer.buf.length > MAX_LINE) return conn.destroy()
      let i
      while ((i = peer.buf.indexOf('\n')) >= 0) {
        const line = peer.buf.slice(0, i)
        peer.buf = peer.buf.slice(i + 1)
        this._onLine(peer, line)
      }
    })
    this._send(peer, { type: 'hello', proof: this._proof(conn, conn.isInitiator).toString('hex') })
    // Anyone who can't prove membership quickly gets dropped.
    peer.timer = setTimeout(() => { if (!peer.authed) conn.destroy() }, 10000)
  }

  _send (peer, obj) {
    try { peer.conn.write(JSON.stringify(obj) + '\n') } catch {}
  }

  _onLine (peer, line) {
    let msg
    try { msg = JSON.parse(line) } catch { return peer.conn.destroy() }

    if (!peer.authed) {
      const expected = this._proof(peer.conn, !peer.conn.isInitiator)
      const got = Buffer.from(String(msg.proof || ''), 'hex')
      if (msg.type !== 'hello' || got.length !== expected.length || !nodeCrypto.timingSafeEqual(got, expected)) {
        this.emit('rejected', peer.key)
        return peer.conn.destroy()
      }
      peer.authed = true
      clearTimeout(peer.timer)
      this.peers.add(peer)
      this.emit('peers', this.peers.size)
      this._send(peer, { type: 'have', ids: [...this.messages.keys()] })
      return
    }

    if (msg.type === 'have' && Array.isArray(msg.ids)) {
      const theirs = new Set(msg.ids)
      const missing = [...this.messages.values()].filter((m) => !theirs.has(m.id))
      if (missing.length) this._send(peer, { type: 'msgs', msgs: missing })
    } else if (msg.type === 'msgs' && Array.isArray(msg.msgs)) {
      const fresh = []
      for (const m of msg.msgs) if (this._add(m)) fresh.push(m)
      if (fresh.length) this._broadcast(fresh, peer)
    }
  }

  _add (m) {
    if (!m || this.messages.has(m.id) || !validMessage(m)) return false
    const clean = { id: m.id, channel: m.channel, author: m.author, name: m.name, text: m.text, ts: m.ts, sig: m.sig }
    this.messages.set(clean.id, clean)
    fs.appendFileSync(this._file('messages.ndjson'), JSON.stringify(clean) + '\n')
    this.emit('message', clean)
    return true
  }

  // Pass news along to everyone except whoever told us.
  _broadcast (msgs, except) {
    for (const p of this.peers) if (p !== except) this._send(p, { type: 'msgs', msgs })
  }

  post (channel, text) {
    if (!this.group) throw new Error('Not in a group')
    if (!this.identity.name) throw new Error('Set a name first')
    channel = String(channel || 'general').toLowerCase()
    text = String(text || '').trim()
    if (!CHANNEL_RE.test(channel)) throw new Error('Bad channel name')
    if (!text || text.length > MAX_TEXT) throw new Error('Message empty or too long')
    const m = { channel, author: this.identity.publicKey, name: this.identity.name, text, ts: Date.now() }
    m.sig = hc.sign(signable(m), Buffer.from(this.identity.secretKey, 'hex')).toString('hex')
    m.id = messageId(m)
    this._add(m)
    this._broadcast([m], null)
    return m
  }

  get peerCount () { return this.peers.size }

  async stop () {
    if (this.swarm) await this.swarm.destroy()
  }
}

module.exports = { Slake, parseInvite, makeInvite, validMessage }
