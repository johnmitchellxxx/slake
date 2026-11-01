// Runs in the desktop app's hidden bridge window (or a test browser). Makes
// browser-style connections and relays them to the engine over a channel.
const { Buffer } = require('buffer')
globalThis.Buffer = globalThis.Buffer || Buffer
const { WebSwarm } = require('./transport')

function start (channel, { relayUrls } = {}) {
  const swarm = new WebSwarm({ relayUrls })
  const conns = new Map()
  let n = 0
  swarm.on('connection', (conn) => {
    const id = 'w' + (++n)
    conns.set(id, conn)
    conn.on('data', (d) => channel.post({ t: 'data', id, data: Buffer.from(d).toString('utf8') }))
    conn.on('close', () => { if (conns.delete(id)) channel.post({ t: 'gone', id }) })
    channel.post({ t: 'conn', id, hh: conn.handshakeHash.toString('hex'), init: conn.isInitiator })
  })
  channel.onMessage((m) => {
    if (!m || typeof m !== 'object') return
    if (m.t === 'join') swarm.join(Buffer.from(String(m.topic), 'hex'))
    else if (m.t === 'leave') swarm.leave(Buffer.from(String(m.topic), 'hex'))
    else if (m.t === 'write') { const c = conns.get(m.id); if (c) c.write(m.data) }
    else if (m.t === 'close') { const c = conns.get(m.id); if (c) { conns.delete(m.id); c.destroy() } }
  })
  channel.post({ t: 'ready' })
}

globalThis.startSlakeBridge = start
// Inside the desktop app, the preload gives us an IPC channel.
if (globalThis.slakeBridge) start(globalThis.slakeBridge, { relayUrls: globalThis.slakeBridge.relayUrls })
