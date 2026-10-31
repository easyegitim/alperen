import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { MintError, base64url, mint, parseArgs, parseDuration } from './mint-jwt';

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

describe('mint-jwt', () => {
  test("HS256 imzası proje secret'ıyla doğrulanır ve role claim'i taşır", () => {
    const { token } = mint({ role: 'bot_runtime', secret: 'test-secret', expSeconds: 3600, now: 1_700_000_000 });
    const [h, p, s] = token.split('.');
    expect(decode(h)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decode(p)).toEqual({ role: 'bot_runtime', iss: 'supabase', iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(s).toBe(base64url(createHmac('sha256', 'test-secret').update(`${h}.${p}`).digest()));
    const other = base64url(createHmac('sha256', 'baska-secret').update(`${h}.${p}`).digest());
    expect(s).not.toBe(other);
  });

  test('yalnız bot_runtime ve batch_worker basılır', () => {
    expect(mint({ role: 'batch_worker', secret: 'test-secret', expSeconds: 60 }).payload.role).toBe('batch_worker');
    for (const role of ['service_role', 'anon', 'authenticated', 'postgres']) {
      expect(() => mint({ role, secret: 'test-secret', expSeconds: 60 })).toThrow(MintError);
    }
    expect(() => mint({ role: 'bot_runtime', secret: '', expSeconds: 60 })).toThrow(MintError);
  });

  test('süre biçimleri', () => {
    expect(parseDuration('90d')).toBe(90 * 86400);
    expect(parseDuration('1h')).toBe(3600);
    expect(parseDuration('30m')).toBe(1800);
    expect(parseDuration('45')).toBe(45);
    expect(() => parseDuration('1y')).toThrow(MintError);
    expect(() => parseDuration('500d')).toThrow(MintError);
  });

  test('argüman ayrıştırma', () => {
    expect(parseArgs(['--role', 'bot_runtime', '--exp=1h'])).toEqual({ role: 'bot_runtime', exp: '1h' });
    expect(() => parseArgs(['--role'])).toThrow(MintError);
  });

  test('komut satırı: stdout yalnız jeton', () => {
    const proc = Bun.spawnSync(['bun', 'run', `${import.meta.dir}/mint-jwt.ts`, '--role', 'bot_runtime', '--secret', 'test-secret', '--exp', '1h']);
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString().trim();
    expect(out.split('.').length).toBe(3);
    expect(decode(out.split('.')[1]).role).toBe('bot_runtime');
    const bad = Bun.spawnSync(['bun', 'run', `${import.meta.dir}/mint-jwt.ts`, '--role', 'service_role', '--secret', 'test-secret']);
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout.toString()).toBe('');
  });
});
