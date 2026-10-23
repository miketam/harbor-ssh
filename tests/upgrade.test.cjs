const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { Store } = require('../dist-electron/electron/store');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
test('future database version is refused without modifying its bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-future-')), path = join(dir,'store.sqlite');
  try {
    const db = new Database(path); db.exec('CREATE TABLE future_data(value BLOB); PRAGMA user_version=99;'); db.prepare('INSERT INTO future_data VALUES(?)').run(Buffer.from('opaque-future-record')); db.close();
    const before = hash(path); assert.throws(() => new Store(path), /更新版本/); assert.equal(hash(path), before);
    const after = new Database(path, { readonly:true }); assert.equal(after.pragma('user_version',{simple:true}),99); after.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('failed legacy migration rolls back schema and releases database; existing backup never overwritten', () => {
  const dir = mkdtempSync(join(tmpdir(),'harbor-rollback-')), path = join(dir,'store.sqlite');
  try {
    const db = new Database(path);db.exec("CREATE TABLE hosts(id TEXT PRIMARY KEY,name TEXT,address TEXT,port INTEGER,username TEXT,group_name TEXT,auth_mode TEXT); PRAGMA user_version=1;");db.prepare('INSERT INTO hosts VALUES(?,?,?,?,?,?,?)').run('legacy','legacy','localhost',22,'fixture','','password');db.close();
    assert.throws(()=>new Store(path),/duplicate column/); const backupHash=hash(path+'.v1-backup.sqlite');
    assert.throws(()=>new Store(path),/duplicate column/);assert.equal(hash(path+'.v1-backup.sqlite'),backupHash);
    const after = new Database(path);assert.equal(after.pragma('user_version',{simple:true}),1);assert.equal(after.prepare('SELECT name FROM hosts').get().name,'legacy');assert.equal(after.pragma('table_info(hosts)').some(column=>column.name==='identity_id'),false);assert.equal(after.prepare("SELECT name FROM sqlite_master WHERE name='identities'").get(),undefined);after.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
