/**
 * P3 içerik stüdyosu ekleri: kodla figür (figure_code + kind), kişisel hata kutusu kaynağı (pattern_ref), deneme
 * dağılımı (blueprint) ve figür yardımcıları (documentFigureJobs, applyFigureRenders, examFigureJobs).
 */
import { describe, expect, it } from 'vitest';
import {
  FIGURE_FILE,
  applyFigureRenders,
  blueprintIssues,
  calloutReferenceIssues,
  documentAst,
  documentFigureJobs,
  examBlueprintIssues,
  examFigureJobs,
  examGeneration,
  figureFileFromCode,
  figureFileName,
  outputFormat,
  personalizationCheck,
  splitDocumentKeys,
  storedDocumentAst,
} from '../src/index.js';
import { fixtureFiles } from './helpers.js';

const valid = (schema: string, name: string): Record<string, unknown> => {
  const f = fixtureFiles(schema, 'valid').find((x) => x.name === `${name}.json`);
  if (!f) throw new Error(`fikstür yok: ${schema}/${name}`);
  return structuredClone(f.data) as Record<string, unknown>;
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"></svg>';

describe('kodla figür (document-ast)', () => {
  const notes = () => valid('document-ast', 'notes-figure-code');

  it('dosya adı kuralı', () => {
    expect(figureFileName(3)).toBe('figure_3.svg');
    expect(FIGURE_FILE.test('figure_12.svg')).toBe(true);
    expect(FIGURE_FILE.test('../figure_1.svg')).toBe(false);
    expect(figureFileFromCode('fig.savefig("figure_7.svg")')).toBe('figure_7.svg');
    expect(figureFileFromCode('save_figure(fig, 3)')).toBe('figure_3.svg');
    expect(figureFileFromCode('save_figure(fig, 1)\nsave_figure(fig2, 4)')).toBe('figure_4.svg');
    expect(figureFileFromCode('plt.show()')).toBeNull();
  });

  it('documentFigureJobs: blok sırası, n, dosya adı', () => {
    const jobs = documentFigureJobs(notes() as never);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ block_id: 'b4', question_no: null, n: 1, kind: 'matplotlib', file_name: 'figure_1.svg' });
    expect(jobs[0]?.code).toContain('save_figure(fig, 1)');
  });

  it('applyFigureRenders: SVG yazılır, kod çıkar; saklanan biçime uyar', () => {
    const doc = notes();
    const { doc: out, missing } = applyFigureRenders(doc as { blocks: unknown[]; keys: unknown[] }, { b4: SVG });
    expect(missing).toEqual([]);
    const fig = (out.blocks as Record<string, unknown>[]).find((b) => b.id === 'b4');
    expect(fig).toMatchObject({ source: 'svg', svg: SVG });
    expect(fig).not.toHaveProperty('figure_code');
    expect(fig).not.toHaveProperty('kind');
    // girdi değişmez
    expect((doc.blocks as Record<string, unknown>[]).find((b) => b.id === 'b4')).toHaveProperty('figure_code');
    expect(documentAst.isValid(out)).toBe(true);
    expect(storedDocumentAst.safeParse(splitDocumentKeys(out as { keys: unknown[] }).content).success).toBe(true);
  });

  it('SVG verilmeyen figür missing listesinde; kodlu belge saklanamaz', () => {
    const { missing } = applyFigureRenders(notes() as { blocks: unknown[] }, {});
    expect(missing).toEqual(['b4']);
    const stored = storedDocumentAst.safeParse(splitDocumentKeys(notes() as { keys: unknown[] }).content);
    expect(stored.success).toBe(false);
    expect(JSON.stringify(stored.error?.issues)).toContain('figure_code');
  });

  it('soru şekli de kodla verilebilir', () => {
    const doc = notes();
    const q = (doc.blocks as Record<string, unknown>[]).find((b) => b.type === 'question') as Record<string, unknown>;
    q.figure = { source: 'svg', figure_code: '<svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="10" y2="10"/></svg>', kind: 'svg', alt: 'Bir doğru parçası' };
    expect(documentAst.isValid(doc)).toBe(true);
    const jobs = documentFigureJobs(doc as never);
    expect(jobs.map((j) => [j.block_id, j.question_no, j.n, j.file_name])).toEqual([
      ['b4', null, 1, 'figure_1.svg'],
      ['q1', 1, 2, 'figure_2.svg'],
    ]);
    const { doc: out } = applyFigureRenders(doc as { blocks: unknown[]; keys: unknown[] }, { b4: SVG, q1: SVG });
    const q2 = (out.blocks as Record<string, unknown>[]).find((b) => b.id === 'q1') as { figure: Record<string, unknown> };
    expect(q2.figure).toEqual({ source: 'svg', svg: SVG, alt: 'Bir doğru parçası' });
  });
});

describe('kişisel hata kutusu (pattern_ref)', () => {
  it('kişiselleştirilmemiş notta kaynaksız (genel) kutu geçerli', () => {
    const doc = valid('document-ast', 'notes-figure-code');
    (doc.meta as Record<string, unknown>).personalized = false;
    const c = (doc.blocks as Record<string, unknown>[]).find((b) => b.type === 'common_mistake_callout') as Record<string, unknown>;
    c.pattern_ref = null;
    expect(documentAst.isValid(doc)).toBe(true);
  });

  it('eski veride pattern_ref yoksa geçerli kalır ve parse alan eklemez (üretilmiş fikstürler kaymaz)', () => {
    const doc = valid('document-ast', 'notes-figure-code');
    const c = (doc.blocks as Record<string, unknown>[]).find((b) => b.type === 'common_mistake_callout') as Record<string, unknown>;
    delete c.pattern_ref;
    const { doc: rendered } = applyFigureRenders(doc as { blocks: unknown[]; keys: unknown[] }, { b4: SVG });
    const r = storedDocumentAst.safeParse(splitDocumentKeys(rendered as { keys: unknown[] }).content);
    expect(r.success).toBe(true);
    const out = r.data?.blocks.find((b) => b.type === 'common_mistake_callout');
    expect(out).not.toHaveProperty('pattern_ref');
    expect(JSON.stringify(outputFormat(documentAst).schema)).toContain('"required":["type","id","section_no","pattern_id","pattern_ref","text"]');
  });
});

describe('deneme dağılımı ve şekilleri (exam-generation)', () => {
  it('fikstür: 10 soru, 2 kodlu şekil, dağılım tutar', () => {
    const exam = examGeneration.parse(valid('exam-generation', 'tyt-blueprint-figures'));
    expect(exam.items).toHaveLength(10);
    expect(examFigureJobs(exam).map((j) => [j.question_no, j.kind, j.file_name])).toEqual([
      [8, 'matplotlib', 'figure_1.svg'],
      [9, 'svg', 'figure_2.svg'],
    ]);
    expect(exam.keys.every((k) => k.canonical_expr !== null)).toBe(true);
  });

  it('save_figure numarası iş adını belirler (svg türü figürle başlayan, numaraları kaymış belge)', () => {
    const doc = {
      blocks: [
        { id: 'a', type: 'figure', kind: 'svg', figure_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', alt: 'x' },
        { id: 'b', type: 'figure', kind: 'matplotlib', figure_code: 'fig = 1\nsave_figure(fig, 1)', alt: 'y' },
        { id: 'c', type: 'figure', kind: 'matplotlib', figure_code: 'fig = 2\nsave_figure(fig, 2)', alt: 'z' },
      ],
    };
    expect(documentFigureJobs(doc).map((j) => [j.block_id, j.n, j.file_name])).toEqual([
      ['a', 1, 'figure_1.svg'],
      ['b', 2, 'figure_1.svg'],
      ['c', 3, 'figure_2.svg'],
    ]);
  });

  it('blueprintIssues: sayım uyuşmazlığı parse\'ı düşürmez, yardımcı bildirir', () => {
    const raw = valid('exam-generation', 'tyt-blueprint-figures') as { blueprint: { sections: { name: string; count: number }[]; difficulty: Record<string, number> } };
    expect(blueprintIssues(examGeneration.parse(raw))).toEqual([]);
    raw.blueprint.sections[0]!.count += 1;
    raw.blueprint.difficulty.easy! += 1;
    const exam = examGeneration.parse(raw);
    expect(blueprintIssues(exam).map((i) => [i.kind, i.expected - i.actual])).toEqual([['section', 1], ['difficulty', 1]]);
    raw.blueprint.sections.push({ name: raw.blueprint.sections[0]!.name, count: 1 });
    expect(examGeneration.isValid(raw)).toBe(false);
  });

  it('blueprint ve figure olmadan (alıştırma seti, eski veri) geçerli; strict şemada ikisi de zorunlu', () => {
    const exam = valid('exam-generation', 'mcq-and-numeric');
    delete exam.blueprint;
    for (const it of exam.items as Record<string, unknown>[]) delete it.figure;
    const out = examGeneration.parse(exam);
    expect(out.blueprint ?? null).toBeNull();
    expect(out.items.every((i) => (i.figure ?? null) === null)).toBe(true);
    expect(examFigureJobs(out)).toEqual([]);
    const strict = JSON.stringify(outputFormat(examGeneration).schema);
    expect(strict).toContain('"required":["title","blueprint","items","keys"]');
    expect(strict).toMatch(/"required":\["no","section","kind","stem","options","figure_svg","figure",/);
  });
});

describe('personalization-check', () => {
  it('ok ↔ sorunlu blok yok', () => {
    expect(personalizationCheck.isValid({ ok: true, offending_block_ids: [], findings: [] })).toBe(true);
    expect(personalizationCheck.isValid({ ok: true, offending_block_ids: ['b6'], findings: [{ block_id: 'b6', problem: 'generic', note: 'genel uyarı' }] })).toBe(false);
  });
});

describe('calloutReferenceIssues (deterministik kişiselleştirme denetimi)', () => {
  const known = [{ source: 'patterns.md' as const, id: 'patterns.md:2', dates: ['2026-10-12', '2026-10-19'] }];
  const doc = () => documentAst.parse(valid('document-ast', 'notes-figure-code'));
  const callout = (d: ReturnType<typeof doc>) => d.blocks.find((b) => b.type === 'common_mistake_callout') as { pattern_ref: unknown };

  it('gerçek örüntü + tarih: sorun yok', () => {
    expect(calloutReferenceIssues(doc(), known)).toEqual([]);
  });

  it('kaynaksız, bilinmeyen, tarihi tutmayan ve genel belgede kişisel kutu', () => {
    const d1 = doc();
    callout(d1).pattern_ref = null;
    expect(calloutReferenceIssues(d1, known)).toEqual([{ block_id: 'b6', problem: 'missing_ref' }]);
    expect(calloutReferenceIssues(doc(), [])).toEqual([{ block_id: 'b6', problem: 'unknown_pattern' }]);
    expect(calloutReferenceIssues(doc(), [{ ...known[0]!, dates: ['2026-10-12'] }])).toEqual([{ block_id: 'b6', problem: 'date_mismatch' }]);
    const d2 = doc();
    d2.meta.personalized = false;
    expect(calloutReferenceIssues(d2, known)).toEqual([{ block_id: 'b6', problem: 'ref_in_generic_note' }]);
  });
});

describe('P3 denetim sonrası: genel not kutusu ve deneme dağılımı kopyası', () => {
  it('kişiselleştirilmemiş notta başvurusuz hata kutusu da yok: callout_in_generic_note', () => {
    const d = documentAst.parse(valid('document-ast', 'notes-figure-code'));
    d.meta.personalized = false;
    const callout = d.blocks.find((b) => b.type === 'common_mistake_callout') as { pattern_ref: unknown };
    callout.pattern_ref = null;
    expect(calloutReferenceIssues(d, [])).toEqual([{ block_id: 'b6', problem: 'callout_in_generic_note' }]);
  });

  it('examBlueprintIssues: kopya istekle aynı değilse ya da sayımlar tutmuyorsa sorun döner (istek kaynaktır)', () => {
    const exam = examGeneration.parse(valid('exam-generation', 'tyt-blueprint-figures'));
    const requested = exam.blueprint!;
    expect(examBlueprintIssues(requested, exam)).toEqual([]);
    expect(examBlueprintIssues(requested, { ...exam, blueprint: null })).toEqual([{ kind: 'copy', name: 'blueprint', expected: 0, actual: 0 }]);
    const other = { sections: requested.sections.map((s) => ({ ...s })), difficulty: { ...requested.difficulty } };
    other.sections[0]!.count += 1;
    expect(examBlueprintIssues(other, exam).map((i) => i.kind)).toEqual(['copy', 'section']);
  });
});
