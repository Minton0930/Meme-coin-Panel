// Update check. update-source.txt holds a public GitHub repo ("owner/repo").
// start.bat downloads the newest version on every start; this file only tells
// the open dashboard when a newer version has been published meanwhile.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

export const updateState = { current: null, latest: null, available: false, repo: null };

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function check() {
  if (!updateState.repo) return;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${updateState.repo}/main/package.json`, { signal: AbortSignal.timeout(10_000), headers: { 'cache-control': 'no-cache' } });
    if (!r.ok) return;
    updateState.latest = (await r.json()).version;
    updateState.available = newer(updateState.latest, updateState.current);
  } catch {}
}

export function startUpdateCheck() {
  updateState.current = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const f = join(ROOT, 'update-source.txt');
  const repo = existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return;
  updateState.repo = repo;
  check();
  setInterval(check, 15 * 60_000);
}
