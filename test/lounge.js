// Two browsers, one lounge: Alice starts it, Bob opens her link, they talk.
// Needs Playwright (npm i -D playwright). Uses a tiny local relay so it runs offline.
// SHOTS=/some/folder saves screenshots.
const { chromium } = require('playwright')
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')

const SITE = path.join(__dirname, '..', 'site')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' }
const server = http.createServer((req, res) => {
  const f = path.join(SITE, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'))
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'text/plain' }); res.end(data)
  })
})
const ok = (cond, what) => { console.log((cond ? 'PASS ' : 'FAIL ') + what); if (!cond) process.exitCode = 1 }

;(async () => {
  const relay = spawn(process.execPath, [path.join(__dirname, 'relay.js'), '7777'], { stdio: 'ignore' })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}/?relays=ws://127.0.0.1:7777`
  const browser = await chromium.launch()
  const phone = { viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] }
  const a = await (await browser.newContext(phone)).newPage()
  const b = await (await browser.newContext(phone)).newPage()
  const errors = []
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message))
  const shot = (p, name) => process.env.SHOTS ? p.screenshot({ path: path.join(process.env.SHOTS, name + '.png') }) : null

  try {
    await a.goto(base)
    await shot(a, '1-start')
    await a.fill('#who', 'Alice')
    await a.click('#startBtn')
    await a.waitForSelector('#chat', { state: 'visible' })
    const title = await a.textContent('#roomName')
    ok(title.length > 0, `Alice's lounge is named "${title}"`)
    await shot(a, '2-alone')
    await a.click('.share button')
    const link = await a.evaluate(() => navigator.clipboard.readText())
    ok(/#[^~]+~[a-z0-9]{10}$/.test(link), `the link is short: ${link.length} characters`)

    await b.goto(link.replace('/#', '/?relays=ws://127.0.0.1:7777#'))
    await shot(b, '3-join')
    ok((await b.textContent('#startSub')).includes(title), 'Bob sees which lounge he is joining')
    await b.fill('#who', 'Bob')
    await b.click('#startBtn')
    await b.waitForSelector('#chat', { state: 'visible' })

    await a.waitForFunction(() => document.getElementById('roomSub').textContent.includes('Bob'), null, { timeout: 30000 })
    ok(true, 'Alice sees Bob arrive')
    await a.fill('#text', 'hello from alice')
    await a.press('#text', 'Enter')
    await b.waitForFunction(() => document.getElementById('messages').textContent.includes('hello from alice'), null, { timeout: 30000 })
    ok(true, 'Bob gets Alice\'s message')
    await b.fill('#text', 'hi alice, https://example.com')
    await b.press('#text', 'Enter')
    await a.waitForFunction(() => document.getElementById('messages').textContent.includes('hi alice'), null, { timeout: 30000 })
    ok(await a.locator('#messages a[href="https://example.com"]').count() === 1, 'web addresses become links')
    await shot(a, '4-talking')

    // Carol arrives late and still gets the history.
    const c = await (await browser.newContext(phone)).newPage()
    await c.goto(link.replace('/#', '/?relays=ws://127.0.0.1:7777#'))
    await c.fill('#who', 'Carol')
    await c.click('#startBtn')
    await c.waitForFunction(() => document.getElementById('messages').textContent.includes('hello from alice'), null, { timeout: 30000 })
    ok(true, 'a latecomer sees what was said before')

    await b.selectOption('#themeSelect', 'orchard')
    ok((await b.getAttribute('#theme', 'href')) === 'themes/orchard.css', 'themes switch')
    await shot(b, '5-orchard')
  } catch (e) { ok(false, e.message) }
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors[0] : ''))
  await browser.close(); relay.kill(); server.close()
})()
