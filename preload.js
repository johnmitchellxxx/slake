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
  createRoom: (title) => call('createRoom', title),
  joinRoom: (invite) => call('joinRoom', invite),
  post: (room, text) => call('post', { room, text }),
  copyInvite: (room) => call('copyInvite', room),
  removeMember: (room, key) => call('removeMember', { room, key }),
  leaveRoom: (room) => call('leaveRoom', room),
  openThemes: () => call('openThemes'),
  copyText: (t) => call('copyText', t),
  menu: (items) => call('menu', items),
  confirm: (opts) => call('confirm', opts),
  setTheme: (t) => call('setTheme', t),
  onRecord: (fn) => ipcRenderer.on('record', (_e, r) => fn(r)),
  onRooms: (fn) => ipcRenderer.on('rooms', (_e, list) => fn(list)),
  onTheme: (fn) => ipcRenderer.on('theme', (_e, t) => fn(t))
})
