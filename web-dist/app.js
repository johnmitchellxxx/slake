// What you see on screen. Talks to the engine only through window.slake.
const $ = (id) => document.getElementById(id)
const s = window.slake

let me = null
let rooms = []          // [{ id, title, owner, ownerName, mine, removed, online, members }]
let records = {}        // room id -> [record]
let current = null      // open room id
let membersOpen = false
const unread = new Set()
let pending = null      // file chosen but not sent yet: { path, name, size, ttl }
let online = new Set()  // identity keys of people connected right now
let walls = { default: { id: 'none' }, rooms: {} }   // your backgrounds (local only)
let searching = false

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

// ---------- Avatars ----------
// Someone's picture is the newest signed "profile" note they've posted in any
// room you share. With none, it's a color and emoji made from their key.
let avatars = new Map()
let clashes = new Map()   // lowercased name -> Map(author -> first time seen)

// Two different people using the same name in rooms you share.
function rebuildClashes () {
  const seen = new Map()
  for (const list of Object.values(records)) {
    for (const r of list) {
      if (r.kind === 'rekey' || !r.name) continue
      const n = r.name.toLowerCase()
      if (!seen.has(n)) seen.set(n, new Map())
      const m = seen.get(n)
      if (!m.has(r.author) || r.ts < m.get(r.author)) m.set(r.author, r.ts)
    }
  }
  clashes = new Map([...seen].filter(([, m]) => m.size > 1))
}

// If someone else had your name first, ask you to pick another.
function renderClash () {
  const n = me && me.name && clashes.get(me.name.toLowerCase())
  const mine = n && n.get(me.publicKey)
  const firstOther = n && Math.min(...[...n].filter(([k]) => k !== me.publicKey).map(([, t]) => t))
  const show = !!(n && (mine === undefined || firstOther < mine))
  $('clashBanner').hidden = !show
  if (show) $('clashText').textContent = `Someone else was already "${me.name}" in a room you're in. Pick a different name so people can tell you apart.`
}

async function rename (name) {
  name = String(name || '').trim()
  if (!name) return
  try { await s.setName(name); me.name = name; rebuildClashes(); renderAll(); toast(`You're now ${name}`) } catch (e) { toast(e.message) }
}
$('clashBanner').onsubmit = (e) => { e.preventDefault(); rename($('clashInput').value); $('clashInput').value = '' }

function rebuildAvatars () {
  rebuildClashes()
  const latest = new Map()
  for (const list of Object.values(records)) {
    for (const r of list) {
      if (r.kind !== 'profile') continue
      const cur = latest.get(r.author)
      if (!cur || r.ts > cur.ts) latest.set(r.author, r)
    }
  }
  avatars = new Map([...latest].map(([k, r]) => [k, r.avatar]))
  if (me) avatars.set(me.publicKey, me.avatar || null)
}

function avatarEl (key, small) {
  const a = avatars.get(key)
  const node = el('div', 'avatar' + (small ? ' sm' : ''))
  if (a && a.image) {
    const img = el('img')
    img.src = a.image
    img.alt = ''
    node.append(img)
  } else if (a && a.emoji) {
    node.classList.add('emoji')
    node.textContent = a.emoji
  } else {
    const b = badge(key)
    node.style.background = b.color
    node.textContent = [...b.emoji][0]
  }
  if (online.has(key) && key !== (me && me.publicKey)) {
    const dot = el('span', 'on')
    dot.title = 'Online now'
    node.append(dot)
  }
  return node
}

// Most recent name someone used anywhere you can see.
function nameOf (key) {
  let best = null
  for (const list of Object.values(records)) for (const r of list) if (r.author === key && r.kind !== 'rekey' && (!best || r.ts > best.ts)) best = r
  return best ? best.name : 'Someone'
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

// ---------- Lounges ----------
// A lounge's name is its code: type the same name and you land in the same
// room. A link is the site address with the name after a # (spaces become -).
const SITE = s.web ? location.origin + location.pathname : 'https://slake.pantheon.live/'
const loungeLink = (title) => `${SITE}#${encodeURIComponent(title.trim().replace(/\s+/g, '-'))}`

let inviteFromLink = null  // a private-room invite (slake:...) from the link
let loungeFromLink = null  // a lounge name from the link
let loungeMode = null      // null (normal chat) | 'start' | 'ready' | 'join'
let startedLounge = null   // { id, title, link } once you've started one
if (s.web && location.hash.length > 1) {
  let h = ''
  try { h = decodeURIComponent(location.hash.slice(1)) } catch {}
  if (/^slake:/.test(h)) inviteFromLink = h
  else if (h.trim()) loungeFromLink = h.replace(/-/g, ' ').trim().slice(0, 40)
  history.replaceState(null, '', location.pathname + location.search)
  if (inviteFromLink || loungeFromLink) loungeMode = 'join'
}

async function copyText (text) {
  try { await navigator.clipboard.writeText(text); return true } catch {}
  const t = el('textarea')
  t.value = text
  t.style.position = 'fixed'
  t.style.opacity = '0'
  document.body.append(t)
  t.select()
  const ok = document.execCommand('copy')
  t.remove()
  return ok
}

function renderLounge () {
  $('welcome').hidden = true
  $('chat').hidden = true
  $('lounge').hidden = false
  for (const [mode, id] of [['start', 'loungeStart'], ['ready', 'loungeReady'], ['join', 'loungeJoin']]) $(id).hidden = loungeMode !== mode
  $('loungeError').textContent = ''

  if (loungeMode === 'start') {
    if (!$('startName').value && me && me.name) $('startName').value = me.name
    $('startNameRow').hidden = !!(me && me.name)
    $('startForm').hidden = false
    $('createAsk').hidden = true
    $('loungeName').focus()
  }
  if (loungeMode === 'ready') {
    $('loungeTitle').textContent = startedLounge.title
    const msg = `Join my room "${startedLounge.title}" on Slake: ${startedLounge.link}`
    $('shareText').href = `sms:?&body=${encodeURIComponent(msg)}`
    $('shareEmail').href = `mailto:?subject=${encodeURIComponent('Join my room on Slake')}&body=${encodeURIComponent(msg)}`
  }
  if (loungeMode === 'join') {
    const info = loungeFromLink ? { title: loungeFromLink, ownerName: null } : s.readInvite(inviteFromLink)
    if (!info) {
      $('joinSub').textContent = "That link doesn't look right. Ask for it again."
      $('joinNameForm').hidden = true
    } else {
      $('joinNameForm').hidden = false
      $('joinSub').textContent = info.ownerName ? `${info.ownerName} invited you to "${info.title}".` : `You're joining "${info.title}".`
      if (!$('joinName').value) $('joinName').value = (me && me.name) || ''
      $('joinName').focus()
      // Already know your name? Straight in.
      if (me && me.name && !renderLounge.went) { renderLounge.went = true; joinFromLink(me.name) }
    }
  }
}

// Type a lounge name. If someone is there you go straight in; if not, we ask
// "Room does not exist. Create it?" (Yes keeps it, No goes back to the prompt.)
let probing = null  // { id, title } while we wait to see if anyone is there
$('startForm').onsubmit = async (e) => {
  e.preventDefault()
  const title = $('loungeName').value.trim()
  let you = $('startName').value.trim()
  if (me && me.name) you = me.name
  if (!title) return
  if (!you) { $('loungeError').textContent = 'Type your name too'; $('startName').focus(); return }
  $('startGo').disabled = true
  $('startGo').textContent = 'Looking…'
  try {
    if (!me || me.name !== you) await s.setName(you)
    const had = (await s.state()).rooms.some((r) => r.lounge && r.title.toLowerCase() === title.toLowerCase())
    const id = await s.joinLounge(title)
    let there = had
    for (let i = 0; i < 16 && !there; i++) {
      await new Promise((ok) => setTimeout(ok, 500))
      const st = await s.state()
      const r = st.rooms.find((x) => x.id === id)
      there = !!r && (r.onlineKeys.length > 0 || (st.records[id] || []).some((x) => x.kind === 'msg' || x.kind === 'file'))
    }
    if (there) {
      loungeMode = null
      await refresh()
      openRoom(id)
    } else {
      probing = { id, title }
      $('createText').textContent = `Room "${title}" does not exist. Create it?`
      $('startForm').hidden = true
      $('createAsk').hidden = false
    }
  } catch (err) { $('loungeError').textContent = err.message }
  $('startGo').disabled = false
  $('startGo').textContent = 'Go'
}

$('createYes').onclick = () => {
  startedLounge = { id: probing.id, title: probing.title, link: loungeLink(probing.title) }
  probing = null
  loungeMode = 'ready'
  renderLounge()
}
$('createNo').onclick = async () => {
  try { await s.leaveRoom(probing.id) } catch {}
  probing = null
  $('loungeName').value = ''
  loungeMode = 'start'
  renderLounge()
}

$('loungeCopy').onclick = async () => {
  if (await copyText(startedLounge.link)) toast('Link copied. Send it to anyone you want in the room.')
  else toast('Could not copy. Select the link from the address bar.')
}

$('goLounge').onclick = async () => {
  const id = startedLounge.id
  startedLounge = null
  loungeMode = null
  await refresh()
  openRoom(id)
}

async function joinFromLink (you) {
  try {
    if (!me || me.name !== you) await s.setName(you)
    let id
    if (loungeFromLink) id = await s.joinLounge(loungeFromLink)
    else { id = await s.joinRoom(inviteFromLink); toast('Joined. History arrives as soon as someone in the room is online.') }
    inviteFromLink = loungeFromLink = null
    loungeMode = null
    await refresh()
    openRoom(id)
  } catch (err) { renderLounge.went = false; $('loungeError').textContent = err.message }
}
$('joinNameForm').onsubmit = (e) => {
  e.preventDefault()
  const you = $('joinName').value.trim()
  if (you) joinFromLink(you)
}

$('howBtn').onclick = $('howBtn2').onclick = () => { $('howDialog').hidden = false }
$('howClose').onclick = () => { $('howDialog').hidden = true }

// ---------- Welcome (desktop; the web opens on a lounge, above) ----------
// One field: your name. No account, no password.
$('nameForm').onsubmit = async (e) => {
  e.preventDefault()
  const name = $('nameInput').value.trim()
  if (!name) return
  let id = null
  try {
    await s.setName(name)
    const lounge = $('welcomeLounge').value.trim()
    if (lounge) id = await s.joinLounge(lounge)
  } catch (err) { $('welcomeError').textContent = err.message; return }
  await refresh()
  if (id) openRoom(id)
}

// ---------- Sidebar ----------
function roomItem (r) {
  const li = el('li')
  li.append(el('span', null, '# ' + r.title))
  if (r.id === current) li.classList.add('active')
  else if (unread.has(r.id)) { li.classList.add('unread'); li.append(el('span', 'dot')) }
  if (r.removed || r.closedAt) li.classList.add('gone')
  else if (r.online > 0 && r.id !== current && !unread.has(r.id)) li.append(el('span', 'live'))
  li.title = r.closedAt ? `Deleted by ${r.ownerName}` : r.removed ? 'You were removed from this room' : r.online ? `${r.online} online` : 'Nobody else online'
  li.dataset.room = r.id
  li.onclick = () => openRoom(r.id)
  return li
}

function renderSidebar () {
  $('meLine').textContent = ''
  $('meLine').append(avatarEl(me.publicKey, true), el('b', null, me.name))
  renderClash()

  const nav = $('spaces')
  nav.textContent = ''
  const byTitle = (a, b) => a.title.localeCompare(b.title)

  // Lounges first: type a name to join. The name is the code.
  const lounges = el('div', 'space')
  lounges.append(el('div', 'space-name', 'Rooms'))
  const lul = el('ul')
  rooms.filter((r) => r.lounge).sort(byTitle).forEach((r) => lul.append(roomItem(r)))
  lounges.append(lul)
  const lform = el('form', 'new-room')
  const linput = el('input')
  linput.placeholder = '+ join a room'
  linput.maxLength = 40
  linput.autocomplete = 'off'
  lform.append(linput)
  lform.onsubmit = async (e) => {
    e.preventDefault()
    const v = linput.value.trim()
    if (!v) return
    try {
      const id = /^slake:/.test(v) ? await s.joinRoom(v) : await s.joinLounge(v)
      linput.value = ''
      await refresh()
      openRoom(id)
    } catch (err) { toast(err.message) }
  }
  lounges.append(lform)
  nav.append(lounges)

  // Your space: private rooms you own.
  const mine = el('div', 'space')
  mine.append(el('div', 'space-name', 'Your space'))
  const ul = el('ul')
  rooms.filter((r) => r.mine && !r.dm).sort(byTitle).forEach((r) => ul.append(roomItem(r)))
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
  for (const r of rooms.filter((x) => !x.mine && !x.dm && !x.lounge)) {
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

  // Direct messages, below everything else.
  const dms = el('div', 'space')
  dms.append(el('div', 'space-name', 'Direct messages'))
  const dl = el('ul')
  const dmRooms = rooms.filter((r) => r.dm)
  dmRooms.sort((a, b) => (online.has(b.peer) - online.has(a.peer)) || a.title.localeCompare(b.title))
  for (const r of dmRooms) {
    const li = el('li')
    const who = el('span', 'person')
    who.append(avatarEl(r.peer, true), el('span', null, r.title))
    li.append(who)
    if (r.id === current) li.classList.add('active')
    else if (unread.has(r.id)) { li.classList.add('unread'); li.append(el('span', 'dot')) }
    li.title = online.has(r.peer) ? `${r.title} is online` : `${r.title} is offline`
    li.dataset.room = r.id
    li.onclick = () => openRoom(r.id)
    dl.append(li)
  }
  dms.append(dl)
  if (!dmRooms.length) dms.append(el('div', 'hint-line', 'Right-click someone to message them.'))
  nav.append(dms)
}

// ---------- Room ----------
function openRoom (id) {
  if (id !== current) { pending = null; showPending(); membersOpen = false }
  current = id
  unread.delete(id)
  if (!roomById(id)) current = null
  document.body.classList.toggle('in-room', !!current)   // phones: show the room full screen
  renderAll()
  if (current && !phone()) $('text').focus()
}

// Phone-sized screens show either your rooms or one room, with a back arrow.
const phone = () => window.matchMedia('(max-width: 640px)').matches
$('backBtn').onclick = () => { document.body.classList.remove('in-room'); $('avatarPicker').hidden = true }

function renderHeader () {
  const r = roomById(current)
  $('noRoom').hidden = !!r
  $('roomView').hidden = !r
  if (!r) { document.body.classList.remove('in-room'); return }
  $('roomName').textContent = r.title
  document.querySelector('.room-head .hash').hidden = r.dm
  if (r.dm) {
    $('roomSub').textContent = online.has(r.peer) ? 'Direct message · online now' : 'Direct message · offline'
  } else {
    const where = r.lounge ? 'Room' : r.mine ? 'In your space' : `In ${r.ownerName}'s space`
    const names = (r.onlineKeys || []).map(nameOf)
    const who = r.closedAt ? 'deleted' : r.removed ? 'removed'
      : !names.length ? 'nobody else online'
        : names.length <= 3 ? `${names.join(', ')} online`
          : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more online`
    $('roomSub').textContent = `${where} · ${who}`
  }
  const gone = r.removed || !!r.closedAt
  $('removedBanner').hidden = !gone
  $('bannerText').textContent = r.closedAt
    ? `This room was deleted by ${r.ownerName}. It leaves your sidebar ${fmtLeftUntil(r.closedAt + 24 * 3600 * 1000)}.`
    : "You're no longer in this room. You can still read what was said before."
  $('composer').classList.toggle('disabled', gone)
  $('text').placeholder = gone ? '' : r.dm ? `Message ${r.title}` : `Message #${r.title}`
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
    if (online.has(m.key)) li.classList.add('online')
    li.append(avatarEl(m.key, true), el('span', 'who', m.name), el('span', 'badge', badge(m.key).emoji))
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
  const inDM = !!(roomById(current) || {}).dm
  for (const m of list) {
    if (m.kind === 'profile') continue
    if (inDM && (m.kind === 'room' || m.kind === 'join')) continue
    if (fmtDay(m.ts) !== prevDay) {
      box.append(el('div', 'day', fmtDay(m.ts)))
      prevDay = fmtDay(m.ts)
      prev = null
    }
    if (m.kind !== 'msg' && m.kind !== 'file') {
      box.append(el('div', 'note', `${noteText(m)} · ${fmtTime(m.ts)}`))
      prev = null
      continue
    }
    const cont = prev && prev.author === m.author && m.ts - prev.ts < 5 * 60 * 1000
    const row = el('div', 'msg' + (cont ? ' cont' : ''))
    row.dataset.msg = m.id
    row.dataset.mine = String(m.author === me.publicKey)
    row.dataset.kind = m.kind
    row.dataset.person = m.author
    row.dataset.name = m.name
    const b = badge(m.author)
    const av = avatarEl(m.author)
    const meta = el('div', 'meta')
    meta.append(el('span', 'name', m.name))
    // The emoji pair only shows up when two different people share a name.
    if (clashes.has(m.name.toLowerCase())) {
      const bd = el('span', 'badge clash-mark', '⚠️ ' + b.emoji)
      bd.title = 'More than one person uses this name. The emoji pair tells them apart: the same person always has the same pair.'
      meta.append(bd)
    }
    meta.append(el('span', 'time', fmtTime(m.ts)))
    const body = el('div', 'body')
    if (m.kind === 'file') body.append(fileCard(m))
    else fillBody(body, m.text)
    row.append(av, meta, body)
    box.append(row)
    prev = m
  }
  if (!list.some((r) => r.kind === 'msg' || r.kind === 'file')) {
    const r = roomById(current)
    if (r && !r.removed && !r.closedAt) {
      box.append(el('p', 'empty', r.dm
        ? (online.has(r.peer) ? `Say hi to ${r.title}.` : `${r.title} gets this conversation the next time you're both online.`)
        : r.lounge
        ? `Nothing here yet. Anyone who types "${r.title}" joins this room. Right-click it to copy the link.`
        : r.mine
        ? `Nothing in #${r.title} yet. Right-click the room to invite people.`
        : list.length ? 'Nothing here yet. Say something.' : 'Waiting for someone in this room to come online…'))
    }
  }
  const last = list[list.length - 1]
  if (atBottom || (last && last.author === me.publicKey)) box.scrollTop = box.scrollHeight
}

// ---------- Files ----------
function fmtSize (n) {
  if (n < 1024) return n + ' B'
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return (n >= 10 ? n.toFixed(0) : n.toFixed(1)) + ' ' + u[i]
}

function fmtLeft (ms) {
  const m = Math.max(1, Math.round(ms / 60000))
  if (m < 60) return m + (m === 1 ? ' minute' : ' minutes')
  const h = Math.round(m / 60)
  if (h < 48) return h + (h === 1 ? ' hour' : ' hours')
  const d = Math.round(h / 24)
  return d + ' days'
}

const fmtDate = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const expiresAt = (f) => f.ts + f.ttl
const isGone = (f) => Date.now() >= expiresAt(f) || (f.status && f.status.state === 'expired')

function fileCard (f) {
  const card = el('div', 'file')
  card.dataset.file = f.fid
  if (isGone(f)) {
    card.classList.add('gone')
    card.append(el('span', 'file-icon', '📄'), el('span', 'file-name', f.fname),
      el('span', 'file-sub', `Sent ${fmtDate(f.ts)} · disappeared ${fmtDate(expiresAt(f))}`))
    return card
  }
  const st = f.status || { state: 'waiting' }
  const left = `Disappears in ${fmtLeft(expiresAt(f) - Date.now())}`
  let sub = `${fmtSize(f.size)} · ${left}`
  const act = el('span', 'file-act')
  if (st.state === 'ready') {
    const b = el('button', 'secondary', 'Save…')
    b.onclick = async () => { try { if (await s.saveFile(f.fid, f.fname)) toast('Saved') } catch (e) { toast(e.message) } }
    act.append(b)
  } else if (st.state === 'available') {
    const b = el('button', 'secondary', 'Download')
    b.onclick = async () => { try { await s.download(f.room, f.fid) } catch (e) { toast(e.message) } }
    act.append(b)
  } else if (st.state === 'downloading') {
    sub = `${Math.floor((st.progress || 0) * 100)}% of ${fmtSize(f.size)} · ${left}`
  } else {
    sub = `${fmtSize(f.size)} · waiting for someone who has it to come online`
  }
  card.append(el('span', 'file-icon', '📄'), el('span', 'file-name', f.fname), el('span', 'file-sub', sub), act)
  if (st.state === 'downloading') {
    const bar = el('span', 'bar')
    const fill = el('span')
    fill.style.width = Math.floor((st.progress || 0) * 100) + '%'
    bar.append(fill)
    card.append(bar)
  }
  return card
}

function showPending () {
  $('pending').hidden = !pending
  if (!pending) return
  $('pendingName').textContent = pending.name
  $('pendingSize').textContent = fmtSize(pending.size)
  for (const b of $('pending').querySelectorAll('[data-ttl]')) b.classList.toggle('on', Number(b.dataset.ttl) === pending.ttl)
}

function choose (info) {
  if (!info || !current) return
  const r = roomById(current)
  if (!r || r.removed) return
  pending = { ...info, ttl: 24 * 3600 * 1000 }
  showPending()
}

$('attachBtn').onclick = async () => { try { choose(await s.pickFile()) } catch (e) { toast(e.message) } }
for (const b of $('pending').querySelectorAll('[data-ttl]')) {
  b.onclick = () => { pending.ttl = Number(b.dataset.ttl); showPending() }
}
$('pendingCancel').onclick = () => { pending = null; showPending() }
$('pendingSend').onclick = async () => {
  if (!pending || !current) return
  const p = pending
  pending = null
  showPending()
  try { await s.sendFile(current, p.path, p.ttl) } catch (e) { toast(e.message) }
}

// Drag a file anywhere onto the room to send it.
let dragDepth = 0
const roomViewEl = document.querySelector('.room-view')
roomViewEl.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('dropZone').hidden = false } })
roomViewEl.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropZone').hidden = true } })
roomViewEl.addEventListener('dragover', (e) => e.preventDefault())
roomViewEl.addEventListener('drop', async (e) => {
  e.preventDefault()
  dragDepth = 0
  $('dropZone').hidden = true
  const file = e.dataTransfer.files[0]
  if (!file) return
  try { choose(await s.fileInfo(s.pathFor(file))) } catch (err) { toast(err.message) }
})
// Never let a dropped file navigate the window away.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

// Keep countdowns honest without anyone touching anything.
setInterval(() => {
  if (current && !searching && (records[current] || []).some((r) => r.kind === 'file' && !isGone(r))) renderMessages()
}, 30 * 1000)

// ---------- Search (⌘F / Ctrl+F) ----------
function openSearch () {
  if (!current && rooms.length) openRoom(rooms[0].id)
  searching = true
  $('searchBar').hidden = false
  $('searchInput').focus()
  $('searchInput').select()
  renderResults()
}

function closeSearch () {
  searching = false
  $('searchBar').hidden = true
  $('results').hidden = true
  $('messages').hidden = false
}

function highlight (node, text, q) {
  const lower = text.toLowerCase()
  let i = 0
  let j
  while (q && (j = lower.indexOf(q, i)) >= 0) {
    if (j > i) node.append(document.createTextNode(text.slice(i, j)))
    node.append(el('mark', null, text.slice(j, j + q.length)))
    i = j + q.length
  }
  if (i < text.length) node.append(document.createTextNode(text.slice(i)))
}

function renderResults () {
  const q = $('searchInput').value.trim().toLowerCase()
  const box = $('results')
  $('messages').hidden = !!q
  box.hidden = !q
  box.textContent = ''
  if (!q) return
  const hits = []
  for (const [roomId, list] of Object.entries(records)) {
    const r = roomById(roomId)
    if (!r) continue
    for (const m of list) {
      const text = m.kind === 'msg' ? m.text : m.kind === 'file' ? m.fname : null
      if (text && (text.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))) hits.push({ r, m, text })
    }
  }
  hits.sort((a, b) => b.m.ts - a.m.ts)
  if (!hits.length) { box.append(el('p', 'empty', 'Nothing matches that yet.')); return }
  for (const { r, m, text } of hits.slice(0, 200)) {
    const row = el('div', 'result')
    const where = m.kind === 'file'
      ? `#${r.title} · ${m.name} sent a file · ${fmtDate(m.ts)}${isGone(m) ? ' · disappeared' : ''}`
      : `#${r.title} · ${m.name} · ${fmtDate(m.ts)}`
    row.append(el('div', 'result-where', where))
    const t = el('div', 'result-text')
    highlight(t, (m.kind === 'file' ? '📄 ' : '') + text, q)
    row.append(t)
    row.onclick = () => {
      closeSearch()
      openRoom(r.id)
      const target = document.querySelector(`[data-msg="${m.id}"]`)
      if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash') }
    }
    box.append(row)
  }
}

$('searchInput').addEventListener('input', renderResults)
$('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch() })
$('searchClose').onclick = closeSearch
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !$('chat').hidden) { e.preventDefault(); openSearch() }
  if (e.key === 'Escape' && !$('avatarPicker').hidden) $('avatarPicker').hidden = true
  if (e.key === 'Escape' && searching) closeSearch()
  else if (e.key === 'Escape' && membersOpen) closeMembers()
})

// ---------- Wallpaper ----------
// Each room can have its own background; otherwise it uses your default.
function applyWallpaper () {
  const wp = (current && walls.rooms[current]) || walls.default
  window.SlakeWallpapers.paint($('wallLayer'), $('wallDim'), wp)
}
s.onWallpapers((w) => { walls = w; applyWallpaper() })

function renderAll () {
  applyWallpaper()
  renderSidebar()
  renderHeader()
  renderMessages()
}

// ---------- Room actions ----------
// ---------- Right-click menus ----------
// Everything you can do to a room or a person lives here, so the window
// itself stays clean.

s.onClosed(({ title, by }) => { toast(`${by} deleted #${title}`); refresh() })

function fmtLeftUntil (ts) {
  const ms = ts - Date.now()
  if (ms <= 0) return 'soon'
  const h = Math.round(ms / 3600000)
  return h >= 1 ? `in about ${h} hour${h === 1 ? '' : 's'}` : 'within the hour'
}

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
  const ok = await s.confirm({ action: 'Leave', message: `Leave #${r.title}?`, detail: r.lounge ? 'It comes off your sidebar. To come back, type its name again.' : `It comes off your sidebar. To come back you'll need a new invite from ${r.ownerName}.` })
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
  const bg = { id: 'background', label: 'Background…' }
  if (r.removed || r.closedAt) return [{ id: 'dismiss', label: 'Remove from sidebar' }]
  if (r.dm) return [bg, { type: 'separator' }, { id: 'closeDM', label: 'Close conversation' }]
  if (r.lounge) return [{ id: 'link', label: 'Copy link' }, bg, { type: 'separator' }, { id: 'leave', label: 'Leave room…' }]
  if (r.mine) return [{ id: 'invite', label: 'Copy full invite' }, { type: 'separator' }, { id: 'members', label: 'Members…' }, bg, { type: 'separator' }, { id: 'delete', label: 'Delete room…' }]
  return [bg, { type: 'separator' }, { id: 'leave', label: 'Leave room…' }]
}

async function runRoomChoice (r, choice) {
  if (choice === 'invite') await copyInvite(r)
  if (choice === 'background') s.openStudio({ mode: 'room', room: r.id })
  if (choice === 'link') { await copyText(loungeLink(r.title)); toast('Link copied. Anyone who opens it joins this room.') }
  if (choice === 'members') showMembers(r)
  if (choice === 'leave') await leave(r)
  if (choice === 'delete') {
    const ok = await s.confirm({ action: 'Delete', message: `Delete #${r.title}?`, detail: "It disappears for everyone in it, and nobody can post there again. Slake can't erase what people already saved." })
    if (ok) { await s.deleteRoom(r.id); if (current === r.id) current = null; await refresh(); toast(`#${r.title} deleted`) }
  }
  if (choice === 'closeDM') {
    const ok = await s.confirm({ action: 'Close', message: `Close your conversation with ${r.title}?`, detail: 'It comes off your sidebar here. To talk again, right-click them and choose Message.' })
    if (ok) { await s.leaveRoom(r.id); if (current === r.id) current = null; await refresh() }
  }
  if (choice === 'dismiss') { await s.leaveRoom(r.id); if (current === r.id) current = null; await refresh() }
}

document.addEventListener('contextmenu', async (e) => {
  // In a browser, typing boxes keep the browser's own menu.
  if (s.web && e.target.closest('input, textarea')) return
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
    let fileRec = null
    if (msgEl && !selected) {
      const m = (records[current] || []).find((x) => x.id === msgEl.dataset.msg)
      if (m && m.kind === 'msg') items.push({ id: 'copyMsg', label: 'Copy message' })
      if (m && m.kind === 'file') {
        fileRec = m
        const st = m.status || {}
        if (isGone(m)) {
          if (m.author === me.publicKey) items.push({ id: 'sendAgain', label: 'Send it again…' })
          else if (r && !r.removed) items.push({ id: 'askResend', label: `Ask ${m.name} to resend` })
        } else if (st.state === 'ready') items.push({ id: 'saveFile', label: 'Save…' })
        else if (st.state === 'available') items.push({ id: 'download', label: 'Download' })
        items.push({ id: 'copyName', label: 'Copy file name' })
      }
    }
    if (personEl && personEl.dataset.person !== me.publicKey && !(r && r.dm)) {
      if (items.length) items.push({ type: 'separator' })
      items.push({ id: 'dmPerson', label: `Message ${personEl.dataset.name}` })
    }
    let target = null
    if (personEl && r && r.mine && !r.removed && !r.dm) {
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
    if (choice === 'dmPerson') {
      const id = await s.messagePerson(personEl.dataset.person, personEl.dataset.name)
      await refresh()
      openRoom(id)
    }
    if (fileRec) {
      if (choice === 'saveFile' && await s.saveFile(fileRec.fid, fileRec.fname)) toast('Saved')
      if (choice === 'download') await s.download(fileRec.room, fileRec.fid)
      if (choice === 'copyName') { await s.copyText(fileRec.fname); toast('Copied') }
      if (choice === 'askResend') await s.post(fileRec.room, `@${fileRec.name} can you resend ${fileRec.fname}?`)
      if (choice === 'sendAgain') choose(await s.pickFile())
    }
  } catch (err) { toast(err.message) }
})

function closeMembers () { membersOpen = false; renderHeader() }
$('closeMembers').onclick = closeMembers

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
// "default-jade" reads as "Default · Jade", "after-hours" as "After Hours".
function themeLabel (t) {
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  if (t === 'default') return 'Iris'
  return t.split(/[-_]/).map(cap).join(' ')
}

function renderThemes (themes, theme) {
  const sel = $('themeSelect')
  sel.textContent = ''
  for (const t of themes) {
    const o = el('option', null, themeLabel(t))
    o.value = t
    if (t === theme) o.selected = true
    sel.append(o)
  }
  const make = el('option', null, 'Make your own…')
  make.value = '__studio'
  sel.append(make)
  sel.dataset.current = theme
}
$('themesBtn').onclick = () => s.openStudio({ mode: 'theme', edit: $('themeSelect').value })
$('themeSelect').onchange = async (e) => {
  const t = e.target.value
  if (t === '__studio') {
    e.target.value = e.target.dataset.current || 'default'
    s.openStudio({ mode: 'theme' })
    return
  }
  const r = await s.setTheme(t)
  applyTheme(r.css)
  renderThemes(r.themes, t)   // the one you just picked moves to the top
}

// ---------- Your picture ----------
const EMOJI_CHOICES = ['😎', '🦊', '🐙', '🦉', '🐝', '🌵', '🍄', '🔥', '🌊', '🌙', '⚡', '🎧',
  '🎛️', '🎤', '🎬', '🎸', '🚀', '🪐', '🦄', '🐳', '🌻', '🍉', '🍕', '👾']
for (const e of EMOJI_CHOICES) {
  const btn = el('button', null, e)
  btn.type = 'button'
  btn.onclick = () => setAvatar({ emoji: e })
  $('emojiGrid').append(btn)
}

async function setAvatar (a) {
  try {
    await s.setAvatar(a)
    me.avatar = a
    rebuildAvatars()
    $('avatarPicker').hidden = true
    renderAll()
  } catch (e) { toast(e.message) }
}

$('meLine').onclick = () => {
  $('avatarPicker').hidden = !$('avatarPicker').hidden
  $('nameChangeInput').value = me.name
}
$('logoutBtn').onclick = async () => {
  const ok = await s.confirm({ action: 'Erase', message: 'Erase Slake on this device?', detail: "Your rooms, messages and files here are deleted and you start over with a new name. Other people keep what they already have. Themes and settings stay." })
  if (ok) await s.logout()
}
$('nameChange').onsubmit = (e) => { e.preventDefault(); rename($('nameChangeInput').value); $('avatarPicker').hidden = true }
$('pickerClose').onclick = () => { $('avatarPicker').hidden = true }
$('pickPhoto').onclick = async () => {
  try { const img = await s.pickImage(); if (img) await setAvatar({ image: img }) } catch (e) { toast(e.message) }
}
$('pickDefault').onclick = () => setAvatar(null)
$('emojiForm').onsubmit = (e) => {
  e.preventDefault()
  const v = $('emojiInput').value.trim()
  if (v) { $('emojiInput').value = ''; setAvatar({ emoji: v }) }
}

// ---------- Version, tiny, bottom corner ----------
function showVersion (v) {
  if (!v) return
  const when = v.updated ? ' · updated ' + new Date(v.updated).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''
  $('versionLine').textContent = `v${v.version}${when}`
}

// ---------- New version note ----------
function showUpdate (u) {
  const b = $('updateBanner')
  if (!u) { b.hidden = true; return }
  b.textContent = ''
  b.append(el('b', null, `Slake ${u.version} is out. `), document.createTextNode(u.packaged ? 'Get it' : 'Run git pull to update'))
  b.hidden = false
}
$('updateBanner').onclick = () => s.openUpdate()
s.onUpdate(showUpdate)
s.update().then(showUpdate).catch(() => {})

// ---------- Message sound ----------
// A barely-there puff of air, made right here (no sound file): a short burst
// of soft noise, filtered to an airy "fff", that swells in slowly and fades.
// Plays when someone else's message arrives and you're looking at another
// room or another app.
let soundOn = true
let audio = null
let noise = null
let lastChime = 0
function chime () {
  const now = Date.now()
  if (!soundOn || now - lastChime < 1500) return   // a burst of messages = one puff
  lastChime = now
  try {
    audio = audio || new AudioContext()
    if (!noise) {
      noise = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.8), audio.sampleRate)
      const d = noise.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    const t = audio.currentTime
    const src = audio.createBufferSource()
    src.buffer = noise
    const low = audio.createBiquadFilter()      // airy at first, softening as it fades
    low.type = 'lowpass'
    low.Q.value = 0.5
    low.frequency.setValueAtTime(3600, t)
    low.frequency.exponentialRampToValueAtTime(1400, t + 0.5)
    const high = audio.createBiquadFilter()     // no low rumble
    high.type = 'highpass'
    high.Q.value = 0.5
    high.frequency.value = 700
    const g = audio.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.setValueCurveAtTime(new Float32Array([0, 0.004, 0.013, 0.022, 0.025]), t, 0.1)
    g.gain.exponentialRampToValueAtTime(0.0002, t + 0.7)
    src.connect(low)
    low.connect(high)
    high.connect(g)
    g.connect(audio.destination)
    src.start(t)
    src.stop(t + 0.75)
  } catch {}
}
s.onSound((on) => { soundOn = on })

// ---------- Live updates ----------
s.onRecord((r) => {
  if (!records[r.room]) records[r.room] = []
  if (records[r.room].some((x) => x.id === r.id)) return
  records[r.room].push(r)
  records[r.room].sort((a, b) => a.ts - b.ts)
  if (r.kind === 'profile') { rebuildAvatars(); renderAll(); return }
  rebuildClashes()
  if (r.room !== current && (r.kind === 'msg' || r.kind === 'file')) unread.add(r.room)
  const fromOthers = (r.kind === 'msg' || r.kind === 'file') && r.author !== me.publicKey && Date.now() - r.ts < 2 * 60 * 1000
  if (fromOthers && (r.room !== current || !document.hasFocus())) chime()
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
s.onOnline((list) => {
  online = new Set(list)
  renderSidebar()
  renderHeader()
  if (!searching) renderMessages()
})
s.onFileStatus(({ room, fid, status }) => {
  for (const r of records[room] || []) if (r.kind === 'file' && r.fid === fid) r.status = status
  if (room === current && !searching) renderMessages()
})

async function refresh () {
  const st = await s.state()
  me = st.me
  rooms = st.rooms
  records = st.records
  online = new Set(st.online || [])
  walls = st.wallpapers || walls
  soundOn = st.sound !== false
  rebuildAvatars()
  showVersion(st.version)
  applyTheme(st.themeCSS)
  renderThemes(st.themes, st.theme)
  if (s.web && !loungeMode) {
    if (!me.name) loungeMode = 'start'
  }
  if (s.web && loungeMode) { renderLounge(); return }
  if (!me.name) {
    $('welcome').hidden = false
    $('chat').hidden = true
    $('nameInput').focus()
    return
  }
  $('welcome').hidden = true
  $('lounge').hidden = true
  $('chat').hidden = false
  if (current && !roomById(current)) current = null
  if (!current && rooms.length) current = [...rooms].sort((a, b) => (b.mine - a.mine) || a.title.localeCompare(b.title))[0].id
  renderAll()
}

document.documentElement.dataset.platform = /Mac/.test(navigator.platform) ? 'mac' : /Win/.test(navigator.platform) ? 'win' : 'other'
refresh()
