/**
 * TS toGeminiSchema ↔ Python flatten.py (schemas/gemini/*.json) birebir aynı çıktı.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_NAMES, toGeminiSchema } from '../src/index.js';
import { SCHEMA_DIR, readJson } from './helpers.js';

const GEMINI_DIR = join(SCHEMA_DIR, 'gemini');
const FLATTENED = SCHEMA_NAMES.filter((n) => n !== 'common');
const BANNED = new Set([
  '$ref', '$id', '$schema', '$defs', 'examples', 'additionalProperties', 'patternProperties', 'propertyNames',
  'allOf', 'oneOf', 'if', 'then', 'else', 'not', 'const', 'contains', 'minContains', 'exclusiveMinimum',
]);

function keysDeep(node: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(node)) node.forEach((x) => keysDeep(x, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      out.add(k);
      // properties/propertyOrdering altındaki anahtarlar alan adıdır, şema anahtar kelimesi değil.
      if (k === 'properties') Object.values(v as object).forEach((x) => keysDeep(x, out));
      else if (k !== 'propertyOrdering' && k !== 'enum' && k !== 'required') keysDeep(v, out);
    }
  }
  return out;
}

describe('Gemini responseSchema düzleştirme', () => {
  it('schemas/gemini dosya kümesi = common dışındaki tüm şemalar', () => {
    const files = readdirSync(GEMINI_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
    expect(files).toEqual([...FLATTENED].sort());
  });

  it.each(FLATTENED)('%s: TS çıktısı commit edilen Python çıktısıyla aynı', (name) => {
    const path = join(GEMINI_DIR, `${name}.json`);
    expect(existsSync(path)).toBe(true);
    expect(toGeminiSchema(name)).toEqual(readJson(path));
  });

  it.each(FLATTENED)('%s: desteklenmeyen anahtar kelime ve x-* kalmaz', (name) => {
    const keys = keysDeep(toGeminiSchema(name), new Set());
    for (const k of keys) {
      expect(BANNED.has(k) || k.startsWith('x-'), `${name}: ${k}`).toBe(false);
    }
  });

  it('format yalnız date-time olarak korunur; uuid/date/uri atılır', () => {
    const plan = toGeminiSchema('exam-priority-plan') as { properties: Record<string, Record<string, unknown>> };
    expect(plan.properties.generated_at?.format).toBe('date-time');
    const qi = toGeminiSchema('question-item') as { properties: Record<string, Record<string, unknown>> };
    expect(qi.properties.id).toEqual({ type: 'string' });
  });

  it('const → enum, oneOf null dalı → nullable, alan sırası korunur', () => {
    const qi = toGeminiSchema('question-item') as { properties: Record<string, Record<string, unknown>>; propertyOrdering: string[] };
    expect(qi.properties.schema_version).toEqual({ enum: ['1.0'], type: 'string' });
    expect(qi.properties.figure?.type).toBe('object');
    expect(qi.properties.figure?.nullable).toBe(true);
    expect(qi.propertyOrdering.slice(0, 3)).toEqual(['schema_version', 'id', 'curriculum_code']);
    const opts = qi.properties.options as { items: { properties: Record<string, Record<string, unknown>> } };
    expect(opts.items.properties.misconception_tag).toMatchObject({ type: 'string', nullable: true });
  });

  it('dosyalar arası $ref çözülür (memory-fact nightly-facts-output içine gömülür)', () => {
    const nf = toGeminiSchema('nightly-facts-output') as { properties: { facts: { items: { properties: Record<string, unknown> } } } };
    expect(Object.keys(nf.properties.facts.items.properties)).toContain('source_message_ids');
  });

  it('birleşik tür ["number","string","null"] → anyOf + nullable', () => {
    const frr = toGeminiSchema('figure-render-report') as Record<string, any>;
    const expected = frr.properties.mismatches.items.anyOf[1].properties.expected;
    expect(expected).toEqual({ anyOf: [{ type: 'number' }, { type: 'string' }], nullable: true });
  });

  it('yalnız kısıt taşıyan oneOf dalları atılır (answer-key)', () => {
    const ak = toGeminiSchema('answer-key') as Record<string, unknown>;
    expect(ak).not.toHaveProperty('anyOf');
    expect(ak.required).toEqual(['question_id', 'solution', 'sympy_status']);
  });

  it('ortak tanım şeması düzleştirilmez; bilinmeyen ad hata verir', () => {
    expect(() => toGeminiSchema('common')).toThrow(/OGR-SCHEMA-004/);
    expect(() => toGeminiSchema('yok')).toThrow(/OGR-SCHEMA-001/);
  });

  it('tutor-reply: sohbet zincirinin istediği alanlar ve sıra', () => {
    const tr = toGeminiSchema('https://ogrenmen.easy/schemas/tutor-reply.json') as { propertyOrdering: string[]; required: string[] };
    expect(tr.propertyOrdering[0]).toBe('reply');
    expect(tr.required).toContain('escalate');
  });
});
