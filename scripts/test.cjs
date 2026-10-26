const { spawnSync } = require('node:child_process');
const electron = require('electron');
const run = spawnSync(electron, ['--test', 'tests/i18n.test.cjs', 'tests/core.test.cjs', 'tests/vault.test.cjs', 'tests/batch3.test.cjs', 'tests/upgrade.test.cjs', 'tests/updates.test.cjs'], { cwd: require('node:path').join(__dirname, '..'), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
process.exit(run.status ?? 1);
