import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { startBridge, type Bridge } from '../../apps/web/e2e/journey/bridge';

// Yerel köprünün köken denetimi (up.ts allowedOrigins): başka bir site tarayıcı üzerinden sabit kodla oturum açamaz.
// Veritabanı gerekmez: reddedilen istekler ve OPTIONS veritabanına inmeden yanıtlanır.

const ALLOWED = ['http://localhost:3000', 'http://127.0.0.1:3000'];
let strict: Bridge;
let open: Bridge;
let dir: string;
const base = (b: Bridge) => `http://127.0.0.1:${(b.server.address() as AddressInfo).port}`;
const noDb = { pool: {} as never };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kopru-'));
  const common = { db: noDb, port: 0, otp: '246810', jwtSecret: 'x'.repeat(40), log: () => undefined, storageDir: dir };
  strict = await startBridge({ ...common, allowedOrigins: ALLOWED });
  open = await startBridge(common);
});

afterAll(async () => {
  await strict?.close();
  await open?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('köprü köken denetimi', () => {
  test('izinli köken yansıtılır, Vary: Origin yazılır', async () => {
    const r = await fetch(`${base(strict)}/auth/v1/verify`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000' } });
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(r.headers.get('vary')).toContain('Origin');
  });

  test('yabancı köken 403 alır (preflight ve doğrudan istek)', async () => {
    const pre = await fetch(`${base(strict)}/auth/v1/verify`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const post = await fetch(`${base(strict)}/auth/v1/verify`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: JSON.stringify({ email: 'ogrenci@ogrenmen.local', token: '246810', type: 'email' }),
    });
    expect(post.status).toBe(403);
    expect(await post.text()).not.toContain('access_token');
    const nul = await fetch(`${base(strict)}/__info`, { headers: { origin: 'null' } });
    expect(nul.status).toBe(403);
  });

  test('Origin başlığı olmayan sunucu isteği serbest', async () => {
    const r = await fetch(`${base(strict)}/__info`);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('allowedOrigins verilmezse eski davranış (journey yığını): her köken, *', async () => {
    const r = await fetch(`${base(open)}/__info`, { headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });
});
