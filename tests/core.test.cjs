const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store, normalizeAddress } = require('../dist-electron/electron/store');
const { SshSession, safeSshError } = require('../dist-electron/electron/ssh');
const { serverFixture } = require('./fixture.cjs');
const host = { name: 'Local fixture', address: '127.0.0.1', port: 22, username: 'fixture', group: 'Tests' };
function waitFor(events, predicate, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const timer = setInterval(() => {
      const found = events.find(predicate);
      if (found) { clearInterval(timer); resolve(found); }
      else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Expected SSH event not received')); }
    }, 10);
  });
}
test('host CRUD persists across restart; no password column; secret fields rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-store-')); const path = join(dir, 'state.sqlite');
  try {
    let store = new Store(path); const saved = store.saveHost(host);
    assert.equal(saved.address, host.address);
    assert.throws(() => store.saveHost({ ...host, password: 'must-not-save-test-secret' }));
    assert.throws(() => store.saveHost({ ...host, privateKey: 'must-not-save-test-private-key' }));
    store.saveHost({ ...saved, name: 'Renamed' });
    store.trust(host.address, host.port, 'SHA256:fixture-fingerprint'); store.close();
    store = new Store(path); assert.equal(store.getHost(saved.id).name, 'Renamed');
    assert.equal(store.fingerprint(host.address, host.port), 'SHA256:fixture-fingerprint');
    store.forget(host.address, host.port); assert.equal(store.listKnownHosts().length, 0);
    store.deleteHost(saved.id); assert.equal(store.listHosts().length, 0); store.close();
    for (const file of readdirSync(dir)) assert.equal(readFileSync(join(dir, file)).includes(Buffer.from('must-not-save-test-secret')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('IPC storage boundary validates address, port, username and id', () => {
  const store = new Store(':memory:');
  for (const input of [{ ...host, port: 0 }, { ...host, port: 1.5 }, { ...host, port: '22' }, { ...host, address: 'ssh://localhost' }, { ...host, address: 'localhost:22' }, { ...host, username: 'x\n' }, { ...host, name: '' }, { ...host, id: 'missing' }]) assert.throws(() => store.saveHost(input));
  assert.equal(normalizeAddress('Example.COM.'), 'example.com'); assert.equal(normalizeAddress('[::1]'), '::1');
  store.close();
});
test('SSH protocol: fingerprint gate precedes authentication; PTY input/output and resize', async () => {
  const fixture = await serverFixture(); const events = []; let session;
  try {
    session = new SshSession('test', event => { events.push(event); if (event.type === 'data') session.acknowledge(); });
    session.connect({ ...host, id: 'fixture', port: fixture.port }, 'fixture-password-only', 80, 24);
    const key = await waitFor(events, e => e.type === 'hostkey'); assert.match(key.fingerprint, /^SHA256:/);
    assert.equal(fixture.stats.authenticated, 0);
    session.decide(true); await waitFor(events, e => e.type === 'status' && e.state === 'connected');
    await waitFor(events, e => e.type === 'data' && Buffer.from(e.data).toString().includes('fixture-ready'));
    session.input('test-input\r'); session.resize(120, 40);
    await waitFor(events, e => e.type === 'data' && Buffer.from(e.data).toString().includes('test-input'));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(fixture.stats.authenticated, 1); assert.equal(fixture.stats.input, 'test-input\r'); assert.ok(fixture.stats.sizes.some(([cols, rows]) => cols === 120 && rows === 40));
    session.close(); assert.ok(events.some(e => e.type === 'status' && e.state === 'disconnected'));
  } finally { session?.close(); await fixture.close(); }
});
test('rejecting fingerprint never sends credentials', async () => {
  const fixture = await serverFixture(); const events = []; const session = new SshSession('reject', e => events.push(e));
  try {
    session.connect({ ...host, id: 'fixture', port: fixture.port }, 'fixture-password-only', 80, 24);
    await waitFor(events, e => e.type === 'hostkey'); session.decide(false);
    await waitFor(events, e => e.type === 'status' && e.state === 'disconnected');
    assert.equal(fixture.stats.authenticated, 0);
  } finally { session.close(); await fixture.close(); }
});
test('wrong password produces a bounded authentication error', async () => {
  const fixture = await serverFixture(); const events = []; const session = new SshSession('wrong', e => events.push(e));
  try {
    session.connect({ ...host, id: 'fixture', port: fixture.port }, 'incorrect-fixture-password', 80, 24);
    await waitFor(events, e => e.type === 'hostkey'); session.decide(true);
    const error = await waitFor(events, e => e.type === 'error'); assert.match(error.message, /认证失败/);
    assert.equal(JSON.stringify(events).includes('incorrect-fixture-password'), false);
  } finally { session.close(); await fixture.close(); }
});
test('cancel pending handshake closes it once; network failures are sanitized', async () => {
  const fixture = await serverFixture(); const events = []; const session = new SshSession('cancel', e => events.push(e));
  try {
    session.connect({ ...host, id: 'fixture', port: fixture.port }, 'fixture-password-only', 80, 24);
    await waitFor(events, e => e.type === 'hostkey'); session.close(); session.close();
    assert.equal(events.filter(e => e.type === 'status' && e.state === 'disconnected').length, 1);
    assert.equal(fixture.stats.authenticated, 0);
    assert.equal(safeSshError(Object.assign(new Error('secret server text'), { code: 'ECONNREFUSED' })).includes('secret'), false);
  } finally { session.close(); await fixture.close(); }
});

test('encrypted OpenSSH Ed25519 private key signs authentication without password', async () => {
  const keys = require('./key-fixture.cjs').makeEd25519('openssh-fixture-passphrase', true);
  const publicBlob = Buffer.from(keys.public.split(' ')[1], 'base64');
  assert.equal(publicBlob.readUInt32BE(15), 32); assert.equal(publicBlob[19], 0);
  const fixture=await serverFixture({auth:'publickey',publicKey:keys.public});const events=[];
  let session;session=new SshSession('key',e=>{events.push(e);if(e.type==='data')session.acknowledge();});
  try {
    session.connect({...host,id:'key',port:fixture.port},{method:'privateKey',privateKey:keys.private,passphrase:'openssh-fixture-passphrase'},80,24);
    await waitFor(events,e=>e.type==='hostkey');session.decide(true);
    await waitFor(events,e=>e.type==='status'&&e.state==='connected');
    assert.equal(fixture.stats.authenticated,1);assert.equal(fixture.stats.methods.includes('password'),false);
    assert.equal(JSON.stringify(events).includes(keys.private),false);assert.equal(JSON.stringify(events).includes('openssh-fixture-passphrase'),false);
  } finally {session.close();await fixture.close();}
});
test('keyboard-interactive supports multiple rounds, echo flags and stale response rejection', async () => {
  const fixture=await serverFixture({auth:'interactive'});const events=[];const session=new SshSession('interactive',e=>events.push(e));
  try {
    session.connect({...host,id:'interactive',port:fixture.port},{method:'interactive'},80,24);
    await waitFor(events,e=>e.type==='hostkey');session.decide(true);
    const one=await waitFor(events,e=>e.type==='interactive');assert.equal(one.prompts[0].echo,false);
    session.answer('stale-request',['must-not-submit']);assert.equal(fixture.stats.answers.length,0);
    session.answer(one.requestId,['interactive-fixture-password']);
    const two=await waitFor(events,e=>e.type==='interactive'&&e.requestId!==one.requestId);assert.equal(two.prompts.length,2);assert.equal(two.prompts[1].echo,true);
    session.answer(two.requestId,['246810','fixture-device']);await waitFor(events,e=>e.type==='status'&&e.state==='connected');
    assert.equal(fixture.stats.authenticated,1);assert.equal(fixture.stats.answers.length,2);
    assert.equal(JSON.stringify(events).includes('interactive-fixture-password'),false);
  } finally {session.close();await fixture.close();}
});
test('private key plus keyboard-interactive MFA and cancelling interactive challenge', async () => {
  const keys=require('./key-fixture.cjs').makeEd25519();const fixture=await serverFixture({auth:'key+interactive',publicKey:keys.public});
  const events=[];const session=new SshSession('mfa',e=>events.push(e));
  try {
    session.connect({...host,id:'mfa',port:fixture.port},{method:'privateKey',privateKey:keys.private,passphrase:''},80,24);
    await waitFor(events,e=>e.type==='hostkey');session.decide(true);
    const q=await waitFor(events,e=>e.type==='interactive');session.answer(q.requestId,['interactive-fixture-password']);
    const next=await waitFor(events,e=>e.type==='interactive'&&e.requestId!==q.requestId);session.answer(next.requestId,['246810','fixture-device']);
    await waitFor(events,e=>e.type==='status'&&e.state==='connected');assert.equal(fixture.stats.authenticated,1);
  } finally {session.close();await fixture.close();}
  const cancelled=await serverFixture({auth:'interactive'});const cancelledEvents=[];const second=new SshSession('cancel-interactive',e=>cancelledEvents.push(e));
  try {
    second.connect({...host,id:'cancel',port:cancelled.port},{method:'interactive'},80,24);await waitFor(cancelledEvents,e=>e.type==='hostkey');second.decide(true);
    await waitFor(cancelledEvents,e=>e.type==='interactive');second.close();assert.equal(cancelled.stats.authenticated,0);
  } finally {second.close();await cancelled.close();}
});
