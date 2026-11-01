// Builds Slake for the browser into a folder of plain files:
//   node tools/build-web.js <output folder>
// The real app goes at the top (index.html); the theme preview stays at
// /themes/ for quick looks at themes.
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')
const root = path.join(__dirname, '..')
const out = path.resolve(process.argv[2] || path.join(root, 'dist-web'))
const version = require(path.join(root, 'package.json')).version

;(async () => {
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })

  // The engine + browser stand-ins, as one script.
  await esbuild.build({
    entryPoints: [path.join(root, 'web', 'entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'safari16', 'firefox115'],
    minify: true,
    outfile: path.join(out, 'slake-web.js'),
    alias: {
      fs: path.join(root, 'web', 'shims', 'fs.js'),
      crypto: path.join(root, 'web', 'shims', 'crypto.js'),
      path: require.resolve('path-browserify'),
      hyperswarm: path.join(root, 'web', 'shims', 'no-hyperswarm.js'),
      // Use real Buffers everywhere, like on the desktop (the engine relies on it).
      b4a: path.join(path.dirname(require.resolve('b4a')), 'index.js')
    },
    inject: [path.join(root, 'web', 'shims', 'globals.js')],
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    logLevel: 'warning'
  })

  // The desktop app's hidden bridge page uses the same browser connections.
  await esbuild.build({
    entryPoints: [path.join(root, 'web', 'bridge-page.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    minify: true,
    outfile: path.join(root, 'bridge', 'bridge-bundle.js'),
    alias: { b4a: path.join(path.dirname(require.resolve('b4a')), 'index.js') },
    inject: [path.join(root, 'web', 'shims', 'globals.js')],
    define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
    logLevel: 'warning'
  })

  // The screen: same files as the desktop app.
  for (const f of fs.readdirSync(path.join(root, 'ui'))) {
    fs.copyFileSync(path.join(root, 'ui', f), path.join(out, f))
  }
  // The Theme Studio runs in a frame over the app and talks to it there.
  let studio = fs.readFileSync(path.join(out, 'studio.html'), 'utf8')
  studio = studio.replace("img-src 'self' data: slakewall:", "img-src 'self' data: blob:")
  studio = studio.replace('<head>', '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1">')
  studio = studio.replace('<script src="wallpapers.js"></script>', '<script src="studio-web.js"></script>\n  <script src="wallpapers.js"></script>')
  fs.writeFileSync(path.join(out, 'studio.html'), studio)
  fs.writeFileSync(path.join(out, 'studio-web.js'), `// In a browser the Studio lives in a frame over the app; borrow its doorway.
window.slake = parent.slakeStudio
window.slakeWallUrl = parent.slakeWallUrl
;(() => {
  const folder = document.getElementById('openFolder')
  if (folder) folder.hidden = true
  // A way out of the panel: a Done button, and Esc.
  const done = document.createElement('button')
  done.textContent = 'Done'
  done.className = 'link'
  done.style.cssText = 'position:absolute;top:18px;right:20px;margin:0;font-size:14px;font-weight:600'
  done.onclick = () => window.slake.closeStudio()
  const head = document.querySelector('.top')
  if (head) { head.style.position = 'relative'; head.append(done) }
})()
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.slake.closeStudio() })
`)
  let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  // Browsers need to reach the public meeting relays (wss:) and run the
  // password hash (WebAssembly).
  html = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws:; script-src 'self' 'wasm-unsafe-eval'">`)
  html = html.replace('<head>', `<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#16161d">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Slake">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icon-180.png">
  <link rel="icon" href="icon-192.png">`)
  html = html.replace(/(\s*<script src="wallpapers.js"><\/script>)/, `\n  <script src="version.js"></script>\n  <script src="slake-web.js"></script>$1`)
  fs.writeFileSync(path.join(out, 'index.html'), html)
  fs.writeFileSync(path.join(out, 'version.js'), `window.SLAKE_VERSION = ${JSON.stringify(version)}\n`)

  // Themes, bundled for the app.
  const themes = {}
  for (const f of fs.readdirSync(path.join(root, 'themes')).filter((x) => x.endsWith('.css')).sort()) {
    themes[f.slice(0, -4)] = fs.readFileSync(path.join(root, 'themes', f), 'utf8')
  }
  fs.writeFileSync(path.join(out, 'themes.json'), JSON.stringify(themes))

  // Home-screen icon and app details, and the offline helper.
  const icon = path.join(root, 'build', 'icon.png')
  for (const size of [180, 192, 512]) {
    require('child_process').execFileSync('python3', ['-c', `from PIL import Image; Image.open(${JSON.stringify(icon)}).convert('RGBA').resize((${size},${size}), Image.LANCZOS).save(${JSON.stringify(path.join(out, 'icon-' + size + '.png'))})`])
  }
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
    name: 'Slake',
    short_name: 'Slake',
    description: "Chat that lives on your friends' computers. No server, no bill.",
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: '#16161d',
    theme_color: '#16161d',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }, null, 2))
  fs.writeFileSync(path.join(out, 'sw.js'), `// Keeps a copy of the app's own files so it opens even on a bad connection.
// Always tries the network first, so updates show up right away.
const CACHE = 'slake-${version}'
self.addEventListener('install', (e) => { self.skipWaiting() })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin) return
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((cache) => cache.put(e.request, c)); return r }).catch(() => caches.match(e.request)))
})
`)

  // Theme preview at /themes/
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-web-preview.js'), path.join(out, 'themes')], { stdio: 'ignore' })

  console.log('Slake for the web built in ' + out)
})().catch((e) => { console.error(e); process.exit(1) })
