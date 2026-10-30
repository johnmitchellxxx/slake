// Sample Slake for the Theme Studio's live preview. Only does anything when
// the page is opened as index.html#preview without the real app behind it.
;(function () {
  if (window.slake || location.hash !== '#preview') return
  const now = Date.now()
  const min = 60 * 1000
  const ME = 'a1b2c3d4'.repeat(8)
  const MACKIE = '3c4d5e6f'.repeat(8)
  const SAM = '9f8e7d6c'.repeat(8)
  const BOB = '77aa1234'.repeat(8)
  const P = '11'.repeat(16)
  const Q = '22'.repeat(16)
  const G = '33'.repeat(16)
  const D = '44'.repeat(16)
  let n = 0
  const rec = (room, kind, author, name, ago, extra) => ({ id: 'demo' + (n++), room, kind, author, name, ts: now - ago * min, ...extra })
  const records = {
    [P]: [
      rec(P, 'room', ME, 'John', 300, { title: 'load-in' }),
      rec(P, 'join', MACKIE, 'Mackie', 240),
      rec(P, 'msg', MACKIE, 'Mackie', 62, { text: 'Truck is at the dock. Rigging first, then video wall.' }),
      rec(P, 'msg', ME, 'John', 58, { text: 'Perfect. Points are marked, motors go up at 9.' }),
      rec(P, 'msg', SAM, 'Sam', 31, { text: 'Bringing the spare processor just in case' }),
      rec(P, 'file', MACKIE, 'Mackie', 20, { fid: 'f'.repeat(64), fname: 'stage-plot-v7.pdf', size: 3100000, ttl: 24 * 60 * min, status: { state: 'ready' } }),
      rec(P, 'msg', ME, 'John', 4, { text: 'Doors at 6. Coffee is on me.' })
    ],
    [Q]: [rec(Q, 'room', ME, 'John', 500, { title: 'weekend' })],
    [G]: [rec(G, 'room', BOB, 'Bob', 900, { title: 'garage' }), rec(G, 'msg', BOB, 'Bob', 400, { text: 'new lift is in' })],
    [D]: [rec(D, 'msg', MACKIE, 'Mackie', 90, { text: 'you around tomorrow?' })]
  }
  const rooms = [
    { id: P, title: 'load-in', owner: ME, ownerName: 'John', mine: true, removed: false, online: 2, onlineKeys: [MACKIE, SAM], members: [] },
    { id: Q, title: 'weekend', owner: ME, ownerName: 'John', mine: true, removed: false, online: 0, onlineKeys: [], members: [] },
    { id: G, title: 'garage', owner: BOB, ownerName: 'Bob', mine: false, removed: false, online: 0, onlineKeys: [], members: null },
    { id: D, title: 'Mackie', dm: true, peer: MACKIE, owner: MACKIE, ownerName: 'Mackie', mine: false, removed: false, online: 1, onlineKeys: [MACKIE], members: null }
  ]
  const noop = () => {}
  const later = async () => null
  window.slake = new Proxy({
    state: async () => ({
      me: { publicKey: ME, name: 'John', avatar: null },
      rooms,
      records,
      online: [MACKIE, SAM],
      themes: ['default'],
      theme: 'default',
      themeCSS: window.__previewCSS || '',
      version: null,
      sound: false,
      wallpapers: window.__previewWalls || { default: { id: 'none' }, rooms: {} }
    }),
    update: later,
    menu: later,
    confirm: async () => false
  }, {
    // Anything else the page asks for: listeners do nothing, actions do nothing.
    get: (t, k) => (k in t ? t[k] : (String(k).startsWith('on') ? noop : later))
  })

  // The Studio sends the theme it's building, and the wallpaper, as you change them.
  window.addEventListener('message', (e) => {
    const m = e.data
    if (!m || m.type !== 'slake-preview') return
    const style = document.getElementById('theme')
    if (style) style.textContent = m.css || ''
    if (window.SlakeWallpapers) window.SlakeWallpapers.paint(document.getElementById('wallLayer'), document.getElementById('wallDim'), m.wallpaper)
  })
})()
