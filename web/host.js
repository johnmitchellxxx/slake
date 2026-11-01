// Slake in a browser: runs the same engine and the same screen as the
// desktop app. This file plays the part the desktop wrapper (main.js +
// preload.js) plays there: it hands the screen a `window.slake` to talk to.
const { Buffer } = require('buffer')
globalThis.Buffer = globalThis.Buffer || Buffer
const fs = require('fs')
const { argon2id } = require('hash-wasm')
const { Slake } = require('../core')
const { WebSwarm } = require('./transport')

const DATA = '/slake'
const WALLS = '/walls'
let BUNDLED = []
const listeners = {}
const on = (name) => (fn) => { (listeners[name] = listeners[name] || []).push(fn) }
const send = (name, data) => { for (const fn of listeners[name] || []) { try { fn(data) } catch (e) { console.error(e) } } }

// ---------- Settings (just this browser) ----------
const SETTINGS = 'slake-settings'
function readSettings () { try { return JSON.parse(localStorage.getItem(SETTINGS)) || {} } catch { return {} } }
function writeSettings (s) { try { localStorage.setItem(SETTINGS, JSON.stringify(s)) } catch {} }

let THEMES = {}
// Themes you make in the Theme Studio, kept in this browser.
const MINE = 'slake-my-themes'
const myThemes = () => { try { return JSON.parse(localStorage.getItem(MINE)) || {} } catch { return {} } }
const listThemes = () => {
  const all = ['default', ...Object.keys(THEMES).sort()]
  const recent = (readSettings().recentThemes || []).filter((t) => all.includes(t))
  return [...recent, ...all.filter((t) => !recent.includes(t))]
}
const themeCSS = (t) => (t && t !== 'default' && THEMES[t]) || ''

const DEFAULT_WALL = { id: 'none', blur: 0, dim: 0.35 }
const wallpapers = () => { const s = readSettings(); return { default: s.wallpaper || DEFAULT_WALL, rooms: s.roomWallpapers || {} } }

// ---------- The engine ----------
let slake = null
const params = new URLSearchParams(location.search)
const relayUrls = params.get('relays') ? params.get('relays').split(',') : undefined
const kdf = async (password, salt) => Buffer.from(await argon2id({ password: new Uint8Array(password), salt: new Uint8Array(salt), parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'binary' }))

const ready = (async () => {
  let bundled = {}
  try { bundled = await (await fetch('themes.json')).json() } catch {}
  BUNDLED = Object.keys(bundled)
  THEMES = { ...bundled, ...myThemes() }
  await fs.load()
  slake = new Slake({ dataDir: DATA, makeSwarm: () => new WebSwarm({ relayUrls }), kdf })
  await slake.start()
  if (params.has('debug')) window.__slakeEngine = slake
  wire()
})()
ready.catch((e) => console.error('Slake failed to start', e))

// ---------- Shaping things for the screen (same as the desktop) ----------
function present (room, r) {
  const out = { id: r.id, room: r.room, kind: r.kind, author: r.author, name: r.name, ts: r.ts }
  if (r.kind === 'msg') out.text = r.body.text
  if (r.kind === 'profile') out.avatar = r.body.avatar
  if (r.kind === 'file') Object.assign(out, { fid: r.body.fid, fname: r.body.fname, size: r.body.size, ttl: r.body.ttl, status: slake.fileStatus(r) })
  if (r.kind === 'room') out.title = r.body.title
  if (r.kind === 'rekey') {
    const before = new Set()
    for (const x of room.records.values()) {
      if ((x.kind === 'join' || x.kind === 'msg') && x.epoch === r.epoch && x.author !== room.owner) before.add(x.author)
      if (x.kind === 'rekey' && x.body.to === r.epoch) x.body.members.forEach((k) => before.add(k))
    }
    const names = new Map([...room.records.values()].filter((x) => x.kind !== 'rekey').map((x) => [x.author, x.name]))
    out.removedNames = [...before].filter((k) => k !== room.owner && !r.body.members.includes(k)).map((k) => names.get(k) || 'someone')
  }
  return out
}
function nameIn (room, key) {
  let best = null
  for (const r of room.records.values()) if (r.author === key && r.kind !== 'rekey' && (!best || r.ts > best.ts)) best = r
  return best ? best.name : null
}
function roomInfo (room) {
  const mine = room.owner === slake.me.publicKey
  const dmName = room.dm ? (nameIn(room, room.peer) || (mine ? room.title : room.ownerName)) : null
  return {
    id: room.id, title: room.dm ? dmName : room.title, dm: !!room.dm, peer: room.peer || null,
    onlineKeys: slake.onlineIn(room.id), owner: room.owner, ownerName: room.ownerName, mine,
    removed: room.removed, closedAt: room.closedAt || null, online: slake.online(room.id),
    members: mine && !room.dm ? slake.members(room.id) : null
  }
}
const DELETED_GRACE = 24 * 3600 * 1000
const showRoom = (r) => !r.closedAt || (r.owner !== slake.me.publicKey && Date.now() - r.closedAt < DELETED_GRACE)
const rooms = () => [...slake.rooms.values()].filter(showRoom).map(roomInfo)

function state () {
  const records = {}
  for (const room of slake.rooms.values()) records[room.id] = [...room.records.values()].sort((a, b) => a.ts - b.ts).map((r) => present(room, r))
  const s = readSettings()
  return { me: slake.me, rooms: rooms(), records, online: [...slake.onlineKeys()], themes: listThemes(), theme: THEMES[s.theme] ? s.theme : 'default', themeCSS: themeCSS(s.theme), version: { version: window.SLAKE_VERSION || '', updated: null }, sound: s.sound !== false, wallpapers: wallpapers() }
}

let unread = 0
const baseTitle = document.title
document.addEventListener('visibilitychange', () => { if (!document.hidden) { unread = 0; document.title = baseTitle } })

function wire () {
  slake.on('rooms', () => { send('rooms', rooms()); send('online', [...slake.onlineKeys()]) })
  slake.on('dm', () => send('rooms', rooms()))
  slake.on('closed', (roomId, title, by) => { if (by !== slake.me.name) send('closed', { title, by }) })
  slake.on('knocked', (roomId, name) => { const room = slake.rooms.get(roomId); send('knocked', { room: roomId, name, title: room ? room.title : '' }) })
  slake.on('file', (roomId, fid) => {
    const room = slake.rooms.get(roomId)
    const rec = room && slake._fileRec(room, fid)
    if (rec) send('fileStatus', { room: roomId, fid, status: slake.fileStatus(rec) })
  })
  slake.on('record', (roomId, r) => {
    const room = slake.rooms.get(roomId)
    if (!room) return
    send('record', present(room, r))
    const fromOthers = (r.kind === 'msg' || r.kind === 'file') && r.author !== slake.me.publicKey
    if (fromOthers && Date.now() - r.ts < 10 * 60 * 1000 && document.hidden) {
      unread++
      document.title = `(${unread}) ${baseTitle}`
    }
  })
  setInterval(() => send('rooms', rooms()), 10 * 60 * 1000)
}

// ---------- Browser stand-ins for desktop things ----------
function pickFiles (accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.onchange = () => resolve(input.files[0] || null)
    window.addEventListener('focus', () => setTimeout(() => { if (!input.files.length) resolve(null) }, 800), { once: true })
    input.click()
  })
}

// Files you pick or drop are kept here until sent.
const picked = new Map()
let pickN = 0
function remember (file) {
  const token = 'webfile:' + (++pickN)
  picked.set(token, file)
  return token
}
const infoFor = (token) => {
  const f = picked.get(token)
  if (!f) throw new Error("Couldn't read that file")
  return { path: token, name: f.name, size: f.size }
}

async function squareImage (file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = c.height = 128
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 128, 128)
    return c.toDataURL('image/jpeg', 0.82)
  } catch { throw new Error("Couldn't read that picture") } finally { URL.revokeObjectURL(url) }
}

function copy (text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text || ''))
  const t = document.createElement('textarea')
  t.value = String(text || '')
  document.body.append(t); t.select(); document.execCommand('copy'); t.remove()
}

// Right-click menus, drawn in the page.
function menu (items) {
  return new Promise((resolve) => {
    const list = (Array.isArray(items) ? items : []).filter((i) => !(i.role && i.role !== 'copy'))
    while (list.length && list[0].type === 'separator') list.shift()
    while (list.length && list[list.length - 1].type === 'separator') list.pop()
    if (!list.length) return resolve(null)
    const m = document.createElement('div')
    m.className = 'web-menu'
    const close = (v) => { m.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); resolve(v) }
    const outside = (e) => { if (!m.contains(e.target)) close(null) }
    const esc = (e) => { if (e.key === 'Escape') close(null) }
    let prevSep = true
    for (const i of list) {
      if (i.type === 'separator') { if (!prevSep) m.append(Object.assign(document.createElement('hr'))); prevSep = true; continue }
      prevSep = false
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = i.role === 'copy' ? 'Copy' : String(i.label || '')
      b.disabled = i.enabled === false
      b.onclick = () => {
        if (i.role === 'copy') { copy(String(window.getSelection() || '')); close(null) } else close(i.id)
      }
      m.append(b)
    }
    document.body.append(m)
    const x = Math.min(lastPointer.x, innerWidth - m.offsetWidth - 8)
    const y = Math.min(lastPointer.y, innerHeight - m.offsetHeight - 8)
    m.style.left = Math.max(8, x) + 'px'
    m.style.top = Math.max(8, y) + 'px'
    setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true) }, 0)
  })
}
const lastPointer = { x: 0, y: 0 }
document.addEventListener('contextmenu', (e) => { lastPointer.x = e.clientX; lastPointer.y = e.clientY }, true)

// Phones have no right-click: press and hold instead.
let hold = null
document.addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1 || e.target.closest('input, textarea')) return
  const t = e.touches[0]
  const target = e.target
  hold = { x: t.clientX, y: t.clientY, timer: setTimeout(() => {
    hold.fired = true
    if (navigator.vibrate) navigator.vibrate(10)
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: hold.x, clientY: hold.y }))
  }, 520) }
}, { passive: true })
document.addEventListener('touchmove', (e) => {
  if (!hold) return
  const t = e.touches[0]
  if (Math.abs(t.clientX - hold.x) > 10 || Math.abs(t.clientY - hold.y) > 10) { clearTimeout(hold.timer); hold = null }
}, { passive: true })
document.addEventListener('touchend', (e) => {
  if (!hold) return
  clearTimeout(hold.timer)
  if (hold.fired) e.preventDefault()   // don't also "tap" what you held
  hold = null
})

// Add to Home Screen: a small helper so it opens like an app.
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {})

const style = document.createElement('style')
style.textContent = `
.web-menu { position: fixed; z-index: 50; min-width: 190px; padding: 5px; border-radius: 10px;
  background: #23232b; color: #eee; border: 1px solid rgba(255,255,255,.12); box-shadow: 0 12px 40px rgba(0,0,0,.45);
  font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.web-menu button { display: block; width: 100%; text-align: left; background: none; color: inherit; border: 0;
  border-radius: 6px; padding: 7px 10px; font: inherit; font-weight: 400; box-shadow: none; text-transform: none; letter-spacing: 0; filter: none; }
.web-menu button:hover:not(:disabled) { background: #3b82f6; color: #fff; }
.web-menu button:disabled { opacity: .4; }
.web-menu hr { border: 0; border-top: 1px solid rgba(255,255,255,.12); margin: 4px 6px; }
@media (max-width: 640px) { .web-menu { min-width: 230px; } .web-menu button { padding: 12px 12px; font-size: 16px; } }
.space li, .msg, .room-head, .member { -webkit-touch-callout: none; }
@media (hover: none) { .space li, .room-head { -webkit-user-select: none; user-select: none; } }`
document.head.append(style)

// ---------- What the screen can call ----------
const api = (fn) => async (...args) => { await ready; return fn(...args) }
window.slake = {
  web: true,
  state: api(() => state()),
  setName: api((n) => slake.setName(n)),
  setPassword: api((pw) => slake.setPassword(pw)),
  login: api((name, password, timeout) => slake.login(name, password, { timeout: Math.min(Number(timeout) || 120000, 120000) })),
  cancelLogin: api(() => slake.cancelLogin()),
  logout: api(async () => {
    slake.removeAllListeners()
    await slake.stop()
    await fs.wipe()
    location.reload()
  }),
  setAvatar: api((a) => slake.setAvatar(a)),
  pickImage: api(async () => { const f = await pickFiles('image/*'); return f ? squareImage(f) : null }),
  createRoom: api((title) => slake.createRoom(title, { waitForNetwork: false })),
  joinRoom: api((inv) => slake.joinRoom(inv, { waitForNetwork: false })),
  post: api((room, text) => { slake.post(room, text) }),
  copyInvite: api((room) => copy(slake.invite(room))),
  inviteCode: api((room) => slake.inviteCode(room)),
  messagePerson: api((key, name) => slake.messagePerson(key, name)),
  joinWithCode: api((code) => slake.joinWithCode(code)),
  removeMember: api((room, key) => slake.removeMember(room, key)),
  leaveRoom: api((room) => slake.leaveRoom(room)),
  deleteRoom: api((room) => slake.deleteRoom(room)),
  openThemes: async () => {},
  copyText: async (t) => copy(t),
  pickFile: api(async () => { const f = await pickFiles(); return f ? infoFor(remember(f)) : null }),
  fileInfo: api((token) => infoFor(token)),
  pathFor: (file) => remember(file),
  sendFile: api(async (room, token, ttl) => {
    const f = picked.get(token)
    if (!f) throw new Error("Couldn't read that file")
    const tmp = DATA + '/uploads/' + token.replace(/\W/g, '') + '-' + f.name.replace(/[\\/]/g, '_')
    fs.mkdirSync(DATA + '/uploads')
    fs.writeFileSync(tmp, Buffer.from(await f.arrayBuffer()))
    try { await slake.sendFile(room, tmp, ttl) } finally { try { fs.unlinkSync(tmp) } catch {} picked.delete(token) }
  }),
  download: api((room, fid) => slake.download(room, fid)),
  saveFile: api(async (fid, fname) => {
    const p = slake.filePath(fid)
    if (!p) throw new Error('That file is gone')
    const url = URL.createObjectURL(new Blob([fs.readFileSync(p)]))
    const a = document.createElement('a')
    a.href = url
    a.download = String(fname || 'file').split(/[\\/]/).pop()
    document.body.append(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    return true
  }),
  menu: (items) => menu(items),
  confirm: async ({ message, detail }) => window.confirm(String(message || '') + (detail ? '\n\n' + detail : '')),
  setTheme: async (t) => {
    const st = readSettings()
    writeSettings({ ...st, theme: t, recentThemes: [t, ...(st.recentThemes || []).filter((x) => x !== t)].slice(0, 50) })
    return { css: themeCSS(t), themes: listThemes() }
  },
  update: async () => null,
  openUpdate: async () => {},
  openStudio: async (opts) => openStudio(opts || {}),
  setWallpaper: async (scope, wp) => {
    const s = readSettings()
    if (scope === 'default') s.wallpaper = wp || DEFAULT_WALL
    else { s.roomWallpapers = s.roomWallpapers || {}; if (wp === null) delete s.roomWallpapers[scope]; else s.roomWallpapers[scope] = wp }
    writeSettings(s)
    send('wallpapers', wallpapers())
  },
  onRecord: on('record'),
  onRooms: on('rooms'),
  onOnline: on('online'),
  onKnocked: on('knocked'),
  onClosed: on('closed'),
  onFileStatus: on('fileStatus'),
  onTheme: on('theme'),
  onUpdate: on('update'),
  onSound: on('sound'),
  onWallpapers: on('wallpapers')
}

// ---------- Theme Studio, in a panel over the page ----------
let studioOpts = {}
let studioFrame = null
function openStudio (opts) {
  studioOpts = opts
  if (studioFrame) studioFrame.remove()
  studioFrame = document.createElement('iframe')
  studioFrame.src = 'studio.html'
  studioFrame.title = 'Theme Studio'
  studioFrame.className = 'web-studio'
  document.body.append(studioFrame)
}
function closeStudio () { if (studioFrame) { studioFrame.remove(); studioFrame = null } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && studioFrame) closeStudio() })
const studioStyle = document.createElement('style')
studioStyle.textContent = '.web-studio { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 60; background: #141519; }'
document.head.append(studioStyle)

// Your own background pictures, kept in this browser's storage.
const wallUrls = new Map()
window.slakeWallUrl = (name) => {
  name = String(name).replace(/[^A-Za-z0-9._-]/g, '')
  if (!wallUrls.has(name)) {
    try { wallUrls.set(name, URL.createObjectURL(new Blob([fs.readFileSync(WALLS + '/' + name)], { type: 'image/jpeg' }))) } catch { return '' }
  }
  return wallUrls.get(name)
}
async function pickWallpaper () {
  const f = await pickFiles('image/*')
  if (!f) return null
  const url = URL.createObjectURL(f)
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url })
    const scale = Math.min(1, 2560 / img.naturalWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.86))
    const data = Buffer.from(await blob.arrayBuffer())
    const name = Buffer.from(require('@noble/hashes/sha2').sha256(data)).toString('hex').slice(0, 16) + '.jpg'
    fs.mkdirSync(WALLS)
    fs.writeFileSync(WALLS + '/' + name, data)
    return 'file:' + name
  } catch { throw new Error("Couldn't read that picture") } finally { URL.revokeObjectURL(url) }
}

// What the Studio (in its own frame) can call.
window.slakeStudio = {
  web: true,
  studioInit: api(() => {
    const st = readSettings()
    const room = studioOpts.room && slake.rooms.get(studioOpts.room)
    let customWalls = []
    try { customWalls = fs.readdirSync(WALLS).filter((f) => /\.jpg$/.test(f)) } catch {}
    return {
      mode: studioOpts.mode || 'theme',
      room: room ? { id: room.id, title: room.title, dm: !!room.dm } : null,
      themes: listThemes().map((t) => ({ name: t, css: themeCSS(t) })),
      current: studioOpts.edit || st.theme || 'default',
      wallpapers: wallpapers(),
      customWalls
    }
  }),
  saveTheme: async (name, css) => {
    let slug = String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
    if (!slug || slug === 'default') throw new Error('Give your theme a name')
    if (BUNDLED.includes(slug)) slug += '-mine'   // never collide with a theme Slake ships
    const mine = myThemes()
    mine[slug] = String(css || '')
    try { localStorage.setItem(MINE, JSON.stringify(mine)) } catch { throw new Error("This browser's storage is full") }
    THEMES[slug] = mine[slug]
    const st = readSettings()
    writeSettings({ ...st, theme: slug, recentThemes: [slug, ...(st.recentThemes || []).filter((x) => x !== slug)].slice(0, 50) })
    send('theme', { themes: listThemes(), theme: slug, css: themeCSS(slug) })
    return slug
  },
  setWallpaper: (scope, wp) => window.slake.setWallpaper(scope, wp),
  pickWallpaper: () => pickWallpaper(),
  closeStudio: async () => closeStudio(),
  openThemes: async () => {}
}
