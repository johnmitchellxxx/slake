// The desktop's second language. Browsers can't use the desktop's direct
// connections, so the desktop also speaks theirs: a hidden browser window
// (web/bridge-page.js) makes WebRTC connections through the same public
// relays the web version uses, and this file hands those connections to the
// engine as if they were ordinary ones.
//
// The engine gets one "swarm" that is really two: Hyperswarm for other
// desktops, and the bridge for browsers. Same rooms, same proofs, same records;
// a desktop in a room with web users passes messages between them simply by
// being in it.
const { EventEmitter } = require('events')

// One browser connection, as seen from here.
class BridgeConn extends EventEmitter {
  constructor (bridge, id, handshakeHash, isInitiator) {
    super()
    this._bridge = bridge
    this.id = id
    this.handshakeHash = Buffer.from(handshakeHash, 'hex')
    this.isInitiator = !!isInitiator
    this.closed = false
  }

  write (line) {
    if (!this.closed) this._bridge._post({ t: 'write', id: this.id, data: String(line) })
    return true
  }

  destroy () {
    if (this.closed) return
    this.closed = true
    this._bridge._post({ t: 'close', id: this.id })
    this._bridge.conns.delete(this.id)
    this.emit('close')
  }
}

// Talks to the hidden page over a `channel` ({ post(msg), onMessage(fn) }):
// IPC inside the app, a WebSocket in tests.
class Bridge extends EventEmitter {
  constructor (channel) {
    super()
    this.channel = channel
    this.conns = new Map()
    this.topics = new Set()
    this.ready = false
    this.queue = []
    channel.onMessage((m) => this._onMessage(m))
  }

  _post (m) { if (this.ready) this.channel.post(m); else this.queue.push(m) }

  _onMessage (m) {
    if (!m || typeof m !== 'object') return
    if (m.t === 'ready') {
      // (Re)started: tell it every room we're in, then anything waiting.
      this.ready = true
      for (const c of [...this.conns.values()]) c.destroy()
      for (const topic of this.topics) this.channel.post({ t: 'join', topic })
      for (const q of this.queue.splice(0)) if (q.t !== 'join' && q.t !== 'leave') this.channel.post(q)
      return
    }
    if (m.t === 'conn' && typeof m.id === 'string' && /^[0-9a-f]{64}$/.test(String(m.hh))) {
      const conn = new BridgeConn(this, m.id, m.hh, m.init)
      this.conns.set(m.id, conn)
      this.emit('connection', conn)
      return
    }
    const conn = this.conns.get(m.id)
    if (!conn) return
    if (m.t === 'data' && typeof m.data === 'string') conn.emit('data', Buffer.from(m.data))
    else if (m.t === 'gone') { conn.closed = true; this.conns.delete(m.id); conn.emit('close') }
  }

  join (topic) {
    const hex = Buffer.from(topic).toString('hex')
    if (!this.topics.has(hex)) {
      this.topics.add(hex)
      if (this.ready) this.channel.post({ t: 'join', topic: hex })
    }
  }

  leave (topic) {
    const hex = Buffer.from(topic).toString('hex')
    if (this.topics.delete(hex) && this.ready) this.channel.post({ t: 'leave', topic: hex })
  }

  destroy () {
    for (const c of [...this.conns.values()]) c.destroy()
    if (this.ready) for (const hex of this.topics) this.channel.post({ t: 'leave', topic: hex })
    this.topics.clear()
  }
}

// Hyperswarm + bridge, looking like one Hyperswarm to the engine.
class BothSwarm extends EventEmitter {
  constructor (hyperswarm, bridge) {
    super()
    this.hyper = hyperswarm
    this.bridge = bridge
    this.hyper.on('connection', (c) => this.emit('connection', c))
    this.bridge.on('connection', (c) => this.emit('connection', c))
  }

  join (topic, opts) {
    const d = this.hyper.join(topic, opts)
    this.bridge.join(topic)
    return d
  }

  async leave (topic) {
    this.bridge.leave(topic)
    return this.hyper.leave(topic)
  }

  async destroy () {
    this.bridge.destroy()
    return this.hyper.destroy()
  }
}

module.exports = { Bridge, BothSwarm }
