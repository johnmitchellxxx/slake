// Browser connections for Slake, shaped like Hyperswarm so the engine
// doesn't notice the difference.
//
// Browsers can't use the desktop's direct connections, so they use WebRTC
// (what video calls run on). To find each other they meet in public "Nostr"
// relays, which only pass along introductions, encrypted with the room's
// meeting point. After that, everything goes straight between the two
// browsers, encrypted.
//
// Every connection gets a fingerprint both ends agree on (from the two
// browsers' WebRTC certificates). The engine's proofs are tied to it, so a
// relay that tried to sit in the middle would fail every proof.
const { EventEmitter } = require('events')
const { Buffer } = require('buffer')
const { sha256 } = require('@noble/hashes/sha2')
const { joinRoom, selfId } = require('trystero/nostr')

const APP_ID = 'slake-v1'

function fingerprint (sdp) {
  const m = /a=fingerprint:(\S+) (\S+)/i.exec(sdp || '')
  return m ? (m[1] + ' ' + m[2]).toLowerCase() : null
}

class WebConn extends EventEmitter {
  constructor (send, peerId, pc) {
    super()
    this._send = send
    this.peerId = peerId
    this.isInitiator = selfId < peerId
    const a = fingerprint(pc && pc.localDescription && pc.localDescription.sdp)
    const b = fingerprint(pc && pc.remoteDescription && pc.remoteDescription.sdp)
    // No certificates to tie to: give each side a different value so every
    // proof fails rather than trusting an unknown connection.
    const basis = a && b ? [a, b].sort().join('\n') : 'unverified ' + Math.random()
    this.handshakeHash = Buffer.from(sha256(Buffer.from('slake-webrtc-v1\n' + basis)))
    this.closed = false
  }

  write (line) {
    if (this.closed) return true
    this._send(String(line), this.peerId).catch(() => {})
    return true
  }

  _data (str) { if (!this.closed) this.emit('data', Buffer.from(String(str))) }

  destroy () {
    if (this.closed) return
    this.closed = true
    this.emit('close')
  }
}

class WebSwarm extends EventEmitter {
  constructor ({ relayUrls } = {}) {
    super()
    this.relayUrls = relayUrls
    this.rooms = new Map()   // topic hex -> { room, conns: Map(peerId -> conn) }
  }

  join (topic) {
    const hex = Buffer.from(topic).toString('hex')
    if (!this.rooms.has(hex)) {
      const config = { appId: APP_ID, password: hex }
      if (this.relayUrls) config.relayUrls = this.relayUrls
      const room = joinRoom(config, hex)
      const [send, get] = room.makeAction('line')
      const entry = { room, conns: new Map(), early: new Map() }
      this.rooms.set(hex, entry)
      room.onPeerJoin((peerId) => {
        if (globalThis.SLAKE_DEBUG) console.log('slake: peer joined', hex.slice(0, 8), peerId)
        const old = entry.conns.get(peerId)
        if (old) old.destroy()
        const conn = new WebConn(send, peerId, room.getPeers()[peerId])
        if (globalThis.SLAKE_DEBUG) { const pc = room.getPeers()[peerId]; console.log('slake: conn', !!pc, !!(pc && pc.localDescription), !!(pc && pc.remoteDescription), conn.handshakeHash.toString('hex').slice(0, 12), conn.isInitiator) }
        entry.conns.set(peerId, conn)
        conn.on('close', () => { if (entry.conns.get(peerId) === conn) entry.conns.delete(peerId) })
        this.emit('connection', conn)
        // Anything they said before we noticed them, in order.
        const queued = entry.early.get(peerId)
        entry.early.delete(peerId)
        if (queued) for (const d of queued) conn._data(d)
      })
      room.onPeerLeave((peerId) => {
        entry.early.delete(peerId)
        const c = entry.conns.get(peerId)
        if (c) c.destroy()
      })
      get((data, peerId) => {
        const c = entry.conns.get(peerId)
        if (c) { c._data(data); return }
        // They're already talking but we haven't seen them join yet: hold it.
        const q = entry.early.get(peerId) || []
        if (q.length < 1000) q.push(data)
        entry.early.set(peerId, q)
      })
    }
    return { flushed: async () => {}, destroy: () => this.leave(topic) }
  }

  async leave (topic) {
    const hex = Buffer.from(topic).toString('hex')
    const entry = this.rooms.get(hex)
    if (!entry) return
    this.rooms.delete(hex)
    for (const c of entry.conns.values()) c.destroy()
    try { await entry.room.leave() } catch {}
  }

  async destroy () {
    for (const hex of [...this.rooms.keys()]) await this.leave(Buffer.from(hex, 'hex'))
  }
}

module.exports = { WebSwarm, selfId }
