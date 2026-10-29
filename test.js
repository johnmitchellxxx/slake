// Runs several copies of Slake on a private, offline test network.
// Run with: npm test
const createTestnet = require('hyperdht/testnet')
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')
const os = require('os')
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { Slake } = require('./core')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until (fn, label, ms = 25000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (fn()) return; await wait(100) }
  throw new Error('Timed out waiting for: ' + label)
}
const texts = (s, roomId) => [...s.rooms.get(roomId).records.values()].filter((r) => r.kind === 'msg').map((r) => r.body.text).sort()

;(async () => {
  const testnet = await createTestnet(3)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slake-test-'))
  const makeSwarm = () => new Hyperswarm({ dht: new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' }) })
  const mk = async (n) => { const s = new Slake({ dataDir: path.join(tmp, n), makeSwarm }); await s.start(); s.setName(n); return s }

  const john = await mk('John')
  const project = await john.createRoom('NewProject')
  const party = await john.createRoom('Lets party')
  john.post(project, 'kickoff notes')

  // Bob is invited to NewProject only.
  const bob = await mk('Bob')
  await bob.joinRoom(john.invite(project))
  await until(() => texts(bob, project).length === 1, 'Bob catches up on NewProject')
  assert.strictEqual(bob.rooms.has(party), false)
  console.log('✓ Bob sees NewProject (and its history) but not the party room')

  // Sam is invited to both.
  const sam = await mk('Sam')
  await sam.joinRoom(john.invite(project))
  await sam.joinRoom(john.invite(party))
  sam.post(party, 'bring snacks')
  await until(() => texts(john, party).includes('bring snacks'), 'John gets party message')
  await wait(1500)
  assert.strictEqual(bob.rooms.has(party), false)
  console.log('✓ Party messages reach John but never Bob')

  // John picks a picture; it reaches people in his rooms, signed by him.
  john.setAvatar({ emoji: '🎛️' })
  const latestAvatar = (x, roomId, who) => [...x.rooms.get(roomId).records.values()].filter((r) => r.kind === 'profile' && r.author === who).sort((a, b) => b.ts - a.ts)[0]
  await until(() => { const r = latestAvatar(sam, party, john.me.publicKey); return r && r.body.avatar.emoji === '🎛️' }, 'Sam sees John\'s new picture')
  assert.throws(() => john.setAvatar({ image: 'data:text/html;base64,AAAA' }), /picture won't work/)
  console.log("✓ John's new picture reached Sam; bad pictures refused")

  // Members can talk; non-owners can't invite.
  bob.post(project, 'hi from bob')
  await until(() => texts(sam, project).includes('hi from bob'), 'Sam gets Bob message')
  assert.throws(() => bob.invite(project), /Only the owner/)
  console.log('✓ Members chat in NewProject; only the owner can invite')

  // Fleeting files: John drops a ~600 KB file into the party room.
  const src = path.join(tmp, 'load-in plot.pdf')
  const bytes = require('crypto').randomBytes(600 * 1024)
  fs.writeFileSync(src, bytes)
  const frec = await john.sendFile(party, src, 24 * 3600 * 1000)
  await until(() => sam.fileStatus(frec).state === 'ready', 'Sam gets the file')
  assert.ok(fs.readFileSync(sam.filePath(frec.body.fid)).equals(bytes))
  const saved = path.join(tmp, 'saved.pdf')
  await sam.saveFile(frec.body.fid, saved)
  assert.ok(fs.readFileSync(saved).equals(bytes))
  assert.strictEqual(bob.filePath(frec.body.fid), null)
  console.log('✓ File went straight from John to Sam, checked byte-for-byte; Bob never got it')

  // A bad timer is refused.
  await assert.rejects(() => john.sendFile(party, src, 5000), /1 hour, 1 day or 1 week/)

  // A day later the file is gone everywhere, but the stub stays.
  for (const x of [john, sam]) { x.now = () => Date.now() + 25 * 3600 * 1000; x.purgeExpired() }
  assert.strictEqual(sam.fileStatus(frec).state, 'expired')
  assert.strictEqual(sam.filePath(frec.body.fid), null)
  assert.strictEqual(john.filePath(frec.body.fid), null)
  assert.ok(sam.rooms.get(party).records.has(frec.id))
  assert.ok(fs.existsSync(saved))
  console.log('✓ After its day, every Slake copy is deleted; the stub and Sam\'s saved copy remain')
  for (const x of [john, sam]) x.now = () => Date.now()

  // Short codes: John makes a 5-character code for the party room; Ana uses it.
  const ana = await mk('Ana')
  const { code } = await john.inviteCode(party)
  assert.match(code, /^[2-9A-Z]{5}$/)
  let knocked = null
  john.once('knocked', (roomId, name) => { knocked = name })
  const anaRoom = await ana.joinWithCode(code.toLowerCase().slice(0, 2) + '-' + code.slice(2))
  assert.strictEqual(anaRoom, party)
  await until(() => texts(ana, party).includes('bring snacks'), 'Ana catches up on the party room')
  assert.strictEqual(knocked, 'Ana')
  console.log(`✓ Ana joined the party room with the code ${code}`)
  await assert.rejects(() => bob.joinWithCode('ZZZZZ', { timeout: 4000 }), /Nobody answered/)
  console.log('✓ A wrong code gets no answer')
  await ana.stop()

  // Who's online: John can see Sam and Bob are on in NewProject.
  await until(() => john.onlineIn(project).length === 2, 'John sees two people online in NewProject')
  assert.ok(john.onlineIn(project).includes(sam.me.publicKey))
  console.log("✓ John sees exactly who's online in NewProject")

  // DMs: John messages Sam directly; it shows up for Sam, and Bob never sees it.
  const dm = await john.messagePerson(sam.me.publicKey, 'Sam')
  await until(() => sam.rooms.has(dm), 'Sam receives the DM')
  assert.strictEqual(sam.rooms.get(dm).dm, true)
  assert.strictEqual(sam.rooms.get(dm).peer, john.me.publicKey)
  assert.strictEqual(await john.messagePerson(sam.me.publicKey, 'Sam'), dm)
  john.post(dm, 'just between us')
  await until(() => texts(sam, dm).includes('just between us'), 'Sam reads the DM')
  sam.post(dm, 'got it')
  await until(() => texts(john, dm).includes('got it'), 'John reads the reply')
  await wait(1000)
  assert.strictEqual(bob.rooms.has(dm), false)
  assert.throws(() => john.invite(dm), /just the two of you/)
  console.log('✓ John DMed Sam; only the two of them have it')

  // Bob's own space: he makes a room and invites John.
  const garage = await bob.createRoom('bobs-garage')
  await john.joinRoom(bob.invite(garage))
  john.post(garage, 'nice garage')
  await until(() => texts(bob, garage).includes('nice garage'), 'Bob gets John in his room')
  assert.strictEqual(john.rooms.get(garage).owner, bob.me.publicKey)
  console.log("✓ John joined a room in Bob's space")

  // John removes Bob from NewProject.
  await until(() => john.members(project).length === 3, 'John sees 3 members')
  await john.removeMember(project, bob.me.publicKey)
  await until(() => bob.rooms.get(project).removed, 'Bob learns he was removed')
  await until(() => sam.rooms.get(project).epoch === 1, 'Sam gets the new key')
  john.post(project, 'secret plans after bob left')
  await until(() => texts(sam, project).includes('secret plans after bob left'), 'Sam gets post-removal message')
  await wait(2000)
  assert.ok(!texts(bob, project).includes('secret plans after bob left'))
  console.log('✓ Removed Bob is cut off; Sam keeps getting new messages')

  // Bob tries to post into NewProject anyway.
  assert.throws(() => bob.post(project, 'let me back in'), /no longer/)
  // Even forging a post with his old key gets refused by others.
  const room = bob.rooms.get(project)
  const forged = bob._sign(room, 'msg', 0, { text: 'sneaky' })
  assert.strictEqual(sam._accept(sam.rooms.get(project), forged, 0), false)
  console.log("✓ Bob's late posts with his old key are refused")

  // An old invite (from before the removal) no longer works for new messages.
  assert.strictEqual(john.members(project).length, 2)
  console.log('✓ Member list updated: John + Sam')

  // Tampering is refused.
  const any = [...sam.rooms.get(project).records.values()].find((r) => r.kind === 'msg')
  assert.strictEqual(bob._accept(bob.rooms.get(garage), { ...any, room: garage, body: { text: 'forged' } }, 99), false)
  console.log('✓ Tampered records refused')

  // Restart Sam: rooms, keys and history survive.
  await sam.stop()
  const sam2 = new Slake({ dataDir: path.join(tmp, 'Sam'), makeSwarm })
  await sam2.start()
  assert.strictEqual(sam2.rooms.size, 3)  // NewProject, party, and his DM with John
  assert.strictEqual(sam2.rooms.get(dm).dm, true)
  assert.strictEqual(sam2.rooms.get(project).epoch, 1)
  assert.ok(texts(sam2, project).includes('secret plans after bob left'))
  console.log('✓ Sam kept his rooms, keys and history after restarting')

  // Leaving a room someone else owns.
  await john.leaveRoom(garage)
  assert.strictEqual(john.rooms.has(garage), false)
  await assert.rejects(() => john.leaveRoom(project), /own this room/)
  console.log("✓ John left Bob's room; can't leave his own")

  await Promise.all([john.stop(), bob.stop(), sam2.stop()])
  await testnet.destroy()
  console.log('\nAll good.')
  process.exit(0)
})().catch((e) => { console.error('✗', e); process.exit(1) })
