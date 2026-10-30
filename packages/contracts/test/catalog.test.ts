import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMA_NAMES, Schemas, schemaDocuments, schemaNameOf } from '../src/index.js';
import { SCHEMA_DIR } from './helpers.js';

type Node = Record<string, unknown>;

/** Koşullu/kısıt alt şemaları dışındaki tüm nesne düğümleri. */
function objectNodes(node: unknown, path: string, out: Array<[string, Node]>): void {
  if (Array.isArray(node)) {
    node.forEach((x, i) => objectNodes(x, `${path}/${i}`, out));
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const n = node as Node;
  if (n.type === 'object' || (Array.isArray(n.type) && n.type.includes('object'))) out.push([path, n]);
  for (const [k, v] of Object.entries(n)) {
    if (['if', 'then', 'else', 'not', 'contains', 'examples', 'const', 'enum'].includes(k)) continue;
    objectNodes(v, `${path}/${k}`, out);
  }
}

describe('sözleşme kataloğu', () => {
  it('SCHEMA_NAMES schemas/ dizinindeki dosyalarla birebir aynı (25 şema)', () => {
    const files = readdirSync(SCHEMA_DIR)
      .filter((f) => f.endsWith('.schema.json'))
      .map((f) => f.slice(0, -'.schema.json'.length))
      .sort();
    expect([...SCHEMA_NAMES]).toEqual(files);
    expect(files).toHaveLength(25);
  });

  it('§11 M00 listesindeki her şema var', () => {
    const required = [
      'common', 'question-item', 'answer-key', 'question-generation', 'lesson-analysis', 'memory-fact',
      'nightly-facts-output', 'weekly-summary', 'research-output', 'exam-item', 'exam-priority-plan',
      'bot-response-log', 'instructor-alert', 'tutor-reply', 'curriculum', 'misconception-tags', 'diagnostic-test',
      'diagnostic-keys', 'telegram-update', 'models', 'figure-render-report', 'template-params', 'transcript',
      'query-expand', 'generation-request',
    ];
    expect([...SCHEMA_NAMES].sort()).toEqual(required.sort());
  });

  it.each([...SCHEMA_NAMES])('%s: draft 2020-12, $id kuralı, x-version, Türkçe açıklama', (name) => {
    const doc = schemaDocuments[name];
    expect(doc.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(doc.$id).toBe(`https://ogrenmen.easy/schemas/${name}.json`);
    expect(Schemas[name]).toBe(doc.$id);
    expect(doc['x-version']).toBe('1.0');
    expect(typeof doc.description).toBe('string');
    expect(String(doc.description)).toMatch(/[çğıöşüÇĞİÖŞÜ]/);
  });

  it.each([...SCHEMA_NAMES])('%s: her nesne düğümü additionalProperties tanımlar ve true değildir', (name) => {
    const nodes: Array<[string, Node]> = [];
    objectNodes(schemaDocuments[name], '#', nodes);
    for (const [path, n] of nodes) {
      expect(n, `${name} ${path}`).toHaveProperty('additionalProperties');
      expect(n.additionalProperties, `${name} ${path}`).not.toBe(true);
    }
  });

  it('schemaNameOf kısa ad, $id ve dosya adını kabul eder; bilinmeyeni reddeder', () => {
    expect(schemaNameOf('question-item')).toBe('question-item');
    expect(schemaNameOf('https://ogrenmen.easy/schemas/question-item.json')).toBe('question-item');
    expect(schemaNameOf('question-item.schema.json')).toBe('question-item');
    expect(() => schemaNameOf('question-item-v9')).toThrow(/OGR-SCHEMA-001/);
  });

  it('veri nesnesi taşıyan sözleşmelerde schema_version sabiti 1.0', () => {
    for (const name of ['question-item', 'lesson-analysis', 'memory-fact', 'nightly-facts-output', 'weekly-summary', 'research-output', 'exam-item', 'exam-priority-plan', 'bot-response-log', 'instructor-alert'] as const) {
      const props = schemaDocuments[name].properties as Record<string, { const?: string }>;
      expect(props.schema_version?.const, name).toBe('1.0');
    }
  });

  it('cevap anahtarı soru maddesinde ve teşhis testinde tanımsız', () => {
    const qi = JSON.stringify(schemaDocuments['question-item'].properties);
    expect(qi).not.toContain('correct_option');
    expect(JSON.stringify(schemaDocuments['diagnostic-test'])).not.toMatch(/"correct"\s*:/);
    const gr = schemaDocuments['generation-request'].properties as Record<string, unknown>;
    expect(gr).not.toHaveProperty('ocr_text');
    expect(gr).not.toHaveProperty('stem');
  });
});
