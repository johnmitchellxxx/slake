// A tiny stand-in Nostr relay for testing: passes introductions along.
const { WebSocketServer } = require('ws')
const wss = new WebSocketServer({ port: Number(process.argv[2] || 7777) })
const subs = new Set()  // { ws, id, kinds, xs }
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw) } catch { return }
    if (m[0] === 'REQ') { const f = m[2] || {}; subs.add({ ws, id: m[1], kinds: f.kinds || [], xs: f['#x'] || [] }) }
    else if (m[0] === 'CLOSE') { for (const s of subs) if (s.ws === ws && s.id === m[1]) subs.delete(s) }
    else if (m[0] === 'EVENT') {
      const ev = m[1]
      ws.send(JSON.stringify(['OK', ev.id, true, '']))
      const x = (ev.tags || []).find((t) => t[0] === 'x')
      for (const s of subs) {
        if (s.kinds.length && !s.kinds.includes(ev.kind)) continue
        if (s.xs.length && !(x && s.xs.includes(x[1]))) continue
        if (s.ws.readyState === 1) s.ws.send(JSON.stringify(['EVENT', s.id, ev]))
      }
    }
  })
  ws.on('close', () => { for (const s of subs) if (s.ws === ws) subs.delete(s) })
})
console.log('relay up')
