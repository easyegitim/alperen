import { describe, expect, it } from 'vitest';
import { FakeTransport, Gateway, InMemoryLedger } from '@ogrenmen/llm';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import { getJob } from '../src/jobs/registry.js';
import { PermanentJobError } from '../src/jobs/errors.js';
import type { JobContext } from '../src/jobs/types.js';
import { silentLogger } from '../src/log.js';
import { UNCONFIGURED_PUSH } from '../src/push.js';

type Call = { text: string; values: unknown[] | undefined };

function fakeDb(handler: (text: string, values?: unknown[]) => Record<string, unknown>[] = () => []): Db & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      return { rows: handler(text, values) };
    },
  };
}

function ctxWith(over: Partial<JobContext> = {}): JobContext & { ledger: InMemoryLedger } {
  const ledger = new InMemoryLedger();
  const gateway = new Gateway({ transport: new FakeTransport(), ledger });
  const base: JobContext = {
    config: loadConfig({ DATABASE_URL: 'postgresql://u:p@h:5432/d' }, []),
    log: silentLogger,
    db: fakeDb(),
    gateway: async () => gateway,
    storage: () => {
      throw new Error('storage yok');
    },
    pdf: { render: async () => ({ pdf: Buffer.from('%PDF-'), pages: 1, bytes: 5 }), close: async () => undefined },
    push: UNCONFIGURED_PUSH,
    enqueue: async () => 'id',
    now: () => new Date('2026-11-03T00:00:00Z'),
    job: { id: 'job-1', name: 'test', retryCount: 0 },
    signal: new AbortController().signal,
  };
  return Object.assign({ ...base, ...over }, { ledger });
}

describe('llm.ping', () => {
  it('fake geçitle tek çağrı yapar ve ledger satırı yazar', async () => {
    const ctx = ctxWith();
    const res = await getJob('llm.ping')!.handler!({ route: 'coach_chat', text: 'ping', maxTokens: 128, studentRef: 's_qk7m2rx4tn5a' }, ctx);
    expect(res.status).toBe('ok');
    expect(res.text).toMatch(/^Sahte yanıt/);
    expect(ctx.ledger.rows).toHaveLength(1);
    const row = ctx.ledger.rows[0]!;
    expect(row.route).toBe('coach_chat');
    expect(row.purpose).toBe('llm.ping');
    expect(row.ref_table).toBe('pgboss.job');
    expect(row.student_ref).toBe('s_qk7m2rx4tn5a');
    expect(res.ledgerIds).toEqual([1]);
  });

  it('bilinmeyen ve Batch rotaları kalıcı hata sayılır', async () => {
    const h = getJob('llm.ping')!.handler!;
    await expect(h({ route: 'yok', text: 'x', maxTokens: 64 }, ctxWith())).rejects.toBeInstanceOf(PermanentJobError);
    await expect(h({ route: 'memory_compaction', text: 'x', maxTokens: 64 }, ctxWith())).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('uuid student_ref deftere yazılmaz', async () => {
    await expect(
      getJob('llm.ping')!.handler!({ route: 'coach_chat', text: 'x', maxTokens: 64, studentRef: '11111111-1111-1111-1111-111111111111' }, ctxWith()),
    ).rejects.toThrow(/public_ref/);
  });
});

describe('dossier.render', () => {
  const sid = '00000000-0000-0000-0000-000000000001';
  const cid = '00000000-0000-0000-0000-000000000002';
  const body = { hash: 'abc123', student: { public_ref: 's_qk7m2rx4tn5a' } };

  it('hash değiştiyse student_dossier_cache’e yazar', async () => {
    const db = fakeDb((t) => (t.includes('render_dossier') ? [{ dossier: body }] : []));
    const res = await getJob('dossier.render')!.handler!({ student_id: sid, course_id: cid }, ctxWith({ db }));
    expect(res.changed).toBe(true);
    expect(db.calls.some((c) => /insert into public\.student_dossier_cache/.test(c.text))).toBe(true);
  });

  it('hash aynıysa yazmaz', async () => {
    const db = fakeDb((t) => (t.includes('render_dossier') ? [{ dossier: body }] : t.includes('select hash') ? [{ hash: 'abc123' }] : []));
    const res = await getJob('dossier.render')!.handler!({ student_id: sid, course_id: cid }, ctxWith({ db }));
    expect(res.changed).toBe(false);
    expect(db.calls.some((c) => /insert into/.test(c.text))).toBe(false);
  });

  it('OGR-DOS-001 kalıcı hata', async () => {
    const db: Db = {
      query: async () => {
        throw new Error('OGR-DOS-001 kayıt yok');
      },
    };
    await expect(getJob('dossier.render')!.handler!({ student_id: sid, course_id: cid }, ctxWith({ db }))).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe('pdf.render işi', () => {
  it('PDF’i Storage’a yükler ve belge satırını günceller', async () => {
    const uploads: string[] = [];
    const db = fakeDb();
    const ctx = ctxWith({
      db,
      storage: () => ({
        upload: async (b, p) => void uploads.push(`${b}/${p}`),
        download: async () => Buffer.from(''),
        createSignedUrl: async () => 'u',
      }),
    });
    const res = await getJob('pdf.render')!.handler!(
      { html: '<p>x</p>', output: { path: 'doc/a.pdf' }, document_id: '00000000-0000-0000-0000-000000000009' },
      ctx,
    );
    expect(res).toMatchObject({ bucket: 'documents', path: 'doc/a.pdf', pages: 1 });
    expect(uploads).toEqual(['documents/doc/a.pdf']);
    expect(db.calls.some((c) => /update public\.generated_documents/.test(c.text) && /'rendered'/.test(c.text))).toBe(true);
  });

  it('yukarı çıkan yol kalıcı hata', async () => {
    await expect(getJob('pdf.render')!.handler!({ html: '<p>x</p>', output: { path: '../a.pdf' } }, ctxWith())).rejects.toBeInstanceOf(PermanentJobError);
  });
});

describe('push.send ve memory.compact', () => {
  it('abonelik yoksa gönderim 0', async () => {
    const res = await getJob('push.send')!.handler!({ user_id: '00000000-0000-0000-0000-000000000003', title: 'Merhaba' }, ctxWith());
    expect(res.sent).toBe(0);
  });

  it('VAPID yoksa abonelik varken kalıcı hata', async () => {
    const db = fakeDb(() => [{ id: '1', endpoint: 'https://e', p256dh: 'p', auth: 'a' }]);
    await expect(getJob('push.send')!.handler!({ user_id: '00000000-0000-0000-0000-000000000003', title: 'x' }, ctxWith({ db }))).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('memory.compact iskeleti öğrenci sayar', async () => {
    const db = fakeDb(() => [{ n: 3 }]);
    expect(await getJob('memory.compact')!.handler!({}, ctxWith({ db }))).toEqual({ skeleton: true, students: 3 });
  });
});
