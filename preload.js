// The only doorway between the screen and the engine. The page can call
// these few functions and nothing else on your computer.
const { contextBridge, ipcRenderer } = require('electron')

const call = async (name, arg) => {
  const r = await ipcRenderer.invoke(name, arg)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

contextBridge.exposeInMainWorld('slake', {
  state: () => call('state'),
  setName: (n) => call('setName', n),
  createGroup: (n) => call('createGroup', n),
  joinGroup: (inv) => call('joinGroup', inv),
  post: (channel, text) => call('post', { channel, text }),
  copyInvite: () => call('copyInvite'),
  openThemes: () => call('openThemes'),
  setTheme: (t) => call('setTheme', t),
  onMessage: (fn) => ipcRenderer.on('message', (_e, m) => fn(m)),
  onPeers: (fn) => ipcRenderer.on('peers', (_e, n) => fn(n)),
  onTheme: (fn) => ipcRenderer.on('theme', (_e, t) => fn(t))
})
