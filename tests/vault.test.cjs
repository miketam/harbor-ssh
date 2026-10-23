const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, createCipheriv, createDecipheriv, generateKeyPairSync } = require('node:crypto');
const { mkdtempSync, readFileSync, writeFileSync, unlinkSync, readdirSync, rmSync, statSync, chmodSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const Database = require('better-sqlite3');
const { Store } = require('../dist-electron/electron/store');
const { Vault } = require('../dist-electron/electron/vault');
const { Identities, inspectPrivateKey } = require('../dist-electron/electron/identities');
const keep = { action: 'keep' }, clear = { action: 'clear' }, replace = value => ({ action: 'replace', value });
const basic = { name: 'test-identity-sensitive-name', username: 'test-identity-sensitive-user', method: 'password', password: replace('saved-fixture-password-secret'), privateKey: clear, passphrase: clear };
// This protector is test-only. Product code always uses Electron safeStorage/Keychain.
function protector(key = randomBytes(32)) {
  return {
    available: async () => true,
    encrypt: async value => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decrypt: async value => { const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12,28)); return { result: Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: false }; }
  };
}
async function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-vault-')), path = join(dir,'store.sqlite'), keyfile = join(dir,'vault-key.bin');
  const store = new Store(path), protect = protector(), vault = new Vault(keyfile, protect, () => store.hasIdentities()), ids = new Identities(store, vault);
  try { await fn({ dir, path, keyfile, store, protect, vault, ids }); }
  finally { vault.close(); store.close(); rmSync(dir, { recursive:true, force:true }); }
}
test('AES-GCM encrypts every identity field; metadata-only API; restart and field keep/replace/clear', () => fixture(async f => {
  const saved = await f.ids.save(basic);
  assert.deepEqual(Object.keys(saved).sort(), ['hasPassphrase','hasPassword','id','method','name','requiresPassphrase','username'].sort());
  assert.equal(saved.hasPassword, true);
  const ciphertext = f.store.identityRow(saved.id).ciphertext;
  for (const secret of [basic.name,basic.username,'saved-fixture-password-secret']) assert.equal(ciphertext.includes(Buffer.from(secret)), false);
  assert.equal(statSync(f.keyfile).mode & 0o777, 0o600);
  f.vault.close(); chmodSync(f.keyfile, 0o644); const reopened = new Vault(f.keyfile, f.protect, () => f.store.hasIdentities()), ids = new Identities(f.store,reopened);
  const list = await ids.list(); assert.equal(list[0].name, basic.name); assert.equal(statSync(f.keyfile).mode & 0o777, 0o600);
  await ids.save({ ...basic, id:saved.id, name:'renamed', password:keep });
  const host=f.store.saveHost({name:'test',address:'localhost',port:22,username:'',group:'',identityId:saved.id});
  assert.equal((await ids.resolve({hostId:host.id})).auth.password,'saved-fixture-password-secret');
  await ids.save({ ...basic,id:saved.id,password:replace('replacement-fixture-secret') });
  assert.equal((await ids.resolve({hostId:host.id})).auth.password,'replacement-fixture-secret');
  await ids.save({ ...basic,id:saved.id,password:clear });
  await assert.rejects(ids.resolve({hostId:host.id}), /请输入/);
  assert.equal((await ids.resolve({hostId:host.id,password:'temporary-fixture-secret'})).auth.password,'temporary-fixture-secret');
  assert.throws(() => f.store.deleteIdentity(saved.id),/引用/);
  reopened.close();
  for (const name of readdirSync(f.dir)) for (const secret of [basic.name,basic.username,'saved-fixture-password-secret','replacement-fixture-secret','temporary-fixture-secret']) assert.equal(readFileSync(join(f.dir,name)).includes(Buffer.from(secret)),false);
}));
test('authenticated ciphertext rejects modification, row swaps and wrong key without leaking values', () => fixture(async f => {
  const one = await f.ids.save(basic), two = await f.ids.save({...basic,name:'second'});
  const raw = f.store.identityRow(one.id).ciphertext;
  const tampered = Buffer.from(raw); tampered[tampered.length-1] ^= 1;
  assert.throws(() => f.vault.decrypt(one.id,tampered),/完整性/);
  assert.throws(() => f.vault.decrypt(two.id,raw),/完整性/);
  const other = new Vault(join(f.dir,'other-key.bin'),protector(),()=>false); await other.open();
  assert.throws(() => other.decrypt(one.id,raw),/完整性/);other.close();
}));
test('Keychain unavailable creates no key and writes no identity; unavailable or missing key preserves existing data', () => fixture(async f => {
  const unavailable = new Vault(f.keyfile,{...f.protect,available:async()=>false},()=>f.store.hasIdentities());
  await assert.rejects(new Identities(f.store,unavailable).save(basic),/系统密钥/);
  assert.equal(f.store.hasIdentities(),false);assert.equal(readdirSync(f.dir).includes('vault-key.bin'),false);
  const saved = await f.ids.save(basic), original = readFileSync(f.keyfile), blob = f.store.identityRow(saved.id).ciphertext;
  f.vault.close(); await assert.rejects(unavailable.open(),/系统密钥/);assert.deepEqual(readFileSync(f.keyfile),original);
  unlinkSync(f.keyfile);const missing = new Vault(f.keyfile,f.protect,()=>f.store.hasIdentities());
  await assert.rejects(missing.open(),/密钥文件缺失/);assert.equal(readdirSync(f.dir).includes('vault-key.bin'),false);assert.deepEqual(f.store.identityRow(saved.id).ciphertext,blob);
}));
test('concurrent first saves initialize one wrapped key; corrupted wrapping never regenerated', () => fixture(async f => {
  await Promise.all([f.ids.save(basic),f.ids.save({...basic,name:'parallel'})]);
  assert.equal((await f.ids.list()).length,2);f.vault.close();
  const corrupt=Buffer.from('corrupted-key-envelope');writeFileSync(f.keyfile,corrupt);
  const reopened=new Vault(f.keyfile,f.protect,()=>true);await assert.rejects(reopened.open(),/系统密钥/);assert.deepEqual(readFileSync(f.keyfile),corrupt);
}));
test('private key validation, encrypted passphrase handling and secret update rejection', () => fixture(async f => {
  const { privateKey } = generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem',cipher:'aes-256-cbc',passphrase:'key-test-passphrase'},publicKeyEncoding:{type:'spki',format:'pem'}});
  assert.equal(inspectPrivateKey(privateKey,''),true);
  assert.throws(()=>inspectPrivateKey(privateKey,'wrong'),/私钥格式/);
  const saved=await f.ids.save({...basic,method:'privateKey',privateKey:replace(privateKey),passphrase:clear});
  assert.equal(saved.requiresPassphrase,true);
  const host=f.store.saveHost({name:'key',address:'localhost',port:22,username:'',group:'',identityId:saved.id});
  await assert.rejects(f.ids.resolve({hostId:host.id}),/passphrase/);
  assert.equal((await f.ids.resolve({hostId:host.id,passphrase:'key-test-passphrase'})).auth.method,'privateKey');
  await f.ids.save({...basic,id:saved.id,method:'privateKey',privateKey:keep,passphrase:replace('key-test-passphrase'),password:keep});
  assert.equal((await f.ids.resolve({hostId:host.id})).auth.passphrase,'key-test-passphrase');
  await assert.rejects(f.ids.save({...basic,privateKey:replace('invalid'),method:'privateKey'}),/私钥格式/);
  await assert.rejects(f.ids.save({...basic,password:{action:'keep',value:'should-reject'}}),/更新方式/);
  for(const name of readdirSync(f.dir)){const bytes=readFileSync(join(f.dir,name));assert.equal(bytes.includes(Buffer.from(privateKey)),false);assert.equal(bytes.includes(Buffer.from('key-test-passphrase')),false);}
}));
test('v1 migration creates backup and preserves hosts/trust; workspace saves only valid non-secret fields', () => {
  const dir=mkdtempSync(join(tmpdir(),'harbor-migrate-')),path=join(dir,'legacy.sqlite');
  let store;
  try {
    const old=new Database(path);old.exec(`CREATE TABLE hosts(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,port INTEGER NOT NULL,username TEXT NOT NULL,group_name TEXT NOT NULL); CREATE TABLE known_hosts(address TEXT,port INTEGER,fingerprint TEXT,trusted_at TEXT,PRIMARY KEY(address,port)); PRAGMA user_version=1;`);
    old.prepare('INSERT INTO hosts VALUES (?,?,?,?,?,?)').run('old','Old host','localhost',22,'legacy-user','Legacy');old.prepare('INSERT INTO known_hosts VALUES (?,?,?,?)').run('localhost',22,'SHA256:legacy','2026-01-01');old.close();
    store=new Store(path);assert.equal(store.getHost('old').username,'legacy-user');assert.equal(store.getHost('old').authMode,'password');assert.equal(store.fingerprint('localhost',22),'SHA256:legacy');assert.ok(readdirSync(dir).includes('legacy.sqlite.v1-backup.sqlite'));
    const state={tabs:[{id:'tab-one',hostId:'old'},{id:'tab-two',hostId:'old'}],activeTabId:'tab-two',selectedHostId:'old'};
    store.saveWorkspace(state);assert.deepEqual(store.getWorkspace(),state);
    assert.throws(()=>store.saveWorkspace({...state,password:'forbidden'}));
    assert.throws(()=>store.saveWorkspace({...state,tabs:[{id:'tab-one',hostId:'old',output:'forbidden'}]}));
    assert.throws(()=>store.saveWorkspace({...state,tabs:Array.from({length:11},(_,i)=>({id:'tab'+i,hostId:'old'}))}));
    store.close();store=new Store(path);assert.deepEqual(store.getWorkspace(),state);
    store.deleteHost('old');assert.equal(store.getWorkspace().tabs.length,0);
  } finally { store?.close();rmSync(dir,{recursive:true,force:true}); }
});
