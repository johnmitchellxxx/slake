// Turns Theme Studio settings into a theme (CSS), and reads a theme back into
// settings. A Studio-made theme carries its settings in its top comment, so
// it opens back up in the Studio exactly as you left it.
;(function () {
  const DEFAULTS = {
    colors: { bg: '#16161d', panel: '#1e1e28', panel2: '#262634', text: '#ece9f2', muted: '#8d8aa0', accent: '#5b9dff', line: '#30303f' },
    fonts: { ui: 'system-ui', messages: 'system-ui', headings: 'system-ui', logo: 'Georgia' },
    logoItalic: true,
    size: 15,
    radius: 10,
    spacing: 'comfortable',      // compact | comfortable | airy
    pictures: 'rounded',         // square | rounded | round
    glow: 0,                     // 0–100
    grain: 0,                    // 0–100
    shadows: 0,                  // 0–100
    seeThrough: 0,               // 0–100
    bubbles: false,
    cues: false
  }

  const clone = (o) => JSON.parse(JSON.stringify(o))
  const q = (f) => (/^(system-ui|ui-rounded|ui-serif|ui-monospace|serif|sans-serif|monospace)$/.test(f) ? f : `"${String(f).replace(/["\\]/g, '')}"`)
  const stack = (f) => `${q(f)}, system-ui, -apple-system, "Segoe UI", sans-serif`

  function hexToRgb (hex) {
    const h = hex.replace('#', '')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }
  function luminance (hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const textOn = (hex) => (luminance(hex) > 0.4 ? '#111111' : '#ffffff')
  const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})` }

  // Any CSS color → #rrggbb (or null).
  function toHex (c) {
    if (!c) return null
    c = String(c).trim()
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase()
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map((x) => x + x).join('').toLowerCase()
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillStyle = c
    const v = ctx.fillStyle
    if (/^#[0-9a-f]{6}$/i.test(v)) return v
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v)
    return m ? '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('') : null
  }

  function generate (cfg) {
    const c = cfg.colors
    const seeA = 1 - (cfg.seeThrough / 100) * 0.85
    const sp = { compact: { gap: 6, pad: '10px 18px', lh: 1.35 }, comfortable: { gap: 14, pad: '16px 22px', lh: 1.45 }, airy: { gap: 24, pad: '24px 34px', lh: 1.6 } }[cfg.spacing] || { gap: 14, pad: '16px 22px', lh: 1.45 }
    const pic = { square: '2px', rounded: '10px', round: '50%' }[cfg.pictures] || '10px'
    const glow = cfg.glow / 100
    const grain = cfg.grain / 100
    const shadow = cfg.shadows / 100
    let css = `/* slake-studio ${JSON.stringify(cfg)} */
/* Made in the Theme Studio. Open it again with Edit next to the theme list. */
:root {
  --bg: ${c.bg};
  --panel: ${c.panel};
  --panel-2: ${c.panel2};
  --text: ${c.text};
  --muted: ${c.muted};
  --accent: ${c.accent};
  --accent-text: ${textOn(c.accent)};
  --line: ${c.line};
  --radius: ${cfg.radius}px;
  --font: ${stack(cfg.fonts.ui)};
  --wordmark: ${stack(cfg.fonts.logo)};
  --msg-size: ${cfg.size}px;
}
body { line-height: ${sp.lh}; }
.body, .composer textarea { font-family: ${stack(cfg.fonts.messages)}; }
.room-title, .no-room h2, .dialog-title, .members-head, .picker-head { font-family: ${stack(cfg.fonts.headings)}; }
.wordmark { font-style: ${cfg.logoItalic ? 'italic' : 'normal'}; }
.messages { padding: ${sp.pad}; }
.msg { margin-top: ${sp.gap}px; }
.avatar, .avatar > img { border-radius: ${pic}; }
`
    if (cfg.seeThrough > 0) {
      css += `.sidebar { background: ${rgba(c.panel, seeA.toFixed(2))}; }
.room-head, .composer, .pending, .search { background: ${rgba(c.bg, (seeA * 0.6).toFixed(2))}; }
.members, .file, .picker { background: ${rgba(c.panel2, seeA.toFixed(2))}; backdrop-filter: blur(14px); }
.sidebar, .room-head, .composer { backdrop-filter: blur(${Math.round(cfg.seeThrough / 5)}px); }
`
    }
    if (glow > 0) {
      css += `.wordmark { color: ${c.accent}; text-shadow: 0 0 ${(4 + 10 * glow).toFixed(0)}px ${rgba(c.accent, (0.4 + 0.5 * glow).toFixed(2))}, 0 0 ${(14 + 26 * glow).toFixed(0)}px ${rgba(c.accent, (0.25 * glow + 0.1).toFixed(2))}; }
.space li.active { box-shadow: 0 0 ${(8 + 18 * glow).toFixed(0)}px ${rgba(c.accent, (0.45 * glow).toFixed(2))}; }
button:not(.ghost):not(.secondary) { box-shadow: 0 0 ${(6 + 16 * glow).toFixed(0)}px ${rgba(c.accent, (0.4 * glow).toFixed(2))}; }
.avatar .on { box-shadow: 0 0 0 2px var(--bg), 0 0 ${(4 + 8 * glow).toFixed(0)}px #3fcf7f; }
`
    }
    if (shadow > 0) {
      css += `.sidebar { box-shadow: ${(4 + 18 * shadow).toFixed(0)}px 0 ${(12 + 40 * shadow).toFixed(0)}px rgba(0, 0, 0, ${(0.15 + 0.35 * shadow).toFixed(2)}); position: relative; z-index: 2; }
.file, .picker, .members, .dialog, .composer textarea { box-shadow: 0 ${(2 + 8 * shadow).toFixed(0)}px ${(8 + 28 * shadow).toFixed(0)}px rgba(0, 0, 0, ${(0.12 + 0.3 * shadow).toFixed(2)}); }
.avatar { box-shadow: 0 ${(1 + 3 * shadow).toFixed(0)}px ${(3 + 8 * shadow).toFixed(0)}px rgba(0, 0, 0, ${(0.2 + 0.3 * shadow).toFixed(2)}); }
`
    }
    if (grain > 0) {
      const noise = "data:image/svg+xml," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>").replace('%2523n', '%23n')
      css += `body::after { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 30; opacity: ${(0.04 + 0.16 * grain).toFixed(3)}; mix-blend-mode: overlay; background: url("${noise}"); }
`
    }
    if (cfg.bubbles) {
      css += `/* Chat bubbles: yours on the right */
.msg .body { justify-self: start; background: var(--panel-2); padding: 8px 14px; border-radius: 18px 18px 18px 6px; max-width: min(560px, 78%); }
.msg .body:has(.file) { background: none; padding: 0; }
.msg[data-mine="true"] { grid-template-columns: 1fr; }
.msg[data-mine="true"] .avatar, .msg[data-mine="true"] .meta { display: none; }
.msg[data-mine="true"] .body, .msg[data-mine="true"].cont .body { grid-column: 1; justify-self: end; background: var(--accent); color: var(--accent-text); border-radius: 18px 18px 6px 18px; }
.msg[data-mine="true"] .body a { color: inherit; }
`
    }
    if (cfg.cues) {
      css += `/* Cue numbers down the left */
.messages { counter-reset: cue; }
.msg { position: relative; padding-left: 52px; }
.msg:not(.cont) { counter-increment: cue; }
.msg:not(.cont)::before { content: "Q" counter(cue); position: absolute; left: 0; top: 2px; width: 44px; font-family: var(--mono); font-size: 12px; color: var(--accent); text-align: right; }
`
    }
    return css
  }

  // Read any theme's CSS back into Studio settings. Studio themes come back
  // exactly; other themes give their colors, fonts and corners.
  function parse (css) {
    const cfg = clone(DEFAULTS)
    if (!css) return cfg
    const m = /\/\* slake-studio (\{.*?\}) \*\//.exec(css)
    if (m) {
      try {
        const saved = JSON.parse(m[1])
        return { ...cfg, ...saved, colors: { ...cfg.colors, ...saved.colors }, fonts: { ...cfg.fonts, ...saved.fonts } }
      } catch {}
    }
    const v = (name) => { const r = new RegExp('--' + name + ':\\s*([^;]+);').exec(css); return r ? r[1].trim() : null }
    const map = { bg: 'bg', panel: 'panel', panel2: 'panel-2', text: 'text', muted: 'muted', accent: 'accent', line: 'line' }
    for (const [k, name] of Object.entries(map)) {
      const hex = toHex(v(name))
      if (hex) cfg.colors[k] = hex
    }
    const first = (s) => s && s.split(',')[0].trim().replace(/^["']|["']$/g, '')
    const font = first(v('font'))
    if (font && !font.startsWith('var(')) { cfg.fonts.ui = font; cfg.fonts.messages = font; cfg.fonts.headings = font }
    const logo = first(v('wordmark'))
    if (logo && !logo.startsWith('var(')) cfg.fonts.logo = logo
    const radius = parseInt(v('radius'), 10)
    if (!isNaN(radius)) cfg.radius = radius
    const size = parseInt(v('msg-size'), 10)
    if (!isNaN(size)) cfg.size = size
    if (/data-mine="true"\]\s*\{\s*grid-template-columns:\s*1fr/.test(css)) cfg.bubbles = true
    if (/counter\(cue\)/.test(css)) cfg.cues = true
    if (/text-shadow/.test(css)) cfg.glow = 40
    if (/\.wordmark\s*\{[^}]*font-style:\s*normal/.test(css)) cfg.logoItalic = false
    return cfg
  }

  window.SlakeStudioGen = { DEFAULTS, generate, parse, clone, toHex }
})()
