const { _electron: electron } = require('playwright');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { makeEd25519 } = require('../tests/key-fixture.cjs');
const assert = require('node:assert/strict');
const root=resolve(__dirname,'..'),artifacts=join(root,'test-artifacts');mkdirSync(artifacts,{recursive:true});
const profile=mkdtempSync(join(artifacts,'openssh-batch2-')),name=`harbor-auth-${process.pid}`;
const keys=makeEd25519('openssh-batch2-passphrase');
function docker(args,input){return execFileSync('docker',args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe'],timeout:120000}).trim();}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let app,created=false;
function scan(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())scan(path);else if(!['LOCK','SingletonLock','SingletonCookie','SingletonSocket'].includes(entry.name)){const bytes=readFileSync(path);for(const value of ['fixture-password-only','openssh-batch2-passphrase','-----BEGIN OPENSSH PRIVATE KEY-----'])assert.equal(bytes.includes(Buffer.from(value)),false);}}}
(async()=>{
  docker(['run','-d','--rm','--name',name,'-p','127.0.0.1::22','alpine:3.23','sh','-c',"apk add --no-cache openssh-server-pam >/dev/null && ssh-keygen -A >/dev/null 2>&1 && adduser -D -s /bin/sh fixture && echo fixture:fixture-password-only | chpasswd && printf 'auth required pam_unix.so\naccount required pam_unix.so\nsession required pam_permit.so\n' > /etc/pam.d/sshd && exec /usr/sbin/sshd.pam -D -e -o UsePAM=yes -o PasswordAuthentication=yes -o KbdInteractiveAuthentication=yes -o PermitRootLogin=no -o PrintMotd=no"]);created=true;
  let ready=false;for(let i=0;i<90;i++){try{docker(['exec',name,'pgrep','-f','^sshd.*: /usr/sbin/sshd.pam']);ready=true;break;}catch{await pause(1000);}}assert.ok(ready,'OpenSSH PAM did not start');
  docker(['exec','-i',name,'sh','-c','mkdir -p /home/fixture/.ssh && cat > /home/fixture/.ssh/authorized_keys && chown -R fixture:fixture /home/fixture/.ssh && chmod 700 /home/fixture/.ssh && chmod 600 /home/fixture/.ssh/authorized_keys'],keys.public+'\n');
  const port=Number(docker(['port',name,'22/tcp']).split(':').pop());
  const env={...process.env,HARBOR_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[root],env});const page=await app.firstWindow();page.setDefaultTimeout(20000);await page.getByRole('heading',{level:1}).waitFor();
  await page.evaluate(async({port,privateKey})=>{
    const clear={action:'clear'},replace=value=>({action:'replace',value});
    const password=await window.harbor.saveIdentity({name:'OpenSSH 密码身份',username:'fixture',method:'password',password:replace('fixture-password-only'),privateKey:clear,passphrase:clear});
    const key=await window.harbor.saveIdentity({name:'OpenSSH 私钥身份',username:'fixture',method:'privateKey',password:clear,privateKey:replace(privateKey),passphrase:replace('openssh-batch2-passphrase')});
    const hosts=[];
    hosts.push(await window.harbor.saveHost({name:'真实密码认证',address:'127.0.0.1',port,username:'',group:'OpenSSH',identityId:password.id}));
    hosts.push(await window.harbor.saveHost({name:'真实私钥认证',address:'127.0.0.1',port,username:'',group:'OpenSSH',identityId:key.id}));
    hosts.push(await window.harbor.saveHost({name:'真实 PAM 交互认证',address:'127.0.0.1',port,username:'fixture',group:'OpenSSH',authMode:'interactive'}));
    await window.harbor.saveWorkspace({tabs:hosts.map((host,index)=>({id:'openssh-tab-'+index,hostId:host.id})),activeTabId:'openssh-tab-0',selectedHostId:hosts[0].id});
  },{port,privateKey:keys.private});
  await page.reload();await page.getByRole('tab').nth(2).waitFor();
  async function execute(marker){await page.getByRole('tabpanel').locator('.xterm-helper-textarea').focus();const encoded=[...Buffer.from(marker)].map(b=>'\\'+b.toString(8).padStart(3,'0')).join('');await page.keyboard.type(`printf "${encoded}\\n"; tty`);await page.keyboard.press('Enter');await page.waitForFunction(marker=>document.querySelector('[role=tabpanel]:not([hidden]) .xterm-screen')?.textContent.includes(marker),marker);}
  async function begin(){await page.getByRole('button',{name:/^连接主机/}).click();const dialog=page.getByRole('dialog',{name:'连接主机',exact:true});assert.equal(await dialog.locator('input[type=password]').count(),0);await dialog.getByRole('button',{name:'开始连接'}).click();}
  await begin();await page.getByRole('button',{name:'信任并连接'}).click();await page.getByRole('tabpanel').locator('.terminal-status').getByText('已连接',{exact:true}).waitFor();await execute('SAVED_PASSWORD_OK');
  await page.getByRole('tab',{name:'真实私钥认证',exact:true}).click();await begin();await page.getByRole('tabpanel').locator('.terminal-status').getByText('已连接',{exact:true}).waitFor();await execute('PRIVATE_KEY_OK');
  await page.getByRole('tab',{name:'真实 PAM 交互认证',exact:true}).click();await begin();
  const question=page.getByRole('dialog',{name:'交互认证',exact:true});await question.waitFor();assert.equal(await question.locator('input').first().getAttribute('type'),'password');await question.locator('input').first().fill('fixture-password-only');await question.getByRole('button',{name:'提交回答'}).click();
  await page.getByRole('tabpanel').locator('.terminal-status').getByText('已连接',{exact:true}).waitFor();await execute('PAM_INTERACTIVE_OK');
  assert.equal(await page.locator('.terminal-pane .terminal-status .status-dot.connected').count(),3);
  await page.screenshot({path:join(artifacts,'batch2-openssh-pam.png')});
  await app.close();app=undefined;scan(profile);
  const report={result:'passed',profile,sshVersion:docker(['exec',name,'sh','-c','/usr/sbin/sshd.pam -V 2>&1']),checks:['real OpenSSH saved encrypted password authentication','real OpenSSH encrypted Ed25519 key and saved passphrase','real OpenSSH/PAM keyboard-interactive','three concurrent independent PTYs','remote shell commands in all three tabs','no plaintext test credentials persisted']};writeFileSync(join(artifacts,'openssh-batch2-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close();if(created)docker(['rm','-f',name]);});
