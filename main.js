// The desktop app wrapper: opens the window and hands things back and forth
// between the engine (core.js) and the screen.
const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, Menu, dialog, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { Slake } = require('./core')

// `npm run second` gives you a separate person on the same computer, for testing.
const profile = (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1]
if (profile) app.setPath('userData', path.join(app.getPath('appData'), 'Slake-' + profile))
app.setName(profile ? `Slake (${profile})` : 'Slake')

// Only one Slake per person. Opening it again just brings the window back.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', () => showWindow())

let win
let slake
let tray
let quitting = false
let unreadCount = 0
const isMac = process.platform === 'darwin'

// ---------- Menu bar ----------
// Closing the window doesn't quit: Slake tucks into the menu bar (the system
// tray on Windows) so you stay online, keep getting messages, and others can
// still fetch files you've shared.

function showWindow () {
  if (!win) return
  if (isMac && app.dock) app.dock.show()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function hideWindow () {
  if (!win) return
  win.hide()
  if (isMac && app.dock) app.dock.hide()
}

function setUnread (n) {
  unreadCount = n
  if (tray) {
    if (isMac) tray.setTitle(n ? ` ${n}` : '')
    tray.setToolTip(n ? `Slake: ${n} new` : 'Slake')
  }
  if (isMac && app.dock) app.dock.setBadge(n ? String(n) : '')
  buildTrayMenu()
}

function buildTrayMenu () {
  if (!tray) return
  const login = app.getLoginItemSettings().openAtLogin
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: unreadCount ? `Open Slake (${unreadCount} new)` : 'Open Slake', click: showWindow },
    ...(update ? [{ label: `Get Slake ${update.version}…`, click: () => shell.openExternal(update.url) }] : []),
    { type: 'separator' },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: login,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }); buildTrayMenu() }
    },
    { type: 'separator' },
    { label: 'Quit Slake', click: () => { quitting = true; app.quit() } }
  ]))
}

// ---------- Updates ----------
// Every launch (and every 6 hours while Slake sits in the menu bar), ask
// GitHub what the newest release is. If it's newer, show a small note.
const RELEASES = 'https://api.github.com/repos/johnmitchellxxx/slake/releases/latest'
let update = null

function newer (a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true
    if ((pa[i] || 0) < (pb[i] || 0)) return false
  }
  return false
}

async function checkForUpdate () {
  try {
    const res = await fetch(RELEASES, { headers: { 'User-Agent': 'Slake', Accept: 'application/vnd.github+json' } })
    if (!res.ok) return
    const j = await res.json()
    const version = String(j.tag_name || '').replace(/^v/, '')
    const url = String(j.html_url || '')
    if (!/^\d+\.\d+\.\d+$/.test(version) || !url.startsWith('https://github.com/')) return
    if (newer(version, app.getVersion())) {
      update = { version, url, packaged: app.isPackaged }
      send('update', update)
      buildTrayMenu()
    }
  } catch {}
}

function makeTray () {
  const img = isMac
    ? nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'))
    : nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-win.png'))
  if (isMac) img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('Slake')
  buildTrayMenu()
  // Windows: click the tray icon to open. (On a Mac, clicking shows the menu.)
  if (!isMac) tray.on('click', showWindow)
}
const themesDir = () => path.join(app.getPath('userData'), 'themes')
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function readSettings () {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch { return { theme: 'default' } }
}
function writeSettings (s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)) }

// First run: copy the bundled example themes somewhere friends can edit them.
// Themes that shipped in earlier versions and have since been retired, by the
// fingerprint of the exact file we shipped. They're removed from your themes
// folder only if you never edited them.
const RETIRED = {
  'grapevine.css': ['c3d67892dcc1931ece784b8482e0d955ba3c1fd9ddcd10cde9734d4ed8be6798'],
  'velvet.css': ['4bb7ab4608bcbe86a358230924ab0493a22c8a9b5573b72a9a2ddad1ddaa3e66'],
  'screenprint.css': ['d0415deed82e526e087295b77a9b5f607630a93298c800f36864dcb3b206dc4f'],
  'ultraviolet.css': ['d574699df6f734db6c833f70386d5e9941fd1dd855c3eaabff9fa154dd61f895'],
  'glass.css': ['615f459a4f6ce6d53af6d021cbed71393f266eff4d9537f3ded48354666ce261'],
  'swiss.css': ['ef1ba993a6ab14433597af096e507bc15aae4703d1eec5e1d6fd05a21411df6c']
}

const sha = (buf) => require('crypto').createHash('sha256').update(buf).digest('hex')

// Copy the bundled themes into your themes folder. A theme you haven't touched
// gets updated when Slake ships a better version; one you've edited is left alone.
function seedThemes () {
  fs.mkdirSync(themesDir(), { recursive: true })
  const st = readSettings()
  const shipped = st.shippedThemes || {}   // file -> fingerprint of what we last copied in
  const bundled = path.join(__dirname, 'themes')
  const names = new Set(fs.readdirSync(bundled).filter((f) => f.endsWith('.css')))
  for (const f of names) {
    const src = fs.readFileSync(path.join(bundled, f))
    const dest = path.join(themesDir(), f)
    let mine = null
    try { mine = sha(fs.readFileSync(dest)) } catch {}
    if (mine === null || (mine === shipped[f] && mine !== sha(src))) {
      fs.writeFileSync(dest, src)
      shipped[f] = sha(src)
    } else if (!shipped[f] && mine === sha(src)) shipped[f] = mine
  }
  for (const f of fs.readdirSync(themesDir())) {
    if (names.has(f) || !f.endsWith('.css')) continue
    const known = [...(RETIRED[f] || []), shipped[f]].filter(Boolean)
    try {
      if (known.includes(sha(fs.readFileSync(path.join(themesDir(), f))))) {
        fs.unlinkSync(path.join(themesDir(), f))
        delete shipped[f]
      }
    } catch {}
  }
  const current = st.theme && st.theme !== 'default' && !fs.existsSync(path.join(themesDir(), st.theme + '.css')) ? 'default' : st.theme
  writeSettings({ ...st, theme: current || 'default', shippedThemes: shipped })
}

// Themes you've used most recently come first; the rest follow alphabetically.
function listThemes () {
  const all = ['default', ...fs.readdirSync(themesDir()).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4)).sort()]
  const recent = (readSettings().recentThemes || []).filter((t) => all.includes(t))
  return [...recent, ...all.filter((t) => !recent.includes(t))]
}

function themeCSS (name) {
  if (!name || name === 'default') return ''
  try { return fs.readFileSync(path.join(themesDir(), path.basename(name) + '.css'), 'utf8') } catch { return '' }
}

// A theme can ask for a see-through window by including the words
// "slake: glass" anywhere (usually in its top comment). Mac only.
function applyWindowLook (css) {
  if (!win || win.isDestroyed()) return
  const glass = isMac && /slake:\s*glass/i.test(css || '')
  win.setVibrancy(glass ? 'under-window' : null)
  win.setBackgroundColor(glass ? '#00000000' : '#16161d')
}

function send (channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

// What the screen needs to know about one record.
function present (room, r) {
  const out = { id: r.id, room: r.room, kind: r.kind, author: r.author, name: r.name, ts: r.ts }
  if (r.kind === 'msg') out.text = r.body.text
  if (r.kind === 'profile') out.avatar = r.body.avatar
  if (r.kind === 'file') {
    Object.assign(out, { fid: r.body.fid, fname: r.body.fname, size: r.body.size, ttl: r.body.ttl, status: slake.fileStatus(r) })
  }
  if (r.kind === 'room') out.title = r.body.title
  if (r.kind === 'rekey') {
    // Work out who was left out, by name, for the little gray notice.
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

// The name someone most recently used in a room (for DM titles).
function nameIn (room, key) {
  let best = null
  for (const r of room.records.values()) if (r.author === key && r.kind !== 'rekey' && (!best || r.ts > best.ts)) best = r
  return best ? best.name : null
}

function roomInfo (room) {
  const mine = room.owner === slake.me.publicKey
  const dmName = room.dm ? (nameIn(room, room.peer) || (mine ? room.title : room.ownerName)) : null
  return {
    id: room.id,
    title: room.dm ? dmName : room.title,
    dm: !!room.dm,
    peer: room.peer || null,
    onlineKeys: slake.onlineIn(room.id),
    owner: room.owner,
    ownerName: room.ownerName,
    mine,
    removed: room.removed,
    online: slake.online(room.id),
    members: mine && !room.dm ? slake.members(room.id) : null
  }
}

// What version this is, and roughly when it arrived on this computer.
function versionInfo () {
  let when = null
  try {
    const f = app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.join(__dirname, 'core.js')
    when = fs.statSync(f).mtimeMs
  } catch {}
  return { version: app.getVersion(), updated: when }
}

function rooms () { return slake ? [...slake.rooms.values()].map(roomInfo) : [] }

function state () {
  const records = {}
  for (const room of slake.rooms.values()) {
    records[room.id] = [...room.records.values()].sort((a, b) => a.ts - b.ts).map((r) => present(room, r))
  }
  const s = readSettings()
  return { me: slake.me, rooms: rooms(), records, online: [...slake.onlineKeys()], themes: listThemes(), theme: s.theme, themeCSS: themeCSS(s.theme), version: versionInfo() }
}

app.whenReady().then(async () => {
  seedThemes()
  slake = new Slake({ dataDir: path.join(app.getPath('userData'), 'data') })
  await slake.start()

  slake.on('rooms', () => { send('rooms', rooms()); send('online', [...slake.onlineKeys()]) })
  slake.on('dm', (id) => {
    const room = slake.rooms.get(id)
    if (!room) return
    send('rooms', rooms())
    if (win && !(win.isVisible() && win.isFocused()) && Notification.isSupported()) {
      const n = new Notification({ title: 'Slake', body: `${room.ownerName} started a conversation with you` })
      n.on('click', showWindow)
      n.show()
    }
  })
  slake.on('knocked', (roomId, name) => {
    const room = slake.rooms.get(roomId)
    send('knocked', { room: roomId, name, title: room ? room.title : '' })
  })
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
    const fresh = Date.now() - r.ts < 10 * 60 * 1000   // not old history arriving in a batch
    if (fromOthers && fresh && win && !(win.isVisible() && win.isFocused())) {
      setUnread(unreadCount + 1)
      if (Notification.isSupported()) {
        const body = r.kind === 'file' ? `📄 ${r.body.fname}` : r.body.text.slice(0, 200)
        const n = new Notification({ title: `${r.name} in ${room.title}`, body })
        n.on('click', showWindow)
        n.show()
      }
    }
  })

  // Live reload: save a theme file and the app repaints instantly.
  fs.watch(themesDir(), () => {
    const s = readSettings()
    send('theme', { themes: listThemes(), theme: s.theme, css: themeCSS(s.theme) })
    applyWindowLook(themeCSS(s.theme))
  })

  const handle = (name, fn) => ipcMain.handle(name, async (_e, arg) => {
    try { return { ok: true, value: await fn(arg) } } catch (err) { return { ok: false, error: err.message } }
  })
  handle('state', () => state())
  handle('update', () => update)
  handle('openUpdate', () => { if (update) shell.openExternal(update.url) })
  handle('setName', (n) => slake.setName(n))
  handle('setAvatar', (a) => slake.setAvatar(a))
  handle('pickImage', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    // Shrink to a small square here, so it's tiny to send around.
    const img = nativeImage.createFromPath(r.filePaths[0])
    if (img.isEmpty()) throw new Error("Couldn't read that picture")
    const { width, height } = img.getSize()
    const side = Math.min(width, height)
    const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
    return 'data:image/jpeg;base64,' + square.resize({ width: 128, height: 128, quality: 'best' }).toJPEG(82).toString('base64')
  })
  handle('createRoom', (title) => slake.createRoom(title, { waitForNetwork: false }))
  handle('joinRoom', (inv) => slake.joinRoom(inv, { waitForNetwork: false }))
  handle('post', ({ room, text }) => { slake.post(room, text) })
  handle('copyInvite', (room) => clipboard.writeText(slake.invite(room)))
  handle('inviteCode', (room) => slake.inviteCode(room))
  handle('messagePerson', ({ key, name }) => slake.messagePerson(key, name))
  handle('joinWithCode', (code) => slake.joinWithCode(code))
  handle('removeMember', ({ room, key }) => slake.removeMember(room, key))
  handle('leaveRoom', (room) => slake.leaveRoom(room))
  handle('openThemes', () => shell.openPath(themesDir()))
  handle('copyText', (t) => clipboard.writeText(String(t || '')))

  // Files
  handle('pickFile', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'] })
    if (r.canceled || !r.filePaths[0]) return null
    const st = fs.statSync(r.filePaths[0])
    return { path: r.filePaths[0], name: path.basename(r.filePaths[0]), size: st.size }
  })
  handle('fileInfo', (p) => {
    const st = fs.statSync(String(p))
    if (!st.isFile()) throw new Error("That's a folder. Send files one at a time, or zip the folder first.")
    return { path: String(p), name: path.basename(String(p)), size: st.size }
  })
  handle('sendFile', async ({ room, path: p, ttl }) => { await slake.sendFile(room, p, ttl) })
  handle('download', ({ room, fid }) => slake.download(room, fid))
  handle('saveFile', async ({ fid, fname }) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), path.basename(fname)) })
    if (r.canceled || !r.filePath) return false
    await slake.saveFile(fid, r.filePath)
    return true
  })

  // Right-click menus. The page describes the items; we show a real Mac/PC
  // menu and report back which one was picked (or null).
  const ROLES = new Set(['cut', 'copy', 'paste', 'selectAll'])
  handle('menu', (items) => new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    const template = (Array.isArray(items) ? items : []).slice(0, 30).map((i) => {
      if (i.type === 'separator') return { type: 'separator' }
      if (i.role && ROLES.has(i.role)) return { role: i.role }
      return { label: String(i.label || '').slice(0, 80), enabled: i.enabled !== false, click: () => finish(i.id) }
    })
    if (!template.length) return finish(null)
    Menu.buildFromTemplate(template).popup({ window: win, callback: () => setTimeout(() => finish(null), 50) })
  }))

  // "Are you sure?" for anything drastic, as a proper system dialog.
  handle('confirm', async ({ message, detail, action }) => {
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [String(action || 'OK'), 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: String(message || ''),
      detail: detail ? String(detail) : undefined
    })
    return r.response === 0
  })
  handle('setTheme', (t) => {
    const st = readSettings()
    const recentThemes = [t, ...(st.recentThemes || []).filter((x) => x !== t)].slice(0, 50)
    writeSettings({ ...st, theme: t, recentThemes })
    applyWindowLook(themeCSS(t))
    return { css: themeCSS(t), themes: listThemes() }
  })

  win = new BrowserWindow({
    width: 1040,
    height: 700,
    show: !(process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAsHidden),
    icon: path.join(__dirname, 'assets', 'icon-256.png'),
    minWidth: 680,
    minHeight: 440,
    title: profile ? `Slake (${profile})` : 'Slake',
    backgroundColor: '#16161d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.loadFile(path.join(__dirname, 'ui', 'index.html'))
  applyWindowLook(themeCSS(readSettings().theme))
  // Links in messages open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())

  // Closing the window hides it; Slake keeps running in the menu bar.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    hideWindow()
  })
  win.on('focus', () => setUnread(0))
  win.on('show', () => setUnread(0))

  makeTray()
  checkForUpdate()
  setInterval(checkForUpdate, 6 * 60 * 60 * 1000)

  // Build check: `SLAKE_SMOKE=1` starts everything, reports, and quits.
  if (process.env.SLAKE_SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      const ok = await win.webContents.executeJavaScript('typeof window.slake === "object" && !!document.getElementById("chat")')
      if (!slake.me.name) slake.setName('Smoke')
      const id = await slake.createRoom('smoke-test', { waitForNetwork: false })
      console.log(`SLAKE_SMOKE ok=${ok} packaged=${app.isPackaged} room=${id.slice(0, 8)} userData=${app.getPath('userData')}`)
      quitting = true
      app.quit()
    })
  }
  if (isMac && app.dock && !win.isVisible()) app.dock.hide()
  if (isMac && app.dock && !app.isPackaged) app.dock.setIcon(path.join(__dirname, 'assets', 'icon-256.png'))
})

// Clicking the dock icon brings the window back.
app.on('activate', () => showWindow())
app.on('before-quit', () => { quitting = true })
app.on('will-quit', async (e) => {
  if (!slake) return
  e.preventDefault()
  const s = slake
  // Stop listening first, so hanging up connections can't poke a closing window.
  s.removeAllListeners()
  slake = null
  try { await s.stop() } catch {}
  app.exit(0)
})
app.on('window-all-closed', () => { /* stay in the menu bar */ })
