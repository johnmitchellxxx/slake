// What you see on screen. Talks to the engine only through window.slake.
const $ = (id) => document.getElementById(id)
const s = window.slake

let me = null
let rooms = []          // [{ id, title, owner, ownerName, mine, removed, online, members }]
let records = {}        // room id -> [record]
let current = null      // open room id
let membersOpen = false
const unread = new Set()

// Each person gets a stable color + emoji pair made from their key,
// so a fake "Duke" won't match the real one.
const EMOJI = ['🦊', '🐙', '🦉', '🐝', '🦀', '🐸', '🦋', '🐢', '🌵', '🍄', '🌙', '⚡', '🔥', '🌊', '🍋', '🎲',
  '🪐', '🦄', '🐳', '🦔', '🌻', '🍉', '🎧', '🚀', '🧲', '🪩', '🦩', '🐌', '🌶', '🧿', '🎈', '🗝']
function badge (hex) {
  const b = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return { emoji: EMOJI[b(0) % 32] + EMOJI[b(1) % 32], color: `hsl(${(b(2) * 256 + b(3)) % 360} 55% 42%)` }
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

function toast (text) {
  const t = $('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { t.hidden = true }, 2200)
}

// A button that needs two clicks, so nothing drastic happens by accident.
function twoClick (btn, confirmText, action) {
  const original = btn.textContent
  btn.onclick = async () => {
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm')
      btn.textContent = confirmText
      clearTimeout(btn.timer)
      btn.timer = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = original }, 4000)
      return
    }
    clearTimeout(btn.timer)
    btn.classList.remove('confirm')
    btn.textContent = original
    try { await action() } catch (e) { toast(e.message) }
  }
}

function applyTheme (css) { $('theme').textContent = css || '' }
const roomById = (id) => rooms.find((r) => r.id === id)

// ---------- Welcome ----------
$('nameForm').onsubmit = async (e) => {
  e.preventDefault()
  $('welcomeError').textContent = ''
  try { await s.setName($('nameInput').value); await refresh() } catch (err) { $('welcomeError').textContent = err.message }
}

// ---------- Sidebar ----------
function roomItem (r) {
  const li = el('li')
  li.append(el('span', null, '# ' + r.title))
  if (r.id === current) li.classList.add('active')
  else if (unread.has(r.id)) { li.classList.add('unread'); li.append(el('span', 'dot')) }
  if (r.removed) li.classList.add('gone')
  else if (r.online > 0 && r.id !== current && !unread.has(r.id)) li.append(el('span', 'live'))
  li.title = r.removed ? 'You were removed from this room' : r.online ? `${r.online} online` : 'Nobody else online'
  li.onclick = () => openRoom(r.id)
  return li
}

function renderSidebar () {
  const b = badge(me.publicKey)
  $('meLine').textContent = ''
  $('meLine').append(document.createTextNode(b.emoji + ' '), el('b', null, me.name))

  const nav = $('spaces')
  nav.textContent = ''
  const byTitle = (a, b) => a.title.localeCompare(b.title)

  // Your space first, always.
  const mine = el('div', 'space')
  mine.append(el('div', 'space-name', 'Your space'))
  const ul = el('ul')
  rooms.filter((r) => r.mine).sort(byTitle).forEach((r) => ul.append(roomItem(r)))
  mine.append(ul)
  const form = el('form', 'new-room')
  const input = el('input')
  input.placeholder = '+ new room'
  input.maxLength = 40
  input.autocomplete = 'off'
  form.append(input)
  form.onsubmit = async (e) => {
    e.preventDefault()
    const title = input.value.trim()
    if (!title) return
    try {
      const id = await s.createRoom(title)
      input.value = ''
      await refresh()
      openRoom(id)
    } catch (err) { toast(err.message) }
  }
  mine.append(form)
  nav.append(mine)

  // Then everyone else's spaces you've been invited into.
  const owners = new Map()
  for (const r of rooms.filter((x) => !x.mine)) {
    if (!owners.has(r.owner)) owners.set(r.owner, { name: r.ownerName, rooms: [] })
    owners.get(r.owner).rooms.push(r)
  }
  for (const [key, o] of [...owners].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const sp = el('div', 'space')
    const head = el('div', 'space-name')
    head.append(document.createTextNode(`${o.name}'s space `), el('span', 'badge', badge(key).emoji))
    head.title = `Rooms ${o.name} has invited you to`
    sp.append(head)
    const list = el('ul')
    o.rooms.sort(byTitle).forEach((r) => list.append(roomItem(r)))
    sp.append(list)
    nav.append(sp)
  }
}

$('joinForm').onsubmit = async (e) => {
  e.preventDefault()
  const v = $('joinInput').value.trim()
  if (!v) return
  try {
    const id = await s.joinRoom(v)
    $('joinInput').value = ''
    await refresh()
    openRoom(id)
    toast('Joined. History arrives as soon as someone in the room is online.')
  } catch (err) { toast(err.message) }
}

// ---------- Room ----------
function openRoom (id) {
  current = id
  unread.delete(id)
  if (!roomById(id)) current = null
  renderAll()
  if (current) $('text').focus()
}

function renderHeader () {
  const r = roomById(current)
  $('noRoom').hidden = !!r
  $('roomView').hidden = !r
  if (!r) return
  $('roomName').textContent = r.title
  const where = r.mine ? 'In your space' : `In ${r.ownerName}'s space`
  const who = r.removed ? 'removed' : r.online === 0 ? 'nobody else online' : `${r.online} online`
  $('roomSub').textContent = `${where} · ${who}`
  $('inviteBtn').hidden = !r.mine
  $('membersBtn').hidden = !r.mine
  $('leaveBtn').hidden = r.mine || r.removed
  $('removedBanner').hidden = !r.removed
  $('composer').classList.toggle('disabled', r.removed)
  $('text').placeholder = r.removed ? '' : `Message #${r.title}`
  $('membersPanel').hidden = !(membersOpen && r.mine)
  if (membersOpen && r.mine) renderMembers(r)
}

function renderMembers (r) {
  const list = $('memberList')
  list.textContent = ''
  for (const m of r.members || []) {
    const li = el('li')
    li.append(el('span', 'badge', badge(m.key).emoji), el('span', 'who', m.name))
    if (m.owner) li.append(el('span', 'tag', 'owner'))
    else {
      const btn = el('button', 'ghost', 'Remove')
      twoClick(btn, 'Sure?', async () => { await s.removeMember(r.id, m.key); toast(`${m.name} removed`) })
      li.append(btn)
    }
    list.append(li)
  }
}

// Turn plain links into clickable ones without ever injecting raw HTML.
function fillBody (node, text) {
  for (const p of text.split(/(https?:\/\/[^\s<]+)/g)) {
    if (/^https?:\/\//.test(p)) {
      const a = el('a', null, p)
      a.href = p
      a.target = '_blank'
      node.append(a)
    } else if (p) node.append(document.createTextNode(p))
  }
}

const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })

function noteText (rec) {
  if (rec.kind === 'room') return `${rec.name} made this room`
  if (rec.kind === 'join') return `${rec.name} joined`
  if (rec.kind === 'rekey') {
    return rec.removedNames && rec.removedNames.length
      ? `${rec.name} removed ${rec.removedNames.join(', ')}`
      : `${rec.name} changed the room key`
  }
  return ''
}

function renderMessages () {
  const box = $('messages')
  if (!current) return
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
  box.textContent = ''
  const list = records[current] || []
  let prev = null
  let prevDay = null
  for (const m of list) {
    if (fmtDay(m.ts) !== prevDay) {
      box.append(el('div', 'day', fmtDay(m.ts)))
      prevDay = fmtDay(m.ts)
      prev = null
    }
    if (m.kind !== 'msg') {
      box.append(el('div', 'note', `${noteText(m)} · ${fmtTime(m.ts)}`))
      prev = null
      continue
    }
    const cont = prev && prev.author === m.author && m.ts - prev.ts < 5 * 60 * 1000
    const row = el('div', 'msg' + (cont ? ' cont' : ''))
    const b = badge(m.author)
    const av = el('div', 'avatar', [...b.emoji][0])
    av.style.background = b.color
    const meta = el('div', 'meta')
    const bd = el('span', 'badge', b.emoji)
    bd.title = 'Identity check: the same person always has the same pair'
    meta.append(el('span', 'name', m.name), bd, el('span', 'time', fmtTime(m.ts)))
    const body = el('div', 'body')
    fillBody(body, m.text)
    row.append(av, meta, body)
    box.append(row)
    prev = m
  }
  if (!list.some((r) => r.kind === 'msg')) {
    const r = roomById(current)
    if (r && !r.removed) {
      box.append(el('p', 'empty', r.mine
        ? `Nothing in #${r.title} yet. Copy the invite to bring people in.`
        : list.length ? 'Nothing here yet. Say something.' : 'Waiting for someone in this room to come online…'))
    }
  }
  const last = list[list.length - 1]
  if (atBottom || (last && last.author === me.publicKey)) box.scrollTop = box.scrollHeight
}

function renderAll () {
  renderSidebar()
  renderHeader()
  renderMessages()
}

// ---------- Room actions ----------
$('inviteBtn').onclick = async () => {
  try { await s.copyInvite(current); toast('Invite copied. Anyone with it can join this room, so share it privately.') } catch (e) { toast(e.message) }
}
$('membersBtn').onclick = () => { membersOpen = !membersOpen; renderHeader() }
$('closeMembers').onclick = () => { membersOpen = false; renderHeader() }
twoClick($('leaveBtn'), 'Click again to leave', async () => {
  await s.leaveRoom(current)
  current = null
  await refresh()
})
$('dismissBtn').onclick = async () => {
  try { await s.leaveRoom(current); current = null; await refresh() } catch (e) { toast(e.message) }
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
  if (!t.value.trim() || !current) return
  try {
    await s.post(current, t.value)
    t.value = ''
    t.style.height = 'auto'
  } catch (err) { toast(err.message) }
}

// ---------- Themes ----------
function renderThemes (themes, theme) {
  const sel = $('themeSelect')
  sel.textContent = ''
  for (const t of themes) {
    const o = el('option', null, t)
    o.value = t
    if (t === theme) o.selected = true
    sel.append(o)
  }
}
$('themesBtn').onclick = () => s.openThemes()
$('themeSelect').onchange = async (e) => applyTheme((await s.setTheme(e.target.value)).css)

// ---------- Live updates ----------
s.onRecord((r) => {
  if (!records[r.room]) records[r.room] = []
  if (records[r.room].some((x) => x.id === r.id)) return
  records[r.room].push(r)
  records[r.room].sort((a, b) => a.ts - b.ts)
  if (r.room !== current && r.kind === 'msg') unread.add(r.room)
  renderSidebar()
  if (r.room === current) renderMessages()
})
s.onRooms((list) => {
  rooms = list
  if (current && !roomById(current)) current = null
  renderSidebar()
  renderHeader()
})
s.onTheme(({ themes, theme, css }) => { renderThemes(themes, theme); applyTheme(css) })

async function refresh () {
  const st = await s.state()
  me = st.me
  rooms = st.rooms
  records = st.records
  applyTheme(st.themeCSS)
  renderThemes(st.themes, st.theme)
  if (!me.name) {
    $('welcome').hidden = false
    $('chat').hidden = true
    $('nameInput').focus()
    return
  }
  $('welcome').hidden = true
  $('chat').hidden = false
  if (current && !roomById(current)) current = null
  if (!current && rooms.length) current = [...rooms].sort((a, b) => (b.mine - a.mine) || a.title.localeCompare(b.title))[0].id
  renderAll()
}

refresh()
