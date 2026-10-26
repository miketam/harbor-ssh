import type { UpdateCheck } from '../shared';

const feed = 'https://api.github.com/repos/miketam/harbor-ssh/releases/latest';
const releaseBase = 'https://github.com/miketam/harbor-ssh/releases/tag/';
const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(value: string): number[] | null {
  const match = versionPattern.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function newerVersion(latest: string, current: string): boolean {
  const a = versionParts(latest), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function assessRelease(data: unknown, currentVersion: string, platform: NodeJS.Platform, arch: string, checkedAt = Date.now()): { result: UpdateCheck; page: string | null } {
  if (!data || typeof data !== 'object') throw new Error('更新信息格式无效');
  const release = data as Record<string, unknown>;
  const tag = release.tag_name;
  if (release.draft !== false || release.prerelease !== false || typeof tag !== 'string' || !versionParts(tag) || !Array.isArray(release.assets)) throw new Error('更新信息格式无效');
  const latestVersion = tag.replace(/^v/, '');
  const newer = newerVersion(latestVersion, currentVersion);
  const suffix = platform === 'darwin' && (arch === 'arm64' || arch === 'x64') ? `-mac-${arch}.dmg` : platform === 'win32' && arch === 'x64' ? '-win-x64-setup.exe' : null;
  const compatible = !!suffix && release.assets.some(asset => asset && typeof asset === 'object' && (asset as { name?: unknown }).name === `harbor-ssh-${latestVersion}${suffix}`);
  const status = !newer ? 'up-to-date' : compatible ? 'available' : 'unsupported';
  return { result: { currentVersion, latestVersion, status, checkedAt }, page: newer ? releaseBase + encodeURIComponent(tag) : null };
}

export async function checkLatestRelease(currentVersion: string, platform = process.platform, arch = process.arch): Promise<{ result: UpdateCheck; page: string | null }> {
  let response: Response;
  try {
    response = await fetch(feed, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Harbor-SSH/${currentVersion}` }, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch { throw new Error('无法连接更新服务，请稍后重试'); }
  if (!response.ok || !response.body) throw new Error('无法读取更新信息，请稍后重试');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512 * 1024) throw new Error('更新信息过大');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return assessRelease(JSON.parse(Buffer.concat(chunks).toString('utf8')), currentVersion, platform, arch); }
  catch { throw new Error('更新信息格式无效'); }
}
