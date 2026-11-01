// Theme Studio: every control edits `cfg`, and the preview on the right
// repaints with the generated theme. Save writes it into your theme list.
const $ = (id) => document.getElementById(id)
const s = window.slake
const G = window.SlakeStudioGen
const W = window.SlakeWallpapers

let init = null
let cfg = G.clone(G.DEFAULTS)
let wp = { id: 'none', blur: 0, dim: 0.35 }   // the background being edited
let roomUsesDefault = false                     // room mode: room has no background of its own
let baseCSS = ''                                // room mode: your current theme, shown as-is
let slot = null                                 // which font slot the list is choosing for

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
function toast (t) {
  const x = $('toast')
  x.textContent = t
  x.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { x.hidden = true }, 2000)
}

// ---------- Preview ----------
function css () { return init && init.mode === 'room' ? baseCSS : G.generate(cfg) }
function push () {
  const frame = $('preview').contentWindow
  if (frame) frame.postMessage({ type: 'slake-preview', css: css(), wallpaper: wp }, '*')
}
$('preview').addEventListener('load', () => setTimeout(push, 120))

// ---------- Colors ----------
const COLOR_ROLES = [
  ['bg', 'Background'], ['panel', 'Sidebar'], ['panel2', 'Raised'], ['line', 'Lines'],
  ['text', 'Text'], ['muted', 'Faded text'], ['accent', 'Accent']
]
function renderColors () {
  const box = $('colors')
  box.textContent = ''
  for (const [k, label] of COLOR_ROLES) {
    const wrap = el('label', 'color')
    const input = el('input')
    input.type = 'color'
    input.value = cfg.colors[k]
    input.oninput = () => { cfg.colors[k] = input.value; push() }
    wrap.append(input, el('span', null, label))
    box.append(wrap)
  }
}

// ---------- Fonts ----------
// Fonts already on this computer. We check a long list of common Mac and
// Windows fonts and keep the ones that are actually installed.
const CANDIDATES = [
  'Avenir Next', 'Avenir Next Condensed', 'Avenir', 'Futura', 'Gill Sans', 'Helvetica Neue', 'Optima', 'DIN Alternate', 'DIN Condensed',
  'Didot', 'Bodoni 72', 'Baskerville', 'Big Caslon', 'Hoefler Text', 'Iowan Old Style', 'Palatino', 'Charter', 'Georgia', 'Times New Roman',
  'American Typewriter', 'Courier New', 'Menlo', 'Monaco', 'SF Mono', 'Copperplate', 'Rockwell', 'Phosphate', 'Chalkboard SE', 'Marker Felt',
  'Noteworthy', 'Trattatello', 'Herculanum', 'Bradley Hand', 'Snell Roundhand', 'Zapfino', 'Impact', 'Arial Rounded MT Bold', 'Arial Black',
  'Trebuchet MS', 'Verdana', 'Tahoma', 'Skia', 'Kefa', 'Mishafi', 'Cochin', 'Seravek', 'Superclarendon', 'Athelas', 'Charter', 'Sukhumvit Set',
  'Segoe UI', 'Bahnschrift', 'Cascadia Code', 'Consolas', 'Constantia', 'Candara', 'Corbel', 'Cambria', 'Palatino Linotype', 'Sitka Text',
  'Gabriola', 'Ink Free', 'Segoe Print', 'Segoe Script', 'Lucida Console', 'Franklin Gothic Medium', 'Garamond', 'Century Gothic',
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans Pro', 'JetBrains Mono', 'Fira Code', 'IBM Plex Sans', 'IBM Plex Mono'
]
const BUILT_IN_FONTS = [
  ['system-ui', 'System'], ['ui-rounded', 'Rounded'], ['ui-serif', 'Serif'], ['ui-monospace', 'Monospace']
]
function installed (name) {
  const ctx = document.createElement('canvas').getContext('2d')
  const sample = 'mmmmmmmmmmlli WQ 0123'
  return ['monospace', 'serif', 'sans-serif'].some((base) => {
    ctx.font = `40px ${base}`
    const a = ctx.measureText(sample).width
    ctx.font = `40px "${name}", ${base}`
    return ctx.measureText(sample).width !== a
  })
}
let FONTS = []
function loadFonts () {
  const seen = new Set()
  FONTS = BUILT_IN_FONTS.map(([v, label]) => ({ value: v, label }))
  for (const f of CANDIDATES) if (!seen.has(f) && installed(f)) { seen.add(f); FONTS.push({ value: f, label: f }) }
}
const fontCSS = (v) => (/^(system-ui|ui-rounded|ui-serif|ui-monospace)$/.test(v) ? v : `"${v}", system-ui`)
const fontLabel = (v) => (FONTS.find((f) => f.value === v) || { label: v }).label

const SLOTS = [['ui', 'Interface'], ['messages', 'Messages'], ['headings', 'Headings'], ['logo', 'Logo']]
function renderSlots () {
  const box = $('fontSlots')
  box.textContent = ''
  for (const [k, label] of SLOTS) {
    const b = el('button', 'slot' + (slot === k ? ' on' : ''))
    b.type = 'button'
    const name = el('b', null, fontLabel(cfg.fonts[k]))
    name.style.fontFamily = fontCSS(cfg.fonts[k])
    b.append(el('small', null, label), name)
    b.onclick = () => { slot = slot === k ? null : k; renderSlots(); renderFontList() }
    box.append(b)
  }
}
function renderFontList () {
  $('fontPicker').hidden = !slot
  if (!slot) return
  const q = $('fontSearch').value.trim().toLowerCase()
  const list = $('fontList')
  list.textContent = ''
  for (const f of FONTS) {
    if (q && !f.label.toLowerCase().includes(q)) continue
    const li = el('li', f.value === cfg.fonts[slot] ? 'on' : '')
    li.style.fontFamily = fontCSS(f.value)
    li.append(document.createTextNode(f.label === f.value ? 'Slake rooms' : f.label))
    li.append(el('small', null, f.label))
    li.onclick = () => { cfg.fonts[slot] = f.value; renderSlots(); renderFontList(); push() }
    list.append(li)
  }
}
$('fontSearch').oninput = renderFontList

// ---------- Sliders, switches, segments ----------
function bindRange (id, key, fmt = (v) => v) {
  const r = $(id)
  r.value = cfg[key]
  $(id + 'Out').textContent = fmt(cfg[key])
  r.oninput = () => { cfg[key] = Number(r.value); $(id + 'Out').textContent = fmt(cfg[key]); push() }
}
function bindSeg (id, key) {
  for (const b of $(id).querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.v === cfg[key])
    b.onclick = () => { cfg[key] = b.dataset.v; bindSeg(id, key); push() }
  }
}
function bindCheck (id, key) {
  $(id).checked = !!cfg[key]
  $(id).onchange = () => { cfg[key] = $(id).checked; push() }
}

function renderControls () {
  renderColors()
  renderSlots()
  renderFontList()
  bindRange('size', 'size', (v) => v)
  bindRange('radius', 'radius', (v) => v)
  bindRange('glow', 'glow')
  bindRange('grain', 'grain')
  bindRange('shadows', 'shadows')
  bindRange('seeThrough', 'seeThrough')
  bindSeg('spacing', 'spacing')
  bindSeg('pictures', 'pictures')
  bindCheck('logoItalic', 'logoItalic')
  bindCheck('bubbles', 'bubbles')
  bindCheck('cues', 'cues')
}

// ---------- Backgrounds ----------
function renderWalls () {
  const box = $('walls')
  box.textContent = ''
  const choices = [...W.BUILT_IN.map((w) => ({ id: w.id, name: w.name })), ...init.customWalls.map((f, i) => ({ id: 'file:' + f, name: 'Yours ' + (i + 1) }))]
  for (const c of choices) {
    const b = el('button', 'wall-thumb' + (c.id === 'none' ? ' none' : '') + (!roomUsesDefault && wp.id === c.id ? ' on' : ''))
    b.type = 'button'
    if (c.id !== 'none') b.style.background = W.background({ id: c.id })
    b.append(el('span', null, c.name))
    b.onclick = () => { wp = { ...wp, id: c.id }; roomUsesDefault = false; renderWalls(); push() }
    box.append(b)
  }
  const add = el('button', 'wall-thumb add', '+')
  add.type = 'button'
  add.title = 'Use your own picture'
  add.onclick = async () => {
    try {
      const id = await s.pickWallpaper()
      if (!id) return
      const f = id.slice(5)
      if (!init.customWalls.includes(f)) init.customWalls.push(f)
      wp = { ...wp, id }
      roomUsesDefault = false
      renderWalls()
      push()
    } catch (e) { toast(e.message) }
  }
  box.append(add)
  $('blur').value = wp.blur || 0
  $('blurOut').textContent = wp.blur || 0
  $('dim').value = Math.round((wp.dim == null ? 0.35 : wp.dim) * 100)
  $('dimOut').textContent = $('dim').value
}
$('blur').oninput = () => { wp.blur = Number($('blur').value); $('blurOut').textContent = wp.blur; roomUsesDefault = false; push() }
$('dim').oninput = () => { wp.dim = Number($('dim').value) / 100; $('dimOut').textContent = $('dim').value; roomUsesDefault = false; push() }

// ---------- Start from ----------
function label (t) {
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1)
  if (t === 'default') return 'Iris'
  return t.split(/[-_]/).map(cap).join(' ')
}
function loadTheme (name) {
  const t = init.themes.find((x) => x.name === name)
  cfg = G.parse(t ? t.css : '')
  const fromStudio = t && /slake-studio/.test(t.css)
  $('themeName').value = fromStudio ? label(name) : ''
  slot = null
  renderControls()
  push()
}
$('startFrom').onchange = () => loadTheme($('startFrom').value)
$('openFolder').onclick = () => s.openThemes()

// ---------- Save ----------
$('save').onclick = async () => {
  const name = $('themeName').value.trim()
  if (!name) { $('themeName').focus(); toast('Give your theme a name'); return }
  try {
    const slug = await s.saveTheme(name, G.generate(cfg))
    await s.setWallpaper('default', wp)
    init.themes = init.themes.filter((t) => t.name !== slug).concat([{ name: slug, css: G.generate(cfg) }])
    toast(`Saved "${name}". It's on now.`)
  } catch (e) { toast(e.message) }
}
$('useRoom').onclick = async () => {
  await s.setWallpaper(init.room.id, wp)
  toast('Background set for this room')
  setTimeout(() => s.closeStudio(), 700)
}
$('useDefault').onclick = async () => {
  await s.setWallpaper(init.room.id, null)
  toast('This room uses your default again')
  setTimeout(() => s.closeStudio(), 700)
}

// ---------- Start ----------
;(async () => {
  init = await s.studioInit()
  loadFonts()
  const sel = $('startFrom')
  for (const t of init.themes) {
    const o = el('option', null, label(t.name))
    o.value = t.name
    sel.append(o)
  }
  if (init.mode === 'room') {
    for (const x of document.querySelectorAll('[data-theme-only]')) x.hidden = true
    $('themeActions').hidden = true
    $('roomActions').hidden = false
    const where = init.room.dm ? init.room.title : '#' + init.room.title
    $('studioTitle').textContent = `Background for ${where}`
    $('studioSub').textContent = 'Only this room. Your other rooms keep their own backgrounds, or your default.'
    $('wallTitle').textContent = 'Pick a background'
    $('wallHint').textContent = ''
    const own = init.wallpapers.rooms[init.room.id]
    roomUsesDefault = !own
    wp = { ...(own || init.wallpapers.default) }
    const cur = init.themes.find((t) => t.name === init.current)
    baseCSS = cur ? cur.css : ''
  } else {
    $('wallTitle').textContent = 'Default background'
    $('wallHint').textContent = "For every room that doesn't have its own. Rooms with their own background keep it. Saved with your theme."
    wp = { ...init.wallpapers.default }
    sel.value = init.themes.some((t) => t.name === init.current) ? init.current : 'default'
    loadTheme(sel.value)
  }
  renderWalls()
  push()
})()
