// The desktop app wrapper: opens the window and hands messages
// back and forth between the engine (core.js) and the screen.
const { app, BrowserWindow, ipcMain, Notification, shell, clipboard } = require('electron')
const path = require('path')
const fs = require('fs')
const { Gossip } = require('./core')

// `npm run second` gives you a separate person on the same computer, for testing.
const profile = (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1]
if (profile) app.setPath('userData', path.join(app.getPath('appData'), 'Gossip-' + profile))

let win
let gossip
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
  const file = path.join(themesDir(), path.basename(name) + '.css')
  try { return fs.readFileSync(file, 'utf8') } catch { return '' }
}

function send (channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function state () {
  return {
    me: gossip.me,
    group: gossip.group ? { name: gossip.group.name } : null,
    invite: gossip.invite,
    messages: [...gossip.messages.values()].sort((a, b) => a.ts - b.ts),
    peers: gossip.peerCount,
    themes: listThemes(),
    theme: readSettings().theme,
    themeCSS: themeCSS(readSettings().theme)
  }
}

app.whenReady().then(async () => {
  seedThemes()
  gossip = new Gossip({ dataDir: path.join(app.getPath('userData'), 'data') })
  await gossip.start()

  gossip.on('peers', (n) => send('peers', n))
  gossip.on('message', (m) => {
    send('message', m)
    if (m.author !== gossip.me.publicKey && win && !win.isFocused() && Notification.isSupported()) {
      new Notification({ title: `${m.name} in #${m.channel}`, body: m.text.slice(0, 200) }).show()
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
  handle('setName', (n) => gossip.setName(n))
  handle('createGroup', (n) => gossip.createGroup(n))
  handle('joinGroup', (inv) => gossip.joinGroup(inv))
  handle('post', ({ channel, text }) => gossip.post(channel, text))
  handle('copyInvite', () => clipboard.writeText(gossip.invite || ''))
  handle('openThemes', () => shell.openPath(themesDir()))
  handle('setTheme', (t) => {
    writeSettings({ ...readSettings(), theme: t })
    return { css: themeCSS(t) }
  })

  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 640,
    minHeight: 420,
    title: profile ? `Gossip (${profile})` : 'Gossip',
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
  if (gossip) await gossip.stop()
  app.quit()
})
