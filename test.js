// Runs three copies of Slake on a private, offline test network:
// Alice starts a group, Bob joins with her invite, Mallory tries to
// sneak in with a made-up invite. Run with: npm test
const createTestnet = require('hyperdht/testnet')
const os = require('os')
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const { Slake } = require('./core')
const DHT = require('hyperdht')
const Hyperswarm = require('hyperswarm')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until (fn, label, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if (fn()) return; await wait(100) }
  throw new Error('Timed out waiting for: ' + label)
}

;(async () => {
  const testnet = await createTestnet(3)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slake-test-'))
  const makeSwarm = () => new Hyperswarm({ dht: new DHT({ bootstrap: testnet.bootstrap, host: '127.0.0.1' }) })
  const mk = (n) => new Slake({ dataDir: path.join(tmp, n), makeSwarm })

  const alice = mk('alice'); await alice.start(); alice.setName('Alice')
  await alice.createGroup('Test Crew')
  alice.post('general', 'hello before anyone is here')

  const bob = mk('bob'); await bob.start(); bob.setName('Bob')
  await bob.joinGroup(alice.invite)

  await until(() => bob.messages.size === 1, 'Bob catches up on history')
  console.log('✓ Bob received the message Alice sent before he joined')

  bob.post('random', 'hi from bob')
  await until(() => alice.messages.size === 2, 'Alice gets live message')
  console.log('✓ Live message reached Alice')

  let rejected = 0
  alice.on('rejected', () => rejected++)
  const mallory = mk('mallory'); await mallory.start(); mallory.setName('Mallory')
  // Right fingerprint for the phone book, wrong secret: she'll find the group
  // but must fail the membership check.
  mallory.group = { name: 'x', secret: alice.group.secret }
  mallory._writeJSON('group.json', mallory.group)
  mallory._secret = Buffer.alloc(32, 7)
  mallory.topic = alice.topic
  mallory.swarm = makeSwarm()
  mallory.swarm.on('connection', (c) => mallory._onConnection(c))
  await mallory.swarm.join(alice.topic).flushed()
  await until(() => rejected > 0, 'Alice rejects impostor')
  await wait(1000)
  assert.strictEqual(mallory.messages.size, 0)
  console.log('✓ Impostor without the real secret was kicked out and saw nothing')

  // Tampered message must be refused.
  const forged = { ...[...alice.messages.values()][0], text: 'forged!' }
  assert.strictEqual(bob._add(forged), false)
  console.log('✓ Tampered message refused')

  // Restart Bob: history should survive on disk.
  await bob.stop()
  const bob2 = new Slake({ dataDir: path.join(tmp, 'bob'), makeSwarm })
  await bob2.start()
  assert.strictEqual(bob2.messages.size, 2)
  assert.strictEqual(bob2.me.name, 'Bob')
  console.log('✓ Bob kept his identity and history after restarting')

  // Leaving a group lets you join a different one; old history is kept aside.
  await bob2.leaveGroup()
  assert.strictEqual(bob2.group, null)
  assert.strictEqual(bob2.messages.size, 0)
  await bob2.joinGroup(alice.invite)
  await until(() => bob2.messages.size === 2, 'Bob rejoins and catches up')
  console.log('✓ Bob left, rejoined with an invite, and caught up again')

  await Promise.all([alice.stop(), bob2.stop(), mallory.stop()])
  await testnet.destroy()
  console.log('\nAll good.')
  process.exit(0)
})().catch((e) => { console.error('✗', e); process.exit(1) })
