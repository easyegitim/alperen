import { existsSync, readFileSync } from 'node:fs';
import { examPageItems, solutionDiagnosis } from '@ogrenmen/contracts';
import { recordTurnMetaInput } from '@ogrenmen/llm';
import { describe, expect, it } from 'vitest';
import { countSentences, loadCourseContext, loadEvalCases, normalizeMath, runEval, scoreCoach, scoreDiagnosis, scoreExamPageItems } from '../src/eval/index.js';
import { examPageItemsUserText, listPromptVersions } from '../src/index.js';

const content = (f: string) => JSON.parse(readFileSync(new URL(`../../../content/tyt-matematik/${f}`, import.meta.url), 'utf8'));
const LEAVES = new Set((content('skills.json') as { id: string; is_leaf: boolean }[]).filter((s) => s.is_leaf).map((s) => s.id));
const TAGS = new Set((content('misconception-tags.json') as { tag: string }[]).map((t) => t.tag));

describe('eval seti', () => {
  const cases = loadEvalCases();
  const sd = cases.filter((c) => c.route === 'solution_diagnosis');
  const cc = cases.filter((c) => c.route === 'coach_chat');
  const epi = cases.filter((c) => c.route === 'exam_page_items');

  it('5 çözüm teşhisi, 4 koç ve 3 kitapçık sayfası vakası; beklenen nedenler çeşitli', () => {
    expect(sd).toHaveLength(5);
    expect(cc).toHaveLength(4);
    expect(epi).toHaveLength(3);
    const causes = new Set(sd.map((c) => (c.route === 'solution_diagnosis' ? c.expected.error_cause : null)));
    expect(causes).toEqual(new Set(['concept', 'careless', 'reading', null, 'time']));
  });

  it('beklenen ve betik kodları içerik deposunda var (sapma yok)', () => {
    for (const c of cases) {
      if (c.route === 'solution_diagnosis') {
        for (const s of c.expected.skill_ids_any) expect(LEAVES.has(s), `${c.id}: ${s}`).toBe(true);
        for (const t of c.expected.misconception_tags_any ?? []) expect(TAGS.has(t), `${c.id}: ${t}`).toBe(true);
      } else if (c.route === 'coach_chat') {
        for (const s of c.expected.turn_meta?.skill_ids_any ?? []) expect(LEAVES.has(s), `${c.id}: ${s}`).toBe(true);
      }
    }
    const ctx = loadCourseContext('tyt-matematik');
    for (const leaf of LEAVES) expect(ctx).toContain(leaf);
  });

  it('teşhis betik yanıtları sözleşmeyi (loose) geçer; koç betikleri tur kaydı şemasını geçer', () => {
    for (const c of sd) {
      expect(c.fake_reply).toHaveLength(1);
      expect(() => solutionDiagnosis.parse(c.fake_reply[0]?.json), c.id).not.toThrow();
    }
    for (const c of cc) {
      const uses = c.fake_reply.flatMap((r) => r.toolUses ?? []);
      expect(uses.map((u) => u.name)).toEqual(['record_turn_meta']);
      for (const u of uses) expect(() => recordTurnMetaInput.parse(u.input), c.id).not.toThrow();
    }
  });

  it('sahte kipte tüm vakalar uçtan uca geçer (prompt → geçit → puan)', async () => {
    const report = await runEval({ cases, mode: 'fake', now: () => new Date('2026-11-03T09:00:00Z') });
    const failed = report.results.filter((r) => !r.pass).map((r) => `${r.id}: ${JSON.stringify(r.checks.filter((x) => !x.pass))}`);
    expect(failed).toEqual([]);
    expect(report.meanScore).toBe(1);
    expect(report.results.every((r) => r.promptVersion === listPromptVersions(r.route).at(-1) && r.promptHash.length === 64)).toBe(true);
    expect(report.byRoute.solution_diagnosis).toMatchObject({ cases: 5, passed: 5 });
    expect(report.byRoute.exam_page_items).toMatchObject({ cases: 3, passed: 3 });
  });

  it('kitapçık vakaları: görsel dosyası var, sahte yanıt sözleşmeden geçer, kullanıcı metni hat kurucusuyla aynı', () => {
    // Vaka sırasıyla: 1. sayfa; 2. sayfa önceki sayfanın son sorusuyla; 2. sayfa önceki sayfa bilinmeyen durumda.
    const pages = [
      { order: 1, previous: null },
      { order: 2, previous: { lastNo: 5, continuesOnNext: true } },
      { order: 2, previous: null },
    ] as const;
    expect(epi.map((c) => c.id)).toEqual(['epi-01-kitapcik-p1', 'epi-02-kitapcik-p2-devam', 'epi-03-kitapcik-p2-onceki-yok']);
    epi.forEach((c, i) => {
      for (const img of c.input.images ?? []) expect(existsSync(new URL(`../../../${img}`, import.meta.url)), img).toBe(true);
      expect(() => examPageItems.parse(c.fake_reply[0]?.json), c.id).not.toThrow();
      const page = pages[i] ?? pages[0];
      expect(c.input.user).toBe(examPageItemsUserText({ order: page.order, total: 3, sectionHint: 'Matematik', previous: page.previous }));
    });
  });
});

describe('puanlayıcılar', () => {
  const [sd1] = loadEvalCases({ route: 'solution_diagnosis' });
  const [cc1] = loadEvalCases({ route: 'coach_chat' });

  it('yanlış teşhisi yakalar', () => {
    if (sd1?.route !== 'solution_diagnosis') throw new Error('vaka yok');
    const s = scoreDiagnosis(sd1, {
      verdict: 'wrong',
      failing_step_no: 2,
      error_cause: 'careless',
      skill_ids: ['tyt.mat.temel.sayilar'],
      misconception_tags: [],
      proposed_subskill: null,
      why_tr: 'Dikkat et! İki cümle.',
    });
    expect(s.pass).toBe(false);
    const failed = s.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(['ilk bozulan adım', 'hata nedeni', 'kazanım', 'yanılgı etiketi', 'why_tr tek cümle', 'ünlem yok']);
    expect(s.score).toBeCloseTo(3 / 9);
  });

  it('cevabı veren, ünlemli, kayıtsız koç yanıtını yakalar', () => {
    if (cc1?.route !== 'coach_chat') throw new Error('vaka yok');
    const s = scoreCoach(cc1, { text: 'Doğrusu −3x+6, yani x = 4 olur! Tebrikler. Yüzde 80 iyisin %80.', turnMeta: [] });
    const failed = s.checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(['ünlem yok', 'yüzde yok', 'yasak: x = 4', 'yasak: −3x+6', 'soru soruyor', 'tur kaydı yazıldı']));
  });

  it('kitapçık puanlayıcısı eksik soru, kaçan devam, kayık şekil kutusu ve yanlış şıkkı yakalar', () => {
    const [p1] = loadEvalCases({ route: 'exam_page_items' });
    if (p1?.route !== 'exam_page_items') throw new Error('vaka yok');
    const good = p1.fake_reply[0]?.json as Parameters<typeof scoreExamPageItems>[1];
    expect(scoreExamPageItems(p1, good).pass).toBe(true);
    const bad = structuredClone(good);
    bad.items = bad.items.filter((it) => it.no !== 2);
    for (const it of bad.items) {
      if (it.no === 5) it.continues_on_next = false;
      if (it.no === 3) it.figures = [{ ...it.figures[0], bbox: { x: 0.1, y: 0.7, w: 0.3, h: 0.05 } } as (typeof it.figures)[number]];
      if (it.no === 1) it.options = it.options.map((o) => (o.key === 'C' ? { ...o, text: '$\\frac{6}{5}$' } : o));
    }
    const failed = scoreExamPageItems(p1, bad).checks.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(['soru numaraları', 'sonraki sayfaya devam', 'soru 3 şekil kutusu (IoU ≥ 0,5)', 'soru 1 şıkları', 'soru 2 şıkları']);
  });

  it('KaTeX normalizasyonu yazım farklarını eşler', () => {
    expect(normalizeMath('$\\frac{1}{2}$')).toBe(normalizeMath('1/2'));
    expect(normalizeMath('$0{,}25\\cdot 0{,}4$')).toBe('0,25·0,4');
    expect(normalizeMath('$-2\\leq x < 3$')).toBe(normalizeMath('−2 ≤ x<3'));
  });

  it('cümle sayacı matematiği, sıra sayılarını ve ondalıkları bölmez', () => {
    expect(countSentences('3. adımda $-3(x-2)$ ifadesini $-3x-6$ yazdın; doğrusu $-3x+6$.')).toBe(1);
    expect(countSentences('Bu hafta 4,5 saat çalıştı. Matematikte ilerliyor.')).toBe(2);
    expect(countSentences('Artı mı olur, eksi mi?')).toBe(1);
    expect(countSentences('Noktasız cümle')).toBe(1);
    expect(countSentences('')).toBe(0);
  });
});
