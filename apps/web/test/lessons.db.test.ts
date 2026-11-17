// @vitest-environment node
// Dersler × gerçek Postgres (OGRENMEN_LIVE=1): geçici v2 veritabanı + TYT müfredatı. Web'in ders okuma katmanı
// (src/server/lessons) gerçek list_lessons / lesson_view yanıtlarını ayrıştırır: eğitmen Ayşe Hoca Elif'in dersini
// yükler (register_lesson), worker transkript + analiz yazar, eğitmen iddiaları inceler (Onayla/Düzenle/Reddet),
// eşik değişir, "Dossier'e uygula", "Öğrenciye görünür" → Elif'in Gelişim satırı. Veli hiçbir şey görmez.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createTempDatabase, type TempDatabase } from '@ogrenmen/llm/testing';
import { loadLesson, loadLessons, loadStudentLessons } from '@/server/lessons/read';
import { callRpc, type RpcClient } from '@/server/practice/rpc';

const LIVE = process.env.OGRENMEN_LIVE === '1';
const ELIF = '00000000-0000-4000-8000-0000000000e1';
const CAN = '00000000-0000-4000-8000-0000000000e2';
const HOCA = '00000000-0000-4000-8000-0000000000a1';
const VELI = '00000000-0000-4000-8000-0000000000b1';
const UPLOAD = '00000000-0000-4000-8000-00000000f001';

type Claims = { role: 'authenticated'; sub: string } | { role: 'service_role' };

function bridge(tmp: TempDatabase, claims: Claims): RpcClient {
  return {
    async rpc(fn, args = {}) {
      const keys = Object.keys(args).filter((k) => /^p_\w+$/.test(k));
      const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
      const proc = await tmp.pool.query(`select bool_or(p.proretset) as s from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]);
      if (proc.rows[0]?.s == null) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn}` } };
      const sql = proc.rows[0].s ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as v from ${call} t` : `select to_jsonb(${call}) as v`;
      const c = await tmp.pool.connect();
      try {
        await c.query('begin');
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await c.query(`set local role ${claims.role === 'service_role' ? 'service_role' : 'authenticated'}`);
        const r = await c.query(
          sql,
          keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k])),
        );
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

describe.skipIf(!LIVE)('dersler × Postgres (yükle → incele → öğrenciye aç)', () => {
  let tmp: TempDatabase;
  let lessonId = '';
  const inst = () => bridge(tmp, { role: 'authenticated', sub: HOCA });
  const worker = () => bridge(tmp, { role: 'service_role' });

  beforeAll(async () => {
    tmp = await createTempDatabase();
    const enr = await callRpc(bridge(tmp, { role: 'authenticated', sub: ELIF }), 'onboarding_enroll', { p_course_text: 'TYT Matematik' }, (x) => x);
    expect(enr.ok).toBe(true);
  }, 180_000);

  afterAll(async () => {
    await tmp?.drop();
  });

  it('register_lesson → liste: işleniyor, iddia yok; öğrenci ve veli göremez', async () => {
    const [enr] = (await tmp.pool.query(`select e.id from public.enrollments e join public.students s on s.id = e.student_id where s.profile_id = $1`, [ELIF])).rows as { id: string }[];
    await tmp.pool.query(`insert into public.uploads (id, owner_id, kind, storage_path, mime, bytes) values ($1, $2, 'video', $3, 'video/mp4', 1000)`, [UPLOAD, HOCA, `${HOCA}/${UPLOAD}.mp4`]);
    const reg = await inst().rpc('register_lesson', { p_meta: { enrollment_id: enr!.id, title: 'Mutlak değer', held_at: '2026-10-29T14:00:00Z' }, p_upload_id: UPLOAD });
    expect(reg.error).toBeNull();
    lessonId = (reg.data as { lesson_id: string }).lesson_id;

    const list = await loadLessons(inst());
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ id: lessonId, title: 'Mutlak değer', status: 'processing', stage: 'prepare', student_visible: false, transcript_ready: false });
    expect(list.rows[0]!.student?.name).toBe('Elif Kaya');

    expect((await loadStudentLessons(5, bridge(tmp, { role: 'authenticated', sub: ELIF }))).items).toEqual([]);
    expect((await loadLessons(bridge(tmp, { role: 'authenticated', sub: VELI }))).ok).toBe(false);
    expect((await loadLesson(lessonId, bridge(tmp, { role: 'authenticated', sub: CAN }))).ok).toBe(false);
  });

  it('worker transkript + analiz yazar → ayrıntı: konuşmacılı transkript, güven eşiği altı/üstü iddialar', async () => {
    const skills = (await tmp.pool.query(`select s.id from public.skills s join public.enrollments e on e.curriculum_id = s.curriculum_id join public.students st on st.id = e.student_id
       where st.profile_id = $1 and s.is_leaf order by s.order_no limit 2`, [ELIF])).rows as { id: string }[];
    const segs = [
      { t0: 0, t1: 6, speaker: 'EĞİTMEN', text: 'Bugün mutlak değerli eşitsizliklere bakalım.' },
      { t0: 830, t1: 836, speaker: 'ÖĞRENCİ', text: 'Eksi tarafı hep unutuyorum aslında.' },
      { t0: 2700, t1: 2712, speaker: 'EĞİTMEN', text: 'Cuma günü sayfa 40 yapılacak.' },
    ];
    expect((await worker().rpc('lesson_set_progress', { p_lesson: lessonId, p_stage: 'stt', p_counters: {} })).error).toBeNull();
    expect((await worker().rpc('write_lesson_transcript', { p_lesson: lessonId, p_segments: segs, p_language: 'tr', p_provider: 'fake' })).error).toBeNull();
    const analysis = {
      schema_version: '1.0', lesson_ref: lessonId, student_ref: 's_x', duration_min: 48,
      skills: [
        { skill_id: skills[0]!.id, mastery_estimate: 0.9, confidence: 0.95, evidence: [{ speaker: 'ÖĞRENCİ', quote: 'Önce çarpmayı yaparım.', t: '00:05:10' }] },
        { skill_id: skills[1]!.id, mastery_estimate: 0.4, confidence: 0.6, evidence: [{ speaker: 'ÖĞRENCİ', quote: 'Eksi tarafı hep unutuyorum aslında.', t: '00:13:50' }] },
      ],
      questions: [], hesitations: [], misconceptions: [],
      commitments: [{ who: 'ÖĞRENCİ', kind: 'homework', text: 'Sayfa 40', due: '2026-11-05', t: '00:45:00' }],
      talk: { student_ratio: 0.4, student_questions: 0, attention: 'high', morale: 'medium' },
      previous_profile_check: [],
      next_step: { for_student: 'Uç noktaları kontrol ederek beş soru çöz.', for_instructor: 'Uç noktaları tekrar et.' },
      course_insights: [],
      model_notes: { model: 'claude-opus-4-5', prompt_version: 'lesson-analysis@2', cost_usd: 0.3, tokens_in: 1, tokens_out: 1, frames: 0 },
    };
    const wrote = await worker().rpc('write_lesson_analysis', { p_lesson: lessonId, p_analysis: { analysis } });
    expect(wrote.error).toBeNull();
    expect((await worker().rpc('lesson_set_progress', { p_lesson: lessonId, p_stage: 'done', p_counters: {} })).error).toBeNull();

    const r = await loadLesson(lessonId, inst());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.view;
    expect(v.lesson).toMatchObject({ stage: 'done', can_manage: true, auto_apply_threshold: 0.8, student_visible: false });
    expect(v.transcript?.segments).toHaveLength(3);
    expect(v.transcript?.segments[1]).toMatchObject({ speaker: 'ÖĞRENCİ', t0: 830 });
    const mastery = v.claims.filter((c) => c.kind === 'skill_mastery');
    expect(mastery).toHaveLength(2);
    expect(mastery.find((c) => c.skill_id === skills[1]!.id)).toMatchObject({ status: 'pending', below_threshold: true, quote: 'Eksi tarafı hep unutuyorum aslında.', t_start_sec: 830, speaker: 'ÖĞRENCİ' });
    expect(v.counts.total).toBe(v.claims.length);
  });

  it('eşik 0,80: Dossier’e uygula yüksek güveni işler; düşük olan Düzenle ile uygulanır; geri al; öğrenciye görünür', async () => {
    const before = await loadLesson(lessonId, inst());
    expect(before.ok && before.view.counts.applied).toBe(0);
    const applied = await inst().rpc('apply_lesson_claims', { p_lesson: lessonId });
    expect(applied.error).toBeNull();
    const mid = await loadLesson(lessonId, inst());
    if (!mid.ok) throw new Error('okunamadı');
    const low = mid.view.claims.find((c) => c.kind === 'skill_mastery' && c.confidence === 0.6)!;
    const high = mid.view.claims.find((c) => c.kind === 'skill_mastery' && c.confidence === 0.95)!;
    expect(high).toMatchObject({ status: 'approved', applied: true, auto: true });
    expect(low).toMatchObject({ status: 'pending', applied: false });

    // Düzenle: ustalık "İyi" bandı (0,9) → hemen uygulanır
    const edited = await inst().rpc('review_lesson_claim', { p_claim: low.id, p_decision: 'edit', p_edit: { mastery_estimate: 0.9 } });
    expect(edited.error).toBeNull();
    const after = await loadLesson(lessonId, inst());
    if (!after.ok) throw new Error('okunamadı');
    expect(after.view.claims.find((c) => c.id === low.id)).toMatchObject({ status: 'edited', applied: true });
    // Geri al (uygulanmış iddiada Reddet)
    expect((await inst().rpc('review_lesson_claim', { p_claim: low.id, p_decision: 'reject', p_edit: null })).error).toBeNull();
    const rej = await loadLesson(lessonId, inst());
    expect(rej.ok && rej.view.claims.find((c) => c.id === low.id)).toMatchObject({ status: 'rejected', applied: false });

    // Ödev iddiasını onayla → öğrenci özetinde görünür (görünürlük açılınca)
    const hw = after.view.claims.find((c) => c.kind === 'homework')!;
    expect((await inst().rpc('review_lesson_claim', { p_claim: hw.id, p_decision: 'approve', p_edit: null })).error).toBeNull();
    const step = after.view.claims.find((c) => c.kind === 'next_step');
    if (step) await inst().rpc('review_lesson_claim', { p_claim: step.id, p_decision: 'approve', p_edit: null });
    expect((await inst().rpc('lesson_set_options', { p_lesson: lessonId, p_options: { student_visible: true, auto_apply_threshold: 0.85 } })).error).toBeNull();

    const final = await loadLesson(lessonId, inst());
    expect(final.ok && final.view.lesson).toMatchObject({ student_visible: true, auto_apply_threshold: 0.85 });

    const mine = await loadStudentLessons(5, bridge(tmp, { role: 'authenticated', sub: ELIF }));
    expect(mine.total).toBe(1);
    expect(mine.items[0]!.row).toMatchObject({ id: lessonId, summary_ready: true });
    expect(mine.items[0]!.sentence).toBe('Uç noktaları kontrol ederek beş soru çöz.');
    // öğrenci personel görünümüne ve transkripte ulaşamaz; veli hiçbirine
    expect((await loadLesson(lessonId, bridge(tmp, { role: 'authenticated', sub: ELIF }))).ok).toBe(false);
    const t = await tmp.pool.query(`select count(*)::int as n from public.lesson_transcripts`);
    expect(t.rows[0].n).toBe(1);
    expect((await loadStudentLessons(5, bridge(tmp, { role: 'authenticated', sub: VELI }))).items).toEqual([]);
  });
});
