import { readFileSync } from 'node:fs';
import { solutionDiagnosis } from '@ogrenmen/contracts';
import { recordTurnMetaInput } from '@ogrenmen/llm';
import { describe, expect, it } from 'vitest';
import { countSentences, loadCourseContext, loadEvalCases, runEval, scoreCoach, scoreDiagnosis } from '../src/eval/index.js';

const content = (f: string) => JSON.parse(readFileSync(new URL(`../../../content/tyt-matematik/${f}`, import.meta.url), 'utf8'));
const LEAVES = new Set((content('skills.json') as { id: string; is_leaf: boolean }[]).filter((s) => s.is_leaf).map((s) => s.id));
const TAGS = new Set((content('misconception-tags.json') as { tag: string }[]).map((t) => t.tag));

describe('eval seti', () => {
  const cases = loadEvalCases();
  const sd = cases.filter((c) => c.route === 'solution_diagnosis');
  const cc = cases.filter((c) => c.route === 'coach_chat');

  it('5 çözüm teşhisi ve 4 koç vakası; beklenen nedenler çeşitli', () => {
    expect(sd).toHaveLength(5);
    expect(cc).toHaveLength(4);
    const causes = new Set(sd.map((c) => (c.route === 'solution_diagnosis' ? c.expected.error_cause : null)));
    expect(causes).toEqual(new Set(['concept', 'careless', 'reading', null, 'time']));
  });

  it('beklenen ve betik kodları içerik deposunda var (sapma yok)', () => {
    for (const c of cases) {
      if (c.route === 'solution_diagnosis') {
        for (const s of c.expected.skill_ids_any) expect(LEAVES.has(s), `${c.id}: ${s}`).toBe(true);
        for (const t of c.expected.misconception_tags_any ?? []) expect(TAGS.has(t), `${c.id}: ${t}`).toBe(true);
      } else {
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
    expect(report.results.every((r) => r.promptVersion === 'v1' && r.promptHash.length === 64)).toBe(true);
    expect(report.byRoute.solution_diagnosis).toMatchObject({ cases: 5, passed: 5 });
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

  it('cümle sayacı matematiği, sıra sayılarını ve ondalıkları bölmez', () => {
    expect(countSentences('3. adımda $-3(x-2)$ ifadesini $-3x-6$ yazdın; doğrusu $-3x+6$.')).toBe(1);
    expect(countSentences('Bu hafta 4,5 saat çalıştı. Matematikte ilerliyor.')).toBe(2);
    expect(countSentences('Artı mı olur, eksi mi?')).toBe(1);
    expect(countSentences('Noktasız cümle')).toBe(1);
    expect(countSentences('')).toBe(0);
  });
});
