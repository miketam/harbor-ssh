const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Test credentials only. ssh2 1.17's generator strips leading zero Ed25519
// public bytes, so use the independent OpenSSH implementation for fixtures.
function makeEd25519(passphrase = '', leadingZero = false) {
  const directory = mkdtempSync(join(tmpdir(), 'harbor-test-key-'));
  const path = join(directory, 'key');
  const run = args => execFileSync('ssh-keygen', args, { stdio: 'pipe', timeout: 10000 });
  try {
    for (let i = 0; i < 4096; i++) {
      run(['-q', '-t', 'ed25519', '-N', '', '-C', 'harbor-test-only', '-f', path]);
      const publicKey = readFileSync(path + '.pub', 'utf8').trim();
      const blob = Buffer.from(publicKey.split(' ')[1], 'base64');
      if (!leadingZero || blob[19] === 0) {
        if (passphrase) run(['-q', '-p', '-a', '4', '-P', '', '-N', passphrase, '-f', path]);
        return { public: publicKey, private: readFileSync(path, 'utf8') };
      }
      unlinkSync(path); unlinkSync(path + '.pub');
    }
    throw new Error('Could not generate leading-zero test public key');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
module.exports = { makeEd25519 };
