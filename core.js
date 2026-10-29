// Slake engine: everything that isn't the window.
//
// The shape of it:
//   - Every person has a space. Rooms live in their owner's space.
//   - Each room has its own secret key. Holding the key = being in the room.
//   - Only the owner hands out invites (an invite carries the key) and only
//     the owner can remove someone. Removing someone means the owner makes a
//     fresh key and seals a copy to each remaining member; the removed person
//     can't open it, so they can't follow the room anymore.
//   - No servers. Each copy keeps the history of its rooms and passes new
//     things along to whoever else in that room is online.

const Hyperswarm = require('hyperswarm')
const hc = require('hypercore-crypto')
const sodium = require('sodium-universal')
const nodeCrypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

const MAX_TEXT = 4000
const MAX_LINE = 8 * 1024 * 1024
const MAX_MEMBERS = 256
const KINDS = new Set(['room', 'join', 'msg', 'rekey'])
const hexRe = (n) => new RegExp('^[0-9a-f]{' + n + '}$')
const KEY_RE = hexRe(64)
const ID_RE = hexRe(32)
const SIG_RE = hexRe(128)

const hmac = (key, data) => nodeCrypto.createHmac('sha256', key).update(data).digest()
const isInt = (n) => Number.isInteger(n) && n >= 0 && n < 1e6

// ---------- Records (everything that happens in a room is a signed record) ----------

function signable (r) {
  return Buffer.from(JSON.stringify(['slake/2', r.room, r.kind, r.author, r.name, r.ts, r.epoch, r.body]))
}

function recordId (r) {
  return nodeCrypto.createHash('sha256').update(signable(r)).update(r.sig).digest('hex')
}

function validBody (kind, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false
  if (kind === 'room') return typeof b.title === 'string' && b.title.length >= 1 && b.title.length <= 40
  if (kind === 'join') return Object.keys(b).length === 0
  if (kind === 'msg') return typeof b.text === 'string' && b.text.length >= 1 && b.text.length <= MAX_TEXT
  if (kind === 'rekey') {
    return isInt(b.to) &&
      Array.isArray(b.members) && b.members.length <= MAX_MEMBERS && b.members.every((k) => KEY_RE.test(k)) &&
      Array.isArray(b.boxes) && b.boxes.length <= MAX_MEMBERS &&
      b.boxes.every((x) => Array.isArray(x) && x.length === 2 && KEY_RE.test(x[0]) && typeof x[1] === 'string' && /^[0-9a-f]{1,256}$/.test(x[1]))
  }
  return false
}

function wellFormed (r) {
  if (!r || typeof r !== 'object') return false
  if (typeof r.room !== 'string' || !ID_RE.test(r.room)) return false
  if (!KINDS.has(r.kind)) return false
  if (typeof r.author !== 'string' || !KEY_RE.test(r.author)) return false
  if (typeof r.sig !== 'string' || !SIG_RE.test(r.sig)) return false
  if (typeof r.name !== 'string' || r.name.length < 1 || r.name.length > 40) return false
  if (typeof r.ts !== 'number' || !Number.isFinite(r.ts)) return false
  if (!isInt(r.epoch)) return false
  if (!validBody(r.kind, r.body)) return false
  if (r.id !== recordId(r)) return false
  return hc.verify(signable(r), Buffer.from(r.sig, 'hex'), Buffer.from(r.author, 'hex'))
}

function clean (r) {
  return { id: r.id, room: r.room, kind: r.kind, author: r.author, name: r.name, ts: r.ts, epoch: r.epoch, body: r.body, sig: r.sig }
}

// ---------- Sealing a room key so only one person can open it ----------

function curveKeys (identity) {
  const pk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  const sk = Buffer.alloc(sodium.crypto_box_SECRETKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(pk, Buffer.from(identity.publicKey, 'hex'))
  sodium.crypto_sign_ed25519_sk_to_curve25519(sk, Buffer.from(identity.secretKey, 'hex'))
  return { pk, sk }
}

function sealTo (memberHex, roomKey) {
  const pk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(pk, Buffer.from(memberHex, 'hex'))
  const out = Buffer.alloc(roomKey.length + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(out, roomKey, pk)
  return out.toString('hex')
}

function openSealed (boxHex, curve) {
  const box = Buffer.from(boxHex, 'hex')
  if (box.length !== 32 + sodium.crypto_box_SEALBYTES) return null
  const out = Buffer.alloc(32)
  return sodium.crypto_box_seal_open(out, box, curve.pk, curve.sk) ? out : null
}

// ---------- Invites ----------
// slake:<base64url of {v, r: room id, t: title, o: owner key, n: owner name, e: epoch, k: room key}>

function makeInvite (room) {
  const e = room.epoch
  const payload = { v: 2, r: room.id, t: room.title, o: room.owner, n: room.ownerName, e, k: room.keys[e] }
  return 'slake:' + Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function parseInvite (str) {
  const m = /^slake:([A-Za-z0-9_-]+)$/.exec(String(str || '').trim())
  if (!m) return null
  try {
    const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    if (p.v !== 2 || !ID_RE.test(p.r) || !KEY_RE.test(p.o) || !KEY_RE.test(p.k) || !isInt(p.e)) return null
    const title = String(p.t || 'room').slice(0, 40) || 'room'
    const ownerName = String(p.n || 'Someone').slice(0, 40) || 'Someone'
    return { id: p.r, title, owner: p.o, ownerName, epoch: p.e, key: p.k }
  } catch { return null }
}

// ---------- The engine ----------

class Slake extends EventEmitter {
  constructor ({ dataDir, makeSwarm } = {}) {
    super()
    this.dataDir = dataDir
    this.roomsDir = path.join(dataDir, 'rooms')
    this.makeSwarm = makeSwarm || (() => new Hyperswarm())
    this.identity = null
    this.rooms = new Map()       // room id -> room
    this.keyIndex = new Map()    // label -> { roomId, epoch, key }
    this.topics = new Map()      // topic hex -> roomId
    this.peers = new Set()
    this.swarm = null
    fs.mkdirSync(this.roomsDir, { recursive: true })
  }

  _file (...p) { return path.join(this.dataDir, ...p) }
  _readJSON (f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
  _writeJSON (f, obj, mode) { fs.writeFileSync(f, JSON.stringify(obj, null, 2), { mode }) }

  async start () {
    this.identity = this._readJSON(this._file('identity.json'))
    if (!this.identity) {
      const kp = hc.keyPair()
      this.identity = { publicKey: kp.publicKey.toString('hex'), secretKey: kp.secretKey.toString('hex'), name: null }
      this._writeJSON(this._file('identity.json'), this.identity, 0o600)
    }
    this.curve = curveKeys(this.identity)

    // Set aside anything from the old one-group version.
    for (const f of ['group.json', 'messages.ndjson']) {
      if (fs.existsSync(this._file(f))) fs.renameSync(this._file(f), this._file('legacy-v1-' + f))
    }

    for (const f of fs.readdirSync(this.roomsDir)) {
      if (!f.endsWith('.json')) continue
      const meta = this._readJSON(path.join(this.roomsDir, f))
      if (meta && ID_RE.test(meta.id)) this._loadRoom(meta)
    }

    this.swarm = this.makeSwarm()
    this.swarm.on('connection', (conn) => this._onConnection(conn))
    await Promise.all([...this.rooms.values()].map((room) => this._joinTopics(room)))
  }

  async stop () { if (this.swarm) await this.swarm.destroy() }

  get me () { return { publicKey: this.identity.publicKey, name: this.identity.name } }

  setName (name) {
    name = String(name || '').trim().slice(0, 40)
    if (!name) throw new Error('Name required')
    this.identity.name = name
    this._writeJSON(this._file('identity.json'), this.identity, 0o600)
  }

  // ----- room bookkeeping -----

  _loadRoom (meta) {
    const room = {
      id: meta.id,
      title: meta.title,
      owner: meta.owner,
      ownerName: meta.ownerName,
      keys: meta.keys || {},
      removed: !!meta.removed,
      records: new Map()
    }
    room.epoch = Math.max(...Object.keys(room.keys).map(Number))
    try {
      const raw = fs.readFileSync(path.join(this.roomsDir, room.id + '.ndjson'), 'utf8')
      for (const line of raw.split('\n')) {
        if (!line) continue
        try { const r = JSON.parse(line); if (wellFormed(r) && r.room === room.id) room.records.set(r.id, r) } catch {}
      }
    } catch {}
    this.rooms.set(room.id, room)
    this._indexKeys(room)
    return room
  }

  _saveRoom (room) {
    const { id, title, owner, ownerName, keys, removed } = room
    this._writeJSON(path.join(this.roomsDir, id + '.json'), { id, title, owner, ownerName, keys, removed }, 0o600)
  }

  _indexKeys (room) {
    for (const [e, hex] of Object.entries(room.keys)) {
      const key = Buffer.from(hex, 'hex')
      this.keyIndex.set(hmac(key, 'slake-label').toString('hex'), { roomId: room.id, epoch: Number(e), key })
    }
  }

  _unindexKeys (room) {
    for (const [label, v] of this.keyIndex) if (v.roomId === room.id) this.keyIndex.delete(label)
  }

  // Announce ourselves in the phone book for each key this room has had.
  // Resolves once the announcements are out.
  async _joinTopics (room) {
    if (!this.swarm || room.removed) return
    const pending = []
    for (const hex of Object.values(room.keys)) {
      const topic = hc.discoveryKey(Buffer.from(hex, 'hex'))
      const t = topic.toString('hex')
      if (this.topics.has(t)) continue
      this.topics.set(t, room.id)
      pending.push(this.swarm.join(topic, { server: true, client: true }).flushed())
    }
    await Promise.all(pending)
  }

  async _leaveTopics (room) {
    if (!this.swarm) return
    for (const [t, id] of this.topics) {
      if (id !== room.id) continue
      this.topics.delete(t)
      await this.swarm.leave(Buffer.from(t, 'hex'))
    }
  }

  _room (id) {
    const room = this.rooms.get(id)
    if (!room) throw new Error('No such room')
    return room
  }

  _rekeys (room) {
    return [...room.records.values()].filter((r) => r.kind === 'rekey').sort((a, b) => a.body.to - b.body.to)
  }

  _rekeyTo (room, to) {
    return this._rekeys(room).find((r) => r.body.to === to)
  }

  // Who is in the room right now: the owner, everyone the latest re-key
  // kept, and anyone who joined (or spoke) since.
  members (roomId) {
    const room = this._room(roomId)
    const e = room.epoch
    const names = new Map()
    for (const r of [...room.records.values()].sort((a, b) => a.ts - b.ts)) {
      if (r.kind === 'join' || r.kind === 'msg' || r.kind === 'room') names.set(r.author, r.name)
    }
    const set = new Set([room.owner])
    const rk = this._rekeyTo(room, e)
    if (rk) for (const k of rk.body.members) set.add(k)
    for (const r of room.records.values()) {
      if ((r.kind === 'join' || r.kind === 'msg') && r.epoch === e) set.add(r.author)
    }
    return [...set].map((key) => ({
      key,
      name: key === room.owner ? (names.get(key) || room.ownerName) : (names.get(key) || 'Someone'),
      owner: key === room.owner,
      you: key === this.identity.publicKey
    }))
  }

  // ----- actions -----

  _needName () { if (!this.identity.name) throw new Error('Set a name first') }

  _sign (room, kind, epoch, body) {
    const r = { room: room.id, kind, author: this.identity.publicKey, name: this.identity.name, ts: Date.now(), epoch, body }
    r.sig = hc.sign(signable(r), Buffer.from(this.identity.secretKey, 'hex')).toString('hex')
    r.id = recordId(r)
    return r
  }

  _publish (room, r) {
    this._accept(room, r, Infinity)
    this._broadcast(room, [r], null)
  }

  async createRoom (title, { waitForNetwork = true } = {}) {
    this._needName()
    title = String(title || '').trim().slice(0, 40)
    if (!title) throw new Error('Give the room a name')
    const id = hc.randomBytes(16).toString('hex')
    const room = { id, title, owner: this.identity.publicKey, ownerName: this.identity.name, keys: { 0: hc.randomBytes(32).toString('hex') }, epoch: 0, removed: false, records: new Map() }
    this.rooms.set(id, room)
    this._saveRoom(room)
    this._indexKeys(room)
    this._publish(room, this._sign(room, 'room', 0, { title }))
    const joining = this._joinTopics(room)
    this._announce()
    this.emit('rooms')
    if (waitForNetwork) await joining
    else joining.catch(() => {})
    return id
  }

  async joinRoom (invite, { waitForNetwork = true } = {}) {
    this._needName()
    const inv = parseInvite(invite)
    if (!inv) throw new Error("That doesn't look like a Slake invite")
    if (inv.owner === this.identity.publicKey) throw new Error("That's one of your own rooms")
    let room = this.rooms.get(inv.id)
    if (room && !room.removed && room.epoch >= inv.epoch) throw new Error("You're already in that room")
    if (!room) {
      room = { id: inv.id, title: inv.title, owner: inv.owner, ownerName: inv.ownerName, keys: {}, epoch: inv.epoch, removed: false, records: new Map() }
      this.rooms.set(room.id, room)
    }
    room.keys[inv.epoch] = inv.key
    room.epoch = Math.max(room.epoch, inv.epoch)
    room.removed = false
    this._saveRoom(room)
    this._indexKeys(room)
    this._publish(room, this._sign(room, 'join', inv.epoch, {}))
    const joining = this._joinTopics(room)
    this._announce()
    this.emit('rooms')
    if (waitForNetwork) await joining
    else joining.catch(() => {})
    return room.id
  }

  invite (roomId) {
    const room = this._room(roomId)
    if (room.owner !== this.identity.publicKey) throw new Error('Only the owner can invite people')
    return makeInvite(room)
  }

  post (roomId, text) {
    this._needName()
    const room = this._room(roomId)
    if (room.removed) throw new Error("You're no longer in this room")
    text = String(text || '').trim()
    if (!text || text.length > MAX_TEXT) throw new Error('Message empty or too long')
    const r = this._sign(room, 'msg', room.epoch, { text })
    this._publish(room, r)
    return r
  }

  async removeMember (roomId, memberKey) {
    const room = this._room(roomId)
    if (room.owner !== this.identity.publicKey) throw new Error('Only the owner can remove people')
    if (memberKey === room.owner) throw new Error("You can't remove yourself from your own room")
    const keep = this.members(roomId).map((m) => m.key).filter((k) => k !== memberKey)
    if (keep.length === this.members(roomId).length) throw new Error("That person isn't in this room")
    const to = room.epoch + 1
    const fresh = hc.randomBytes(32)
    const boxes = keep.filter((k) => k !== room.owner).map((k) => [k, sealTo(k, fresh)])
    const r = this._sign(room, 'rekey', room.epoch, { to, members: keep, boxes })
    room.keys[to] = fresh.toString('hex')
    room.epoch = to
    this._saveRoom(room)
    this._indexKeys(room)
    this._publish(room, r)
    await this._joinTopics(room)
    this._announce()
    this.emit('rooms')
  }

  // Take a room off your sidebar. History is renamed aside, not deleted.
  async leaveRoom (roomId) {
    const room = this._room(roomId)
    if (room.owner === this.identity.publicKey) throw new Error("You own this room, so it stays in your space")
    await this._leaveTopics(room)
    this._unindexKeys(room)
    this.rooms.delete(roomId)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    for (const ext of ['.json', '.ndjson']) {
      const f = path.join(this.roomsDir, roomId + ext)
      if (fs.existsSync(f)) fs.renameSync(f, path.join(this.roomsDir, `left-${stamp}-${roomId}${ext}.bak`))
    }
    this.emit('rooms')
  }

  // ----- accepting records -----

  // `peerEpoch` is the newest key the sender proved they hold for this room;
  // they can't hand us anything newer than that (re-keys excepted, which only
  // the owner can sign).
  _accept (room, r, peerEpoch) {
    if (!r || room.records.has(r.id)) return false
    if (!wellFormed(r) || r.room !== room.id) return false
    if (r.kind === 'room' && (r.author !== room.owner || r.epoch !== 0)) return false
    if (r.kind === 'rekey') {
      if (r.author !== room.owner || r.body.to !== r.epoch + 1) return false
      if (this._rekeyTo(room, r.body.to)) return false
    } else {
      if (r.epoch > peerEpoch) return false
      // A removed person still holding an old key can't slip in new posts.
      const next = this._rekeyTo(room, r.epoch + 1)
      if (next && r.ts > next.ts && !next.body.members.includes(r.author)) return false
    }

    const rec = clean(r)
    room.records.set(rec.id, rec)
    fs.appendFileSync(path.join(this.roomsDir, room.id + '.ndjson'), JSON.stringify(rec) + '\n')

    if (rec.kind === 'room' && (room.title !== rec.body.title || room.ownerName !== rec.name)) {
      room.title = rec.body.title
      room.ownerName = rec.name
      this._saveRoom(room)
      this.emit('rooms')
    }
    if (rec.kind === 'rekey') this._onRekey(room, rec)
    this.emit('record', room.id, rec)
    return true
  }

  _onRekey (room, r) {
    if (room.owner === this.identity.publicKey) return
    if (room.keys[r.body.to]) return
    const mine = r.body.boxes.find(([k]) => k === this.identity.publicKey)
    const key = mine && openSealed(mine[1], this.curve)
    if (key) {
      room.keys[r.body.to] = key.toString('hex')
      room.epoch = Math.max(room.epoch, r.body.to)
      room.removed = false
      this._saveRoom(room)
      this._indexKeys(room)
      this._joinTopics(room).catch(() => {})
      this._announce()
      this.emit('rooms')
    } else if (r.body.to > room.epoch && !room.removed) {
      room.removed = true
      this._saveRoom(room)
      this._leaveTopics(room).catch(() => {})
      this.emit('rooms')
    }
  }

  // ----- talking to other computers -----

  _proof (conn, key, initiator) {
    return hmac(key, Buffer.concat([conn.handshakeHash, Buffer.from(initiator ? 'I' : 'R')]))
  }

  // Prove which room keys we hold, without revealing them (or even which
  // rooms they are) to anyone who doesn't hold the same key.
  _hello (peer) {
    const entries = []
    for (const [label, v] of this.keyIndex) {
      const room = this.rooms.get(v.roomId)
      if (!room || room.removed) continue
      entries.push({ l: label, p: this._proof(peer.conn, v.key, peer.conn.isInitiator).toString('hex') })
    }
    this._send(peer, { type: 'hello', entries })
  }

  _announce () { for (const p of this.peers) this._hello(p) }

  _onConnection (conn) {
    const peer = { conn, buf: '', proven: new Map() }
    this.peers.add(peer)
    conn.on('error', () => {})
    conn.on('close', () => { this.peers.delete(peer); clearTimeout(peer.timer); this.emit('rooms') })
    conn.on('data', (d) => {
      peer.buf += d.toString('utf8')
      if (peer.buf.length > MAX_LINE) return conn.destroy()
      let i
      while ((i = peer.buf.indexOf('\n')) >= 0) {
        const line = peer.buf.slice(0, i)
        peer.buf = peer.buf.slice(i + 1)
        try { this._onMessage(peer, JSON.parse(line)) } catch { return conn.destroy() }
      }
    })
    this._hello(peer)
    // Strangers who can't prove they share any room get dropped.
    peer.timer = setTimeout(() => { if (peer.proven.size === 0) { this.emit('rejected'); conn.destroy() } }, 15000)
  }

  _send (peer, obj) { try { peer.conn.write(JSON.stringify(obj) + '\n') } catch {} }

  _sendable (room, peerEpoch) {
    return [...room.records.values()].filter((r) => r.kind === 'rekey' || r.epoch <= peerEpoch)
  }

  _onMessage (peer, msg) {
    if (msg.type === 'hello' && Array.isArray(msg.entries)) {
      const changed = new Set()
      for (const ent of msg.entries.slice(0, 4096)) {
        const v = this.keyIndex.get(String(ent && ent.l))
        if (!v) continue
        const expected = this._proof(peer.conn, v.key, !peer.conn.isInitiator)
        const got = Buffer.from(String(ent.p || ''), 'hex')
        if (got.length !== expected.length || !nodeCrypto.timingSafeEqual(got, expected)) continue
        const prev = peer.proven.has(v.roomId) ? peer.proven.get(v.roomId) : -1
        if (v.epoch > prev) { peer.proven.set(v.roomId, v.epoch); changed.add(v.roomId) }
      }
      if (changed.size) {
        // They just proved a new room to us: prove ours back (they may have
        // joined after our last hello), then offer what we have.
        this._hello(peer)
        for (const roomId of changed) {
          const room = this.rooms.get(roomId)
          if (room) this._send(peer, { type: 'have', room: roomId, ids: [...room.records.keys()] })
        }
        this.emit('rooms')
      }
      return
    }

    const room = this.rooms.get(msg.room)
    if (!room || !peer.proven.has(room.id)) return
    const peerEpoch = peer.proven.get(room.id)

    if (msg.type === 'have' && Array.isArray(msg.ids)) {
      const theirs = new Set(msg.ids)
      const missing = this._sendable(room, peerEpoch).filter((r) => !theirs.has(r.id))
      if (missing.length) this._send(peer, { type: 'recs', room: room.id, recs: missing })
    } else if (msg.type === 'recs' && Array.isArray(msg.recs)) {
      const fresh = []
      const sorted = msg.recs.slice().sort((a, b) => (a && b ? a.ts - b.ts : 0))
      for (const r of sorted) if (this._accept(room, r, peerEpoch)) fresh.push(room.records.get(r.id))
      if (fresh.length) this._broadcast(room, fresh, peer)
    }
  }

  // Pass news along to everyone in that room, except whoever told us.
  _broadcast (room, recs, except) {
    for (const p of this.peers) {
      if (p === except || !p.proven.has(room.id)) continue
      const e = p.proven.get(room.id)
      const ok = recs.filter((r) => r.kind === 'rekey' || r.epoch <= e)
      if (ok.length) this._send(p, { type: 'recs', room: room.id, recs: ok })
    }
  }

  online (roomId) {
    const room = this.rooms.get(roomId)
    if (!room || room.removed) return 0
    let n = 0
    for (const p of this.peers) if (p.proven.has(roomId) && p.proven.get(roomId) >= room.epoch) n++
    return n
  }
}

module.exports = { Slake, parseInvite, makeInvite, wellFormed }
