/**
 * Örnek belgeler: fixtures/documents/{not,deneme,rapor}.json + rapor.chartdata.json. Deterministik; elle düzenlenmez.
 * Kullanım: bun scripts/gen-fixtures.ts [--check]   (--check: diskteki dosyalar güncel değilse çıkış 1)
 * Doğrulama: not/deneme `documentAst`, rapor `examReport` şemasıyla (gerçek sözleşme) geçmek zorundadır.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentAst, examReport } from '@ogrenmen/contracts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(ROOT, 'fixtures/documents');
const DATE = '2026-11-03';

const MAT = 'tyt.mat.temel.rasyonel-sayilar';

const numberLine = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 90" width="420" height="90"><line x1="20" y1="45" x2="400" y2="45" stroke="#051c60" stroke-width="2"/><g stroke="#051c60" stroke-width="2"><line x1="20" y1="37" x2="20" y2="53"/><line x1="115" y1="37" x2="115" y2="53"/><line x1="210" y1="37" x2="210" y2="53"/><line x1="305" y1="37" x2="305" y2="53"/><line x1="400" y1="37" x2="400" y2="53"/></g><g font-family="Lexend, sans-serif" font-size="14" fill="#051c60" text-anchor="middle"><text x="20" y="75">0</text><text x="115" y="75">1/4</text><text x="210" y="75">1/2</text><text x="305" y="75">3/4</text><text x="400" y="75">1</text></g><circle cx="305" cy="45" r="6" fill="#0030a2"/></svg>`;

const rightTriangle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 150" width="220" height="150"><polygon points="20,125 200,125 20,20" fill="#e3eafc" stroke="#051c60" stroke-width="2"/><rect x="20" y="109" width="16" height="16" fill="none" stroke="#051c60" stroke-width="1.5"/><g font-family="Lexend, sans-serif" font-size="14" fill="#051c60"><text x="8" y="80" text-anchor="end">6</text><text x="110" y="145" text-anchor="middle">8</text><text x="12" y="16">A</text><text x="10" y="140" text-anchor="end">B</text><text x="206" y="140">C</text></g></svg>`;

function opts(texts: string[]) {
  return texts.map((text, i) => ({ key: ['A', 'B', 'C', 'D', 'E'][i] as 'A', text }));
}

interface Q {
  stem: string;
  options: string[];
  correct: number;
  section: number;
  skill: string;
  expr: string;
  figure?: string;
}

const questions: Q[] = [
  { section: 1, skill: MAT, stem: '$\\dfrac{3}{4}+\\dfrac{5}{6}$ işleminin sonucu kaçtır?', options: ['$\\dfrac{8}{10}$', '$\\dfrac{19}{12}$', '$\\dfrac{15}{12}$', '$\\dfrac{23}{24}$', '$\\dfrac{4}{3}$'], correct: 1, expr: '19/12' },
  { section: 1, skill: 'tyt.mat.temel.mutlak-deger', stem: '$|x-3|=5$ denklemini sağlayan x değerlerinin toplamı kaçtır?', options: ['$-2$', '$0$', '$3$', '$6$', '$8$'], correct: 3, expr: '6' },
  { section: 1, skill: 'tyt.mat.temel.uslu-sayilar', stem: '$2^{x+1}=64$ olduğuna göre x kaçtır?', options: ['$3$', '$4$', '$5$', '$6$', '$7$'], correct: 2, expr: '5' },
  { section: 1, skill: 'tyt.mat.temel.ortalama', stem: 'Beş sayının aritmetik ortalaması 12 dir. Bu sayılardan biri çıkarılırsa kalan dört sayının ortalaması 10 oluyor.\n\nÇıkarılan sayı kaçtır?', options: ['$16$', '$18$', '$20$', '$22$', '$24$'], correct: 2, expr: '20' },
  { section: 1, skill: 'tyt.mat.temel.denklemler', stem: '$x^2-5x+6=0$ denkleminin kökleri $x_1$ ve $x_2$ olduğuna göre $x_1^2+x_2^2$ kaçtır?', options: ['$9$', '$11$', '$13$', '$15$', '$17$'], correct: 2, expr: '13' },
  { section: 1, skill: 'tyt.mat.temel.yuzde', stem: 'Bir ürüne yüzde yirmi zam yapıldığında fiyatı 360 TL oluyor. Ürünün zamdan önceki fiyatı kaç TL idi?', options: ['$288$', '$300$', '$312$', '$320$', '$330$'], correct: 1, expr: '300' },
  { section: 2, skill: 'tyt.geo.ucgen', stem: 'Şekildeki ABC dik üçgeninde $|AB|=6$ ve $|BC|=8$ birimdir. $[AC]$ kenarının uzunluğu kaç birimdir?', options: ['$7$', '$9$', '$10$', '$12$', '$14$'], correct: 2, expr: '10', figure: rightTriangle },
  { section: 2, skill: 'tyt.geo.cember', stem: 'Yarıçapı 7 birim olan bir çemberin çevresi kaç birimdir? ($\\pi$ sayısı olduğu gibi bırakılacaktır.)', options: ['$7\\pi$', '$14\\pi$', '$21\\pi$', '$28\\pi$', '$49\\pi$'], correct: 1, expr: '14*pi' },
  { section: 2, skill: 'tyt.geo.dortgen', stem: 'Köşegen uzunluğu $6\\sqrt{2}$ birim olan karenin alanı kaç birimkaredir?', options: ['$18$', '$24$', '$36$', '$48$', '$72$'], correct: 2, expr: '36' },
  { section: 2, skill: 'tyt.geo.ucgen', stem: 'Bir üçgenin iç açılarının ölçüleri $2x$, $3x$ ve $4x$ derecedir. Bu üçgenin en büyük açısı kaç derecedir?', options: ['$60$', '$70$', '$80$', '$90$', '$100$'], correct: 2, expr: '80' },
];

function deneme() {
  const blocks: unknown[] = questions.map((q, i) => ({
    type: 'question',
    id: `q${i + 1}`,
    section_no: q.section,
    no: i + 1,
    stem: q.stem,
    options: opts(q.options),
    ...(q.figure ? { figure: { source: 'svg', svg: q.figure, alt: 'A noktasında dik açılı, kenarları 6 ve 8 birim olan ABC dik üçgeni' } } : {}),
    skill_ids: [q.skill],
  }));
  blocks.push(
    { type: 'page_break', id: 'pb1', section_no: 2 },
    { type: 'answer_sheet', id: 'optik', section_no: 2, title: 'Optik form', question_count: questions.length, options_per_question: 5 },
    { type: 'answer_key_page', id: 'anahtar', section_no: 2, title: 'Cevap anahtarı' },
  );
  return {
    kind: 'mock_exam',
    title: 'Temel Matematik Denemesi 1',
    meta: { course_title: 'TYT Matematik', subtitle: 'Sentetik örnek: 10 soru', generated_on: DATE, language: 'tr', personalized: false, duration_min: 25 },
    sections: [
      { no: 1, title: 'Temel Matematik' },
      { no: 2, title: 'Geometri' },
    ],
    blocks,
    keys: questions.map((q, i) => ({ question_no: i + 1, correct_option: ['A', 'B', 'C', 'D', 'E'][q.correct], numeric_value: null, canonical_expr: q.expr })),
  };
}

function not() {
  const b = (type: string, id: string, section_no: number, rest: Record<string, unknown>) => ({ type, id, section_no, ...rest });
  const checks = [
    ['$\\dfrac{1}{2}+\\dfrac{1}{3}$ işleminin sonucu kaçtır?', '$\\dfrac{5}{6}$. Paydalar 6 da eşitlenir: $\\dfrac{3}{6}+\\dfrac{2}{6}$.'],
    ['$\\dfrac{2}{3}\\cdot\\dfrac{9}{4}$ çarpımı kaçtır?', '$\\dfrac{3}{2}$. Önce sadeleştir: $\\dfrac{2\\cdot 9}{3\\cdot 4}=\\dfrac{18}{12}$.'],
    ['$\\dfrac{5}{6}:\\dfrac{5}{12}$ bölümü kaçtır?', '$2$. Bölme, ikinci kesrin çarpmaya göre tersiyle çarpmaktır.'],
    ['$\\dfrac{7}{8}-\\dfrac{3}{4}$ farkı kaçtır?', '$\\dfrac{1}{8}$.'],
    ['$\\dfrac{1}{4}$ ile $\\dfrac{1}{3}$ arasında bir rasyonel sayı yaz.', 'Örneğin $\\dfrac{7}{24}$ (ikisinin ortalaması).'],
  ] as const;
  return {
    kind: 'notes',
    title: 'Rasyonel Sayılarda Dört İşlem',
    meta: { course_title: 'TYT Matematik', subtitle: 'Kişisel çalışma notu', generated_on: DATE, language: 'tr', personalized: true, duration_min: null },
    sections: [
      { no: 1, title: 'Hedefler' },
      { no: 2, title: 'Kavram' },
      { no: 3, title: 'Örnekler' },
      { no: 4, title: 'Kendini sına' },
    ],
    blocks: [
      b('heading', 'h1', 1, { level: 1, text: 'Bu notun sonunda neyi yapabileceksin' }),
      b('summary_box', 's1', 1, { title: 'Hedefler', bullets: ['Paydaları eşitleyerek toplama ve çıkarma yapmak', 'Çarpma ve bölmede sadeleştirmeyi doğru sırada kullanmak', 'Sonucu sayı doğrusunda yorumlamak'] }),
      b('heading', 'h2', 2, { level: 1, text: 'Kesirlerle toplama' }),
      b('paragraph', 'p1', 2, { text: 'İki kesri toplarken paydaları ortak bir değere getirmen gerekir. Örneğin $\\dfrac{a}{b}+\\dfrac{c}{d}$ için ortak payda $b\\cdot d$ olabilir; ama en küçük ortak katı (EKOK) almak işlemi kısaltır.' }),
      b('definition_box', 'd1', 2, { term: 'Rasyonel sayı', body: 'a ve b tam sayı, $b\\neq 0$ olmak üzere $\\dfrac{a}{b}$ biçiminde yazılabilen sayıdır.' }),
      b('math_display', 'm1', 2, { latex: '\\frac{a}{b}+\\frac{c}{d}=\\frac{a\\cdot d+b\\cdot c}{b\\cdot d}' }),
      b('figure', 'f1', 2, { source: 'svg', svg: numberLine, alt: 'Sıfırdan bire kadar dörde bölünmüş sayı doğrusu; 3/4 noktası işaretli' }),
      b('common_mistake_callout', 'c1', 2, { pattern_id: 'rasyonel.pay-payda-ayri-toplama', pattern_ref: { source: 'patterns.md', id: 'rasyonel.pay-payda-ayri-toplama', date: '2026-10-19' }, text: 'Geçen denemede $\\dfrac{1}{2}+\\dfrac{1}{3}$ işlemini $\\dfrac{2}{5}$ bulmuştun: payları ve paydaları ayrı ayrı topladın. Önce paydaları eşitle, sonra yalnız payları topla.' }),
      b('heading', 'h3', 3, { level: 1, text: 'Çözümlü örnekler' }),
      b('worked_example', 'w1', 3, {
        title: 'Toplama ve çıkarma bir arada',
        problem: '$\\dfrac{3}{4}+\\dfrac{5}{6}-\\dfrac{1}{3}$ işleminin sonucunu bul.',
        steps: ['EKOK(4, 6, 3) = 12 olduğundan her kesri 12 paydaya getir: $\\dfrac{9}{12}+\\dfrac{10}{12}-\\dfrac{4}{12}$.', 'Payları işle: $9+10-4=15$.', 'Sadeleştir: $\\dfrac{15}{12}=\\dfrac{5}{4}$.'],
        answer: '$\\dfrac{5}{4}$',
      }),
      b('table', 't1', 3, {
        caption: 'İşlem türüne göre özet',
        header: ['İşlem', 'Kural', 'Örnek'],
        rows: [
          ['Toplama', 'Paydaları eşitle, payları topla', '$\\dfrac{1}{4}+\\dfrac{1}{4}=\\dfrac{1}{2}$'],
          ['Çarpma', 'Pay payla, payda paydayla', '$\\dfrac{2}{3}\\cdot\\dfrac{3}{5}=\\dfrac{2}{5}$'],
          ['Bölme', 'İkinci kesri ters çevirip çarp', '$\\dfrac{1}{2}:\\dfrac{1}{4}=2$'],
        ],
      }),
      b('summary_box', 's2', 3, { title: 'Aklında kalsın', bullets: ['Toplamada önce payda eşitle.', 'Çarpmada çapraz sadeleştirme zaman kazandırır.', 'Bölme işleminde ikinci kesri ters çevir.'] }),
      b('page_break', 'pb', 4, {}),
      b('heading', 'h4', 4, { level: 1, text: 'Kendini sına' }),
      ...checks.map(([question, answer_hidden], i) => b('check_yourself', `k${i + 1}`, 4, { question, answer_hidden })),
    ],
    keys: [],
  };
}

const reportCharts = {
  section_nets: {
    kind: 'score_by_section',
    rows: [
      { label: 'Temel Matematik', net: 22.5, max: 40 },
      { label: 'Geometri', net: 6, max: 10 },
      { label: 'Fizik', net: 4, max: 14 },
    ],
  },
  skill_map: {
    kind: 'skill_heatmap',
    rows: [
      { label: 'Rasyonel sayılar', value: 0.85, correct: 6, total: 7 },
      { label: 'Mutlak değer', value: 0.55, correct: 3, total: 5 },
      { label: 'Üslü sayılar', value: 0.7, correct: 4, total: 6 },
      { label: 'Yüzde ve oran', value: 0.3, correct: 1, total: 4 },
      { label: 'Üçgenler', value: 0.62, correct: 5, total: 8 },
      { label: 'Çember ve daire', value: 0.15, correct: 0, total: 3 },
    ],
  },
  error_causes: {
    kind: 'error_cause_histogram',
    rows: [
      { label: 'Kavram eksiği', count: 6 },
      { label: 'İşlem hatası', count: 4 },
      { label: 'Dikkatsizlik', count: 3 },
      { label: 'Soruyu yanlış okuma', count: 1 },
      { label: 'Süre yetmedi', count: 5 },
    ],
  },
  trend: {
    kind: 'mastery_trend',
    points: [
      { label: 'Eylül', value: 0.35 },
      { label: 'Ekim', value: 0.48 },
      { label: 'Kasım', value: 0.58 },
    ],
  },
};

function rapor() {
  const b = (type: string, id: string, section_no: number, rest: Record<string, unknown>) => ({ type, id, section_no, ...rest });
  return {
    kind: 'report',
    title: 'Deneme analizi: Temel Matematik Denemesi 1',
    meta: { course_title: 'TYT Matematik', subtitle: 'Okul denemesi', generated_on: DATE, language: 'tr', personalized: true, duration_min: null },
    sections: [
      { no: 1, title: 'Özet' },
      { no: 2, title: 'Ayrıntı' },
      { no: 3, title: 'Sonraki adım' },
    ],
    blocks: [
      b('paragraph', 'p1', 1, { text: 'Bu denemede toplam netin 32,5 oldu; matematikte iyi, fizikte orta düzeyde bir sonuç aldın ve en çok kazanç yüzde konusunda var.' }),
      b('chart', 'ch1', 1, { chart_kind: 'score_by_section', title: 'Bölüm netleri', data_ref: 'section_nets', caption: 'Çubuk uzunluğu bölümün en yüksek netine göre.' }),
      b('heading', 'h1', 2, { level: 1, text: 'Kazanım haritası' }),
      b('chart', 'ch2', 2, { chart_kind: 'skill_heatmap', title: 'Kazanım ısı haritası', data_ref: 'skill_map', caption: 'Koyu hücre güçlü, açık hücre çalışılacak konu. Sayı: doğru / sorulan.' }),
      b('chart', 'ch3', 2, { chart_kind: 'error_cause_histogram', title: 'Hataların nedeni', data_ref: 'error_causes' }),
      b('heading', 'h2', 2, { level: 1, text: 'Yanlış ve boş sorular' }),
      b('table', 't1', 2, {
        caption: 'Yeniden bakılacak sorular',
        header: ['Soru', 'Durum', 'Kazanım', 'Neden'],
        rows: [
          ['4', 'Yanlış', 'Ortalama', 'İşlem hatası'],
          ['6', 'Yanlış', 'Yüzde ve oran', 'Kavram eksiği'],
          ['8', 'Boş', 'Çember ve daire', 'Süre yetmedi'],
          ['9', 'Boş', 'Dörtgenler', 'Süre yetmedi'],
        ],
      }),
      b('common_mistake_callout', 'c1', 2, { pattern_id: 'yuzde.zam-sonrasi-geri-hesap', text: 'Yüzde sorularında zamlı fiyattan geri dönerken yüzdeyi çıkarıyorsun. Zamlı fiyat, ilk fiyatın 1,2 katıdır; böl, çıkarma.' }),
      b('chart', 'ch4', 2, { chart_kind: 'mastery_trend', title: 'Son üç ayda genel ustalık', data_ref: 'trend' }),
      b('summary_box', 's1', 3, { title: 'Sonraki adım', bullets: ['Bu hafta yüzde ve oran için 10 soruluk bir çalışma yap.', 'Çember ve daire konusunun kısa notunu oku.', 'Bir sonraki denemede son 10 dakikayı boş soruları görmeye ayır.'] }),
    ],
    keys: [],
  };
}

const outputs: [string, unknown][] = [
  ['not.json', documentAst.parse(not())],
  ['deneme.json', documentAst.parse(deneme())],
  ['rapor.json', examReport.parse(rapor())],
  ['rapor.chartdata.json', reportCharts],
];

const check = process.argv.includes('--check');
if (!check) mkdirSync(OUT, { recursive: true });
let stale = 0;
for (const [name, value] of outputs) {
  const path = resolve(OUT, name);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) {
      console.error(`GÜNCEL DEĞİL: fixtures/documents/${name} (bun run fixtures)`);
      stale++;
    }
  } else {
    writeFileSync(path, text);
  }
}
if (stale > 0) process.exit(1);
console.log(check ? 'fixtures/documents güncel' : `fixtures/documents yazıldı (${outputs.length} dosya)`);
