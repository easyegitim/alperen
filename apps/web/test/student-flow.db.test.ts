// @vitest-environment node
// Bugün → Test → Sonuç × gerçek Postgres (OGRENMEN_LIVE=1): geçici v2 veritabanı (packages/llm testing) + TYT anahtar
// seed'i (content/tyt-matematik/scripts/seed-keys.py --schema v2: onaylı ve anahtarı tam sorular). Web'in sunucu
// katmanı (src/server/{suggestions,practice,progress}) RpcClient arayüzüyle PostgREST'in yaptığının aynısını yapan
// bir köprüye bağlanır: işlem içinde SET LOCAL ROLE authenticated + request.jwt.claims (sub = profil). Böylece
// onboarding_enroll, list_today_suggestions, start_practice, answer_practice_item, finish_practice gerçek RLS ve
// SECURITY DEFINER denetimleriyle sınanır; ekran metinleri (resultView, arrangeToday) gerçek yanıtlardan üretilir.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createTempDatabase, REPO_ROOT, type TempDatabase } from '@ogrenmen/llm/testing';
import { nextAfterEnroll, parseEnrollResult } from '@/app/ogrenci/onboarding/shared';
import { initPlayer, playerReducer } from '@/server/practice/machine';
import { playerItems, resultView } from '@/server/practice/present';
import { callRpc, type RpcClient } from '@/server/practice/rpc';
import { answerItem, finishPractice, getPracticeSet, isClosed, startFromSuggestion } from '@/server/practice/service';
import { draftDone, lastSevenDays, topicRows } from '@/server/progress/present';
import { arrangeToday } from '@/server/suggestions/arrange';
import { listToday } from '@/server/suggestions/service';

const LIVE = process.env.OGRENMEN_LIVE === '1';
const ELIF = '00000000-0000-4000-8000-0000000000e1';
const CAN = '00000000-0000-4000-8000-0000000000e2';
const VELI = '00000000-0000-4000-8000-0000000000b1';

type Claims = { role: 'authenticated'; sub: string } | { role: 'service_role' };

/** PostgREST eşleniği: adlandırılmış argümanlarla RPC; tablo dönen fonksiyon dizi, diğerleri tek değer döner. */
function bridge(tmp: TempDatabase, claims: Claims): RpcClient {
  const setReturning = new Map<string, boolean>();
  return {
    async rpc(fn, args = {}) {
      if (!/^\w+$/.test(fn)) throw new Error(`geçersiz fonksiyon adı ${fn}`);
      if (!setReturning.has(fn)) {
        const r = await tmp.pool.query(`select bool_or(p.proretset) as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
        if (r.rows[0]?.s == null) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } };
        setReturning.set(fn, Boolean(r.rows[0].s));
      }
      const keys = Object.keys(args).filter((k) => /^p_\w+$/.test(k));
      const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      const sql = setReturning.get(fn) ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as v from ${call} t` : `select to_jsonb(${call}) as v`;
      const c = await tmp.pool.connect();
      try {
        await c.query('begin');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await c.query(`set local role ${claims.role === 'service_role' ? 'service_role' : 'authenticated'}`);
        const r = await c.query(sql, keys.map((k) => args[k]));
        await c.query('commit');
        return { data: r.rows[0]?.v ?? null, error: null };
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        const err = e as { code?: string; message: string };
        return { data: null, error: { code: err.code ?? null, message: err.message } };
      } finally {
        c.release();
      }
    },
  };
}

/** RLS altında tek sorgu (Gelişim okumalarının dayanağı). */
async function asUser<T>(tmp: TempDatabase, sub: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await tmp.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub })]);
    await c.query('set local role authenticated');
    const r = await c.query(sql, params);
    await c.query('commit');
    return r.rows as T[];
  } finally {
    c.release();
  }
}

describe.skipIf(!LIVE)('öğrenci akışı × Postgres (Bugün → Test → Sonuç)', () => {
  let tmp: TempDatabase;

  beforeAll(async () => {
    tmp = await createTempDatabase();
    // Onaylı + anahtarı tam soru bankası (start_practice yalnız bunlardan set kurar)
    execFileSync('python3', [join(REPO_ROOT, 'content/tyt-matematik/scripts/seed-keys.py'), '--schema', 'v2', '--database-url', tmp.url], {
      stdio: 'pipe',
      env: { ...process.env, PGOPTIONS: '-c role=ogrenmen_owner' },
    });
    // seed-keys.py --schema v2 teşhis sınavının sorularını da onaylı bankaya koyar; start_practice (0021) bitirilmemiş
    // teşhisin sorusunu alıştırmaya almaz. Burada öğrenci teşhisi bitirmiş gibi sınav alıştırma türüne alınır.
    await tmp.pool.query(`update public.exams set kind = 'practice' where kind = 'diagnostic'`);
  }, 180_000);

  afterAll(async () => {
    await tmp?.drop();
  });

  it('onboarding: aktif müfredat → Bugün; yeni ders → taslak + "Hazırlıyorum…"', async () => {
    const elif = await callRpc(bridge(tmp, { role: 'authenticated', sub: ELIF }), 'onboarding_enroll', { p_course_text: 'TYT Matematik' }, parseEnrollResult);
    expect(elif.ok).toBe(true);
    if (!elif.ok) return;
    expect(elif.data.curriculum_status).toBe('active');
    expect(nextAfterEnroll(elif.data)).toBe('/ogrenci');

    const can = await callRpc(bridge(tmp, { role: 'authenticated', sub: CAN }), 'onboarding_enroll', { p_course_text: 'Lineer Cebir' }, parseEnrollResult);
    expect(can.ok).toBe(true);
    if (!can.ok) return;
    expect(can.data.curriculum_status).toBe('draft');
    expect(nextAfterEnroll(can.data)).toBe(`/ogrenci/onboarding?mufredat=${can.data.curriculum_id}`);
    const [state] = await asUser<{ status: string; draft_status: string | null }>(tmp, CAN, 'select status, draft_status from public.curricula where id = $1', [can.data.curriculum_id]);
    expect(state).toMatchObject({ status: 'draft', draft_status: 'queued' });
    expect(draftDone(state!)).toBe(false);
  });

  it('Bugün: worker önerileri → kahraman kart + kutu + belge kartı; veli okuyamaz', async () => {
    const [enr] = (await tmp.pool.query(`select e.id, e.student_id from public.enrollments e join public.students s on s.id = e.student_id where s.profile_id = $1`, [ELIF])).rows as { id: string; student_id: string }[];
    const items = [
      { kind: 'practice', title: 'Rasyonel sayılar', payload: { count: 2, minutes: 4 }, rank: 0, enrollment_id: enr!.id },
      { kind: 'weekly_homework', title: 'Haftalık ödev', payload: { count: 3, minutes: 20 }, rank: 10, enrollment_id: enr!.id },
      { kind: 'document_ready', title: 'Rasyonel sayılar notun hazır', payload: { document_id: '00000000-0000-4000-8000-00000000d0c1' }, rank: 20 },
    ];
    const wrote = await bridge(tmp, { role: 'service_role' }).rpc('replace_suggestions', { p_student: enr!.student_id, p_items: JSON.stringify(items) });
    expect(wrote.error).toBeNull();

    const res = await listToday(bridge(tmp, { role: 'authenticated', sub: ELIF }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const today = arrangeToday(res.data);
    expect(today.hero).toMatchObject({ kind: 'practice', title: 'Rasyonel sayılar' });
    expect(today.boxes.map((b) => b.kind)).toEqual(['weekly_homework']);
    expect(today.notices.map((n) => n.kind)).toEqual(['document_ready']);

    const parent = await listToday(bridge(tmp, { role: 'authenticated', sub: VELI }));
    expect(parent.ok).toBe(false);
  });

  it('Başla → 2 soru (durum makinesiyle) → Sonuç; doğru şık hiç dönmez, attempts ve ustalık yazılır', async () => {
    const db = bridge(tmp, { role: 'authenticated', sub: ELIF });
    const list = await listToday(db);
    const hero = list.ok ? arrangeToday(list.data).hero : null;
    expect(hero).not.toBeNull();
    const started = await startFromSuggestion(db, hero!.id);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const set = started.data;
    expect(set.status).toBe('in_progress');
    expect(set.items).toHaveLength(2);
    expect(JSON.stringify(set)).not.toMatch(/"(answer|correct_option|numeric_value|numeric_tolerance|misconception_tag)"/);

    // aynı öneri ikinci kez aynı seti döner
    const again = await startFromSuggestion(db, hero!.id);
    expect(again.ok && again.data.set_id).toBe(set.set_id);

    const items = playerItems(set, 'http://127.0.0.1:54321');
    let s = initPlayer(items.map((i) => ({ no: i.no, answered: i.answered, correct: i.correct })), 0);
    while (s.phase === 'answering') {
      const it = items[s.index]!;
      s = playerReducer(s, { type: 'SELECT', value: it.kind === 'mcq' ? it.options[0]!.key : '0' });
      s = playerReducer(s, { type: 'SUBMIT' });
      const r = await answerItem(db, { setId: set.set_id, questionId: it.questionId, answer: s.selected!, responseMs: 4200 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = playerReducer(s, { type: 'ANSWERED', no: r.data.no, correct: r.data.correct, at: 1 });
    }
    expect(s.phase).toBe('finishing');

    const fin = await finishPractice(db, set.set_id);
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.data).toMatchObject({ status: 'finished', total: 2, answered: 2 });
    const closed = await getPracticeSet(db, set.set_id);
    expect(closed.ok && isClosed(closed.data)).toBe(true);
    if (!closed.ok) return;
    const v = resultView(fin.data, closed.data.items);
    expect(v.scoreLabel).toBe(`2 sorudan ${fin.data.correct} doğru`);
    expect(v.dots).toHaveLength(2);
    expect(v.sentence.length).toBeGreaterThan(5);
    expect(v.sentence).not.toMatch(/[!%]/);

    // aynı soruya ikinci cevap notlanmaz (ilk sonuç döner)
    const late = await answerItem(db, { setId: set.set_id, questionId: items[0]!.questionId, answer: 'A' });
    expect(late.ok && late.data.already_answered).toBe(true);

    // Gelişim dayanakları RLS altında: bu haftanın denemeleri ve yaprak ustalığı
    const attempts = await asUser<{ created_at: string }>(tmp, ELIF, `select created_at::text from public.attempts where enrollment_id = $1 and created_at >= now() - interval '7 days'`, [set.enrollment_id]);
    expect(attempts).toHaveLength(2);
    expect(lastSevenDays(attempts.map((a) => new Date(a.created_at).toISOString()), new Date()).at(-1)!.value).toBe(2);
    const mv = await asUser<{ skill_id: string; skill_name: string; band: 'low' | 'mid' | 'high' | null; evidence_count: number }>(tmp, ELIF, 'select skill_id, skill_name, band, evidence_count from public.mastery_view where enrollment_id = $1', [set.enrollment_id]);
    expect(topicRows(mv).length).toBeGreaterThan(0);

    // başlatılan öneri Bugün'den düşer
    const after = await listToday(db);
    expect(after.ok && after.data.some((x) => x.id === hero!.id)).toBe(false);
  });
  it('Bugün: 4 başlatılabilir öneri + belge kartı → bildirim kutuların arkasında kaybolmaz', async () => {
    const [enr] = (await tmp.pool.query(`select e.id, e.student_id from public.enrollments e join public.students s on s.id = e.student_id where s.profile_id = $1`, [ELIF])).rows as { id: string; student_id: string }[];
    const items = [
      { kind: 'practice', title: 'Rasyonel sayılar', payload: { count: 2 }, rank: 0, enrollment_id: enr!.id },
      { kind: 'weekly_homework', title: 'Haftalık ödev', payload: { count: 3 }, rank: 10, enrollment_id: enr!.id },
      { kind: 'lesson_review', title: 'Ders tekrarı', payload: { count: 3 }, rank: 20, enrollment_id: enr!.id },
      { kind: 'gap_analysis', title: 'Eksik analizi', payload: { count: 3 }, rank: 30, enrollment_id: enr!.id },
      { kind: 'document_ready', title: 'Notun hazır', payload: { document_id: '00000000-0000-4000-8000-00000000d0c2' }, rank: 50 },
    ];
    const wrote = await bridge(tmp, { role: 'service_role' }).rpc('replace_suggestions', { p_student: enr!.student_id, p_items: JSON.stringify(items) });
    expect(wrote.error).toBeNull();
    const res = await listToday(bridge(tmp, { role: 'authenticated', sub: ELIF }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const today = arrangeToday(res.data);
    expect(today.hero?.kind).toBe('practice');
    expect(today.boxes).toHaveLength(3);
    expect(today.notices.map((n) => n.kind)).toEqual(['document_ready']);
  });

  it('yarım kalan test: start → 1 cevap → set in_progress kalır ve Devam et için bulunur', async () => {
    const db = bridge(tmp, { role: 'authenticated', sub: ELIF });
    const list = await listToday(db);
    const hero = list.ok ? arrangeToday(list.data).hero : null;
    expect(hero).not.toBeNull();
    const started = await startFromSuggestion(db, hero!.id);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const first = started.data.items[0]!;
    const q = (await tmp.pool.query(`select options from public.questions where id = $1`, [first.question_id])).rows[0] as { options: Array<{ key: string }> } | undefined;
    const ans = await answerItem(db, { setId: started.data.set_id, questionId: first.question_id, answer: q?.options?.[0]?.key ?? 'A' });
    expect(ans.ok).toBe(true);
    // öneri tüketildi (Bugün'den düştü) ama set açık: RLS altında en yeni in_progress set okunur
    const open = await asUser<{ id: string }>(tmp, ELIF, `select id from public.practice_sets where status = 'in_progress' order by started_at desc limit 1`);
    expect(open[0]?.id).toBe(started.data.set_id);
    const again = await getPracticeSet(db, started.data.set_id);
    expect(again.ok && again.data.answered).toBe(1);
    expect(again.ok && again.data.answered < again.data.total).toBe(true);
  });
});
