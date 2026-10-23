const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv, generateKeyPairSync } = require('node:crypto');
const Database = require('better-sqlite3');
const { Store } = require('../dist-electron/electron/store');
const { Vault } = require('../dist-electron/electron/vault');
const { Identities, inspectPrivateKey, preparePrivateKey } = require('../dist-electron/electron/identities');
const { forwardInput, remotePath } = require('../dist-electron/electron/resources');
const host = {name:'test',address:'localhost',port:22,username:'fixture',group:''};
function provider() { const key=randomBytes(32);return {available:async()=>true,encrypt:async text=>{const nonce=randomBytes(12),c=createCipheriv('aes-256-gcm',key,nonce);return Buffer.concat([nonce,c.update(text),c.final(),c.getAuthTag()]);},decrypt:async blob=>{const d=createDecipheriv('aes-256-gcm',key,blob.subarray(0,12));d.setAuthTag(blob.subarray(-16));return {result:Buffer.concat([d.update(blob.subarray(12,-16)),d.final()]).toString(),shouldReEncrypt:false};}}; }
test('v2 to v3 preserves identities/workspace and backs up; jump topology rejects self, nesting, deletion',()=>{
 const dir=mkdtempSync(join(tmpdir(),'harbor-v3-')),file=join(dir,'db.sqlite');let store;
 try{
  const db=new Database(file);db.exec(`CREATE TABLE identities(id TEXT PRIMARY KEY,ciphertext BLOB NOT NULL);CREATE TABLE hosts(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,port INTEGER NOT NULL,username TEXT NOT NULL,group_name TEXT NOT NULL,identity_id TEXT REFERENCES identities(id),auth_mode TEXT NOT NULL DEFAULT 'password'); CREATE TABLE known_hosts(address TEXT,port INTEGER,fingerprint TEXT,trusted_at TEXT,PRIMARY KEY(address,port));CREATE TABLE workspace(id INTEGER PRIMARY KEY,content TEXT NOT NULL);PRAGMA user_version=2;`);
  db.prepare('INSERT INTO identities VALUES (?,?)').run('encrypted',Buffer.from('opaque-ciphertext'));db.prepare('INSERT INTO hosts VALUES (?,?,?,?,?,?,?,?)').run('existing','existing','localhost',22,'','', 'encrypted','password');db.prepare('INSERT INTO workspace VALUES(1,?)').run(JSON.stringify({tabs:[{id:'restored',hostId:'existing'}],activeTabId:'restored',selectedHostId:'existing'}));db.close();
  store=new Store(file);assert.equal(store.getHost('existing').jumpHostId,null);assert.equal(store.identityRow('encrypted').ciphertext.toString(),'opaque-ciphertext');assert.equal(store.getWorkspace().activeTabId,'restored');assert.ok(readdirSync(dir).includes('db.sqlite.v2-backup.sqlite'));
  const jump=store.saveHost(host),target=store.saveHost({...host,jumpHostId:jump.id}),other=store.saveHost(host);
  assert.throws(()=>store.saveHost({...jump,jumpHostId:jump.id}),/单跳/);assert.throws(()=>store.saveHost({...other,jumpHostId:target.id}),/单跳/);assert.throws(()=>store.saveHost({...jump,jumpHostId:other.id}),/单跳/);assert.throws(()=>store.deleteHost(jump.id),/跳板机/);
  store.saveHost({...target,jumpHostId:null});store.deleteHost(jump.id);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('remember connection password binds one encrypted identity, survives reopening, and failed bind rolls back',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'harbor-remember-')),file=join(dir,'db.sqlite'),keyfile=join(dir,'key');const store=new Store(file),protect=provider();let vault=new Vault(keyfile,protect,()=>store.hasIdentities());let ids=new Identities(store,vault);
 try{
  const saved=store.saveHost(host);await ids.remember(saved.id,{method:'password',password:'batch3-test-password'});assert.ok(store.getHost(saved.id).identityId);assert.equal(store.getHost(saved.id).username,'');
  await ids.remember(saved.id,{method:'password',password:'batch3-test-password-2'});assert.equal(store.identityRows().length,1);
  vault.close();vault=new Vault(keyfile,protect,()=>store.hasIdentities());ids=new Identities(store,vault);assert.equal((await ids.resolve({hostId:saved.id})).auth.password,'batch3-test-password-2');assert.equal((await ids.list())[0].hasPassword,true);
  assert.throws(()=>store.saveBoundIdentity('missing','orphan',Buffer.from('opaque')));assert.equal(store.identityRows().length,1);
  for(const name of readdirSync(dir))assert.equal(readFileSync(join(dir,name)).includes(Buffer.from('batch3-test-password')),false);
 }finally{vault.close();store.close();rmSync(dir,{recursive:true,force:true});}
});
test('PKCS8 RSA and EC encrypted keys parse with correct passphrase and preserve public signing identity',()=>{
 const {utils}=require('ssh2');
 for(const type of ['rsa','ec']){
  const options=type==='rsa'?{modulusLength:2048}:{namedCurve:'prime256v1'};
  const keys=generateKeyPairSync(type,{...options,privateKeyEncoding:{type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:'pkcs8-test-only'},publicKeyEncoding:{type:'spki',format:'pem'}});
  assert.equal(inspectPrivateKey(keys.privateKey,''),true);assert.throws(()=>inspectPrivateKey(keys.privateKey,'wrong'),/私钥/);assert.equal(inspectPrivateKey(keys.privateKey,'pkcs8-test-only'),false);
  const parsed=utils.parseKey(preparePrivateKey(keys.privateKey,'pkcs8-test-only'));assert.ok(!(parsed instanceof Error));assert.equal(parsed.verify(Buffer.from('test-signing'),parsed.sign(Buffer.from('test-signing'))),true);
 }
});
test('resource validation rejects malformed paths, network exposure options and invalid ports',()=>{
 assert.deepEqual(forwardInput({localPort:0,remoteHost:'LOCALHOST',remotePort:22}),{localPort:0,remoteHost:'localhost',remotePort:22});
 assert.throws(()=>forwardInput({localPort:1234,remoteHost:'localhost',remotePort:22,bind:'0.0.0.0'}));for(const port of [-1,65536,1.5,'22'])assert.throws(()=>forwardInput({localPort:port,remoteHost:'localhost',remotePort:22}));
 for(const path of ['',null,'a\0b','a\nb'])assert.throws(()=>remotePath(path));assert.equal(remotePath('/tmp/中文 a'),'/tmp/中文 a');
});

test('jump fingerprint gate precedes each hop authentication and rejection releases both clients',async()=>{
 const {serverFixture}=require('./fixture.cjs'),{SshSession}=require('../dist-electron/electron/ssh');
 const jump=await serverFixture({allowForward:true}),target=await serverFixture();let session;
 const wait=async predicate=>{for(let i=0;i<200;i++){const result=predicate();if(result)return result;await new Promise(r=>setTimeout(r,10));}throw new Error('jump test timed out');};
 const jumpHost={...host,id:'jump',port:jump.port,address:'127.0.0.1'},targetHost={...host,id:'target',port:target.port,address:'127.0.0.1'};
 try{
  let events=[];session=new SshSession('jump-reject',e=>events.push(e));session.connect(targetHost,'fixture-password-only',80,24,{host:jumpHost,auth:{method:'password',password:'fixture-password-only'}});
  await wait(()=>events.find(e=>e.type==='hostkey'));assert.equal(jump.stats.authenticated,0);assert.equal(target.stats.connections,0);session.decide(false);await wait(()=>events.find(e=>e.state==='disconnected'));session.close();
  events=[];session=new SshSession('target-reject',e=>events.push(e));session.connect(targetHost,'fixture-password-only',80,24,{host:jumpHost,auth:{method:'password',password:'fixture-password-only'}});
  await wait(()=>events.find(e=>e.type==='hostkey'&&e.hostId==='jump'));session.decide(true);await wait(()=>events.find(e=>e.type==='hostkey'&&e.hostId==='target'));assert.equal(jump.stats.authenticated,1);assert.equal(target.stats.authenticated,0);session.decide(false);await wait(()=>events.find(e=>e.state==='disconnected'));session.close();
  events=[];session=new SshSession('target-accepted',e=>{events.push(e);if(e.type==='data')session.acknowledge();});session.connect(targetHost,'fixture-password-only',80,24,{host:jumpHost,auth:{method:'password',password:'fixture-password-only'}});
  await wait(()=>events.find(e=>e.type==='hostkey'&&e.hostId==='jump'));session.decide(true);await wait(()=>events.find(e=>e.type==='hostkey'&&e.hostId==='target'));session.decide(true);await wait(()=>events.find(e=>e.state==='connected'));assert.equal(target.stats.authenticated,1);
 }finally{session?.close();await jump.close();await target.close();}
});

test('cancel before delayed SFTP open acknowledgement removes the file created by that request',async()=>{
 const {EventEmitter}=require('node:events'),{Writable}=require('node:stream');const {SessionResources}=require('../dist-electron/electron/resources');
 const dir=mkdtempSync(join(tmpdir(),'harbor-cancel-')),file=join(dir,'input');require('node:fs').writeFileSync(file,'test payload');
 let remoteExists=false;const events=[];const client=new EventEmitter();client.sftp=callback=>queueMicrotask(()=>callback(null,{on(){},once(){},open(path,flags,mode,cb){assert.equal(flags,'wx');setTimeout(()=>{remoteExists=true;cb(null,Buffer.from('handle'));},30);},createWriteStream(){return new Writable({write(chunk,encoding,cb){cb();}});},unlink(path,cb){remoteExists=false;cb();}}));
 const resources=new SessionResources(client,'cancel',event=>events.push(event));
 try{
  await resources.request({method:'transfer',id:'cancel-before-open',direction:'upload',localPath:file,remotePath:'/remote/test',name:'input'});await resources.request({method:'cancel',id:'cancel-before-open'});
  for(let i=0;i<100&&!events.some(e=>e.transfer?.state==='cancelled');i++)await new Promise(r=>setTimeout(r,10));
  assert.ok(events.some(e=>e.transfer?.state==='cancelled'));assert.equal(remoteExists,false);
 }finally{await resources.close();rmSync(dir,{recursive:true,force:true});}
});
