const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, chmodSync } = require('node:fs');
const { join, resolve, basename } = require('node:path');
const { generateKeyPairSync, createHash } = require('node:crypto');
const net = require('node:net');
const { utils } = require('ssh2');
const { serverFixture } = require('../tests/fixture.cjs');
const Database = require('better-sqlite3');
const root = resolve(__dirname, '..'), artifacts = join(root,'test-artifacts'), release = join(root,'release');
mkdirSync(artifacts,{recursive:true});
const manifest = JSON.parse(readFileSync(join(release,'manifest.json'),'utf8'));
const previous = process.env.HARBOR_PREVIOUS_APP || join(artifacts,'baseline-0.3.0');
if (!existsSync(previous)) throw new Error('缺少真实 0.3.0 基线。请设置 HARBOR_PREVIOUS_APP 为旧版应用或保留的编译目录，不能用新版改版本号替代。');
const profile = mkdtempSync(join(artifacts,'batch4-profile-')), install = mkdtempSync(join(artifacts,'batch4-install-')), mount = join(install,'mount');mkdirSync(mount);
const env = { ...process.env, HARBOR_DATA_DIR:profile };delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_PATH;delete env.NODE_OPTIONS;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (binary,args) => execFileSync(binary,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000});
const key = generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase:'upgrade-test-key-only'},publicKeyEncoding:{type:'spki',format:'pem'}});
const pem = require('node:crypto').createPrivateKey({key:key.privateKey,passphrase:'upgrade-test-key-only'}).export({type:'pkcs1',format:'pem'});
const parsed = utils.parseKey(pem), publicKey = 'ssh-rsa '+parsed.getPublicSSH().toString('base64');
let app,page,mounted=false; const fixtures=[],checks=[],errors=[];
const installedApp = join(install,'Applications','Harbor SSH.app'), binary = join(installedApp,'Contents/MacOS/Harbor SSH');
async function launch(target, packaged = false, directory = profile) {
  const executablePath = packaged ? join(target,'Contents/MacOS/Harbor SSH') : undefined;
  app = await electron.launch(packaged ? {executablePath,args:[],env:{...env,HARBOR_DATA_DIR:directory}} : {executablePath:require('electron'),args:[target],env:{...env,HARBOR_DATA_DIR:directory}});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('heading',{level:1}).waitFor();
  await page.evaluate(()=>{window.testSessions={};window.harbor.onSession(event=>{if(event.type==='status')window.testSessions[event.tabId]=event.sessionId;});});
}
const active = ()=>page.getByRole('tabpanel');
async function connect(name,trust=false){
  await page.getByRole('tab',{name,exact:true}).click();await page.getByRole('button',{name:/^连接主机/}).click();const dialog=page.getByRole('dialog',{name:'连接主机',exact:true});assert.equal(await dialog.locator('input[type=password]').count(),0);await dialog.getByRole('button',{name:'开始连接',exact:true}).click();if(trust)await page.getByRole('button',{name:'信任并连接',exact:true}).click();await active().locator('.terminal-status').getByText('已连接',{exact:true}).waitFor();
}
async function type(text){await active().locator('.xterm-helper-textarea').focus();await page.keyboard.type(text);await page.keyboard.press('Enter');await page.waitForFunction(text=>document.querySelector('[role=tabpanel]:not([hidden]) .xterm-screen')?.textContent.includes(text),text);}
function snapshot(){const db=new Database(join(profile,'harbor.sqlite'),{readonly:true});try{return {version:db.pragma('user_version',{simple:true}),identities:db.prepare('SELECT id,ciphertext FROM identities ORDER BY id').all().map(row=>({id:row.id,sha256:hash(row.ciphertext)})),keyFile:hash(readFileSync(join(profile,'vault-key.bin')))};}finally{db.close();}}
async function measure(){return page.evaluate(()=>{const box=document.querySelector('.terminal-panel').getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},terminalTop:box.top,terminalHeight:box.height,overflow:document.documentElement.scrollWidth>innerWidth,largeHeadingCount:document.querySelectorAll('.workspace-bar,.connection-heading').length};});}
function exchange(port){return new Promise((resolve,reject)=>{const socket=net.connect(port,'127.0.0.1');socket.setTimeout(4000,()=>socket.destroy(new Error('forward timeout')));socket.on('error',reject);socket.once('connect',()=>socket.write('upgrade-forward'));socket.once('data',data=>{resolve(data.toString());socket.destroy();});});}
function scan(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())scan(file);else if(!['LOCK','SingletonLock','SingletonCookie','SingletonSocket'].includes(entry.name)){const bytes=readFileSync(file);for(const secret of ['fixture-password-only','upgrade-test-key-only',key.privateKey])assert.equal(bytes.includes(Buffer.from(secret)),false,'test credential found in plaintext');}}}
(async()=>{
  const password=await serverFixture({allowForward:true}),target=await serverFixture({auth:'publickey',publicKey,allowForward:true}),next=await serverFixture({auth:'publickey',publicKey});fixtures.push(password,target,next);
  await launch(previous,previous.endsWith('.app'));
  assert.equal(await app.evaluate(({app})=>app.commandLine.hasSwitch('use-mock-keychain')),false);
  const oldInfo=await app.evaluate(({app})=>({version:app.getVersion(),name:app.getName(),defaultDirectory:app.getPath('appData')+'/'+app.getName(),packaged:app.isPackaged}));assert.equal(oldInfo.version,'0.3.0');
  await page.evaluate(async({passwordPort,targetPort,privateKey})=>{
    const clear={action:'clear'},replace=value=>({action:'replace',value});
    const password=await window.harbor.saveIdentity({name:'升级密码身份',username:'fixture',method:'password',password:replace('fixture-password-only'),privateKey:clear,passphrase:clear});
    const key=await window.harbor.saveIdentity({name:'升级私钥身份',username:'fixture',method:'privateKey',password:clear,privateKey:replace(privateKey),passphrase:replace('upgrade-test-key-only')});
    const jump=await window.harbor.saveHost({name:'升级跳板',address:'127.0.0.1',port:passwordPort,username:'',group:'旧版主机',identityId:password.id});
    const host=await window.harbor.saveHost({name:'升级目标',address:'127.0.0.1',port:targetPort,username:'',group:'旧版主机',identityId:key.id,jumpHostId:jump.id});
    await window.harbor.saveWorkspace({tabs:[{id:'upgrade-password',hostId:jump.id},{id:'upgrade-key',hostId:host.id}],activeTabId:'upgrade-password',selectedHostId:jump.id});
  },{passwordPort:password.port,targetPort:target.port,privateKey:key.privateKey});
  await page.reload();await page.getByRole('tab').nth(1).waitFor();await connect('升级跳板',true);await connect('升级目标',true);await type('old-version-ssh-ok');
  const oldHosts=await page.evaluate(()=>window.harbor.listHosts()),oldTrust=await page.evaluate(()=>window.harbor.listKnownHosts()),oldWorkspace=await page.evaluate(()=>window.harbor.getWorkspace());
  await app.close();app=undefined;const originalWrapped=readFileSync(join(profile,'vault-key.bin'));const before=snapshot(),connections=fixtures.map(f=>f.stats.connections);
  const originalDb=new Database(join(profile,'harbor.sqlite'),{readonly:true});const originalIdentities=originalDb.prepare('SELECT id,ciphertext FROM identities').all();originalDb.close();
  console.log('Baseline 0.3 SSH and persistence passed');
  checks.push('real 0.3.0 baseline writes Keychain-protected identities, trust, single-hop config and ordered tabs');
  const dmg=join(release,manifest.artifacts.find(a=>a.file.endsWith('.dmg')).file),zip=join(release,manifest.artifacts.find(a=>a.file.endsWith('.zip')).file);
  for(const artifact of manifest.artifacts)assert.equal(hash(readFileSync(join(release,artifact.file))),artifact.sha256);
  run('hdiutil',['verify',dmg]);run('hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,dmg]);mounted=true;
  assert.ok(existsSync(join(mount,'Applications')));mkdirSync(join(install,'Applications'));run('ditto',[join(mount,'Harbor SSH.app'),installedApp]);run('codesign',['--verify','--deep','--strict',installedApp]);
  run('hdiutil',['detach',mount]);mounted=false;
  const zipOutput=join(install,'zip');mkdirSync(zipOutput);run('ditto',['-x','-k',zip,zipOutput]);assert.equal(hash(readFileSync(join(zipOutput,'Harbor SSH.app/Contents/Resources/app.asar'))),manifest.asarSha256);
  checks.push('DMG verified, mounted read-only and installed into isolated Applications; ZIP extracted; checksums and signatures verified');
  console.log('Launching installed app');await launch(installedApp,true);await page.getByRole('tab').nth(1).waitFor();
  const newInfo=await app.evaluate(({app})=>({version:app.getVersion(),name:app.getName(),defaultDirectory:app.getPath('appData')+'/Harbor SSH',packaged:app.isPackaged,applicationPath:app.getAppPath(),mockKeychain:app.commandLine.hasSwitch('use-mock-keychain')}));assert.equal(newInfo.version,manifest.version);assert.equal(newInfo.packaged,true);assert.equal(newInfo.mockKeychain,false);assert.ok(newInfo.applicationPath.includes('app.asar'));assert.equal(newInfo.defaultDirectory,oldInfo.defaultDirectory);
  assert.deepEqual(await page.evaluate(()=>window.harbor.listHosts()),oldHosts);assert.deepEqual(await page.evaluate(()=>window.harbor.listKnownHosts()),oldTrust);assert.deepEqual(await page.evaluate(()=>window.harbor.getWorkspace()),oldWorkspace);assert.deepEqual(snapshot(),before);
  assert.equal((await page.evaluate(()=>window.harbor.listIdentities())).length,2);
  assert.equal((await page.evaluate(()=>window.harbor.vaultStatus())).state,'ready');
  assert.deepEqual(snapshot(),before);
  await page.waitForTimeout(150);assert.deepEqual(fixtures.map(f=>f.stats.connections),connections);assert.equal(await active().locator('.terminal-status').getByText('未连接',{exact:true}).count(),1);
  const identities=await page.evaluate(()=>window.harbor.listIdentities());assert.equal(identities.length,2);assert.equal(identities.find(i=>i.method==='password').hasPassword,true);assert.equal(identities.find(i=>i.method==='privateKey').hasPassphrase,true);
  await connect('升级跳板');await type('installed-password-ok');await connect('升级目标');await type('installed-private-key-and-jump-ok');
  checks.push('installed app retains schema/ciphertext/key file and all metadata; startup never reconnects; saved password and encrypted key authenticate after upgrade');
  const normal=await measure();assert.equal(normal.largeHeadingCount,0);assert.equal(normal.overflow,false);assert.ok(normal.terminalTop<40);await page.screenshot({path:join(artifacts,'batch4-normal.png')});
  const echo=net.createServer(socket=>socket.on('data',data=>socket.write(data)));await new Promise(resolve=>echo.listen(0,'127.0.0.1',resolve));
  try{
    const sessionId=await page.evaluate(()=>window.testSessions['upgrade-key']);assert.ok(sessionId);const forward=await page.evaluate(({id,port})=>window.harbor.startForward(id,{localPort:0,remoteHost:'127.0.0.1',remotePort:port}),{id:sessionId,port:echo.address().port});assert.equal(await exchange(forward.localPort),'upgrade-forward');
    await page.getByRole('button',{name:'编辑',exact:true}).click();const dialog=page.getByRole('dialog',{name:'编辑主机',exact:true});await dialog.getByLabel('主机名称',{exact:true}).fill('修改后的目标');await dialog.getByLabel('服务器地址',{exact:true}).fill('localhost');await dialog.getByLabel('端口',{exact:true}).fill(String(next.port));await dialog.getByLabel('分组 可选',{exact:true}).fill('升级后');await dialog.getByLabel('跳板机',{exact:true}).selectOption('');await dialog.getByRole('button',{name:'保存主机',exact:true}).click();await dialog.waitFor({state:'hidden'});
    const changed=(await page.evaluate(()=>window.harbor.listHosts())).find(host=>host.name==='修改后的目标');assert.equal(changed.port,next.port);assert.equal(changed.jumpHostId,null);assert.equal(changed.address,'localhost');assert.equal(next.stats.authenticated,0);
    assert.ok((await active().locator('.session-endpoint').textContent()).includes(`127.0.0.1:${target.port}`));await active().getByText('配置已修改，下次连接生效',{exact:true}).waitFor();await type('original-connection-survives-edit');assert.ok(target.stats.input.includes('original-connection-survives-edit'));assert.equal(await exchange(forward.localPort),'upgrade-forward');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(900,600));await page.waitForTimeout(100);const minimum=await measure();assert.equal(minimum.overflow,false);assert.ok(minimum.terminalTop<40);await page.screenshot({path:join(artifacts,'batch4-minimum.png')});
    await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('dialog',{name:'编辑主机',exact:true}).getByText('可直接修改主机信息。已建立的会话保持原连接，修改在下次连接时生效。',{exact:true}).waitFor();await page.screenshot({path:join(artifacts,'batch4-edit.png')});await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/^断开连接/}).click();await active().locator('.terminal-status').getByText('已断开',{exact:true}).waitFor();await assert.rejects(exchange(forward.localPort));
    await connect('修改后的目标',true);await type('new-configuration-connects');assert.equal(next.stats.authenticated,1);assert.ok((await active().locator('.session-endpoint').textContent()).includes(`localhost:${next.port}`));
    checks.push('active host edits persist immediately; original SSH/forward keep their endpoint; reconnect uses new address/port/jump config and validates new fingerprint');
    checks.push('removed large header; normal/minimum terminal geometry measured; edit dialog and toolbar accessible at 900x600');
    await app.close();app=undefined;
    // Replace only the isolated installation, exercising the ZIP replacement path.
    run('ditto',[join(zipOutput,'Harbor SSH.app'),installedApp]);await launch(installedApp,true);await page.getByRole('tab').nth(1).waitFor();assert.equal((await page.evaluate(()=>window.harbor.listIdentities())).length,2);await connect('修改后的目标');await type('replacement-retains-identities');await app.close();app=undefined;
    const legacyProfiles=[];
    for(const version of [1,2]) {
      const directory=mkdtempSync(join(artifacts,`batch4-v${version}-`)),file=join(directory,'harbor.sqlite');const db=new Database(file);
      db.exec(`CREATE TABLE hosts(id TEXT PRIMARY KEY,name TEXT NOT NULL,address TEXT NOT NULL,port INTEGER NOT NULL,username TEXT NOT NULL,group_name TEXT NOT NULL);CREATE TABLE known_hosts(address TEXT NOT NULL,port INTEGER NOT NULL,fingerprint TEXT NOT NULL,trusted_at TEXT NOT NULL,PRIMARY KEY(address,port));PRAGMA user_version=${version};`);
      if(version===2){db.exec("CREATE TABLE identities(id TEXT PRIMARY KEY,ciphertext BLOB NOT NULL);CREATE TABLE workspace(id INTEGER PRIMARY KEY CHECK(id=1),content TEXT NOT NULL);ALTER TABLE hosts ADD COLUMN identity_id TEXT REFERENCES identities(id);ALTER TABLE hosts ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'password';");for(const row of originalIdentities)db.prepare('INSERT INTO identities VALUES(?,?)').run(row.id,row.ciphertext);db.prepare('INSERT INTO workspace VALUES(1,?)').run(JSON.stringify(oldWorkspace));writeFileSync(join(directory,'vault-key.bin'),originalWrapped);chmodSync(join(directory,'vault-key.bin'),0o600);}
      for(const host of (version===1?[oldHosts.find(host=>host.name==='升级跳板')]:oldHosts)) {
        if(version===1)db.prepare('INSERT INTO hosts VALUES(?,?,?,?,?,?)').run(host.id,host.name,host.address,host.port,'fixture',host.group);
        else db.prepare('INSERT INTO hosts VALUES(?,?,?,?,?,?,?,?)').run(host.id,host.name,host.address,host.port,host.username,host.group,host.identityId,host.authMode);
      }
      for(const item of oldTrust)db.prepare('INSERT INTO known_hosts VALUES(?,?,?,?)').run(item.address,item.port,item.fingerprint,item.trustedAt);db.close();
      await launch(installedApp,true,directory);await page.waitForFunction(async expected=>(await window.harbor.listHosts()).length===expected,version===1?1:2);
      assert.ok(existsSync(file+`.v${version}-backup.sqlite`));const backup=new Database(file+`.v${version}-backup.sqlite`,{readonly:true});assert.equal(backup.pragma('user_version',{simple:true}),version);backup.close();
      const migrated=new Database(file,{readonly:true});assert.equal(migrated.pragma('user_version',{simple:true}),3);if(version===2)assert.deepEqual(migrated.prepare('SELECT id,ciphertext FROM identities ORDER BY id').all().map(row=>({id:row.id,sha256:hash(row.ciphertext)})),before.identities);migrated.close();
      assert.deepEqual(await page.evaluate(()=>window.harbor.listKnownHosts()),oldTrust);
      if(version===1){await page.getByRole('button',{name:/^连接主机/}).click();await page.getByLabel('临时密码',{exact:true}).fill('fixture-password-only');await page.getByRole('button',{name:'开始连接',exact:true}).click();await active().locator('.terminal-status').getByText('已连接',{exact:true}).waitFor();}
      else {assert.equal((await page.evaluate(()=>window.harbor.listIdentities())).length,2);assert.deepEqual(await page.evaluate(()=>window.harbor.getWorkspace()),oldWorkspace);await connect('升级跳板');await connect('升级目标');}
      await app.close();app=undefined;scan(directory);legacyProfiles.push({version,directory,backup:true,connected:true});
    }
    checks.push('packaged app migrates constructed v1/v2 profiles with versioned backups; v2 encrypted identities and workspace survive and authenticate');
    scan(profile);assert.deepEqual(errors,[]);
    const report={result:'passed',profile,installedApp,previous:oldInfo,current:newInfo,checks,nativeKeychain:true,legacyProfiles,geometry:{before:JSON.parse(readFileSync(join(artifacts,'batch4-before.json'),'utf8')),after:{normal,minimum}},signing:manifest.signing,notarized:manifest.notarized,plaintextTestCredentialsFound:false,visualConsumers:'checked 3 / changed 3 / left 0'};
    writeFileSync(join(artifacts,'batch4-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await new Promise(resolve=>echo.close(resolve));}
})().catch(async error=>{if(page&&!page.isClosed())try{await page.screenshot({path:join(artifacts,'batch4-failure.png')});console.error('Safe UI errors:',await page.locator('.form-error,.session-error,.error-banner').allTextContents());}catch{}console.error(error.message);process.exitCode=1;}).finally(async()=>{if(app)await app.close();for(const fixture of fixtures)await fixture.close();if(mounted)run('hdiutil',['detach',mount]);});
