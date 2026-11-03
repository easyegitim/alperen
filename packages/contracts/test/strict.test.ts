/**
 * Yapılandırılmış çıktı kısıtları (Anthropic output_config.format): model çıktısı olan sözleşmelerin strict
 * şeması özyinelemesiz, kısıtsız (min/max/length/pattern), her nesnede additionalProperties:false olmalı;
 * zorunlu olmayan alan <= 24, birleşik (anyOf / tür dizisi) alan <= 16.
 */
import { LOOSE_ONLY_KEYS } from './helpers.js';
import { describe, expect, it } from 'vitest';
import { LLM_OUTPUT_SCHEMA_NAMES, SCHEMA_NAMES, contractJsonSchema, contractRegistry, outputFormat } from '../src/index.js';

type Node = Record<string, unknown>;
const FORBIDDEN_KEYS = [
  'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'pattern', 'maxItems', 'uniqueItems', 'contains', 'minContains', 'patternProperties', 'propertyNames',
  'if', 'then', 'else', 'not', 'oneOf', 'prefixItems', '$ref', '$dynamicRef', 'unevaluatedProperties',
];
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

function isNode(x: unknown): x is Node {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function inspect(root: Node) {
  const violations: string[] = [];
  let optional = 0;
  let unions = 0;
  const visit = (n: unknown, path: string, isParam: boolean): void => {
    if (Array.isArray(n)) return n.forEach((x, i) => visit(x, `${path}[${i}]`, false));
    if (!isNode(n)) return;
    for (const k of FORBIDDEN_KEYS) if (k in n) violations.push(`${path}: ${k}`);
    if (typeof n.format === 'string' && !SUPPORTED_FORMATS.has(n.format)) violations.push(`${path}: format ${n.format}`);
    if (typeof n.minItems === 'number' && n.minItems > 1) violations.push(`${path}: minItems ${n.minItems}`);
    if (isParam && (n.anyOf !== undefined || Array.isArray(n.type))) unions += 1;
    if (n.type === 'object' || n.properties !== undefined) {
      if (n.additionalProperties !== false) violations.push(`${path}: additionalProperties false değil`);
      const required = new Set((n.required as string[] | undefined) ?? []);
      for (const [k, v] of Object.entries((n.properties as Node | undefined) ?? {})) {
        if (!required.has(k)) optional += 1;
        visit(v, `${path}.${k}`, true);
      }
    }
    if (n.items !== undefined) visit(n.items, `${path}[]`, true);
    if (n.anyOf !== undefined) visit(n.anyOf, `${path}|`, false);
  };
  visit(root, '$', false);
  return { violations, optional, unions };
}

describe('strict şemalar (model çıktısı)', () => {
  it('en az 14 sözleşme model çıktısı olarak işaretli', () => {
    expect(LLM_OUTPUT_SCHEMA_NAMES.length).toBeGreaterThanOrEqual(14);
  });

  it.each(LLM_OUTPUT_SCHEMA_NAMES)('%s: kısıt yok, nesneler kapalı, karmaşıklık sınırları içinde', (name) => {
    const doc = contractJsonSchema(contractRegistry[name], 'strict') as Node;
    const { violations, optional, unions } = inspect(doc);
    expect(violations).toEqual([]);
    expect(optional).toBeLessThanOrEqual(24);
    expect(unions).toBeLessThanOrEqual(16);
  });
});

describe('outputFormat', () => {
  it.each(LLM_OUTPUT_SCHEMA_NAMES)('%s: json_schema biçimi, enum/const korunur, meta anahtarları yok', (name) => {
    const f = outputFormat(contractRegistry[name]);
    expect(f.type).toBe('json_schema');
    for (const k of ['$schema', '$id', 'x-version', 'title']) expect(f.schema).not.toHaveProperty(k);
    expect(f.schema.type).toBe('object');
  });

  it('enum ve const değerleri açıklamaya taşınmadan şemada kalır', () => {
    const text = JSON.stringify(outputFormat(contractRegistry['document-ast']).schema);
    expect(text).toContain('"const":"heading"');
    expect(text).toContain('"enum":["notes","mock_exam","report","question_set"]');
  });
});

describe('loose şemalar', () => {
  it.each(SCHEMA_NAMES)('%s: JSON Schema üretilebilir ve nesneler kapalı', (name) => {
    const doc = contractJsonSchema(contractRegistry[name]) as Node;
    expect(doc.$id).toBe(`https://ogrenmen.easy/schemas/${name}.json`);
    expect(doc.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    const open: string[] = [];
    const visit = (n: unknown, path: string): void => {
      if (Array.isArray(n)) return n.forEach((x, i) => visit(x, `${path}[${i}]`));
      if (!isNode(n)) return;
      if (n.properties !== undefined && n.additionalProperties !== false) open.push(path);
      // if/then/contains/prefixItems/not kısmi parçalardır (v1'den taşınan koşullu kurallar), kapalı olmaları gerekmez.
      for (const [k, v] of Object.entries(n)) if (!['if', 'then', 'else', 'not', 'contains', 'prefixItems'].includes(k)) visit(v, `${path}.${k}`);
    };
    visit(doc, '$');
    expect(open).toEqual([]);
  });

  it('strict ve loose aynı biçimi paylaşır: strict çıktıdaki alan adları loose ile aynı', () => {
    for (const name of SCHEMA_NAMES) {
      const c = contractRegistry[name];
      const keys = (s: Node) => JSON.stringify(Object.keys((s.properties as Node | undefined) ?? {}).sort());
      const looseKeys = (JSON.parse(keys(contractJsonSchema(c) as Node)) as string[]).filter((k) => !(LOOSE_ONLY_KEYS[name] ?? []).includes(k));
      expect(keys(contractJsonSchema(c, 'strict') as Node), name).toBe(JSON.stringify(looseKeys));
    }
  });
});

describe('strict kipte korunan kısıtlar (minItems 1, biçimler)', () => {
  const strictProps = (name: (typeof SCHEMA_NAMES)[number]) => (contractJsonSchema(contractRegistry[name], 'strict') as Node).properties as Node;

  it.each([
    ['document-ast', 'blocks'],
    ['curriculum-draft', 'nodes'],
    ['exam-generation', 'items'],
    ['exam-generation', 'keys'],
    ['memory-compaction', 'files'],
    ['style-question-generation', 'items'],
    ['proposal-review', 'decisions'],
  ] as const)('%s.%s: loose en az 1 isteyen dizi strict\'te minItems=1', (name, field) => {
    const loose = (contractJsonSchema(contractRegistry[name]) as Node).properties as Node;
    expect((loose[field] as Node).minItems).toBeGreaterThanOrEqual(1);
    expect((strictProps(name)[field] as Node).minItems).toBe(1);
  });

  it('uuid alanı strict kipte de format: uuid taşır', () => {
    const decisions = strictProps('proposal-review').decisions as Node;
    const props = (decisions.items as Node).properties as Node;
    expect((props.proposal_id as Node).format).toBe('uuid');
  });
});
