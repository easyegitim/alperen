/**
 * P4 tarz kütüphanesi birim testleri (veritabanısız): kümeleme deterministik ve sentetik arşivde beklenen tarzlar,
 * var olan tarzlarla eşleme, kod/ad kuralları, skor (SQL formülünün saf karşılığı), PDF → sayfa (pdftoppm), tarza özel
 * üretim eşlemesi (fikstür), Bugün tarz kartı kuralı ve sahte taşıma fikstürlerinin arşivle tutarlılığı.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { StyleQuestionGeneration } from '@ogrenmen/contracts';
import { STYLE_CLUSTERS_MARK, STYLE_REQUEST_MARK, archiveMatch, examItemMatch, examItemExtractUserText, styleQuestionGenUserText } from '@ogrenmen/prompts';
import { mapStyleItems } from '../src/styles/bank.js';
import {
  assignStyles,
  clusterItems,
  copiesArchiveQuestion,
  copiesSource,
  fallbackName,
  slugCode,
  tokenize,
  uniqueCode,
  usableStyleText,
  type ClusterItem,
} from '../src/styles/cluster.js';
import { frequencyBand, styleScore } from '../src/styles/score.js';
import { loadArchivePages, pdftoppmRasterizer } from '../src/styles/pages.js';
import { FakeTransport, Gateway, InMemoryLedger } from '@ogrenmen/llm';
import { SPEND_RETRY_AFTER_SEC, itemText, styleIngestJob, toItemPayload } from '../src/jobs/style-ingest.js';
import { jobCtx, routedDb } from './support.js';
import { getJob, jobNames } from '../src/jobs/registry.js';
import { REQUIRED_QUEUES } from '../src/startup-checks.js';
import { planSuggestions, type StudentSignals } from '../src/suggestions/rules.js';
import { styleSuggestion, type StyleGap } from '../src/suggestions/styles.js';

interface Archive {
  styles: { key: string; first_cluster: string; code: string; name: string; topic: string; format: string; trick: string; skill_ids: string[] }[];
  sources: { year: number; term: string; items: { no: number; style: string; points: number; difficulty: number; text: string }[] }[];
  expected: { clusters_2024: string[][]; clusters_all: string[][] };
}

const ARCHIVE = JSON.parse(readFileSync(new URL('./fixtures/styles/archive.json', import.meta.url), 'utf8')) as Archive;
const HAS_PDFTOPPM = spawnSync('pdftoppm', ['-v']).error === undefined;
const LLM_FIXTURES = new URL('../../../packages/llm/fixtures/', import.meta.url);
const readFixture = (p: string) => JSON.parse(readFileSync(new URL(p, LLM_FIXTURES), 'utf8')) as { fake_match?: string[]; output?: unknown } & Record<string, unknown>;

/** Arşiv maddeleri, sahte madde sınıflandırmasının (exam_item_extract fikstürü) verdiği konu/kazanım/biçimle. */
function archiveItems(years: number[] = [2024, 2025]): (ClusterItem & { key: string })[] {
  const st = new Map(ARCHIVE.styles.map((s) => [s.key, s]));
  return ARCHIVE.sources
    .filter((s) => years.includes(s.year))
    .flatMap((s) =>
      s.items.map((it) => {
        const x = st.get(it.style)!;
        return { id: `${s.year}-${it.no}`, key: `${s.year}-${it.no}`, text: it.text, topic: x.topic, skillIds: x.skill_ids, kind: 'calc', format: x.format };
      }),
    );
}

const partition = (items: { key: string }[], groups: number[][]) => groups.map((g) => g.map((i) => items[i]!.key));
const canon = (p: string[][]) => p.map((g) => [...g].sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));

describe('kümeleme (tf-idf + aynı-kazanım bonusu)', () => {
  it('sentetik arşiv: 2024 → 4 küme, iki yıl birlikte → 4 tarz (beklenen üyeler)', () => {
    const y24 = archiveItems([2024]);
    const r24 = clusterItems(y24);
    expect(r24.method).toBe('tfidf');
    expect(partition(y24, r24.groups)).toEqual(ARCHIVE.expected.clusters_2024);
    const all = archiveItems();
    const r = clusterItems(all);
    expect(canon(partition(all, r.groups))).toEqual(canon(ARCHIVE.expected.clusters_all));
  });

  it('deterministik: aynı girdi aynı kümeler; girdi sırası bölmeyi değiştirmez', () => {
    const all = archiveItems();
    expect(clusterItems(all)).toEqual(clusterItems(all));
    const shuffled = [...all].reverse();
    expect(canon(partition(shuffled, clusterItems(shuffled).groups))).toEqual(canon(partition(all, clusterItems(all).groups)));
  });

  it('kazanım bonusu: metni farklı ama aynı kazanımlı madde aynı tarza; kazanımsız ve metni farklı madde ayrı kalır', () => {
    const all = archiveItems();
    const noSkills = all.map((it) => ({ ...it, skillIds: [], topic: null }));
    const withBonus = partition(all, clusterItems(all).groups).find((g) => g.includes('2025-4'))!;
    expect(withBonus).toContain('2024-2');
    const without = partition(noSkills, clusterItems(noSkills).groups).find((g) => g.includes('2025-4'))!;
    expect(without).not.toContain('2024-2');
  });

  it('gömme varsa kosinüs gömmeyle (eşik 0,30)', () => {
    const items: ClusterItem[] = [
      { id: 'a', text: 'x', topic: null, skillIds: [], kind: 'calc', format: null, embedding: [1, 0, 0] },
      { id: 'b', text: 'y', topic: null, skillIds: [], kind: 'calc', format: null, embedding: [0.95, 0.05, 0] },
      { id: 'c', text: 'z', topic: null, skillIds: [], kind: 'calc', format: null, embedding: [0, 1, 0] },
    ];
    const r = clusterItems(items);
    expect(r.method).toBe('embedding');
    expect(r.groups).toEqual([[0, 1], [2]]);
  });

  it('belirteçler: sayılar tek belirteç, KaTeX komutu korunur, Türkçe küçük harf', () => {
    expect(tokenize('İşlem $\\frac{3}{4}$ ile 125 TL')).toEqual(['işlem', 'frac_cmd', '#', '#', '#', 'tl']);
  });
});

describe('var olan tarzlarla eşleme', () => {
  const groups = [[0, 1, 2], [3, 4], [5]];
  it('onaylı tarz (pinned) kümesini çeker; onaysız tarz en çok ortak maddeyle yeniden kullanılır; kalan küme yeni', () => {
    const out = assignStyles({
      styleOf: ['P', null, 'D', 'D', 'D', null],
      styles: [{ id: 'P', code: 'onayli', pinned: true }, { id: 'D', code: 'taslak', pinned: false }],
      groups,
    });
    expect(out.map((c) => [c.key, c.styleId, c.assign])).toEqual([
      ['k1', 'P', [1, 2]], // 2'nin taslağı onaylı tarza geçer
      ['k2', 'D', []],
      ['k3', null, [5]],
    ]);
  });
  it('onaylı tarzın maddesi başka kümeye düşse de yerinde kalır (atanmaz)', () => {
    const out = assignStyles({ styleOf: [null, null, null, 'P', null, null], styles: [{ id: 'P', code: 'onayli', pinned: true }], groups });
    expect(out[1]).toMatchObject({ styleId: 'P', assign: [4] });
  });
  it('bir onaysız tarz yalnız bir kümeye verilir', () => {
    const out = assignStyles({ styleOf: ['D', 'D', null, 'D', null, null], styles: [{ id: 'D', code: 'taslak', pinned: false }], groups });
    expect(out.map((c) => c.styleId)).toEqual(['D', null, null]);
  });
});

describe('ad ve kod kuralları', () => {
  it('kod: Türkçe harf ASCII, tire, benzersiz', () => {
    expect(slugCode('Kesirlerle İşlem Önceliği (Ş)')).toBe('kesirlerle-islem-onceligi-s');
    const taken = new Set(['kesir-islem']);
    expect(uniqueCode('kesir-islem', taken)).toBe('kesir-islem-2');
    expect(uniqueCode('kesir-islem', taken)).toBe('kesir-islem-3');
    expect(uniqueCode('!!', taken)).toBe('tarz');
  });
  it('öngörü sözcüğü ve 30+ karakterlik kopya reddedilir', () => {
    const src = ['Bir sayının 3 katının 5 fazlası, aynı sayının 2 katından 11 fazladır.'];
    expect(usableStyleText('Sözel ifadeden denklem kurma', src, 3, 80)).toBe(true);
    expect(usableStyleText('Sınavda kesin çıkacak tarz', src, 3, 80)).toBe(false);
    expect(usableStyleText('Tahmini sık soru', src, 3, 80)).toBe(false);
    expect(copiesSource('Soru: bir sayının 3 katının 5 fazlası, aynı sayı', src)).toBe(true);
    expect(fallbackName([{ topic: 'Denklem kurma problemi', text: src[0]!, skillIds: ['s1'] }], new Map(), 4)).toBe('Denklem kurma problemi');
    expect(fallbackName([{ topic: null, text: src[0]!, skillIds: ['s1'] }], new Map([['s1', 'Sayı problemleri']]), 4)).toBe('Sayı problemleri');
    expect(fallbackName([{ topic: null, text: 'x', skillIds: [] }], new Map(), 4)).toBe('Soru tarzı 4');
  });
});

describe('öncelik skoru (SQL app.refresh_style_scores ile aynı formül)', () => {
  it('0.5·sıklık + 0.3·güncellik + 0.2·uyum', () => {
    expect(styleScore({ yearsHit: [2024, 2025], archiveYears: [2024, 2025], alignment: 1 })).toEqual({ frequency: 1, recency: 1, alignment: 1, score: 1 });
    // yalnız 2024'te: sıklık 0,5, güncellik 0.5^(1/2) = 0,7071
    expect(styleScore({ yearsHit: [2024], archiveYears: [2024, 2025], alignment: 1 })).toEqual({ frequency: 0.5, recency: 0.7071, alignment: 1, score: 0.6621 });
    expect(styleScore({ yearsHit: [2021], archiveYears: [2021, 2022, 2023, 2025], alignment: 0.5 })).toEqual({ frequency: 0.25, recency: 0.25, alignment: 0.5, score: 0.3 });
    expect(styleScore({ yearsHit: [], archiveYears: [2024], alignment: 0.5 }).score).toBe(0.1);
  });
  it('kelime bandı (yüzde yok)', () => {
    expect([frequencyBand(1), frequencyBand(0.5), frequencyBand(0.2), frequencyBand(0)]).toEqual(['sık soruluyor', 'ara sıra soruluyor', 'seyrek soruluyor', null]);
  });
});

describe('sahte taşıma fikstürleri arşivle tutarlı', () => {
  it('exam_page_items / exam_item_extract eşleme anahtarları prompts kurucularıyla aynı', () => {
    for (const s of ARCHIVE.sources) {
      const page = readFixture(`exam_page_items/arsiv-${s.year}.json`);
      expect(page.fake_match).toEqual([archiveMatch(s.year), 'sayfa 1/1.']);
      expect((page.output as { items: { stem_text: string }[] }).items.map((i) => i.stem_text)).toEqual(s.items.map((i) => i.text));
      for (const it of s.items) {
        const f = readFixture(`exam_item_extract/arsiv-${s.year}-${it.no}.json`);
        expect(f.fake_match).toEqual([archiveMatch(s.year), examItemMatch(it.no)]);
        const text = examItemExtractUserText({ sourceId: '00000000-0000-4000-8000-000000000001', itemNo: it.no, year: s.year, term: s.term, section: null, kindHint: 'open', text: it.text, options: [], figures: [], legibility: 'clear' }).toLocaleLowerCase('tr');
        for (const m of f.fake_match!) expect(text).toContain(m);
      }
    }
    const def = readFixture('style_definition/arsiv.json') as unknown as { styles: { cluster_id: string; code: string }[] };
    expect(def.styles.map((s) => s.cluster_id)).toEqual(ARCHIVE.styles.map((s) => s.first_cluster));
    expect(STYLE_CLUSTERS_MARK.length).toBeGreaterThan(5);
    const gen = readFixture('style_question_gen/arsiv-tarz.json');
    const req = styleQuestionGenUserText({ style: { id: 'x', code: 'c', name: 'n', description: null, format: null, trick: null, difficulty_band: null }, count: 3, skills: [], exemplars: [], avoidStems: [], courseTitle: null });
    for (const m of gen.fake_match!) expect(req.toLocaleLowerCase('tr')).toContain(m);
    expect(req).toContain(STYLE_REQUEST_MARK);
  });
});

describe('style.ingest yardımcıları', () => {
  it('harcama tavanı: son denemede bile kaynak düşürülmez, iş ertelenir', async () => {
    const SRC = '00000000-0000-4000-8000-0000000000aa';
    const db = routedDb([
      [/from public\.exam_sources s join public\.courses/, () => [{ id: SRC, course_id: 'c1', course_code: 'MAT', course_title: 'Mat', curriculum_id: 'cur', year: 2024, term: 'osym', status: 'uploaded', upload_ids: ['u1'] }]],
      [/check_spend\('style\.ingest'\)/, () => [{ paid_allowed: false, state: 'hard_cap' }]],
    ]);
    const paid = { transport: { kind: 'anthropic' } } as unknown as Gateway;
    const ctx = jobCtx({ db, gateway: async () => paid, job: { id: 'j', name: 'style.ingest', retryCount: 3 } });
    const r = await styleIngestJob.handler!({ source_id: SRC }, ctx);
    expect(r.status).toBe('uploaded');
    expect(r.warnings[0]).toMatch(/kaynak bekletildi/);
    expect(db.calls.some((c) => /set status = 'failed'/.test(c.text))).toBe(false);
    expect(ctx.enqueued).toEqual([{ name: 'style.ingest', data: { source_id: SRC, reason: 'spend_blocked' }, opts: expect.objectContaining({ startAfter: SPEND_RETRY_AFTER_SEC }) }]);
  });
  it('madde metni: kök + şıklar; model yoksa OCR türünden', () => {
    const q = { no: 3, section: null, kind: 'mcq' as const, stem_text: 'Kök', options: [{ key: 'A', text: '1' }, { key: 'B', text: '2' }], figures: [], pageUploadId: 'u', pageUploadIds: ['u'], legibility: 'clear' as const, skillIds: [], bbox: null };
    expect(itemText(q)).toBe('Kök\nA) 1\nB) 2');
    expect(toItemPayload(q, 2024, null)).toMatchObject({ item_no: 3, kind: 'mc', topic: null, skill_ids: [], year: 2024, ocr_text: 'Kök\nA) 1\nB) 2' });
  });

  it.skipIf(!HAS_PDFTOPPM)('PDF → PNG sayfaları (pdftoppm, sıra korunur)', async () => {
    const pdf = execFileSync('python3', ['-I', '-c', [
      'import io, sys, matplotlib', 'matplotlib.use("Agg")', 'import matplotlib.pyplot as plt', 'from matplotlib.backends.backend_pdf import PdfPages',
      'b = io.BytesIO()', 'with PdfPages(b) as pp:', '    for i in range(2):', '        f = plt.figure(figsize=(3, 2)); f.text(0.2, 0.5, f"Sayfa {i+1}"); pp.savefig(f); plt.close(f)',
      'sys.stdout.buffer.write(b.getvalue())',
    ].join('\n')], { env: { ...process.env, MPLBACKEND: 'Agg' } });
    const pages = await pdftoppmRasterizer(pdf, { dpi: 50, maxPages: 5 });
    expect(pages).toHaveLength(2);
    for (const p of pages) expect(p.subarray(1, 4).toString()).toBe('PNG');
  }, 30_000);
  it('pdftoppm yoksa PDF belge olarak okunur (uyarı); Storage yoksa yükleme tek sayfa', async () => {
    const gateway = new Gateway({ transport: new FakeTransport(), ledger: new InMemoryLedger() });
    const up = { id: 'u1', owner_id: 'o', student_id: null, kind: 'pdf', storage_path: 'o/u1.pdf', mime: 'application/pdf', status: 'processing', anthropic_file_id: null };
    const storage = { upload: async () => undefined, download: async () => Buffer.from('%PDF-1.4'), createSignedUrl: async () => '' };
    const r = await loadArchivePages({ gateway, storage, uploads: [up], sourceId: 's1', rasterize: async () => { throw new Error('pdftoppm çalışmadı: ENOENT'); } });
    expect(r.pages).toMatchObject([{ uploadId: 'u1', order: 1, total: 1, mime: 'application/pdf' }]);
    expect(r.warnings[0]).toMatch(/belge olarak/);
    const r2 = await loadArchivePages({ gateway, storage: null, uploads: [up, { ...up, id: 'u2', kind: 'photo', mime: 'image/png', storage_path: 'o/u2.png' }], sourceId: 's1' });
    expect(r2.pages.map((p) => [p.order, p.total, p.mime])).toEqual([[1, 2, 'application/pdf'], [2, 2, 'image/png']]);
  });
});

describe('tarza özel üretim eşlemesi (fikstür)', () => {
  const gen = readFixture('style_question_gen/arsiv-tarz.json').output as StyleQuestionGeneration;
  const base = { curriculumId: 'cur', styleId: 'S1', model: 'm', costUsd: 0.3, promptVersion: 'v1', jobRef: 'j', remapForeignSkills: false };
  it('kazanım tarzın yaprağıysa üç soru; anahtarlar ayrı; style_id doğrulamada', () => {
    const r = mapStyleItems(gen, { ...base, leaves: ['tyt.mat.temel.rasyonel-sayilar'] });
    expect(r.dropped).toEqual([]);
    expect(r.items.map((i) => [i.kind, i.key.correct_option, i.key.numeric_value, i.key.canonical_expr])).toEqual([
      ['mcq', 'C', null, 'Rational(3,4)'],
      ['mcq', 'C', null, '1'],
      ['numeric', null, '5', '5'],
    ]);
    expect(r.items.every((i) => i.verification.style_id === 'S1' && i.key.sympy_status === 'not_applicable')).toBe(true);
    expect(new Set(r.items.map((i) => i.content_hash)).size).toBe(3);
  });
  it('başka kazanım: gerçek modelde atılır, sahte taşımada tarzın yaprağına eşlenir', () => {
    expect(mapStyleItems(gen, { ...base, leaves: ['tyt.mat.problem.sayi'] }).items).toHaveLength(0);
    expect(mapStyleItems(gen, { ...base, leaves: ['tyt.mat.problem.sayi'], remapForeignSkills: true }).items.every((i) => i.skill_ids[0] === 'tyt.mat.problem.sayi')).toBe(true);
  });
  it('kökü arşiv metnini yeniden üreten madde atılır (telif); kalıp ifade ortaklığı maddeyi düşürmez', () => {
    const leaves = ['tyt.mat.temel.rasyonel-sayilar'];
    const first = gen.items[0]!;
    // arşivde üretilen kök, boşluk/büyük harf farkıyla aynen geçiyor
    const archive = `2019 ÖSYM Soru 7.   ${first.stem.toLocaleUpperCase('tr').replace(/ /g, '  ')}\nA) 1 B) 2`;
    const r = mapStyleItems(gen, { ...base, leaves, sources: [archive] });
    expect(r.dropped).toEqual([{ no: first.no, reason: 'arşiv metnine çok benziyor' }]);
    expect(r.items).toHaveLength(gen.items.length - 1);
    // uzun bir çıkmış sorunun 60+ karakterlik parçası da yakalanır
    const long = 'Bir sayının 4 katının 7 eksiği, aynı sayının 2 katının 9 fazlasına eşittir. Bu sayıyı denklem kurarak bulunuz.';
    expect(copiesArchiveQuestion(`${long.slice(0, 70)} Buna göre sayı kaçtır?`, [long])).toBe(true);
    // "… işleminin sonucu kaçtır?" kalıbı ve kısa formül ortaklığı kopya sayılmaz
    const formulaic = '$\\left(\\frac{1}{2} + \\frac{1}{3}\\right) : \\frac{5}{6} - \\frac{1}{4}$ işleminin sonucu kaçtır? İşlem önceliğine dikkat ederek kesirleri sadeleştiriniz.';
    expect(mapStyleItems(gen, { ...base, leaves, sources: [formulaic] }).dropped).toEqual([]);
  });
});

describe('Bugün tarz kartı', () => {
  const gap: StyleGap = { styleId: 'S1', name: 'Kesirlerle işlem önceliği', skillIds: ['k1'], seen: 0, solved: 0, correct: 0, coverageText: 'Bu tarzı hiç çözmedin' };
  const enr = {
    enrollmentId: 'E1', courseId: 'C1', courseTitle: 'TYT', examDate: null, targetExam: null, leaves: [],
    firstLeaves: [{ skillId: 'f1', name: 'Sayılar' }], topMisconception: null, homework: [], lessonReview: null,
  };
  it('payload.style_id + "Bu tarzı hiç çözmedin"; alıştırmadan sonra', () => {
    const sig: StudentSignals = { studentId: 'S', today: '2026-11-04', enrollments: [{ ...enr, styleGap: gap }], documents: [], uploads: [], consumedRefs: [], practicedToday: [] };
    const cards = planSuggestions(sig);
    expect(cards.map((c) => c.kind)).toEqual(['practice', 'practice']);
    expect(cards[1]).toMatchObject({
      title: 'Kesirlerle işlem önceliği',
      subtitle: 'Bu tarzı hiç çözmedin · 8 soru · 12 dk',
      payload: { style_id: 'S1', skill_ids: ['k1'], reason: 'style_gap', count: 8, minutes: 12 },
      key: 'style:E1:S1',
    });
    expect(`${cards[1]!.title} ${cards[1]!.subtitle}`).not.toMatch(/[!%]|tahmin|çıkacak|kesin/iu);
  });
  it('kazanımı bugün çalışıldıysa ya da kartta kullanıldıysa kart yok; sinyal yoksa kart yok', () => {
    expect(styleSuggestion({ ...enr, styleGap: gap }, 0, new Set(), new Set(['k1']))).toBeNull();
    expect(styleSuggestion({ ...enr, styleGap: gap }, 0, new Set(['k1']), new Set())).toBeNull();
    expect(styleSuggestion({ ...enr, styleGap: null }, 0, new Set(), new Set())).toBeNull();
  });
});

describe('kayıt defteri', () => {
  it('üç tarz işi kayıtlı ve kuyrukları zorunlu listede', () => {
    for (const n of ['style.ingest', 'style.coverage.refresh', 'style.question_gen']) {
      expect(jobNames()).toContain(n);
      expect(REQUIRED_QUEUES).toContain(n);
      expect(getJob(n)!.handler).not.toBeNull();
    }
    expect(getJob('style.ingest')!.payload.safeParse({ source_id: '00000000-0000-4000-8000-000000000001', upload_ids: [] }).success).toBe(true);
    expect(getJob('style.question_gen')!.payload.parse({ style_id: '00000000-0000-4000-8000-000000000001' })).toMatchObject({ count: 5 });
  });
});
