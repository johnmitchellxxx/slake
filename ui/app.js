// What you see on screen. Talks to the engine only through window.gossip.
const $ = (id) => document.getElementById(id)
const g = window.gossip

let state
let current = 'general'
const unread = new Set()
const extraChannels = new Set(['general'])

// Each person gets a stable color + emoji pair made from their key,
// so a fake "Duke" won't match the real one.
const EMOJI = ['🦊', '🐙', '🦉', '🐝', '🦀', '🐸', '🦋', '🐢', '🌵', '🍄', '🌙', '⚡', '🔥', '🌊', '🍋', '🎲',
  '🪐', '🦄', '🐳', '🦔', '🌻', '🍉', '🎧', '🚀', '🧲', '🪩', '🦩', '🐌', '🌶', '🧿', '🎈', '🗝']
function badge (hex) {
  const b = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return {
    emoji: EMOJI[b(0) % 32] + EMOJI[b(1) % 32],
    color: `hsl(${(b(2) * 256 + b(3)) % 360} 55% 42%)`
  }
}

function toast (text) {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { t.hidden = true }, 1800)
}

function applyTheme (css) { $('theme').textContent = css || '' }

// ---------- Welcome flow ----------
function showWelcome () {
  $('welcome').hidden = false
  $('chat').hidden = true
  const named = !!state.me.name
  $('nameForm').hidden = named
  $('groupStep').hidden = !named
  ;(named ? $('groupName') : $('nameInput')).focus()
}

async function guarded (fn) {
  $('welcomeError').textContent = ''
  try { await fn() } catch (e) { $('welcomeError').textContent = e.message }
}

$('nameForm').onsubmit = (e) => {
  e.preventDefault()
  guarded(async () => { await g.setName($('nameInput').value); await refresh() })
}
$('createForm').onsubmit = (e) => {
  e.preventDefault()
  guarded(async () => { await g.createGroup($('groupName').value); await refresh() })
}
$('joinForm').onsubmit = (e) => {
  e.preventDefault()
  guarded(async () => { await g.joinGroup($('inviteInput').value); await refresh() })
}

// ---------- Chat ----------
function channelList () {
  const set = new Set(extraChannels)
  for (const m of state.messages) set.add(m.channel)
  return [...set].sort((a, b) => (a === 'general' ? -1 : b === 'general' ? 1 : a.localeCompare(b)))
}

function renderChannels () {
  const ul = $('channels')
  ul.textContent = ''
  for (const c of channelList()) {
    const li = document.createElement('li')
    li.textContent = '# ' + c
    if (c === current) li.className = 'active'
    else if (unread.has(c)) {
      li.className = 'unread'
      const dot = document.createElement('span')
      dot.className = 'dot'
      li.append(dot)
    }
    li.onclick = () => openChannel(c)
    ul.append(li)
  }
}

function openChannel (c) {
  current = c
  unread.delete(c)
  $('roomName').textContent = c
  renderChannels()
  renderMessages()
  $('text').focus()
}

// Turn plain links into clickable ones without ever injecting raw HTML.
function fillBody (el, text) {
  const parts = text.split(/(https?:\/\/[^\s<]+)/g)
  for (const p of parts) {
    if (/^https?:\/\//.test(p)) {
      const a = document.createElement('a')
      a.href = p
      a.target = '_blank'
      a.textContent = p
      el.append(a)
    } else if (p) el.append(document.createTextNode(p))
  }
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })

function renderMessages () {
  const box = $('messages')
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  box.textContent = ''
  const list = state.messages.filter((m) => m.channel === current)
  if (!list.length) {
    const p = document.createElement('p')
    p.className = 'empty'
    p.textContent = `Nothing in #${current} yet. Start the rumor.`
    box.append(p)
    return
  }
  let prev = null
  for (const m of list) {
    if (!prev || fmtDay(prev.ts) !== fmtDay(m.ts)) {
      const d = document.createElement('div')
      d.className = 'day'
      d.textContent = fmtDay(m.ts)
      box.append(d)
      prev = null
    }
    const cont = prev && prev.author === m.author && m.ts - prev.ts < 5 * 60 * 1000
    const row = document.createElement('div')
    row.className = 'msg' + (cont ? ' cont' : '')
    const b = badge(m.author)

    const av = document.createElement('div')
    av.className = 'avatar'
    av.style.background = b.color
    av.textContent = [...b.emoji][0]

    const meta = document.createElement('div')
    meta.className = 'meta'
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = m.name
    const bd = document.createElement('span')
    bd.className = 'badge'
    bd.title = 'Identity check: the same person always has the same pair'
    bd.textContent = b.emoji
    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = fmtTime(m.ts)
    meta.append(name, bd, time)

    const body = document.createElement('div')
    body.className = 'body'
    fillBody(body, m.text)

    row.append(av, meta, body)
    box.append(row)
    prev = m
  }
  if (atBottom || list[list.length - 1].author === state.me.publicKey) box.scrollTop = box.scrollHeight
}

function renderPeers (n) {
  const el = $('peerStatus')
  el.textContent = n === 0 ? 'Just you right now' : n === 1 ? '1 friend online' : `${n} friends online`
  el.classList.toggle('live', n > 0)
}

function renderThemes (themes, theme) {
  const sel = $('themeSelect')
  sel.textContent = ''
  for (const t of themes) {
    const o = document.createElement('option')
    o.value = t
    o.textContent = t
    if (t === theme) o.selected = true
    sel.append(o)
  }
}

function showChat () {
  $('welcome').hidden = true
  $('chat').hidden = false
  $('groupTitle').textContent = state.group.name
  const b = badge(state.me.publicKey)
  $('meLine').textContent = `${b.emoji} ${state.me.name}`
  renderPeers(state.peers)
  renderThemes(state.themes, state.theme)
  openChannel(current)
}

async function refresh () {
  state = await g.state()
  applyTheme(state.themeCSS)
  if (!state.me.name || !state.group) showWelcome()
  else showChat()
}

// Send on Enter, new line on Shift+Enter.
$('text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit() }
})
$('text').addEventListener('input', (e) => {
  e.target.style.height = 'auto'
  e.target.style.height = e.target.scrollHeight + 'px'
})
$('composer').onsubmit = async (e) => {
  e.preventDefault()
  const t = $('text')
  if (!t.value.trim()) return
  try {
    await g.post(current, t.value)
    t.value = ''
    t.style.height = 'auto'
  } catch (err) { toast(err.message) }
}

$('newChannel').onsubmit = (e) => {
  e.preventDefault()
  const name = $('newChannelInput').value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 32)
  $('newChannelInput').value = ''
  if (!name) return
  extraChannels.add(name)
  openChannel(name)
}

$('inviteBtn').onclick = async () => { await g.copyInvite(); toast('Invite copied. Only share it with people you trust.') }
$('themesBtn').onclick = () => g.openThemes()
$('themeSelect').onchange = async (e) => {
  const r = await g.setTheme(e.target.value)
  applyTheme(r.css)
}

g.onMessage((m) => {
  state.messages.push(m)
  if (m.channel !== current) unread.add(m.channel)
  renderChannels()
  if (m.channel === current) renderMessages()
})
g.onPeers(renderPeers)
g.onTheme(({ themes, theme, css }) => { renderThemes(themes, theme); applyTheme(css) })

refresh()
