// The desktop app wrapper: opens the window and hands things back and forth
// between the engine (core.js) and the screen.
const { app, BrowserWindow, ipcMain, Notification, shell, clipboard, Menu, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { Slake } = require('./core')

// `npm run second` gives you a separate person on the same computer, for testing.
const profile = (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1]
if (profile) app.setPath('userData', path.join(app.getPath('appData'), 'Slake-' + profile))

let win
let slake
const themesDir = () => path.join(app.getPath('userData'), 'themes')
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function readSettings () {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) } catch { return { theme: 'default' } }
}
function writeSettings (s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)) }

// First run: copy the bundled example themes somewhere friends can edit them.
function seedThemes () {
  fs.mkdirSync(themesDir(), { recursive: true })
  const bundled = path.join(__dirname, 'themes')
  for (const f of fs.readdirSync(bundled)) {
    const dest = path.join(themesDir(), f)
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(bundled, f), dest)
  }
}

function listThemes () {
  return ['default', ...fs.readdirSync(themesDir()).filter((f) => f.endsWith('.css')).map((f) => f.slice(0, -4))]
}

function themeCSS (name) {
  if (!name || name === 'default') return ''
  try { return fs.readFileSync(path.join(themesDir(), path.basename(name) + '.css'), 'utf8') } catch { return '' }
}

function send (channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

// What the screen needs to know about one record.
function present (room, r) {
  const out = { id: r.id, room: r.room, kind: r.kind, author: r.author, name: r.name, ts: r.ts }
  if (r.kind === 'msg') out.text = r.body.text
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

function roomInfo (room) {
  const mine = room.owner === slake.me.publicKey
  return {
    id: room.id,
    title: room.title,
    owner: room.owner,
    ownerName: room.ownerName,
    mine,
    removed: room.removed,
    online: slake.online(room.id),
    members: mine ? slake.members(room.id) : null
  }
}

function rooms () { return [...slake.rooms.values()].map(roomInfo) }

function state () {
  const records = {}
  for (const room of slake.rooms.values()) {
    records[room.id] = [...room.records.values()].sort((a, b) => a.ts - b.ts).map((r) => present(room, r))
  }
  const s = readSettings()
  return { me: slake.me, rooms: rooms(), records, themes: listThemes(), theme: s.theme, themeCSS: themeCSS(s.theme) }
}

app.whenReady().then(async () => {
  seedThemes()
  slake = new Slake({ dataDir: path.join(app.getPath('userData'), 'data') })
  await slake.start()

  slake.on('rooms', () => send('rooms', rooms()))
  slake.on('file', (roomId, fid) => {
    const room = slake.rooms.get(roomId)
    const rec = room && slake._fileRec(room, fid)
    if (rec) send('fileStatus', { room: roomId, fid, status: slake.fileStatus(rec) })
  })
  slake.on('record', (roomId, r) => {
    const room = slake.rooms.get(roomId)
    if (!room) return
    send('record', present(room, r))
    if ((r.kind === 'msg' || r.kind === 'file') && r.author !== slake.me.publicKey && win && !win.isFocused() && Notification.isSupported()) {
      const body = r.kind === 'file' ? `📄 ${r.body.fname}` : r.body.text.slice(0, 200)
      new Notification({ title: `${r.name} in ${room.title}`, body }).show()
    }
  })

  // Live reload: save a theme file and the app repaints instantly.
  fs.watch(themesDir(), () => {
    const s = readSettings()
    send('theme', { themes: listThemes(), theme: s.theme, css: themeCSS(s.theme) })
  })

  const handle = (name, fn) => ipcMain.handle(name, async (_e, arg) => {
    try { return { ok: true, value: await fn(arg) } } catch (err) { return { ok: false, error: err.message } }
  })
  handle('state', () => state())
  handle('setName', (n) => slake.setName(n))
  handle('createRoom', (title) => slake.createRoom(title, { waitForNetwork: false }))
  handle('joinRoom', (inv) => slake.joinRoom(inv, { waitForNetwork: false }))
  handle('post', ({ room, text }) => { slake.post(room, text) })
  handle('copyInvite', (room) => clipboard.writeText(slake.invite(room)))
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
    writeSettings({ ...readSettings(), theme: t })
    return { css: themeCSS(t) }
  })

  win = new BrowserWindow({
    width: 1040,
    height: 700,
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
  // Links in messages open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
})

app.on('window-all-closed', async () => {
  if (slake) await slake.stop()
  app.quit()
})
