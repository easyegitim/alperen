import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCases } from '../src/cases.js';
import { buildDump, errorCode } from '../src/dump.js';
import {
  ERROR_CODES,
  FOLD_FROM,
  FOLD_TO,
  KINDS,
  PATTERNS,
  config,
  isValidTckn,
  nameTokenHashes,
  normalizeToken,
  scrub,
  sha256Hex,
  tokenHash,
  totalReplacements,
} from '../src/index.js';

const data = loadCases();
const nodeSha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('cases.json', () => {
  it('en az 60 tekil vaka içerir', () => {
    expect(data.cases.length).toBeGreaterThanOrEqual(60);
    expect(new Set(data.cases.map((c) => c.id)).size).toBe(data.cases.length);
  });

  for (const c of data.cases) {
    it(`vaka ${c.id}`, () => {
      expect(scrub(c.text, c.opts)).toEqual(c.expected);
    });
  }

  for (const hc of data.hash_cases) {
    it(`hash ${hc.id}`, () => {
      expect(nameTokenHashes(hc.full_name)).toEqual(hc.expected);
    });
  }

  for (const ec of data.error_cases) {
    it(`hata ${ec.id} → ${ec.expected_error}`, () => {
      expect(errorCode(() => scrub(ec.text as string, ec.opts as never))).toBe(ec.expected_error);
    });
  }

  it('her hata kodu en az bir hata vakasında geçer', () => {
    expect(new Set(data.error_cases.map((e) => e.expected_error))).toEqual(new Set(Object.values(ERROR_CODES)));
  });

  it('her tür en az bir vakada geçer', () => {
    const seen = new Set(data.cases.flatMap((c) => c.expected.replacements.map((r) => r.kind)));
    expect([...seen].sort()).toEqual([...KINDS].sort());
  });

  it('opts yalnız hex hash taşır (düz ad yok)', () => {
    const hex = /^[0-9a-f]{64}$/;
    for (const c of data.cases) {
      for (const h of c.opts.nameHashes) expect(h).toMatch(hex);
      for (const h of Object.keys(c.opts.roleHashes ?? {})) expect(h).toMatch(hex);
    }
  });
});

describe('sha256', () => {
  const samples = [
    '',
    'abc',
    'elif',
    'ayşe',
    'ışıl çğöşü',
    'a'.repeat(55),
    'b'.repeat(56),
    'c'.repeat(64),
    'Öğrenmen '.repeat(40),
    '🚀 emoji',
  ];
  for (const s of samples) {
    it(`node:crypto ile aynı: ${JSON.stringify(s.slice(0, 20))} (${s.length})`, () => {
      expect(sha256Hex(s)).toBe(nodeSha(s));
    });
  }
});

describe('yardımcılar', () => {
  it('katlama: İ, I ve ı → i; diğer harfler Türkçe küçük', () => {
    expect(normalizeToken('IŞIL')).toBe('işil');
    expect(normalizeToken('Işıl')).toBe('işil');
    expect(normalizeToken('İNCE')).toBe('ince');
    expect(normalizeToken('elıf')).toBe('elif');
    expect(normalizeToken('ÇĞÖŞÜÂÎÛ')).toBe('çğöşüâîû');
    expect(Array.from(FOLD_FROM)).toHaveLength(Array.from(FOLD_TO).length);
    for (const ch of FOLD_TO) expect(ch).not.toBe('ı');
  });

  it('ELIF / ELİF / Elif / elıf aynı hash', () => {
    const hs = ['ELIF', 'ELİF', 'Elif', 'elıf', 'elif'].map((t) => tokenHash(t));
    expect(new Set(hs).size).toBe(1);
    expect(hs[0]).toBe(nodeSha('elif'));
  });

  it('NFC: ayrışık yazım aynı hash', () => {
    expect(tokenHash('S\u0327u\u0308kru\u0308')).toBe(nodeSha('şükrü'));
    expect(nameTokenHashes('E\u0301lif')).toEqual(nameTokenHashes('\u00C9lif'));
  });

  it('tokenHash kesme işaretli eki atar', () => {
    expect(tokenHash("Elif'in")).toBe(nodeSha('elif'));
    expect(tokenHash('ELİF’e')).toBe(nodeSha('elif'));
  });

  it.each([
    ['10000000146', true],
    ['12345678950', true],
    ['12345678901', false],
    ['01234567890', false],
    ['1234567890', false],
    ['1000000014a', false],
    ['10000000147', false],
  ])('TCKN %s → %s', (n, ok) => {
    expect(isValidTckn(n)).toBe(ok);
  });

  it('bilinmeyen rol etiketi reddedilir', () => {
    expect(() =>
      scrub('Elif', { nameHashes: [], roleHashes: { [tokenHash('elif')]: 'ANNE' as never } }),
    ).toThrow(/^OGR-SCR-003/);
  });

  it('prototip anahtarı (toString, constructor, hasOwnProperty) rol etiketi değildir', () => {
    for (const label of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(() =>
        scrub('Elif', { nameHashes: [], roleHashes: { [tokenHash('elif')]: label as never } }),
      ).toThrow(/^OGR-SCR-003/);
    }
  });

  it('nameHashes dizi olmalı; tek hash dizgesi de reddedilir', () => {
    expect(() => scrub('Elif', { nameHashes: 'Elif' as never })).toThrow(/^OGR-SCR-001/);
    expect(() => scrub('Elif', { nameHashes: tokenHash('elif') as never })).toThrow(/^OGR-SCR-001/);
    expect(() => scrub('Elif', undefined as never)).toThrow(/^OGR-SCR-001/);
  });

  it('düz ad hash yerine verilirse hata (sessizce geçmez)', () => {
    expect(() => scrub('Elif geldi', { nameHashes: ['Elif'] })).toThrow(/^OGR-SCR-002/);
    expect(() => scrub('Elif geldi', { nameHashes: [], roleHashes: { Elif: 'ÖĞRENCİ' } })).toThrow(/^OGR-SCR-002/);
  });

  it('OGR-PII-001 kullanılmaz (blueprint update_student_pii kodu)', () => {
    expect(Object.values(ERROR_CODES).every((c) => /^OGR-SCR-[0-9]{3}$/.test(c))).toBe(true);
  });

  it('büyük harfli hex hash kabul edilir', () => {
    expect(scrub('Elif', { nameHashes: [tokenHash('elif').toUpperCase()] }).text).toBe('[AD]');
  });

  it('deterministik ve durumsuz (global RegExp lastIndex sızmaz)', () => {
    const text = 'Benim adım Elif, numaram 0532 123 45 67';
    const first = scrub(text, { nameHashes: [] });
    for (let i = 0; i < 5; i++) expect(scrub(text, { nameHashes: [] })).toEqual(first);
    expect(nameTokenHashes('Elif Kaya')).toEqual(nameTokenHashes('Elif Kaya'));
  });

  it('toplam değişiklik sayısı', () => {
    expect(totalReplacements(scrub('a@b.com ve 05321234567 ve c@d.org', { nameHashes: [] }))).toBe(3);
  });

  it('desenler u bayrağıyla derlenir, yapılandırma eksiksiz', () => {
    for (const p of Object.values(PATTERNS)) expect(() => new RegExp(p, 'gu')).not.toThrow();
    expect(Object.keys(config())).toEqual([
      'rules_version', 'kinds', 'placeholders', 'stop_cap', 'subjects', 'low_stop', 'school_words',
      'answer_words', 'verdict_words', 'fold_from', 'fold_to', 'error_codes', 'patterns',
    ]);
  });

  it('kısa mesajda hızlıdır (Worker CPU bütçesi)', () => {
    const hashes = nameTokenHashes('Elif Kaya Ayşe Yılmaz Mert Demir');
    const text = 'Merhaba hocam, benim adım Elif. 3/4 + 1/8 kaç oluyor, paydaları nasıl eşitliyorum? '.repeat(4);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) scrub(text, { nameHashes: hashes });
    const perCall = (performance.now() - t0) / 200;
    expect(perCall).toBeLessThan(5);
  });
});

describe('dump', () => {
  it('beklenen değerlerle aynı', () => {
    const dump = buildDump(data) as { cases: Array<{ id: string; text: string; replacements: unknown }> };
    const byId = new Map(data.cases.map((c) => [c.id, c.expected]));
    for (const row of dump.cases) {
      expect({ text: row.text, replacements: row.replacements }).toEqual(byId.get(row.id));
    }
  });

  it('hata vakaları dump\'ta beklenen kodla', () => {
    const dump = buildDump(data) as { error_cases: Array<{ id: string; error: string | null }> };
    expect(dump.error_cases).toEqual(data.error_cases.map((e) => ({ id: e.id, error: e.expected_error })));
  });

  it('CLI geçerli JSON yazar', () => {
    const script = fileURLToPath(new URL('../src/dump.ts', import.meta.url));
    const out = execFileSync('bun', [script], { encoding: 'utf8' });
    const parsed = JSON.parse(out) as { cases: unknown[] };
    expect(parsed.cases.length).toBe(data.cases.length);
    expect(out.endsWith('\n')).toBe(true);
  });
});
