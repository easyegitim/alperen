// @vitest-environment node
// Veli ekranlarının veri yolu x gerçek Postgres (OGRENMEN_LIVE=1): geçici v2 veritabanı. Her çağrı velinin JWT'siyle
// (authenticated rolü, request.jwt.claims) 0042–0044 RPC'lerine gider: özet ayrıştırma ve tek cümle, başka çocuk 42501,
// rapor isteği (tür parametreleri, günlük sınır, kuyruğa düşen belge), bildirim listesi/okundu, kural anahtarı, push aboneliği,
// bağlı veliler listesi.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import pg from 'pg';
import { createTempDatabase, seedStudents, type TempDatabase } from '@ogrenmen/llm/testing';
import { PARENT_COPY, PARENT_RULES, parseRules, summarySentence } from '@/lib/parent';
import { askReport, loadNotifications, loadRules, loadSummary, markRead, setRule } from '@/server/parent/rpc';
import type { RpcClient } from '@/server/practice/rpc';

const LIVE = process.env.OGRENMEN_LIVE === '1';
const ELIF_PROFILE = '00000000-0000-4000-8000-0000000000e1';
const PARENT = '00000000-0000-4000-8000-0000000000b1';

function userClient(pool: pg.Pool, sub: string): RpcClient {
  const sigs = new Map<string, { names: string[]; types: string[] }>();
  const sig = async (fn: string) => {
    let s = sigs.get(fn);
    if (!s) {
      const r = await pool.query(
        `select coalesce(p.proargnames[1:p.pronargs], '{}') as names, array(select format_type(t, null) from unnest(p.proargtypes) as t) as types
           from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
        [fn],
      );
      if (!r.rows[0]) throw new Error(`rpc yok: ${fn}`);
      s = { names: r.rows[0].names as string[], types: r.rows[0].types as string[] };
      sigs.set(fn, s);
    }
    return s;
  };
  return {
    async rpc(fn, args = {}) {
      const s = await sig(fn);
      const values: unknown[] = [];
      const list = Object.entries(args).map(([k, v]) => {
        const type = s.types[s.names.indexOf(k)];
        if (!type) throw new Error(`${fn}: bilinmeyen argüman ${k}`);
        values.push(v === null || v === undefined ? null : type === 'jsonb' || type === 'json' ? JSON.stringify(v) : v);
        return `${k} => $${values.length}::${type}`;
      });
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
        await c.query('set local role authenticated');
        const r = await c.query(`select to_jsonb(public.${fn}(${list.join(', ')})) as v`, values);
        await c.query('commit');
        return { data: r.rows[0]?.v ?? null, error: null };
      } catch (err) {
        await c.query('rollback').catch(() => undefined);
        const e = err as { message: string; code?: string };
        return { data: null, error: { message: e.message, code: e.code } };
      } finally {
        c.release();
      }
    },
  };
}

describe.skipIf(!LIVE)("veli ekranları x Postgres (JWT + 0042–0044 RPC'leri)", () => {
  let tmp: TempDatabase;
  let elif: string;
  let can: string;

  beforeAll(async () => {
    tmp = await createTempDatabase();
    ({ elif, can } = await seedStudents(tmp.pool));
  });
  afterAll(async () => {
    await tmp?.drop();
  });

  it('özet: gerçek parent_child_summary yanıtı ayrıştırılır; tek cümle yüzde/ünlem içermez; başka çocuk OGR-AUTH-001', async () => {
    const db = userClient(tmp.pool, PARENT);
    const res = await loadSummary(db, elif);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.name).toBeTruthy();
    const line = summarySentence(res.data);
    expect(line).not.toMatch(/[%!]/);
    expect(line.length).toBeGreaterThan(5);
    const other = await loadSummary(db, can);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.code).toBe('OGR-AUTH-001');
    // öğrencinin kendi JWT'si veli özetini alamaz
    const asStudent = await loadSummary(userClient(tmp.pool, ELIF_PROFILE), elif);
    expect(asStudent.ok).toBe(false);
  });

  it('rapor isteği: tür parametreleri, kuyruğa düşen belge, günlük sınırdan sonra nazik ileti', async () => {
    const db = userClient(tmp.pool, PARENT);
    expect((await askReport(db, elif, { kind: 'weekly' })).message).toBe(PARENT_COPY.reportAsked);
    expect((await askReport(db, elif, { kind: 'trend', weeks: 8 })).ok).toBe(true);
    expect((await askReport(db, elif, { kind: 'topic', topic: 'rasyonel sayılar' })).ok).toBe(true);
    const fourth = await askReport(db, elif, { kind: 'weekly' });
    expect(fourth).toEqual({ ok: false, message: PARENT_COPY.reportLimit });
    const queued = (await tmp.pool.query(`select count(*)::int as n from public.generated_documents where kind = 'report' and student_id = $1 and status = 'queued'`, [elif])).rows[0]!.n;
    expect(queued).toBe(3);
    // başka çocuk için istek
    expect((await askReport(db, can, { kind: 'weekly' })).ok).toBe(false);
  });

  it('bildirim: liste, okundu; kural anahtarı kaydedilir ve listede görünür; yedi kural türü de var', async () => {
    const db = userClient(tmp.pool, PARENT);
    await tmp.pool.query(
      `insert into public.notifications (recipient_id, kind, title, body, channels, payload) values ($1, 'exam_analysed', 'Deneme sonucu hazır', 'Elif’in denemesi incelendi.', '{in_app}', '{"url":"/veli"}')`,
      [PARENT],
    );
    const before = await loadNotifications(db, 5);
    expect(before.ok && before.data.unread).toBeGreaterThanOrEqual(1);
    if (!before.ok) return;
    const id = before.data.items[0]!.id;
    await markRead(db, id);
    const after = await loadNotifications(db, 5);
    expect(after.ok && after.data.items.some((i) => i.id === id)).toBe(false);
    expect((await setRule(db, 'weekly_summary', false)).ok).toBe(true);
    const rules = await loadRules(db);
    expect(rules.ok).toBe(true);
    if (!rules.ok) return;
    expect(rules.data.find((r) => r.kind === 'weekly_summary')?.enabled).toBe(false);
    for (const r of PARENT_RULES) expect(rules.data.some((x) => x.kind === r.kind)).toBe(true);
    expect(parseRules(rules.data.map((r) => ({ ...r }))).length).toBe(rules.data.length);
    expect((await setRule(db, 'yok_boyle_tur', true)).ok).toBe(false);
  });

  it('push aboneliği RPC’si (PushToggle yolu): kaydet, başka kullanıcıya taşı, kaldır; geçersiz uç nokta reddedilir', async () => {
    const parent = userClient(tmp.pool, PARENT);
    const student = userClient(tmp.pool, ELIF_PROFILE);
    const key = 'B'.repeat(87);
    const args = { p_endpoint: 'https://push.example/abc123456', p_p256dh: key, p_auth: 'a'.repeat(22), p_ua: 'test' };
    expect((await parent.rpc('register_push_subscription', args)).error).toBeNull();
    expect((await student.rpc('register_push_subscription', args)).error).toBeNull(); // paylaşılan cihaz: taşınır
    const owner = (await tmp.pool.query(`select user_id from public.push_subscriptions where endpoint = $1`, [args.p_endpoint])).rows[0]!.user_id;
    expect(owner).toBe(ELIF_PROFILE);
    expect((await parent.rpc('unregister_push_subscription', { p_endpoint: args.p_endpoint })).data).toBe(false);
    expect((await student.rpc('unregister_push_subscription', { p_endpoint: args.p_endpoint })).data).toBe(true);
    expect((await parent.rpc('register_push_subscription', { ...args, p_endpoint: 'http://kotu' })).error).not.toBeNull();
  });

  it('öğrenci Profil: list_guardian_links bağlı veliyi gösterir (token yok); veli çağıramaz', async () => {
    const student = userClient(tmp.pool, ELIF_PROFILE);
    const res = await student.rpc('list_guardian_links', { p_student: elif });
    const rows = res.data as Array<Record<string, unknown>>;
    expect(rows.some((r) => r.status === 'active' && r.parent_name === 'Murat Kaya')).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/token|hash/);
    expect((await userClient(tmp.pool, PARENT).rpc('list_guardian_links', { p_student: elif })).error?.code).toBe('42501');
  });
});
