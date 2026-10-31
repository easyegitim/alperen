/**
 * Kaynak denetimleri (§5.11): answer-key-import, no-runtime-ajv, rpc-names, log kuralı.
 * Kaynak dosyalar düz metin olarak okunur (Node).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import rpcNames from '../rpc-names.json';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(SRC).filter((f) => f.endsWith('.ts'));
const read = (f: string): string => readFileSync(f, 'utf8');

describe('answer-key-import', () => {
  it("src/ içinde 'answer-key' içe alımı ve doğru şık alanı adı yok", () => {
    const keyField = 'correct' + '_option';
    for (const f of files) {
      const s = read(f);
      expect(s.includes('answer-key'), f).toBe(false);
      expect(s.includes(keyField), f).toBe(false);
    }
  });

  it('hizmet rolü ve JWT gizi adları yalnız "anahtar yok" işaretli satırlarda (env.ts ret kuralı)', () => {
    for (const f of files) {
      for (const line of read(f).split('\n')) {
        if (/service_role|SUPABASE_JWT_SECRET/.test(line)) expect(line.includes('// anahtar yok'), `${f}: ${line}`).toBe(true);
      }
    }
  });
});

describe('no-runtime-ajv', () => {
  it("src/ içinde `new Ajv(` ve `from 'ajv'` yok; structured.ts önceden derlenmiş doğrulayıcıyı içe alır", () => {
    for (const f of files) {
      const s = read(f);
      expect(s.includes('new Ajv('), f).toBe(false);
      expect(/from ['"]ajv/.test(s), f).toBe(false);
      expect(/from ['"]@ogrenmen\/contracts['"]/.test(s), `${f}: kök dışa aktarım çalışma anında Ajv derler`).toBe(false);
    }
    expect(read(join(SRC, 'llm/structured.ts'))).toContain("from '@ogrenmen/contracts/validators'");
  });
});

describe('rpc-names', () => {
  const pg = read(join(SRC, 'data/postgrest.ts'));
  const fake = read(join(SRC, 'data/fake.ts'));
  const called = [...new Set([...pg.matchAll(/this\.rpc(?:<[^>]*>)?\('([a-z_]+)'/g)].map((m) => m[1] ?? ''))].sort();
  const faked = [...new Set([...fake.matchAll(/this\.rpc\('([a-z_]+)'\)/g)].map((m) => m[1] ?? ''))].sort();

  it('PostgREST istemcisinin çağırdığı RPC adları test/rpc-names.json ile sabit', () => {
    expect(called).toEqual([...rpcNames.rpc].sort());
  });

  it('FakeDb aynı RPC kümesini uygular', () => {
    expect(faked).toEqual(called);
  });

  it('§5.11 zorunlu adlar listede', () => {
    for (const n of ['resolve_telegram', 'consume_staff_quota', 'dedup_update', 'profile_for_prompt', 'redeem_staff_code', 'next_practice_items', 'enqueue_research', 'mark_answered', 'priority_plan_for_enrollment', 'cron_group_auto_answer']) {
      expect(rpcNames.rpc).toContain(n);
    }
  });
});

describe('log kuralı', () => {
  it('console.log( içinde display_name|text_raw yok; src/ console.log kullanmaz (yapılandırılmış log)', () => {
    for (const f of files) {
      const s = read(f);
      expect(/console\.log\([^)]*(display_name|text_raw)/.test(s), f).toBe(false);
      if (!f.endsWith('ops/log.ts')) expect(s.includes('console.log('), f).toBe(false);
    }
  });
});
