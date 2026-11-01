// A pretend disk for the browser. The engine reads and writes files exactly
// as it does on a computer; here they live in memory and are saved to the
// browser's own storage (IndexedDB) a moment later. Call load() before use.
const { Buffer } = require('buffer')
const { EventEmitter } = require('events')

const files = new Map()   // path -> { chunks: [Buffer], size, mtimeMs }
const dirs = new Set(['/'])
const DB = 'slake-disk'
const STORE = 'files'
let db = null
const dirty = new Set()
let flushTimer = null

const norm = (p) => ('/' + String(p)).replace(/\/+/g, '/').replace(/\/$/, '') || '/'
const parent = (p) => norm(p).split('/').slice(0, -1).join('/') || '/'
const err = (code, p) => Object.assign(new Error(`${code}: ${p}`), { code })

function bytes (f) {
  if (f.chunks.length > 1) f.chunks = [Buffer.concat(f.chunks)]
  return f.chunks[0] || Buffer.alloc(0)
}

function touch (p) { dirty.add(p); if (!flushTimer) flushTimer = setTimeout(flush, 400) }

function openDB () {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function load () {
  try { db = await openDB() } catch { db = null; return }
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c) return resolve()
      const { data, mtimeMs } = c.value
      const p = norm(c.key)
      files.set(p, { chunks: [Buffer.from(data)], size: data.byteLength, mtimeMs })
      for (let d = parent(p); d !== '/'; d = parent(d)) dirs.add(d)
      c.continue()
    }
    req.onerror = () => resolve()
  })
}

function flush () {
  flushTimer = null
  if (!db || !dirty.size) { dirty.clear(); return }
  const tx = db.transaction(STORE, 'readwrite')
  const st = tx.objectStore(STORE)
  for (const p of dirty) {
    const f = files.get(p)
    if (f) st.put({ data: new Uint8Array(bytes(f)), mtimeMs: f.mtimeMs }, p)
    else st.delete(p)
  }
  dirty.clear()
}

// Forget everything (logging out).
async function wipe () {
  files.clear(); dirty.clear()
  if (db) { db.close(); db = null }
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => resolve() })
}

const fs = {
  load,
  flush,
  wipe,
  existsSync: (p) => files.has(norm(p)) || dirs.has(norm(p)),
  mkdirSync (p) { for (let d = norm(p); d !== '/'; d = parent(d)) dirs.add(d) },
  readdirSync (p) {
    const dir = norm(p)
    if (!dirs.has(dir)) throw err('ENOENT', p)
    const out = new Set()
    const pre = dir === '/' ? '/' : dir + '/'
    for (const k of [...files.keys(), ...dirs]) if (k.startsWith(pre) && k !== dir) out.add(k.slice(pre.length).split('/')[0])
    return [...out]
  },
  readFileSync (p, enc) {
    const f = files.get(norm(p))
    if (!f) throw err('ENOENT', p)
    const b = bytes(f)
    return enc ? b.toString(typeof enc === 'string' ? enc : enc.encoding || 'utf8') : Buffer.from(b)
  },
  writeFileSync (p, data) {
    const b = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(typeof data === 'string' ? data : new Uint8Array(data))
    files.set(norm(p), { chunks: [b], size: b.length, mtimeMs: Date.now() })
    touch(norm(p))
  },
  appendFileSync (p, data) {
    const k = norm(p)
    const b = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
    const f = files.get(k)
    if (!f) return fs.writeFileSync(k, b)
    f.chunks.push(Buffer.from(b))
    f.size += b.length
    f.mtimeMs = Date.now()
    touch(k)
  },
  renameSync (a, b) {
    const f = files.get(norm(a))
    if (!f) throw err('ENOENT', a)
    files.delete(norm(a)); touch(norm(a))
    files.set(norm(b), f); touch(norm(b))
  },
  unlinkSync (p) {
    if (!files.delete(norm(p))) throw err('ENOENT', p)
    touch(norm(p))
  },
  statSync (p) {
    const f = files.get(norm(p))
    if (f) return { size: f.size, mtimeMs: f.mtimeMs, isFile: () => true, isDirectory: () => false }
    if (dirs.has(norm(p))) return { size: 0, mtimeMs: 0, isFile: () => false, isDirectory: () => true }
    throw err('ENOENT', p)
  },
  createReadStream (p, { start = 0, highWaterMark = 64 * 1024 } = {}) {
    const s = new EventEmitter()
    let paused = false
    let pos = start
    let done = false
    const f = files.get(norm(p))
    const pump = () => {
      if (done) return
      if (!f) { done = true; s.emit('error', err('ENOENT', p)); s.emit('close'); return }
      const b = bytes(f)
      while (!paused && pos < b.length) {
        const chunk = b.subarray(pos, Math.min(b.length, pos + highWaterMark))
        pos += chunk.length
        s.emit('data', Buffer.from(chunk))
      }
      if (!paused && pos >= b.length) { done = true; s.emit('end'); s.emit('close') }
    }
    s.pause = () => { paused = true; return s }
    s.resume = () => { if (paused) { paused = false; setTimeout(pump, 0) } return s }
    s.destroy = () => { done = true; s.emit('close') }
    s.pipe = (ws) => { s.on('data', (d) => ws.write(d)); s.on('end', () => ws.end()); return ws }
    setTimeout(pump, 0)
    return s
  },
  createWriteStream (p) {
    const s = new EventEmitter()
    const chunks = []
    s.write = (d) => { chunks.push(Buffer.from(d)); return true }
    s.end = () => { fs.writeFileSync(p, Buffer.concat(chunks)); setTimeout(() => { s.emit('finish'); s.emit('close') }, 0) }
    return s
  },
  promises: {
    stat: async (p) => fs.statSync(p),
    copyFile: async (a, b) => fs.writeFileSync(b, fs.readFileSync(a))
  }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)

module.exports = fs
