// E2E için üretim derlemesi: NEXT_PUBLIC_* değerleri derleme sırasında gömüldüğünden sahte Supabase adresiyle,
// ayrı bir dizine (.next-e2e) derlenir. Çıktı güncelse yeniden derlenmez (E2E_REBUILD=1 ile zorla).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_ANON_KEY, FAKE_URL } from './fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(ROOT, '.next-e2e');

function newestMtime(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.next-e2e', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return newest;
}

const built = fs.existsSync(path.join(dist, 'BUILD_ID')) ? fs.statSync(path.join(dist, 'BUILD_ID')).mtimeMs : 0;
const sourcesChanged = ['src', 'public', 'next.config.ts', 'package.json'].some((p) => {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return false;
  return (fs.statSync(full).isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs) > built;
});
if (built && !sourcesChanged && !process.env.E2E_REBUILD) {
  console.log('e2e derlemesi güncel (.next-e2e)');
  process.exit(0);
}
const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'build', '--webpack'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NEXT_DIST_DIR: '.next-e2e', NEXT_PUBLIC_SUPABASE_URL: FAKE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON_KEY, NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${process.env.E2E_WEB_PORT || 3101}` },
});
process.exit(r.status ?? 1);
