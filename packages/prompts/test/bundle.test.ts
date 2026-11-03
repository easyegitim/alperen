import { describe, expect, it } from 'vitest';
import { collectSources, lockConflicts, renderBundle, renderLock, validate, type LockFile } from '../scripts/build-bundle.js';
import { PROMPT_DEFAULTS, PROMPT_SOURCES } from '../src/bundle.gen.js';
import { readFileSync } from 'node:fs';
import { allPrompts, PromptRegistry } from '../src/index.js';

const LOCK_PATH = new URL('../prompts.lock.json', import.meta.url);

describe('gömülü kaynaklar ve kilit', () => {
  it('src/bundle.gen.ts diskteki .md dosyalarıyla aynı', () => {
    const disk = collectSources();
    expect(Object.keys(PROMPT_SOURCES).sort()).toEqual(Object.keys(disk).sort());
    for (const [k, v] of Object.entries(disk)) expect(PROMPT_SOURCES[k], k).toBe(v.replace(/\r\n?/g, '\n'));
    expect(readFileSync(new URL('../src/bundle.gen.ts', import.meta.url), 'utf8')).toBe(renderBundle(disk, { ...PROMPT_DEFAULTS }));
  });

  it('kilit güncel ve doğrulama temiz', () => {
    expect(readFileSync(LOCK_PATH, 'utf8')).toBe(renderLock(allPrompts(), { ...PROMPT_DEFAULTS }));
    expect(validate(new PromptRegistry(PROMPT_SOURCES)).errors).toEqual([]);
  });

  it('kilitlenmiş sürümün değişmesini ve silinmesini yakalar', () => {
    const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as LockFile;
    expect(lockConflicts(lock, allPrompts())).toEqual([]);
    const changed = structuredClone(lock);
    const first = Object.keys(changed.prompts)[0] as string;
    (changed.prompts[first] as { sha256: string }).sha256 = '0'.repeat(64);
    expect(lockConflicts(changed, allPrompts())).toEqual([`${first}: kilitlenmiş sürüm değişti; yeni sürüm açın ya da --relock`]);
    const extra = structuredClone(lock);
    extra.prompts['silinen@v1'] = { sha256: 'x', model: 'm', effort: 'low', schema: null, tools: [] };
    expect(lockConflicts(extra, allPrompts())[0]).toMatch(/silinen@v1: kilitte var/);
    expect(lockConflicts(null, allPrompts())).toEqual([]);
  });

  it('doğrulama kısa ve kurala aykırı promptu reddeder', () => {
    const reg = new PromptRegistry({
      'layers/product.v1.md': 'kısa ürün',
      'layers/roles/analyst.v1.md': 'kısa rol!',
      'demo/v1.md': '---\nroute: demo\nversion: v1\nmodel: claude-haiku-5-5\neffort: low\nschema: null\ntools: []\nrole: analyst\nlayers: [product.v1, roles/analyst.v1]\n---\ngövde\n',
    });
    const { errors } = validate(reg);
    expect(errors.some((e) => e.includes('önbellek için en az 512'))).toBe(true);
    expect(errors.some((e) => e.includes('no-exclamation'))).toBe(true);
  });
});
