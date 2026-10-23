import { packager } from '@electron/packager';
import { listPackage, extractFile } from '@electron/asar';
import { mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const release = join(root, 'release');
const basename = `harbor-ssh-${pkg.version}-win-x64`;
mkdirSync(release, { recursive: true });
const [output] = await packager({
  dir: root, out: release, name: 'Harbor SSH', executableName: 'Harbor SSH',
  extraResource: [join(root, "LICENSE"), join(root, "THIRD_PARTY_NOTICES.md"), join(root, "node_modules/electron/dist/LICENSES.chromium.html")],
  platform: 'win32', arch: 'x64', electronVersion: pkg.devDependencies.electron,
  win32metadata: { CompanyName: 'Harbor SSH', ProductName: 'Harbor SSH' },
  appVersion: pkg.version, overwrite: true, prune: true,
  asar: { unpack: '**/*.{node,dll}' },
  ignore: name => (!!name && !/^\/(?:dist(?:\/|$)|dist-electron(?:\/|$)|node_modules(?:\/|$)|package\.json$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(name))
    || /\/node_modules\/better-sqlite3\/(?:src|deps|build)(?:\/|$)/.test(name)
    || (name.includes('/better-sqlite3/prebuilds/') && name.endsWith('.node') && !name.endsWith('/win32-x64.node'))
    // ssh2 has a JavaScript fallback; never ship the build host's optional addons.
    || /\/node_modules\/(?:cpu-features|ssh2)\/.*\.(?:node|o|a)$/.test(name),
});
const entries = listPackage(join(output, 'resources/app.asar'));
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  if (!extractFile(join(output, 'resources/app.asar'), file).equals(readFileSync(join(root, file)))) throw new Error(`许可证缺失或不一致：${file}`);
}
if (entries.some(file => /^\/(?:tests|scripts|src|test-artifacts|release|\.env)(?:\/|$)/.test(file)
  || /^\/node_modules\/(?:electron|playwright|typescript|@electron\/packager)(?:\/|$)/.test(file))) throw new Error('安装包包含非运行时资料');
const native = readFileSync(join(output, 'resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node'));
const pe = native.readUInt32LE(0x3c);
if (native.toString('ascii', 0, 2) !== 'MZ' || native.toString('ascii', pe, pe + 4) !== 'PE\0\0' || native.readUInt16LE(pe + 4) !== 0x8664) throw new Error('SQLite 不是 Windows x64 模块');
// NSIS accepts forward slashes in build paths on both Windows and macOS.
const nsisPath = value => value.replaceAll('\\', '/').replaceAll('$', '$$').replaceAll('"', '$\\"');
const installer = join(release, `${basename}-setup.exe`);
const script = join(release, `${basename}.nsi`);
// A custom install folder may contain unrelated files; remove only shipped paths.
const installedPaths = readdirSync(output, { recursive: true });
const uninstallFiles = installedPaths.filter(path => statSync(join(output, path)).isFile())
  .map(path => `  Delete "$INSTDIR\\${nsisPath(path).replaceAll('/', '\\')}"`).join('\n');
const uninstallDirectories = installedPaths.filter(path => statSync(join(output, path)).isDirectory())
  .sort((a, b) => b.length - a.length)
  .map(path => `  RMDir "$INSTDIR\\${nsisPath(path).replaceAll('/', '\\')}"`).join('\n');
writeFileSync(script, `Unicode true
!include "MUI2.nsh"
Name "Harbor SSH"
OutFile "${nsisPath(installer)}"
InstallDir "$LOCALAPPDATA\\Programs\\Harbor SSH"
InstallDirRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HarborSSH" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section
  SetShellVarContext current
  FindWindow $0 "Chrome_WidgetWin_1" "Harbor SSH"
  StrCmp $0 0 +3
    MessageBox MB_OK "请先退出 Harbor SSH，再安装或升级。"
    Abort
  SetOutPath "$INSTDIR"
  File /r "${nsisPath(output)}/*"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\\Harbor SSH"
  CreateShortcut "$SMPROGRAMS\\Harbor SSH\\Harbor SSH.lnk" "$INSTDIR\\Harbor SSH.exe"
  CreateShortcut "$SMPROGRAMS\\Harbor SSH\\卸载.lnk" "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HarborSSH" "DisplayName" "Harbor SSH"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HarborSSH" "DisplayVersion" "${pkg.version}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HarborSSH" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HarborSSH" "UninstallString" '$\\"$INSTDIR\\Uninstall.exe$\\"'
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  FindWindow $0 "Chrome_WidgetWin_1" "Harbor SSH"
  StrCmp $0 0 +3
    MessageBox MB_OK "请先退出 Harbor SSH，再卸载。"
    Abort
${uninstallFiles}
  Delete "$INSTDIR\\Uninstall.exe"
${uninstallDirectories}
  RMDir "$INSTDIR"
  RMDir /r "$SMPROGRAMS\\Harbor SSH"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HarborSSH"
SectionEnd
`);
execFileSync(process.env.MAKENSIS || 'makensis', [script], { stdio: 'inherit' });
const sha256 = createHash('sha256').update(readFileSync(installer)).digest('hex');
writeFileSync(join(release, `${basename}-SHA256SUMS`), `${sha256}  ${basename}-setup.exe\n`);
writeFileSync(join(release, `${basename}-manifest.json`), JSON.stringify({ version: pkg.version, platform: 'win32', arch: 'x64', electron: pkg.devDependencies.electron, signing: 'unsigned', runtimeTested: false, artifacts: [{ file: `${basename}-setup.exe`, bytes: statSync(installer).size, sha256 }] }, null, 2) + '\n');
console.log(`Windows 安装包：${installer}`);
