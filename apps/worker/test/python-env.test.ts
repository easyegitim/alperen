/**
 * Python alt süreçleri sırları devralmaz: `minimalPythonEnv()` yalnız izinli anahtarları taşır ve gerçek bir
 * `python3 -I` çocuğu ANTHROPIC/SUPABASE/DATABASE içeren hiçbir ortam değişkeni görmez.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { minimalPythonEnv } from '../src/documents/sandbox.js';

const SECRETS = ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of SECRETS) {
    saved[k] = process.env[k];
    process.env[k] = 'gizli-deger';
  }
});
afterEach(() => {
  for (const k of SECRETS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const hasPython = (() => {
  try {
    execFileSync('python3', ['-I', '-c', 'pass'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('minimalPythonEnv', () => {
  it('sır içeren hiçbir anahtar taşımaz, yalnız izinli anahtarlar vardır', () => {
    const env = minimalPythonEnv();
    for (const k of SECRETS) expect(env).not.toHaveProperty(k);
    expect(Object.keys(env).sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'MPLBACKEND', 'PATH', 'PYTHONDONTWRITEBYTECODE', 'TMPDIR']);
    expect(env.MPLBACKEND).toBe('Agg');
    expect(env.PYTHONDONTWRITEBYTECODE).toBe('1');
    expect(env.PATH).toBe(process.env.PATH ?? '/usr/bin:/bin');
  });
});

describe.skipIf(!hasPython)('gerçek python3 -I çocuğu', () => {
  it('ortamında ANTHROPIC / SUPABASE / DATABASE yoktur', () => {
    const r = spawnSync('python3', ['-I', '-c', 'import os, json; print(json.dumps(sorted(os.environ)))'], { env: minimalPythonEnv(), encoding: 'utf8' });
    expect(r.status).toBe(0);
    const keys = JSON.parse(r.stdout) as string[];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).not.toMatch(/ANTHROPIC|SUPABASE|DATABASE/);
  });
});
