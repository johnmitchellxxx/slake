// Slake's relay helper, a tiny Cloudflare Worker.
//
// When two devices can't connect directly (a phone on a cell network and a
// home computer, say), they fall back to Cloudflare's relay. Cloudflare wants
// a short-lived password for that. This worker hands them out, so the secret
// key never ends up inside the app. It sees no messages or files: the relay
// only carries traffic that's already encrypted between the two devices.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store'
}

export default {
  async fetch (request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'not set up' }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    }
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86400 })
    })
    if (!r.ok) return new Response(JSON.stringify({ error: 'relay said ' + r.status }), { status: 502, headers: { ...CORS, 'content-type': 'application/json' } })
    const data = await r.json()
    // Port 53 is often blocked in browsers; leave it out.
    for (const s of data.iceServers || []) s.urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u))
    return new Response(JSON.stringify(data), { headers: { ...CORS, 'content-type': 'application/json' } })
  }
}
