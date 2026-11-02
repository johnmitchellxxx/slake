// Slake: a lounge is a WebRTC room. Messages live only in the browsers inside it,
// so when everyone leaves, the lounge is gone. Public relays just make the introductions.
import { joinRoom, selfId } from './trystero.js'

const $ = (id) => document.getElementById(id)
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
const mem = { get: (k) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } }
const toast = (t) => { const b = $('toast'); b.textContent = t; b.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { b.hidden = true }, 2200) }
const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n)

// ---------- Themes: each one is a CSS file in themes/ ----------
const THEMES = ['after-hours', 'bubbles', 'harbor', 'indigo-mint', 'marshmallow', 'necklace', 'orchard', 'showfile', 'terminal', 'visionary']
const sel = $('themeSelect')
sel.append(new Option('Iris', ''), ...THEMES.map((t) => new Option(t.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), t)))
function setTheme (t) {
  if (t) $('theme').setAttribute('href', `themes/${t}.css`); else $('theme').removeAttribute('href')
  sel.value = t
  mem.set('slake-theme', t)
}
sel.onchange = () => setTheme(sel.value)
setTheme(THEMES.includes(mem.get('slake-theme')) ? mem.get('slake-theme') : '')

// ---------- Lounge links: https://…/#Cosmic-Meadow~k7f3q9xab2 (the part after ~ is the secret) ----------
const ALPHA = '23456789abcdefghjkmnpqrstvwxyz'
const secret = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHA[b % ALPHA.length]).join('')
const ADJ = ['Quiet', 'Lazy', 'Sunny', 'Cosmic', 'Velvet', 'Mellow', 'Rustic', 'Neon', 'Wild', 'Gentle', 'Amber', 'Foggy', 'Mossy', 'Lucky', 'Pocket']
const NOUN = ['Otter', 'Lantern', 'Harbor', 'Meadow', 'Comet', 'Kettle', 'Orchard', 'Lagoon', 'Parade', 'Garden', 'Cabin', 'Ember', 'Bungalow', 'Tide', 'Canoe']
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const make = (name) => { const slug = clean(name, 40).replace(/[~#%?/\\]/g, '').replace(/\s+/g, '-'); return slug ? { slug, key: secret(), title: slug.replace(/-/g, ' ') } : make(`${pick(ADJ)} ${pick(NOUN)}`) }
function fromHash () {
  try {
    const [slug, key] = decodeURIComponent(location.hash.slice(1)).split('~')
    return slug && key && key.length >= 8 ? { slug, key, title: slug.replace(/-/g, ' ') } : null
  } catch { return null }
}
let lounge = fromHash()
const link = () => `${location.origin}${location.pathname}#${encodeURIComponent(lounge.slug)}~${lounge.key}`

// ---------- The start screen ----------
$('who').value = mem.get('slake-name') || ''
if (lounge) {
  $('startSub').textContent = `You're joining "${lounge.title}".`
  $('loungeName').hidden = $('loungeLabel').hidden = true
  $('startBtn').textContent = 'Join the lounge'
  if ($('who').value) enter($('who').value)
} else {
  $('loungeName').value = `${pick(ADJ)} ${pick(NOUN)}`
}
$('startForm').onsubmit = (e) => {
  e.preventDefault()
  const name = clean($('who').value, 40)
  if (!name) return
  if (!lounge) {
    lounge = make($('loungeName').value)
    history.replaceState(null, '', `#${encodeURIComponent(lounge.slug)}~${lounge.key}`)
  }
  enter(name)
}
$('how').onclick = () => { $('howDialog').hidden = false }
$('howClose').onclick = () => { $('howDialog').hidden = true }

// ---------- Inside the lounge ----------
function enter (me) {
  mem.set('slake-name', me)
  $('start').hidden = true
  $('chat').hidden = false
  $('me').textContent = me
  $('roomName').textContent = lounge.title
  document.title = `${lounge.title} · Slake`

  const people = new Map()   // peer id -> name (everyone here but you)
  const history = []         // messages: shared with anyone who joins later
  const notes = []           // "Bob joined": only you see these
  const seen = new Set()

  // Test hook: ?relays=ws://127.0.0.1:7777 uses a local relay (local addresses only).
  const relays = (new URLSearchParams(location.search).get('relays') || '').split(',').filter((u) => /^ws:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u))
  const room = joinRoom({ appId: 'slake-v2', password: lounge.key, ...(relays.length && { relayUrls: relays }) }, `${lounge.slug}~${lounge.key}`)
  const [sendHi, onHi] = room.makeAction('hi')       // my name, to someone new
  const [sendMsg, onMsg] = room.makeAction('msg')    // a message, to everyone
  const [sendOld, onOld] = room.makeAction('old')    // what was said before you came

  room.onPeerJoin((id) => { sendHi(me, id); if (history.length) sendOld(history, id) })
  room.onPeerLeave((id) => {
    const n = people.get(id)
    if (!people.delete(id)) return
    notes.push({ note: `${n} left`, ts: Date.now() })
    draw()
  })
  onHi((name, id) => {
    name = clean(name, 40)
    if (!name) return
    if (!people.has(id)) notes.push({ note: `${name} joined`, ts: Date.now() })
    people.set(id, name)
    draw()
  })
  onMsg((m, id) => add(m, id))
  onOld((list) => { if (Array.isArray(list)) list.slice(-500).forEach((m) => m && add(m, m.from)) })

  function add (m, from) {
    if (!m || typeof m.id !== 'string' || typeof m.text !== 'string' || seen.has(m.id)) return
    seen.add(m.id)
    history.push({ id: m.id.slice(0, 40), from: clean(from, 40), who: clean(m.who, 40) || '?', text: m.text.slice(0, 4000), ts: Number.isFinite(m.ts) ? m.ts : Date.now() })
    history.sort((a, b) => a.ts - b.ts)
    if (history.length > 500) history.shift()
    draw()
  }

  const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  function fill (box, text) {   // text, with web addresses made clickable
    text.split(/(https?:\/\/[^\s<]+)/).forEach((part, i) => {
      if (i % 2 === 0) { box.append(part); return }
      const a = el('a', null, part)
      a.href = part; a.target = '_blank'; a.rel = 'noopener noreferrer'
      box.append(a)
    })
  }

  function draw () {
    const names = [me + ' (you)', ...people.values()]
    $('people').replaceChildren(...names.map((n, i) => { const li = el('li'); li.append(el('span', null, n)); if (i) li.append(el('span', 'live')); return li }))
    $('roomSub').textContent = people.size ? `${names.length} here: ${[me, ...people.values()].join(', ')}` : 'Just you so far'

    const box = $('messages')
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80
    box.replaceChildren()
    if (!history.length && !people.size) {
      const e = el('div', 'empty')
      e.append(el('p', null, 'Your lounge is open. Send this link to anyone you want in it.'))
      const share = el('div', 'share')
      const text = `Join my lounge "${lounge.title}" on Slake: ${link()}`
      const copyBtn = el('button', null, 'Copy link')
      copyBtn.onclick = copy
      const sms = el('a', null, 'Text it'); sms.href = `sms:?&body=${encodeURIComponent(text)}`
      const mail = el('a', null, 'Email it'); mail.href = `mailto:?subject=${encodeURIComponent('Join my lounge on Slake')}&body=${encodeURIComponent(text)}`
      share.append(copyBtn, sms, mail)
      e.append(share)
      box.append(e)
      return
    }
    let prev = null
    for (const m of [...history, ...notes].sort((a, b) => a.ts - b.ts)) {
      if (m.note) { box.append(el('div', 'note', `${m.note} · ${clock(m.ts)}`)); prev = null; continue }
      const row = el('div', 'msg' + (prev && prev.from === m.from && m.ts - prev.ts < 300000 ? ' cont' : ''))
      const av = el('div', 'avatar', [...m.who][0].toUpperCase())
      av.style.background = `hsl(${hue(m.from)} 55% 42%)`
      const meta = el('div', 'meta')
      meta.append(el('span', 'name', m.who), el('span', 'time', clock(m.ts)))
      const body = el('div', 'body')
      fill(body, m.text)
      row.append(av, meta, body)
      box.append(row)
      prev = m
    }
    if (atBottom || (prev && prev.from === selfId)) box.scrollTop = box.scrollHeight
  }

  async function copy () {
    try { await navigator.clipboard.writeText(link()); toast('Link copied. Send it to anyone you want in the lounge.') } catch { toast('Could not copy. Copy the link from the address bar.') }
  }
  $('invite').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Slake', text: `Join my lounge "${lounge.title}" on Slake:`, url: link() }); return } catch (e) { if (e.name === 'AbortError') return }
    }
    copy()
  }
  $('leave').onclick = () => {
    if (!people.size && history.length && !confirm("You're the last one here. If you leave, the lounge and its messages are gone. Leave?")) return
    room.leave()
    location.href = location.pathname
  }

  const send = () => {
    const text = $('text').value.trim()
    if (!text) return
    $('text').value = ''
    const m = { id: crypto.randomUUID(), who: me, text, ts: Date.now() }
    add(m, selfId)
    sendMsg(m)
  }
  $('composer').onsubmit = (e) => { e.preventDefault(); send() }
  $('text').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() } }

  draw()
  $('text').focus()
}

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {})
