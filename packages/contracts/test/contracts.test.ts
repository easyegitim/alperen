import { describe, expect, it } from 'vitest';
import {
  LLM_OUTPUT_SCHEMA_NAMES,
  SCHEMA_NAMES,
  contractRegistry,
  curriculumDraft,
  lessonAnalysis,
  memoryDelta,
  questionItem,
  schemaRegistry,
  solutionDiagnosis,
  strictSchemaRegistry,
} from '../src/index.js';
import { fixtureFiles } from './helpers.js';

const valid = (schema: string, name: string): Record<string, unknown> => {
  const f = fixtureFiles(schema, 'valid').find((x) => x.name === `${name}.json`);
  if (!f) throw new Error(`fikstür yok: ${schema}/${name}`);
  return structuredClone(f.data) as Record<string, unknown>;
};

describe('kayıt defteri', () => {
  it('v2 planındaki bütün şemalar kayıtlı', () => {
    const required = [
      'solution-diagnosis', 'curriculum-draft', 'page-class', 'exam-page-items', 'answer-sheet', 'inferred-keys',
      'exam-report', 'document-ast', 'exam-generation', 'style-definition', 'memory-delta', 'conversation-summary',
      'notification-copy', 'eval-verdict',
      'question-item', 'answer-key', 'lesson-analysis', 'exam-item', 'exam-priority-plan', 'memory-fact',
      'weekly-summary', 'transcript', 'figure-render-report', 'curriculum',
    ];
    for (const n of required) expect(SCHEMA_NAMES, n).toContain(n);
  });

  it('ad, kayıt anahtarıyla aynı; schemaRegistry loose, strictSchemaRegistry strict şemayı verir', () => {
    for (const n of SCHEMA_NAMES) {
      expect(contractRegistry[n].name).toBe(n);
      expect(schemaRegistry[n]).toBe(contractRegistry[n].loose);
      expect(strictSchemaRegistry[n]).toBe(contractRegistry[n].strict);
      expect(contractRegistry[n].looseSchema()).toBe(contractRegistry[n].loose);
      expect(contractRegistry[n].strictSchema()).toBe(contractRegistry[n].strict);
    }
  });

  it('model çıktısı sözleşmeleri listesi', () => {
    for (const n of ['solution-diagnosis', 'document-ast', 'memory-delta', 'curriculum-draft'] as const) {
      expect(LLM_OUTPUT_SCHEMA_NAMES).toContain(n);
    }
  });
});

describe('solution-diagnosis', () => {
  it('geçerli örnek ayrıştırılır, hatalı adım numarası reddedilir', () => {
    const data = valid('solution-diagnosis', 'wrong-step');
    expect(solutionDiagnosis.isValid(data)).toBe(true);
    expect(solutionDiagnosis.parse(data).failing_step_no).toBe(2);
    expect(solutionDiagnosis.isValid({ ...data, failing_step_no: 99 })).toBe(false);
  });

  it('strict şema kısıtları denetlemez (güven 1.4 geçer), loose eder', () => {
    const data = { ...valid('solution-diagnosis', 'wrong-step'), confidence: 1.4 };
    expect(solutionDiagnosis.strict.safeParse(data).success).toBe(true);
    expect(solutionDiagnosis.loose.safeParse(data).success).toBe(false);
  });
});

describe('curriculum-draft', () => {
  it('ağaç kuralları: yaprak zinciri geçerli, derinlik 5 reddedilir', () => {
    const data = valid('curriculum-draft', 'lgs-fen-slice');
    expect(curriculumDraft.isValid(data)).toBe(true);
    const nodes = data.nodes as Record<string, unknown>[];
    const extra = { ...nodes[3], code: `${nodes[3]?.code}.x`, parent_code: nodes[3]?.code };
    expect(curriculumDraft.isValid({ ...data, nodes: [...nodes, extra] })).toBe(false);
  });
});

describe('question-item', () => {
  it('şık kuralı: A-B-C-D sırası ve en az iki etiketsiz şık', () => {
    const item = valid('question-item', 'mcq-diagnostic');
    expect(questionItem.isValid(item)).toBe(true);
    const tags = ['a.b', 'c.d', 'e.f', 'g.h'];
    const options = (item.options as Record<string, unknown>[]).map((o, i) => ({ ...o, misconception_tag: tags[i] }));
    expect(questionItem.isValid({ ...item, options })).toBe(false);
    expect(questionItem.isValid({ ...item, correct_option: 'B' })).toBe(false);
  });
});

describe('lesson-analysis v2', () => {
  it('v1 verisi geçerli kalır, course_insights loose kipte [] olur, strict kipte zorunludur', () => {
    const v1 = valid('lesson-analysis', 'full-lesson');
    expect('course_insights' in v1).toBe(false);
    const parsed = lessonAnalysis.parse(v1);
    expect(parsed.course_insights).toEqual([]);
    expect(lessonAnalysis.strict.safeParse(v1).success).toBe(false);
    expect(lessonAnalysis.strict.safeParse(parsed).success).toBe(true);
  });
});

describe('memory-delta', () => {
  it('en çok 3 işlem ve yalnız /memories/ altı', () => {
    const data = valid('memory-delta', 'three-ops');
    expect(memoryDelta.isValid(data)).toBe(true);
    const ops = data.ops as Record<string, unknown>[];
    expect(memoryDelta.isValid({ ops: [...ops, ops[1]] })).toBe(false);
    expect(memoryDelta.isValid({ ops: [{ ...ops[0], path: '/memories/../x.md' }] })).toBe(false);
  });
});

describe('document-ast', () => {
  it('mock_exam her soru için anahtar ister; notes anahtarsız geçer', () => {
    const doc = valid('document-ast', 'mock-exam');
    expect(contractRegistry['document-ast'].isValid(doc)).toBe(true);
    expect(contractRegistry['document-ast'].isValid({ ...doc, keys: [] })).toBe(false);
    expect(contractRegistry['document-ast'].isValid(valid('document-ast', 'personal-notes'))).toBe(true);
  });
});
