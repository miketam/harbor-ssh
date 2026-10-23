const { generateKeyPairSync } = require('node:crypto');
const { Server, utils } = require('ssh2');
const { once } = require('node:events');
function makeHostKey() { return generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } }).privateKey; }
async function serverFixture({ key = makeHostKey(), port = 0, auth = 'password', publicKey, allowForward = false }  = {}) {
  const clients = new Set();
  const stats = { connections: 0, authenticated: 0, sizes: [], input: '', methods: [], answers: [] };
  const authorized = publicKey ? utils.parseKey(publicKey) : null;
  const server = new Server({ hostKeys: [key] }, client => {
    stats.connections++; clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    let keyAccepted = false;
    client.on('authentication', ctx => {
      stats.methods.push(ctx.method);
      const methods = auth === 'password' ? ['password'] : auth === 'publickey' ? ['publickey'] : auth === 'key+interactive' && !keyAccepted ? ['publickey'] : ['keyboard-interactive'];
      if (ctx.username !== 'fixture') { ctx.reject(methods); return; }
      if (auth === 'password' && ctx.method === 'password' && ctx.password === 'fixture-password-only') { stats.authenticated++; ctx.accept(); return; }
      if (['publickey','key+interactive'].includes(auth) && ctx.method === 'publickey' && authorized && !(authorized instanceof Error) && authorized.getPublicSSH().equals(ctx.key.data)) {
        if (!ctx.signature) { ctx.accept(); return; }
        if (authorized.verify(ctx.blob,ctx.signature,ctx.hashAlgo) !== true) { ctx.reject(methods); return; }
        keyAccepted = true;
        if (auth === 'key+interactive') ctx.reject(['keyboard-interactive'],true);
        else { stats.authenticated++; ctx.accept(); }
        return;
      }
      if ((auth === 'interactive' || (auth === 'key+interactive' && keyAccepted)) && ctx.method === 'keyboard-interactive') {
        ctx.prompt([{prompt:'Test password: ',echo:false}], 'Fixture authentication', 'First round', first => {
          stats.answers.push(first);
          if (first[0] !== 'interactive-fixture-password') { ctx.reject(['keyboard-interactive']); return; }
          ctx.prompt([{prompt:'Verification code: ',echo:false},{prompt:'Device label: ',echo:true}], 'Fixture authentication', 'Second round', second => {
            stats.answers.push(second);
            if (second[0] === '246810' && second[1] === 'fixture-device') { stats.authenticated++;ctx.accept(); }
            else ctx.reject(['keyboard-interactive']);
          });
        });
        return;
      }
      ctx.reject(methods);
    });
    client.on('tcpip', (accept, reject, info) => {
      if (!allowForward) return reject();
      const socket = require('node:net').connect(info.destPort, info.destIP);
      socket.on('error', () => { try { reject(); } catch {} socket.destroy(); });
      socket.once('connect', () => {
        const channel = accept(); channel.on('error', () => channel.destroy());
        socket.pipe(channel).pipe(socket); socket.once('close', () => channel.destroy()); channel.once('close', () => socket.destroy());
      });
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', (accept, _reject, info) => { stats.sizes.push([info.cols, info.rows]); accept?.(); });
      session.on('window-change', (accept, _reject, info) => { stats.sizes.push([info.cols, info.rows]); accept?.(); });
      session.on('shell', accept => {
        const stream = accept(); stream.write('fixture-ready\r\n');
        stream.on('data', data => { stats.input += data.toString(); stream.write(data); });
      });
    }));
  });
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  return { port: server.address().port, stats, key, close: async () => { for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { makeHostKey, serverFixture };
