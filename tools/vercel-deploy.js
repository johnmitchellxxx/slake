// Deploy a folder of static files to Vercel and attach a domain, using
// Vercel's web API directly (no Vercel CLI to download).
//   VERCEL_TOKEN=... node tools/vercel-deploy.js <folder> <project> <domain> [team-slug]
const fs = require('fs')
const path = require('path')

const [dir, project, domain, team] = process.argv.slice(2)
const token = process.env.VERCEL_TOKEN
if (!dir || !project || !token) {
  console.error('Usage: VERCEL_TOKEN=... node vercel-deploy.js <folder> <project> <domain> [team-slug]')
  process.exit(1)
}
const q = team ? '?slug=' + encodeURIComponent(team) : ''

async function api (method, url, body) {
  const res = await fetch('https://api.vercel.com' + url + (url.includes('?') ? q.replace('?', '&') : q), {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

function walk (root, rel = '') {
  const out = []
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) out.push(...walk(root, r))
    else if (e.isFile()) out.push({ file: r, data: fs.readFileSync(path.join(root, r)).toString('base64'), encoding: 'base64' })
  }
  return out
}

;(async () => {
  const files = walk(path.resolve(dir))
  console.log('    Uploading ' + files.length + ' files...')
  const dep = await api('POST', '/v13/deployments', {
    name: project,
    target: 'production',
    files,
    projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null, devCommand: null }
  })
  if (!dep.ok) {
    console.error('    Deploy failed (' + dep.status + '): ' + JSON.stringify(dep.data.error || dep.data))
    process.exit(1)
  }
  const id = dep.data.id
  let state = dep.data.readyState
  for (let i = 0; i < 60 && state !== 'READY' && state !== 'ERROR' && state !== 'CANCELED'; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const d = await api('GET', '/v13/deployments/' + id)
    state = d.data.readyState || state
  }
  console.log('    Deployment: ' + state + ' (https://' + dep.data.url + ')')
  if (state !== 'READY') process.exit(1)

  if (domain) {
    const add = await api('POST', '/v10/projects/' + encodeURIComponent(project) + '/domains', { name: domain })
    const code = add.data.error && add.data.error.code
    if (add.ok) console.log('    Added ' + domain + ' to the project.')
    else if (code === 'domain_already_in_use' || code === 'domain_already_exists' || add.status === 409) console.log('    ' + domain + ' is already attached.')
    else console.log('    Could not add ' + domain + ' (' + add.status + '): ' + JSON.stringify(add.data.error || add.data))
    const cfg = await api('GET', '/v6/domains/' + encodeURIComponent(domain) + '/config')
    if (cfg.ok) console.log(cfg.data.misconfigured ? '    DNS not pointing here yet (can take a few minutes after adding the record).' : '    DNS looks good.')
  }
})().catch((e) => { console.error('    ' + e.message); process.exit(1) })
