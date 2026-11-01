// Built-in wallpapers, all drawn in code (no image files), plus support for
// your own pictures. Used by the main window and the Theme Studio.
//
// A wallpaper setting looks like:
//   { id: 'swirl', blur: 0, dim: 0.35 }        a built-in one
//   { id: 'file:abc123.jpg', blur: 8, dim: 0.5 } one of your own pictures
//   { id: 'none' }                              no wallpaper
;(function () {
  const svg = (w, h, body) => 'url("data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`) + '")'

  // Vague mechanics: faint dials, tick rings and gear-ish outlines.
  function dials () {
    let b = ''
    const rings = [[260, 300, 210], [940, 220, 150], [700, 640, 250], [120, 760, 120]]
    for (const [cx, cy, r] of rings) {
      for (let k = 0; k < 4; k++) b += `<circle cx="${cx}" cy="${cy}" r="${r - k * r * 0.22}" fill="none" stroke="#9fb4d8" stroke-opacity="${0.16 - k * 0.025}" stroke-width="${k === 0 ? 1.4 : 1}"/>`
      for (let a = 0; a < 360; a += 6) {
        const rad = (a * Math.PI) / 180
        const long = a % 30 === 0
        const r1 = r * (long ? 0.86 : 0.92)
        b += `<line x1="${(cx + Math.cos(rad) * r1).toFixed(1)}" y1="${(cy + Math.sin(rad) * r1).toFixed(1)}" x2="${(cx + Math.cos(rad) * r).toFixed(1)}" y2="${(cy + Math.sin(rad) * r).toFixed(1)}" stroke="#9fb4d8" stroke-opacity="${long ? 0.2 : 0.1}"/>`
      }
      b += `<line x1="${cx}" y1="${cy}" x2="${(cx + r * 0.6).toFixed(1)}" y2="${(cy - r * 0.35).toFixed(1)}" stroke="#c9d6ee" stroke-opacity="0.14" stroke-width="1.5"/>`
    }
    return svg(1200, 900, `<rect width="1200" height="900" fill="#151a22"/>${b}`) + ' center / cover no-repeat'
  }

  // Lake contours: wobbly rings, like a depth map of a lake.
  function topo () {
    let b = ''
    for (let k = 1; k <= 16; k++) {
      let d = ''
      const base = k * 34
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2
        const wob = 1 + 0.12 * Math.sin(3 * t + k * 0.6) + 0.06 * Math.sin(7 * t - k)
        const x = 600 + Math.cos(t) * base * 1.45 * wob
        const y = 470 + Math.sin(t) * base * wob
        d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)
      }
      b += `<path d="${d}Z" fill="none" stroke="#8fd3c8" stroke-opacity="${(0.2 - k * 0.008).toFixed(3)}"/>`
    }
    return svg(1200, 900, `<rect width="1200" height="900" fill="#0f1f24"/>${b}`) + ' center / cover no-repeat'
  }

  const BUILT_IN = [
    { id: 'none', name: 'None', css: 'none' },
    {
      id: 'swirl',
      name: 'Glass swirl',
      css: 'radial-gradient(60% 55% at 18% 22%, #7c9cff 0%, transparent 62%), radial-gradient(55% 60% at 82% 28%, #ff8fb1 0%, transparent 60%), radial-gradient(70% 60% at 55% 88%, #4fe0c4 0%, transparent 62%), radial-gradient(40% 40% at 60% 45%, #b69cff 0%, transparent 70%), linear-gradient(160deg, #1d2142, #0e1124)'
    },
    {
      id: 'aurora',
      name: 'Aurora',
      css: 'radial-gradient(80% 40% at 30% 0%, rgba(80, 255, 190, 0.55), transparent 70%), radial-gradient(70% 45% at 75% 10%, rgba(90, 160, 255, 0.5), transparent 70%), radial-gradient(60% 50% at 50% 100%, rgba(170, 90, 255, 0.35), transparent 70%), linear-gradient(180deg, #071726, #04080f)'
    },
    {
      id: 'dusk',
      name: 'Dusk',
      css: 'radial-gradient(90% 60% at 50% 110%, rgba(255, 150, 110, 0.55), transparent 70%), linear-gradient(180deg, #1a1033 0%, #3a1d4a 55%, #6b3150 100%)'
    },
    {
      id: 'blueprint',
      name: 'Blueprint',
      css: 'repeating-linear-gradient(0deg, rgba(160, 200, 255, 0.07) 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, rgba(160, 200, 255, 0.07) 0 1px, transparent 1px 24px), repeating-linear-gradient(0deg, rgba(160, 200, 255, 0.12) 0 1px, transparent 1px 120px), repeating-linear-gradient(90deg, rgba(160, 200, 255, 0.12) 0 1px, transparent 1px 120px), radial-gradient(120% 90% at 50% 40%, #173a6b, #0b1d38)'
    },
    { id: 'dials', name: 'Dials', css: null, make: dials },
    { id: 'topo', name: 'Lake contours', css: null, make: topo }
  ]
  for (const w of BUILT_IN) if (w.make) { w.css = w.make(); delete w.make }

  // CSS `background` for a wallpaper setting.
  function background (wp) {
    if (!wp || !wp.id || wp.id === 'none') return 'none'
    if (wp.id.startsWith('file:')) {
      const name = wp.id.slice(5).replace(/[^A-Za-z0-9._-]/g, '')
      // In a browser, pictures live in the page's storage, not on disk.
      let web = null
      try { web = window.slakeWallUrl || (parent && parent.slakeWallUrl) || (parent && parent.parent && parent.parent.slakeWallUrl) } catch {}
      if (web) { const u = web(name); return u ? `url("${u}") center / cover no-repeat` : 'none' }
      return `url("slakewall://w/${name}") center / cover no-repeat`
    }
    const w = BUILT_IN.find((x) => x.id === wp.id)
    return w ? w.css : 'none'
  }

  // Paint a wallpaper into the given layer + dim elements.
  function paint (layer, dimEl, wp) {
    const bg = background(wp)
    layer.style.background = bg
    layer.hidden = bg === 'none'
    dimEl.hidden = bg === 'none'
    const blur = Math.max(0, Math.min(40, Number(wp && wp.blur) || 0))
    layer.style.filter = blur ? `blur(${blur}px)` : ''
    layer.style.transform = blur ? 'scale(1.06)' : ''
    dimEl.style.opacity = String(Math.max(0, Math.min(0.9, wp && wp.dim != null ? Number(wp.dim) : 0.35)))
  }

  window.SlakeWallpapers = { BUILT_IN, background, paint }
})()
