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
    entryPoints: [path.join(root, 'web', 'host.js')],
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

  // The screen: same files as the desktop app.
  for (const f of fs.readdirSync(path.join(root, 'ui'))) {
    if (/^studio/.test(f) || f === 'demo.js') continue
    fs.copyFileSync(path.join(root, 'ui', f), path.join(out, f))
  }
  let html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
  // Browsers need to reach the public meeting relays (wss:) and run the
  // password hash (WebAssembly).
  html = html.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,
    `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws:; script-src 'self' 'wasm-unsafe-eval'">`)
  html = html.replace('<head>', '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1">')
  html = html.replace(/(\s*<script src="wallpapers.js"><\/script>)/, `\n  <script src="version.js"></script>\n  <script src="slake-web.js"></script>$1`)
  fs.writeFileSync(path.join(out, 'index.html'), html)
  fs.writeFileSync(path.join(out, 'version.js'), `window.SLAKE_VERSION = ${JSON.stringify(version)}\n`)

  // Themes, bundled for the app.
  const themes = {}
  for (const f of fs.readdirSync(path.join(root, 'themes')).filter((x) => x.endsWith('.css')).sort()) {
    themes[f.slice(0, -4)] = fs.readFileSync(path.join(root, 'themes', f), 'utf8')
  }
  fs.writeFileSync(path.join(out, 'themes.json'), JSON.stringify(themes))

  // Theme preview at /themes/
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build-web-preview.js'), path.join(out, 'themes')], { stdio: 'ignore' })

  console.log('Slake for the web built in ' + out)
})().catch((e) => { console.error(e); process.exit(1) })
