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
const KINDS = new Set(['room', 'join', 'msg', 'rekey', 'file', 'profile'])
const MAX_AVATAR = 60000  // a small photo, as text

// Files are fleeting: they always vanish after one of these.
const HOUR = 3600 * 1000
const TTLS = new Set([HOUR, 24 * HOUR, 7 * 24 * HOUR])
const AUTO_FETCH = 50 * 1024 * 1024       // files up to this size download by themselves
const CHUNK = 192 * 1024
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

// An avatar is nothing (use the default), one emoji, or a small photo.
function validAvatar (a) {
  if (a === null) return true
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false
  const keys = Object.keys(a)
  if (keys.length !== 1) return false
  if (keys[0] === 'emoji') return typeof a.emoji === 'string' && a.emoji.length >= 1 && a.emoji.length <= 16 && !/[<>]/.test(a.emoji)
  if (keys[0] === 'image') return typeof a.image === 'string' && a.image.length <= MAX_AVATAR && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a.image)
  return false
}

function validBody (kind, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return false
  if (kind === 'room') return typeof b.title === 'string' && b.title.length >= 1 && b.title.length <= 40
  if (kind === 'join') return Object.keys(b).length === 0
  if (kind === 'msg') return typeof b.text === 'string' && b.text.length >= 1 && b.text.length <= MAX_TEXT
  if (kind === 'profile') return validAvatar(b.avatar)
  if (kind === 'file') {
    return typeof b.fid === 'string' && KEY_RE.test(b.fid) &&
      typeof b.fname === 'string' && b.fname.length >= 1 && b.fname.length <= 200 && !/[\\/\0]/.test(b.fname) &&
      Number.isSafeInteger(b.size) && b.size >= 0 &&
      Number.isSafeInteger(b.ttl) && TTLS.has(b.ttl)
  }
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

// ---------- Short codes ----------
// A 5-character code is too short to carry a room key, so it works as a knock:
// the owner's Slake listens at a meeting point made from the code, a friend
// proves they know the code, and the owner's Slake hands over the real
// invite, sealed so only that friend can open it. Codes last 15 minutes.
//
// The meeting point is made with a deliberately slow hash, so someone who
// spots it in the public phone book can't quickly work backwards to the code.
// (Fine for a small group; strengthen when Slake grows.)
const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTVWXYZ'   // no 0/O, 1/I/L or U
const CODE_LEN = 5
const CODE_TTL = 15 * 60 * 1000
const CODE_SALT = Buffer.from('slake-knock-v1!!')     // 16 bytes

function normalizeCode (str) {
  const c = String(str || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (c.length !== CODE_LEN || ![...c].every((ch) => CODE_CHARS.includes(ch))) return null
  return c
}

function newCode () {
  const bytes = hc.randomBytes(CODE_LEN)
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('')
}

function codeSeed (code) {
  const out = Buffer.alloc(32)
  sodium.crypto_pwhash(out, Buffer.from(code), CODE_SALT, 3, sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE, sodium.crypto_pwhash_ALG_ARGON2ID13)
  return out
}

function sealBytes (memberHex, bytes) {
  const pk = Buffer.alloc(sodium.crypto_box_PUBLICKEYBYTES)
  sodium.crypto_sign_ed25519_pk_to_curve25519(pk, Buffer.from(memberHex, 'hex'))
  const out = Buffer.alloc(bytes.length + sodium.crypto_box_SEALBYTES)
  sodium.crypto_box_seal(out, bytes, pk)
  return out
}

function openBytes (box, curve) {
  if (box.length <= sodium.crypto_box_SEALBYTES) return null
  const out = Buffer.alloc(box.length - sodium.crypto_box_SEALBYTES)
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
    this.filesDir = path.join(dataDir, 'files')
    this.transfers = new Map()   // fid -> { room, rec, bytes, peer, tried, timer }
    this.wanted = new Set()      // big files someone clicked Download on
    this.now = () => Date.now()  // tests can fast-forward the clock
    this.codes = new Map()       // label -> { code, roomId, seed, topic, expires }  (codes I handed out)
    this.knocks = new Map()      // label -> { seed, topic, resolve, reject, timer }  (codes I'm using)
    this.swarm = null
    fs.mkdirSync(this.roomsDir, { recursive: true })
    fs.mkdirSync(this.filesDir, { recursive: true })
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
    this.purgeExpired()
    this._purgeTimer = setInterval(() => this.purgeExpired(), 30 * 1000)
    if (this._purgeTimer.unref) this._purgeTimer.unref()
  }

  async stop () {
    clearInterval(this._purgeTimer)
    for (const label of [...this.codes.keys()]) this._endCode(label)
    for (const k of this.knocks.values()) clearTimeout(k.timer)
    for (const t of this.transfers.values()) clearTimeout(t.timer)
    if (this.swarm) await this.swarm.destroy()
  }

  get me () { return { publicKey: this.identity.publicKey, name: this.identity.name, avatar: this.identity.avatar || null } }

  // Change your picture everywhere: a signed note in every room you're in.
  setAvatar (avatar) {
    this._needName()
    if (!validAvatar(avatar)) throw new Error("That picture won't work. Try a smaller photo or a single emoji.")
    this.identity.avatar = avatar
    this._writeJSON(this._file('identity.json'), this.identity, 0o600)
    for (const room of this.rooms.values()) if (!room.removed) this._publish(room, this._sign(room, 'profile', room.epoch, { avatar }))
  }

  _shareAvatar (room) {
    if (this.identity.avatar) this._publish(room, this._sign(room, 'profile', room.epoch, { avatar: this.identity.avatar }))
  }

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
      if (r.kind !== 'rekey') names.set(r.author, r.name)
    }
    const set = new Set([room.owner])
    const rk = this._rekeyTo(room, e)
    if (rk) for (const k of rk.body.members) set.add(k)
    for (const r of room.records.values()) {
      if ((r.kind === 'join' || r.kind === 'msg' || r.kind === 'file' || r.kind === 'profile') && r.epoch === e) set.add(r.author)
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
    this._shareAvatar(room)
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
    this._shareAvatar(room)
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

  // Make a 5-character code for one of your rooms. Good for 15 minutes.
  async inviteCode (roomId) {
    const room = this._room(roomId)
    if (room.owner !== this.identity.publicKey) throw new Error('Only the owner can invite people')
    const code = newCode()
    const seed = codeSeed(code)
    const label = hmac(seed, 'slake-knock-label').toString('hex')
    const topic = hc.discoveryKey(seed)
    const entry = { code, roomId, seed, topic, expires: this.now() + CODE_TTL }
    this.codes.set(label, entry)
    entry.timer = setTimeout(() => this._endCode(label), CODE_TTL)
    if (entry.timer.unref) entry.timer.unref()
    await this.swarm.join(topic, { server: true, client: false }).flushed()
    return { code, expires: entry.expires }
  }

  _endCode (label) {
    const c = this.codes.get(label)
    if (!c) return
    clearTimeout(c.timer)
    this.codes.delete(label)
    if (this.swarm) this.swarm.leave(c.topic).catch(() => {})
  }

  // Use a 5-character code someone gave you.
  joinWithCode (str, { timeout = 60000 } = {}) {
    this._needName()
    const code = normalizeCode(str)
    if (!code) return Promise.reject(new Error('Codes are 5 letters and numbers, like K7Q2M'))
    const seed = codeSeed(code)
    const label = hmac(seed, 'slake-knock-label').toString('hex')
    const topic = hc.discoveryKey(seed)
    return new Promise((resolve, reject) => {
      const k = { seed, topic, label }
      k.done = (err, id) => {
        clearTimeout(k.timer)
        this.knocks.delete(label)
        this.swarm.leave(topic).catch(() => {})
        err ? reject(err) : resolve(id)
      }
      k.timer = setTimeout(() => k.done(new Error("Nobody answered that code. Check it, and make sure the room's owner has Slake running.")), timeout)
      this.knocks.set(label, k)
      for (const p of this.peers) this._knock(p, k)
      this.swarm.join(topic, { server: false, client: true })
    })
  }

  // Prove we know the code, tied to this one connection. We go first and the
  // owner never sends a proof back, so a stranger can't use a reply to guess.
  _knock (peer, k) {
    const p = hmac(k.seed, Buffer.concat([peer.conn.handshakeHash, Buffer.from('knock')])).toString('hex')
    this._send(peer, { type: 'knock', l: k.label, p, key: this.identity.publicKey, name: this.identity.name })
  }

  _onKnock (peer, msg) {
    const c = this.codes.get(String(msg.l || ''))
    if (!c || this.now() > c.expires) return
    const expected = hmac(c.seed, Buffer.concat([peer.conn.handshakeHash, Buffer.from('knock')]))
    const got = Buffer.from(String(msg.p || ''), 'hex')
    if (got.length !== expected.length || !nodeCrypto.timingSafeEqual(got, expected)) return
    if (typeof msg.key !== 'string' || !KEY_RE.test(msg.key)) return
    const room = this.rooms.get(c.roomId)
    if (!room || room.removed) return
    const box = sealBytes(msg.key, Buffer.from(makeInvite(room)))
    this._send(peer, { type: 'welcome', l: msg.l, box: box.toString('base64') })
    this.emit('knocked', room.id, String(msg.name || 'Someone').slice(0, 40))
  }

  _onWelcome (peer, msg) {
    const k = this.knocks.get(String(msg.l || ''))
    if (!k) return
    const inv = openBytes(Buffer.from(String(msg.box || ''), 'base64'), this.curve)
    if (!inv) return
    const invite = inv.toString('utf8')
    const parsed = parseInvite(invite)
    if (!parsed) return
    const existing = this.rooms.get(parsed.id)
    if (existing && !existing.removed && existing.epoch >= parsed.epoch) { k.done(null, parsed.id); return }
    this.joinRoom(invite, { waitForNetwork: false }).then((id) => k.done(null, id), (e) => k.done(e))
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
    if (rec.kind === 'file' && rec.author !== this.identity.publicKey && rec.body.size <= AUTO_FETCH) this._fetch(room, rec)
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
    const peer = { conn, buf: Buffer.alloc(0), proven: new Map(), streams: new Set() }
    this.peers.add(peer)
    conn.on('error', () => {})
    conn.on('close', () => {
      this.peers.delete(peer)
      clearTimeout(peer.timer)
      for (const st of peer.streams) st.destroy()
      // Anything we were downloading from them: try someone else.
      for (const t of this.transfers.values()) if (t.peer === peer) this._nextSource(t)
      this.emit('rooms')
    })
    conn.on('data', (d) => {
      peer.buf = peer.buf.length ? Buffer.concat([peer.buf, d]) : d
      let i
      while ((i = peer.buf.indexOf(10)) >= 0) {
        const line = peer.buf.subarray(0, i).toString('utf8')
        peer.buf = peer.buf.subarray(i + 1)
        try { this._onMessage(peer, JSON.parse(line)) } catch { return conn.destroy() }
      }
      if (peer.buf.length > MAX_LINE) return conn.destroy()
    })
    this._hello(peer)
    for (const k of this.knocks.values()) this._knock(peer, k)
    // Strangers who can't prove they share any room get dropped.
    peer.timer = setTimeout(() => { if (peer.proven.size === 0) { this.emit('rejected'); conn.destroy() } }, 15000)
  }

  _send (peer, obj) {
    try { return peer.conn.write(JSON.stringify(obj) + '\n') } catch { return true }
  }

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
        for (const roomId of changed) this._retryFiles(roomId)
      }
      return
    }

    if (msg.type === 'knock') { this._onKnock(peer, msg); return }
    if (msg.type === 'welcome') { this._onWelcome(peer, msg); return }

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
    } else if (msg.type === 'want') {
      this._serve(peer, room, peerEpoch, msg)
    } else if (msg.type === 'chunk' || msg.type === 'nofile') {
      this._onChunk(peer, room, msg)
    }
  }

  // ---------- Fleeting files ----------
  // A file record is a signed note in the room ("John sent plot.pdf, lasts
  // 1 day"). The bytes travel directly between computers, are checked
  // against the note's fingerprint, and every copy is deleted when time's up.

  _fileRec (room, fid) {
    for (const r of room.records.values()) if (r.kind === 'file' && r.body.fid === fid) return r
    return null
  }

  _filePath (fid) { return path.join(this.filesDir, fid) }
  _expired (rec) { return this.now() >= rec.ts + rec.body.ttl }

  fileStatus (rec) {
    if (this._expired(rec)) return { state: 'expired', expiresAt: rec.ts + rec.body.ttl }
    if (fs.existsSync(this._filePath(rec.body.fid))) return { state: 'ready', expiresAt: rec.ts + rec.body.ttl }
    const t = this.transfers.get(rec.body.fid)
    if (t && t.peer) return { state: 'downloading', progress: rec.body.size ? t.bytes / rec.body.size : 1, expiresAt: rec.ts + rec.body.ttl }
    const auto = rec.body.size <= AUTO_FETCH || this.wanted.has(rec.body.fid)
    return { state: auto || t ? 'waiting' : 'available', expiresAt: rec.ts + rec.body.ttl }
  }

  async sendFile (roomId, filePath, ttl = 24 * HOUR) {
    this._needName()
    const room = this._room(roomId)
    if (room.removed) throw new Error("You're no longer in this room")
    if (!TTLS.has(ttl)) throw new Error('Files last 1 hour, 1 day or 1 week')
    const st = await fs.promises.stat(filePath)
    if (!st.isFile()) throw new Error("That's not a file")
    // Fingerprint the file while copying it into Slake's short-term shelf.
    const hash = nodeCrypto.createHash('sha256')
    const tmp = path.join(this.filesDir, 'incoming-' + hc.randomBytes(8).toString('hex'))
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(filePath)
      const ws = fs.createWriteStream(tmp)
      rs.on('data', (d) => hash.update(d))
      rs.on('error', reject)
      ws.on('error', reject)
      ws.on('finish', resolve)
      rs.pipe(ws)
    })
    const fid = hash.digest('hex')
    fs.renameSync(tmp, this._filePath(fid))
    const fname = path.basename(filePath).replace(/[\0]/g, '').slice(-200) || 'file'
    const r = this._sign(room, 'file', room.epoch, { fid, fname, size: st.size, ttl })
    this._publish(room, r)
    this.emit('file', room.id, fid)
    return r
  }

  // Ask for a big file that doesn't download by itself.
  download (roomId, fid) {
    const room = this._room(roomId)
    const rec = this._fileRec(room, fid)
    if (!rec) throw new Error('No such file')
    if (this._expired(rec)) throw new Error('That file has disappeared')
    this.wanted.add(fid)
    this._fetch(room, rec)
  }

  async saveFile (fid, dest) {
    if (!KEY_RE.test(fid) || !fs.existsSync(this._filePath(fid))) throw new Error("That file isn't here (anymore)")
    await fs.promises.copyFile(this._filePath(fid), dest)
  }

  filePath (fid) {
    return KEY_RE.test(fid) && fs.existsSync(this._filePath(fid)) ? this._filePath(fid) : null
  }

  _fetch (room, rec) {
    const fid = rec.body.fid
    if (this._expired(rec) || fs.existsSync(this._filePath(fid))) return
    let t = this.transfers.get(fid)
    if (!t) {
      t = { room: room.id, rec, bytes: 0, peer: null, tried: new Set(), timer: null }
      this.transfers.set(fid, t)
    }
    if (!t.peer) this._nextSource(t)
  }

  _retryFiles (roomId) {
    for (const t of this.transfers.values()) {
      if (t.room !== roomId || t.peer) continue
      t.tried.clear()
      this._nextSource(t)
    }
  }

  // Pick the next person in the room to ask for the file.
  _nextSource (t) {
    if (t.checking) return
    clearTimeout(t.timer)
    t.peer = null
    const room = this.rooms.get(t.room)
    if (!room || this._expired(t.rec)) { this._dropTransfer(t.rec.body.fid); return }
    const part = this._filePath(t.rec.body.fid) + '.part'
    t.bytes = fs.existsSync(part) ? fs.statSync(part).size : 0
    for (const p of this.peers) {
      if (t.tried.has(p) || !p.proven.has(room.id) || p.proven.get(room.id) < t.rec.epoch) continue
      t.tried.add(p)
      t.peer = p
      this._send(p, { type: 'want', room: room.id, fid: t.rec.body.fid, off: t.bytes })
      this._stall(t)
      break
    }
    this.emit('file', t.room, t.rec.body.fid)
  }

  _stall (t) {
    clearTimeout(t.timer)
    t.timer = setTimeout(() => this._nextSource(t), 20000)
  }

  _dropTransfer (fid) {
    const t = this.transfers.get(fid)
    if (t) clearTimeout(t.timer)
    this.transfers.delete(fid)
  }

  _serve (peer, room, peerEpoch, msg) {
    const fid = String(msg.fid || '')
    const rec = KEY_RE.test(fid) && this._fileRec(room, fid)
    const p = rec && this._filePath(fid)
    const off = Number(msg.off) || 0
    if (!rec || rec.epoch > peerEpoch || this._expired(rec) || !fs.existsSync(p) || off < 0 || off > rec.body.size) {
      this._send(peer, { type: 'nofile', room: room.id, fid })
      return
    }
    if (off === rec.body.size) { this._send(peer, { type: 'chunk', room: room.id, fid, off, d: '' }); return }
    const rs = fs.createReadStream(p, { start: off, highWaterMark: CHUNK })
    peer.streams.add(rs)
    let pos = off
    rs.on('data', (d) => {
      const ok = this._send(peer, { type: 'chunk', room: room.id, fid, off: pos, d: d.toString('base64') })
      pos += d.length
      if (!ok) { rs.pause(); peer.conn.once('drain', () => rs.resume()) }
    })
    const done = () => peer.streams.delete(rs)
    rs.on('end', done)
    rs.on('error', () => { done(); this._send(peer, { type: 'nofile', room: room.id, fid }) })
    rs.on('close', done)
  }

  _onChunk (peer, room, msg) {
    const fid = String(msg.fid || '')
    const t = this.transfers.get(fid)
    if (!t || t.peer !== peer || t.room !== room.id) return
    if (msg.type === 'nofile') { this._nextSource(t); return }
    if (Number(msg.off) !== t.bytes || typeof msg.d !== 'string') return
    const data = Buffer.from(msg.d, 'base64')
    if (t.bytes + data.length > t.rec.body.size) { this._badFile(t); return }
    const part = this._filePath(fid) + '.part'
    if (data.length) fs.appendFileSync(part, data)
    else if (!fs.existsSync(part)) fs.writeFileSync(part, '')
    t.bytes += data.length
    this._stall(t)
    if (t.bytes < t.rec.body.size) {
      const now = Date.now()
      if (!t.lastEmit || now - t.lastEmit > 250) { t.lastEmit = now; this.emit('file', room.id, fid) }
      return
    }
    // All there: make sure it's exactly the file that was announced.
    // (Read in pieces, so a 40 GB file doesn't need 40 GB of memory.)
    clearTimeout(t.timer)
    t.checking = true
    const hash = nodeCrypto.createHash('sha256')
    fs.createReadStream(part)
      .on('data', (d) => hash.update(d))
      .on('error', () => this._badFile(t))
      .on('end', () => {
        t.checking = false
        if (hash.digest('hex') !== fid) { this._badFile(t); return }
        try { fs.renameSync(part, this._filePath(fid)) } catch { this._badFile(t); return }
        this._dropTransfer(fid)
        this.emit('file', room.id, fid)
      })
  }

  _badFile (t) {
    try { fs.unlinkSync(this._filePath(t.rec.body.fid) + '.part') } catch {}
    t.bytes = 0
    this._nextSource(t)
  }

  // Delete every file whose time is up. Called on start and every 30 seconds.
  purgeExpired () {
    const live = new Set()
    const dead = new Set()
    for (const room of this.rooms.values()) {
      for (const r of room.records.values()) {
        if (r.kind !== 'file') continue
        if (this._expired(r)) {
          dead.add(r.body.fid)
          const had = fs.existsSync(this._filePath(r.body.fid)) || this.transfers.has(r.body.fid)
          this._dropTransfer(r.body.fid)
          if (had) this.emit('file', room.id, r.body.fid)
        } else live.add(r.body.fid)
      }
    }
    for (const f of fs.readdirSync(this.filesDir)) {
      const fid = f.replace(/\.part$/, '')
      if (live.has(fid)) continue
      const full = path.join(this.filesDir, f)
      try {
        // Expired: gone now. Unknown leftovers (e.g. from a room you left):
        // gone once they're a couple of minutes old, so a send in progress is safe.
        if (dead.has(fid) || Date.now() - fs.statSync(full).mtimeMs > 120000) fs.unlinkSync(full)
      } catch {}
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

module.exports = { Slake, parseInvite, makeInvite, wellFormed, normalizeCode }
