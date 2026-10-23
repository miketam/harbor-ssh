import { packager } from '@electron/packager';
import { listPackage } from '@electron/asar';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

if (process.platform !== 'darwin') throw new Error('macOS 安装包须在 Mac 上构建');
const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
const arch = process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error('只支持当前 Mac 架构构建');
const release = join(root, 'release'); mkdirSync(release, { recursive: true });
const work = mkdtempSync(join(release, '.package-'));
const run = (binary, args) => execFileSync(binary, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const identity = process.env.HARBOR_SIGN_IDENTITY || '-';
const bundleId = 'app.harbor.ssh';
try {
  console.log('生成 Harbor 图标');
  run('xcrun', ['swift', join(root, 'packaging/icon.swift'), join(work, 'icon.png')]);
  const iconset = join(work, 'Harbor.iconset'); mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1,2]) {
    run('sips', ['-z', String(size * scale), String(size * scale), join(work, 'icon.png'), '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
  }
  const icon = join(work, 'Harbor.icns'); run('iconutil', ['-c', 'icns', iconset, '-o', icon]);
  console.log(`打包 macOS ${arch}，签名方式：${identity === '-' ? 'ad-hoc 本地测试' : '配置的 Developer ID'}`);
  const [output] = await packager({
    dir: root, out: release, name: 'Harbor SSH', executableName: 'Harbor SSH',
    appBundleId: bundleId, helperBundleId: `${bundleId}.helper`, appCategoryType: 'public.app-category.developer-tools',
    platform: 'darwin', arch, electronVersion: pkg.devDependencies.electron, appVersion: pkg.version, buildVersion: pkg.version,
    icon, overwrite: true, prune: true, asar: { unpack: '**/*.{node,dylib}' },
    ignore: name => (!!name && !/^\/(?:dist(?:\/|$)|dist-electron(?:\/|$)|node_modules(?:\/|$)|package\.json$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(name)) || /\/node_modules\/better-sqlite3\/(?:src|deps|build)(?:\/|$)/.test(name) || (name.includes('/better-sqlite3/prebuilds/') && name.endsWith('.node') && !name.endsWith(`/darwin-${arch}.node`)),
    osxSign: { identity, identityValidation: identity !== '-', gatekeeperAssess: false, preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      // Ad-hoc builds have no Team ID; explicitly clear inherited runtime flags.
      optionsForFile: () => ({ entitlements: join(root, 'packaging/entitlements.plist'), hardenedRuntime: identity !== '-', ...(identity === '-' ? { signatureFlags: '0' } : {}) })
    },
  });
  const app = join(output, 'Harbor SSH.app');
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  const archive = join(app, 'Contents/Resources/app.asar');
  const entries = listPackage(archive);
  if (entries.some(file => /^\/(?:test-artifacts|tests|scripts|src|evidence|release|\.env)(?:\/|$)/.test(file))) throw new Error('安装包包含非运行时资料');
  if (entries.some(file => /^\/node_modules\/(?:playwright|electron|typescript|@electron\/packager)(?:\/|$)/.test(file))) throw new Error('安装包包含开发依赖');
  const nativeDirectory = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds');
  const nativeModules = readdirSync(nativeDirectory).filter(file => file.endsWith('.node')).map(file => ({ path: `better-sqlite3/prebuilds/${file}`, architecture: run('file', ['-b', join(nativeDirectory,file)]).trim() }));
  if (!nativeModules.length || nativeModules.some(file => !file.architecture.includes(arch === 'x64' ? 'x86_64' : 'arm64'))) throw new Error('SQLite 原生模块架构不匹配');
  const basename = `harbor-ssh-${pkg.version}-mac-${arch}`;
  const zip = join(release, `${basename}.zip`), dmg = join(release, `${basename}.dmg`);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const stage = join(work, 'dmg'); mkdirSync(stage); run('ditto', [app, join(stage, 'Harbor SSH.app')]);
  symlinkSync('/Applications', join(stage, 'Applications'));
  writeFileSync(join(stage, '安装说明.txt'), `Harbor SSH ${pkg.version}\n\n先退出旧版，将 Harbor SSH.app 拖到 Applications 后启动。\n已有数据保存在 ~/Library/Application Support/Harbor SSH，不在应用包内。\n升级会保留身份密钥文件；不要删除数据目录或 Keychain 条目。\n${identity === '-' ? '此包仅有 ad-hoc 本地签名，未获 Apple 公证，尚不是正式分发版本。' : '此包有代码签名，公证状态以发布验证报告为准。'}\n`);
  console.log('创建 DMG 与 ZIP');
  run('hdiutil', ['create', '-volname', 'Harbor SSH', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg]);
  run('hdiutil', ['verify', dmg]);
  const artifacts = [dmg, zip].map(path => ({ file: path.split('/').pop(), sha256: hash(path), bytes: statSync(path).size }));
  writeFileSync(join(release, 'SHA256SUMS'), artifacts.map(a => `${a.sha256}  ${a.file}`).join('\n')+'\n');
  const manifest = { version: pkg.version, platform: 'darwin', arch, electron: pkg.devDependencies.electron, bundleId, signing: identity === '-' ? 'ad-hoc' : 'developer-id', notarized: false, app, minimumMacOS: run('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', join(app,'Contents/Info.plist')]).trim(), asarSha256: hash(archive), nativeModules, artifacts };
  writeFileSync(join(release, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
  console.log(JSON.stringify(manifest, null, 2));
} finally { rmSync(work, { recursive: true, force: true }); }
