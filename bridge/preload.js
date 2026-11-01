// The hidden bridge window's only doorway: pass connection traffic to and
// from the engine. Nothing else.
const { contextBridge, ipcRenderer } = require('electron')
const relays = (process.argv.find((a) => a.startsWith('--slake-relays=')) || '').slice('--slake-relays='.length)
contextBridge.exposeInMainWorld('slakeBridge', {
  post: (m) => ipcRenderer.send('bridge', m),
  onMessage: (fn) => ipcRenderer.on('bridge', (_e, m) => fn(m)),
  relayUrls: relays ? relays.split(',') : undefined
})
