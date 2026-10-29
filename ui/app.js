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
  li.dataset.room = r.id
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
    li.dataset.person = m.key
    li.dataset.name = m.name
    li.append(el('span', 'badge', badge(m.key).emoji), el('span', 'who', m.name))
    if (m.owner) li.append(el('span', 'tag', 'owner'))
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
    row.dataset.msg = m.id
    row.dataset.person = m.author
    row.dataset.name = m.name
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
        ? `Nothing in #${r.title} yet. Right-click the room to copy its invite.`
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
// ---------- Right-click menus ----------
// Everything you can do to a room or a person lives here, so the window
// itself stays clean.

async function copyInvite (r) {
  await s.copyInvite(r.id)
  toast('Invite copied. Anyone with it can join, so share it privately.')
}

function showMembers (r) {
  if (current !== r.id) openRoom(r.id)
  membersOpen = true
  renderHeader()
}

async function leave (r) {
  const ok = await s.confirm({ action: 'Leave', message: `Leave #${r.title}?`, detail: `It comes off your sidebar. To come back you'll need a new invite from ${r.ownerName}.` })
  if (!ok) return
  await s.leaveRoom(r.id)
  if (current === r.id) current = null
  await refresh()
}

async function removePerson (r, key, name) {
  const ok = await s.confirm({ action: 'Remove', message: `Remove ${name} from #${r.title}?`, detail: "They keep what they've already seen, but won't get anything new." })
  if (!ok) return
  await s.removeMember(r.id, key)
  toast(`${name} removed`)
}

function roomMenu (r) {
  if (r.removed) return [{ id: 'dismiss', label: 'Remove from sidebar' }]
  if (r.mine) return [{ id: 'invite', label: 'Copy invite' }, { id: 'members', label: 'Members…' }]
  return [{ id: 'leave', label: 'Leave room…' }]
}

async function runRoomChoice (r, choice) {
  if (choice === 'invite') await copyInvite(r)
  if (choice === 'members') showMembers(r)
  if (choice === 'leave') await leave(r)
  if (choice === 'dismiss') { await s.leaveRoom(r.id); if (current === r.id) current = null; await refresh() }
}

document.addEventListener('contextmenu', async (e) => {
  e.preventDefault()
  const t = e.target
  try {
    // Typing boxes get the usual cut / copy / paste.
    if (t.closest('input, textarea')) {
      await s.menu([{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }])
      return
    }

    const items = []
    const selected = String(window.getSelection() || '').trim()
    if (selected) items.push({ role: 'copy' })

    const roomEl = t.closest('[data-room]')
    const inHeader = t.closest('.room-head')
    const room = roomEl ? roomById(roomEl.dataset.room) : inHeader ? roomById(current) : null
    if (room) {
      if (items.length) items.push({ type: 'separator' })
      items.push(...roomMenu(room))
      const choice = await s.menu(items)
      await runRoomChoice(room, choice)
      return
    }

    const msgEl = t.closest('[data-msg]')
    const personEl = t.closest('[data-person]')
    const r = roomById(current)
    if (msgEl && !selected) {
      const m = (records[current] || []).find((x) => x.id === msgEl.dataset.msg)
      if (m) items.push({ id: 'copyMsg', label: 'Copy message' })
    }
    let target = null
    if (personEl && r && r.mine && !r.removed) {
      const key = personEl.dataset.person
      const isMember = (r.members || []).some((x) => x.key === key)
      if (key !== me.publicKey && key !== r.owner && isMember) {
        target = { key, name: personEl.dataset.name }
        if (items.length) items.push({ type: 'separator' })
        items.push({ id: 'remove', label: `Remove ${target.name} from #${r.title}…` })
      }
    }
    if (!items.length) return
    const choice = await s.menu(items)
    if (choice === 'copyMsg') {
      const m = (records[current] || []).find((x) => x.id === msgEl.dataset.msg)
      await s.copyText(m.text)
      toast('Copied')
    }
    if (choice === 'remove' && target) await removePerson(r, target.key, target.name)
  } catch (err) { toast(err.message) }
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
