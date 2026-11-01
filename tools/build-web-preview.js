// Builds a static "theme preview" of Slake that runs in any browser.
// It's the real Slake page with sample chat in it, plus a theme switcher.
//   node tools/build-web-preview.js <output folder>
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const out = path.resolve(process.argv[2] || path.join(root, 'dist-preview'))

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'themes'), { recursive: true })
fs.cpSync(path.join(root, 'ui'), path.join(out, 'ui'), { recursive: true })
const themes = fs.readdirSync(path.join(root, 'themes')).filter((f) => f.endsWith('.css')).sort()
for (const f of themes) fs.copyFileSync(path.join(root, 'themes', f), path.join(out, 'themes', f))
const names = ['default', ...themes.map((f) => f.slice(0, -4))]
const version = require(path.join(root, 'package.json')).version

fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Slake themes</title>
<style>
  html, body { margin: 0; height: 100%; background: #0c0d10; font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #ecebf0; }
  body { display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr); }
  header > b, header > small { flex: none; }
  header { display: flex; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid #24262c; }
  header b { font: italic 700 20px Georgia, serif; color: #5b9dff; }
  header small { color: #8e8d98; }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
  .pills button { flex: none; border: 1px solid #2e3037; background: #1b1c21; color: #cfcdd8; border-radius: 999px; padding: 6px 12px; font: inherit; cursor: pointer; }
  .pills button.on { background: #5b9dff; border-color: #5b9dff; color: #04121f; font-weight: 600; }
  main { padding: 14px; min-height: 0; min-width: 0; }
  iframe { width: 100%; height: 100%; border: 0; border-radius: 12px; background: #16161d; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
</style>
</head>
<body>
<header><b>slake</b><div class="pills" id="pills"></div><small>sample chat · not a real account · v${version}</small></header>
<main><iframe id="app" title="Slake"></iframe></main>
<script>
// pantheon.live/slake (no slash) would break the relative links, so add one.
if (!location.pathname.endsWith('/') && !location.pathname.endsWith('.html')) location.replace(location.pathname + '/' + location.search)
const NAMES = ${JSON.stringify(names)}
const nice = (n) => n === 'default' ? 'Default' : n.replace(/-/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase())
const pills = document.getElementById('pills')
const frame = document.getElementById('app')
let current = new URLSearchParams(location.search).get('theme') || localStorageGet() || 'visionary'
if (!NAMES.includes(current)) current = 'default'
function localStorageGet () { try { return localStorage.getItem('slake-preview-theme') } catch { return null } }
async function show (name) {
  current = name
  try { localStorage.setItem('slake-preview-theme', name) } catch {}
  history.replaceState(null, '', '?theme=' + name)
  for (const b of pills.children) b.classList.toggle('on', b.dataset.n === name)
  const css = name === 'default' ? '' : await (await fetch('themes/' + name + '.css?' + Date.now())).text()
  frame.contentWindow.postMessage({ type: 'slake-preview', css, wallpaper: { id: 'none' } }, '*')
}
for (const n of NAMES) {
  const b = document.createElement('button')
  b.textContent = nice(n); b.dataset.n = n
  b.onclick = () => show(n)
  pills.append(b)
}
frame.onload = () => setTimeout(() => show(current), 150)
frame.src = 'ui/index.html#preview'
</script>
</body>
</html>
`)
console.log('Preview built in ' + out + ' (' + names.length + ' themes)')
