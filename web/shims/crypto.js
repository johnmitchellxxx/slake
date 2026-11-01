// The few pieces of Node's crypto the engine uses, for the browser.
const { Buffer } = require('buffer')
const { sha256 } = require('@noble/hashes/sha2')
const { hmac } = require('@noble/hashes/hmac')

const toBytes = (d) => (typeof d === 'string' ? Buffer.from(d) : d)
const out = (b, enc) => (enc ? Buffer.from(b).toString(enc) : Buffer.from(b))

function createHash (alg) {
  if (alg !== 'sha256') throw new Error('Only sha256 in the browser')
  const h = sha256.create()
  const api = { update (d) { h.update(toBytes(d)); return api }, digest: (enc) => out(h.digest(), enc) }
  return api
}

function createHmac (alg, key) {
  if (alg !== 'sha256') throw new Error('Only sha256 in the browser')
  const h = hmac.create(sha256, toBytes(key))
  const api = { update (d) { h.update(toBytes(d)); return api }, digest: (enc) => out(h.digest(), enc) }
  return api
}

function timingSafeEqual (a, b) {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length')
  let x = 0
  for (let i = 0; i < a.length; i++) x |= a[i] ^ b[i]
  return x === 0
}

function randomBytes (n) {
  const b = Buffer.alloc(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

module.exports = { createHash, createHmac, timingSafeEqual, randomBytes }
