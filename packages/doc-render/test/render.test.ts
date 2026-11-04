import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentAst, examReport, splitDocumentKeys, storedDocumentAst } from '@ogrenmen/contracts';
import { type ChartDataMap, renderHtml, sanitizeSvg, templateFor, token, trDate, trNumber, wordBand } from '../src/index.js';
import { readFixture } from './helpers.js';

type Doc = Parameters<typeof renderHtml>[0] & { keys: { question_no: number; correct_option: string | null; numeric_value: number | null }[] };
const not = readFixture<Doc>('not.json');
const deneme = readFixture<Doc>('deneme.json');
const rapor = readFixture<Doc>('rapor.json');
const chartData = readFixture<ChartDataMap>('rapor.chartdata.json');
const opts = { theme: 'print', fonts: 'none' } as const;
/** Görünen metin (SVG içindeki <text> dahil; stil ve öznitelikler hariç). */
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<head>[\s\S]*?<\/head>/, '').replace(/<[^>]+>/g, ' ');

describe('fixtures', () => {
  it('gerçek sözleşmelere uyar', () => {
    expect(documentAst.isValid(not)).toBe(true);
    expect(documentAst.isValid(deneme)).toBe(true);
    expect(examReport.isValid(rapor)).toBe(true);
    expect(storedDocumentAst.safeParse(not).success).toBe(true);
    expect(storedDocumentAst.safeParse(splitDocumentKeys(deneme).content).success).toBe(true);
  });
  it('denemede 10 soru ve 10 anahtar var', () => {
    expect(deneme.blocks.filter((b) => b.type === 'question')).toHaveLength(10);
    expect(deneme.keys).toHaveLength(10);
  });
});

describe('şablon seçimi', () => {
  it('kind -> şablon', () => {
    expect(templateFor('notes')).toBe('not');
    expect(templateFor('mock_exam')).toBe('deneme');
    expect(templateFor('question_set')).toBe('deneme');
    expect(templateFor('report')).toBe('rapor');
  });
  it('belirleyici: aynı girdi aynı çıktı', () => {
    expect(renderHtml(rapor, { ...opts, chartData })).toBe(renderHtml(rapor, { ...opts, chartData }));
    expect(renderHtml(deneme, opts)).toBe(renderHtml(deneme, opts));
  });
  it('yalnız basılı tema; koyu tema kuralı yok', () => {
    const html = renderHtml(not, opts);
    expect(html).not.toMatch(/prefers-color-scheme:\s*dark|data-theme="dark"/);
    expect(html).toContain(token('--og-paper'));
    // @ts-expect-error yalnız 'print'
    expect(() => renderHtml(not, { theme: 'dark' })).toThrow();
  });
});

describe('KaTeX, şekil, tablo', () => {
  it('satır içi ve ayrı satır formülleri sunucuda HTML+MathML olarak çizilir', () => {
    const html = renderHtml(not, opts);
    expect(html).toContain('class="katex"');
    expect(html).toContain('<math');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('mfrac');
    expect(html).not.toContain('$\\dfrac'); // ham sınırlayıcı kalmamalı
  });
  it("mathOutput:'html' MathML üretmez", () => {
    expect(renderHtml(not, { ...opts, mathOutput: 'html' })).not.toContain('<math');
  });
  it('bozuk TeX belgeyi düşürmez', () => {
    const doc = { ...not, blocks: [{ type: 'paragraph', id: 'x', section_no: 1, text: 'Bozuk $\\frac{1$ formül' }] } as unknown as Doc;
    expect(() => renderHtml(doc, opts)).not.toThrow();
  });
  it('SVG şekil satır içi gömülür, alt metni erişilebilirlik etiketidir', () => {
    const html = renderHtml(not, opts);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label="Sıfırdan bire kadar dörde bölünmüş sayı doğrusu');
  });
  it('tablo başlık, gövde ve açıklamayla çizilir', () => {
    const html = renderHtml(not, opts);
    expect(html).toContain('<table class="data"');
    expect(html).toContain('<caption>');
    expect(html).toContain('<th scope="col"><span>Kural</span></th>');
    expect(html.match(/<tr>/g)?.length).toBeGreaterThanOrEqual(4);
  });
  it('yükleme şekli: çözücü yoksa yedek kutu, varsa img', () => {
    const doc = { ...not, blocks: [{ type: 'figure', id: 'f', section_no: 1, source: 'upload', upload_id: '11111111-1111-4111-8111-111111111111', alt: 'Kırpılmış soru fotoğrafı' }] } as unknown as Doc;
    expect(renderHtml(doc, opts)).toContain('Şekil yüklenemedi');
    expect(renderHtml(doc, { ...opts, resolveUploadUrl: () => 'https://cdn.example/x.png' })).toContain('<img src="https://cdn.example/x.png"');
  });
});

describe('sanitizeSvg', () => {
  it('betik, olay işleyicisi, dış başvuru ve foreignObject atılır', () => {
    const dirty = '<svg viewBox="0 0 1 1" onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><a href="https://x.test"><rect width="1" height="1" style="fill:url(https://x.test/a)"/></a><use href="#ok"/><use href="https://x.test/s.svg#a"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script|onload|foreignObject|https:|<a\b/i);
    expect(clean).toContain('href="#ok"');
    expect(clean).toContain('<rect');
  });
  const attacks = [
    '<svg><scr<set/>ipt>document.title="PWNED"</scr<set/>ipt><rect/></svg>',
    '<svg><rect/onclick=alert(1) width=5 /></svg>',
    '<svg><rect"onclick=alert(1) width=5 /></svg>',
    '<svg><RECT ONCLICK="alert(1)" OnMouseOver=1 width="5"/></svg>',
    '<svg><ScRiPt>alert(1)</sCrIpT><rect/></svg>',
    '<svg><a href="javascript:alert(1)"><a xlink:href="https://x.test"><rect/></a></a></svg>',
    '<svg><use href="data:image/svg+xml;base64,PHN2Zz4="/><use xlink:href="javascript:alert(1)"/></svg>',
    '<svg><rect style="fill:url(&#104;ttp://x.test/a)" fill="url(https://x.test/a)"/></svg>',
    '<svg><style>@import url(https://x.test/a.css); rect{fill:url(https://x.test/b)}</style><rect/></svg>',
    '<svg><image href="https://x.test/a.png"/><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onclick" to="alert(1)"/></svg>',
    '<svg><foreignObject><iframe src="https://x.test"></iframe></foreignObject></svg>',
  ];
  it.each(attacks)('saldırı girdisi çalıştırılabilir yapı bırakmaz: %s', (dirty) => {
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/<\s*(script|foreignObject|iframe|image|animate|set|a)\b/i);
    for (const tag of clean.match(/<[^>]*>/g) ?? []) expect(tag).not.toMatch(/[\s/"']on[a-z]+\s*=/i);
    expect(clean).not.toMatch(/javascript:|https?:|data:/i);
  });
  it('iyi huylu matplotlib tarzı SVG korunur', () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g transform="translate(1 1)"><path d="M0 0L5 5" stroke="#000" stroke-width="0.5"/><use href="#g"/><text x="1" y="2">A &amp; B</text></g></svg>';
    const clean = sanitizeSvg(ok);
    for (const t of ['<linearGradient id="g">', '<path d="M0 0L5 5"', 'href="#g"', 'A &amp; B', '</svg>']) expect(clean).toContain(t);
  });
  it('style öğesi ve style/class öznitelikleri atılır (SVG CSS\'i belge genelinde etki etmez)', () => {
    const dirty = '<svg viewBox="0 0 1 1"><style>.q-options{display:none} .doc{visibility:hidden}</style><rect class="q-options" style="position:fixed;top:0;left:0;width:999px;height:999px;display:none;z-index:9;fill:#abcdef;stroke:#123456" width="1" height="1"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toContain('<style');
    expect(clean).not.toContain('q-options');
    expect(clean).not.toContain('position');
    expect(clean).not.toContain('visibility');
    expect(clean).not.toContain('z-index');
    expect(clean).not.toContain('display');
    expect(clean).toContain('style="fill:#abcdef;stroke:#123456"');
  });
  it('svg olmayan girdi boş döner; belgede yedek kutu çizilir', () => {
    expect(sanitizeSvg('<div>x</div>')).toBe('');
    const doc = { ...not, blocks: [{ type: 'figure', id: 'f', section_no: 1, source: 'svg', svg: '<div onclick=1>x</div>', alt: 'Bozuk şekil örneği' }] } as unknown as Doc;
    expect(renderHtml(doc, opts)).toContain('Şekil yüklenemedi');
  });
});

describe('kapak ve CSP', () => {
  it('soru setinde marka etiketi "Soru seti" ve optik form kuralı yok; denemede ikisi de var', () => {
    const qs = { ...deneme, kind: 'question_set', blocks: deneme.blocks.filter((b) => b.type !== 'answer_sheet' && b.type !== 'answer_key_page') } as unknown as Doc;
    const h = renderHtml(qs, opts);
    expect(h).toContain('Soru seti');
    expect(h).not.toContain('optik forma işaretle');
    const d = renderHtml(deneme, opts);
    expect(d).toContain('Deneme sınavı');
    expect(d).toContain('optik forma işaretle');
  });
  it('CSP betiğe izin vermez; yüklenen görselin kökeni img-src içindedir', () => {
    const h = renderHtml(deneme, opts);
    const csp = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(h)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src/);
    const withImg = { ...not, blocks: [{ type: 'figure', id: 'f', section_no: 1, source: 'upload', upload_id: 'u1', alt: 'Foto' }] } as unknown as Doc;
    const h2 = renderHtml(withImg, { ...opts, resolveUploadUrl: () => 'https://cdn.example.test/a.png?sig=1' });
    expect(h2).toContain('img-src data: https://cdn.example.test;');
  });
});

describe('deneme: anahtar sızdırmaz', () => {
  const canary = 12345.678;
  const leaky = { ...deneme, keys: [{ question_no: 1, correct_option: null, numeric_value: canary, canonical_expr: 'zzcanaryzz' }, ...deneme.keys.slice(1)] };
  it('anahtar seçeneği verilmezse ne `keys` ne de anahtar sayfası çıkar', () => {
    const html = renderHtml(leaky, opts);
    expect(html).not.toContain('Cevap anahtarı');
    expect(html).not.toContain('12345');
    expect(html).not.toContain('zzcanaryzz');
    expect(html).not.toContain('<div class="key-grid"');
  });
  it('sorular iki sütunda, şıklar A–E, kapak ve optik form var', () => {
    const html = renderHtml(deneme, opts);
    expect(html).toContain('class="questions"');
    expect(html.match(/class="question"/g)).toHaveLength(10);
    expect(html.match(/<span class="k">E\)<\/span>/g)).toHaveLength(10);
    expect(html).toContain('Optik form');
    expect(html.match(/class="bubble"/g)).toHaveLength(50);
    expect(html).toContain('Soru sayısı');
  });
  it('anahtar yalnız answerKeys verilince ve answer_key_page varken çizilir', () => {
    const withKeys = renderHtml(deneme, { ...opts, answerKeys: deneme.keys });
    expect(withKeys).toContain('Cevap anahtarı');
    expect(withKeys.match(/<div class="key-cell"/g)).toHaveLength(10);
    const noBlock = { ...deneme, blocks: deneme.blocks.filter((b) => b.type !== 'answer_key_page') };
    expect(renderHtml(noBlock, { ...opts, answerKeys: deneme.keys })).not.toContain('<div class="key-cell"');
  });
  it('sayısal anahtar Türkçe biçimlenir', () => {
    const html = renderHtml(deneme, { ...opts, answerKeys: [{ question_no: 1, correct_option: null, numeric_value: 2.5 }] });
    expect(html).toContain('<b>2,5</b>');
  });
});

describe('not', () => {
  it('kendini sına cevapları gövdede değil, son sayfada', () => {
    const html = renderHtml(not, opts);
    const body = html.slice(0, html.indexOf('Kendini sına: cevaplar'));
    expect(body).not.toContain('Örneğin <span class="math-inline"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mfrac><mn>7</mn><mn>24</mn>');
    expect(html.match(/Kendini sına \d\./g)).toHaveLength(5);
    expect(text(body)).not.toContain('ikisinin ortalaması');
    expect(text(html)).toContain('ikisinin ortalaması');
  });
  it('yaygın hata kutusu tarihli ve örüntüye bağlı', () => {
    const html = renderHtml(not, opts);
    expect(html).toContain('data-pattern-id="rasyonel.pay-payda-ayri-toplama"');
    expect(html).toContain('3 Kasım 2026');
  });
});

describe('rapor', () => {
  const html = renderHtml(rapor, { ...opts, chartData });
  const plain = text(html);
  it('tek cümle özet öne çıkar, sonraki adım kutusu var', () => {
    expect(html).toContain('<p class="lead"');
    expect(html).toContain('class="box next-step"');
  });
  it('bölüm net çubukları kelime bandıyla, yüzdesiz', () => {
    expect(html).toContain('data-chart="score_by_section"');
    expect(html).toMatch(/orta · 22,5 \/ 40 net/);
    expect(html).toMatch(/düşük · 4 \/ 14 net/);
    expect(plain).not.toContain('%');
    expect(plain).not.toContain('!');
  });
  it('ısı haritası primary-soft -> primary rampasında ve sayı taşır', () => {
    expect(html).toContain('class="heat"');
    expect(html.match(/class="heat-cell"/g)).toHaveLength(6);
    expect(html).toContain('6/7');
    expect(html).toContain('0/3');
    // en düşük değer primary-soft'a, en yüksek primary'ye yakın olmalı
    expect(html).toMatch(/background:#[0-9a-f]{6};color:#[0-9a-f]{6}/);
  });
  it('rapor grafikleri deterministik SVG: bar rect ve izler', () => {
    expect(html).toContain(`fill="${token('--og-primary')}"`);
    expect(html).toContain(`fill="${token('--og-line')}"`);
  });
  it('uzun çubuk etiketi kısaltılır, tam ad <title> içinde kalır; uzun değer küçük punto', () => {
    const long = 'Birinci dereceden denklemler ve eşitsizlikler';
    const withLong = { ...chartData, section_nets: { kind: 'score_by_section' as const, rows: [{ label: long, net: 1234, max: 2000 }] } };
    const out = renderHtml(rapor, { ...opts, chartData: withLong });
    expect(out).toContain(`<title>${long}</title>`);
    expect(out).toContain('Birinci dereceden denklem…');
    expect(out).not.toContain(`>${long}</text>`);
    expect(out).toMatch(/font-size="10" fill="[^"]*">[^<]*net<\/text>/);
  });
  it('veri yoksa açık not (sessiz boş grafik yok)', () => {
    const empty = renderHtml(rapor, { ...opts, chartData: {} });
    expect(empty.match(/Bu grafik için veri yok/g)).toHaveLength(4);
  });
  it('kind uyuşmayan veri reddedilir', () => {
    const wrong = renderHtml(rapor, { ...opts, chartData: { ...chartData, section_nets: chartData.skill_map! } });
    expect(wrong.match(/Bu grafik için veri yok/g)).toHaveLength(1);
  });
});

describe('biçim yardımcıları', () => {
  it('sayı, tarih, bant', () => {
    expect(trNumber(18.5)).toBe('18,5');
    expect(trNumber(40)).toBe('40');
    expect(trDate('2026-11-03')).toBe('3 Kasım 2026');
    expect([0.1, 0.5, 0.9].map(wordBand)).toEqual(['düşük', 'orta', 'yüksek']);
  });
});

describe('gömülü fontlar', () => {
  it('Lexend/JetBrains Mono kopyası tasarım sistemiyle birebir', () => {
    for (const f of ['Lexend-400', 'Lexend-500', 'Lexend-600', 'Lexend-700', 'JetBrainsMono-400']) {
      const a = readFileSync(resolve(import.meta.dirname, `../fonts/${f}.woff2`));
      const b = readFileSync(resolve(import.meta.dirname, `../../design-system/fonts/${f}.woff2`));
      expect(a.equals(b)).toBe(true);
    }
  });
  it("fonts:'embed' base64 woff2 gömer ve dış başvuru bırakmaz", () => {
    const html = renderHtml(not, { theme: 'print' });
    expect(html).toContain('font-family:"Lexend"');
    expect(html).toContain('font-family:KaTeX_Main');
    expect(html).not.toMatch(/url\((?!data:)[^)]*\.(woff2?|ttf)/);
  });
});
