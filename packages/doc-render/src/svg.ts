/**
 * Model çıktısı SVG'yi belgeye gömmeden önce temizler. Düzenli ifade ile "kötüyü sil" yerine belirteç (token) tabanlı
 * beyaz liste: girdi sıkı bir etiket belirteçleyicisiyle okunur, çıktı yalnız izinli eleman ve özniteliklerden YENİDEN
 * KURULUR. Ham girdi parçası çıktıya kopyalanmaz; tanınmayan her `<` metin olarak kaçırılır. Böylece parçalar
 * silinince yeniden birleşip betik oluşturma (`<scr<set/>ipt>`) ve `/` veya `"` ayırıcılı olay işleyicileri mümkün değildir.
 * Kök `<svg` ile başlamıyorsa boş döner (çağıran yedek kutu çizer).
 */

const ELEMENTS = [
  'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker', 'title', 'desc',
];
const ELEMENT_BY_LOWER = new Map(ELEMENTS.map((e) => [e.toLowerCase(), e]));
/**
 * `style` özniteliğinde izinli özellikler: boya, çizgi, opaklık ve yazı. Konum, görünürlük ve katman (position, display,
 * visibility, z-index, content, top, width...) atılır; böylece bir şekil belgenin geri kalanını örtemez ya da gizleyemez.
 * matplotlib çıktısı renkleri bu biçimde yazar.
 */
const STYLE_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-anchor', 'letter-spacing', 'dominant-baseline',
]);

/**
 * İçeriğiyle birlikte atılan elemanlar (içindeki metin de çalışabilir/sızabilir). `style` burada: SVG içindeki CSS
 * kuralları HTML belgesinin tamamına etki eder (soruları gizleyebilir, sayfayı kaplayabilir); presentation öznitelikleri yeterli.
 */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'animate', 'set', 'animatetransform', 'animatemotion',
  'audio', 'video', 'canvas', 'template', 'noscript', 'switch', 'handler', 'listener', 'feimage',
]);

const ATTRIBUTES = new Set(
  (
    'id style transform viewBox width height x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-opacity fill-rule stroke ' +
    'stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit opacity ' +
    'font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline baseline-shift letter-spacing ' +
    'text-decoration dx dy rotate textLength lengthAdjust preserveAspectRatio xmlns xmlns:xlink version role aria-label aria-hidden ' +
    'aria-labelledby aria-describedby focusable offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod fx fy ' +
    'clip-path clip-rule mask maskUnits maskContentUnits clipPathUnits patternUnits patternContentUnits patternTransform ' +
    'markerWidth markerHeight markerUnits refX refY orient vector-effect shape-rendering text-rendering display visibility ' +
    'xml:space'
  ).split(/\s+/),
);
const ATTRIBUTE_BY_LOWER = new Map([...ATTRIBUTES].map((a) => [a.toLowerCase(), a]));

const SAFE_ENTITY = /&(?:amp|lt|gt|quot|apos);/g;
const escText = (s: string) => s.replace(/&(?!(?:amp|lt|gt|quot|apos);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Öznitelik değeri güvenli mi: CSS kaçışı, varlık, dış url(), betik/ifade sözcükleri yok. Güvensizse öznitelik atılır. */
function safeValue(name: string, value: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  if (/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\\]/.test(value)) return undefined;
  if (value.replace(SAFE_ENTITY, '').includes('&')) return undefined;
  const v = value.replace(SAFE_ENTITY, ' ').toLowerCase();
  if (/javascript:|vbscript:|data:|expression\s*\(|@import|behavior\s*:|-moz-binding/.test(v)) return undefined;
  const urls = v.matchAll(/url\(\s*(['"]?)([^)]*)\1\s*\)/g);
  for (const u of urls) if (!(u[2] ?? '').trim().startsWith('#')) return undefined;
  if (/url\s*\(/.test(v) && !/url\(\s*['"]?#/.test(v)) return undefined;
  return value.replace(/"/g, '&quot;');
}

interface Tag {
  closing: boolean;
  name: string;
  attrs: [string, string][];
  selfClosing: boolean;
  end: number;
}

const TAG = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:[\s/]+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)[\s/]*>/;
const ATTR = /[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?/g;

function readTag(s: string, at: number): Tag | undefined {
  const m = TAG.exec(s.slice(at));
  if (!m) return undefined;
  const attrs: [string, string][] = [];
  for (const a of (m[3] ?? '').matchAll(ATTR)) {
    const eq = a[0].indexOf('=');
    if (eq < 0) attrs.push([a[0], '']);
    else {
      const raw = a[0].slice(eq + 1).trim();
      attrs.push([a[0].slice(0, eq).trim(), /^["']/.test(raw) ? raw.slice(1, -1) : raw]);
    }
  }
  return { closing: m[1] === '/', name: m[2] ?? '', attrs, selfClosing: /\/\s*>$/.test(m[0]), end: at + m[0].length };
}

/** style özniteliği: yalnız STYLE_PROPERTIES içindeki ve güvenli değerli bildirimler kalır. Hiçbiri kalmazsa undefined. */
function safeStyle(raw: string): string | undefined {
  const kept: string[] = [];
  for (const decl of raw.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (!STYLE_PROPERTIES.has(prop) || val === '') continue;
    const safe = safeValue(prop, val);
    if (safe !== undefined) kept.push(`${prop}:${safe}`);
  }
  return kept.length > 0 ? kept.join(';') : undefined;
}

function buildAttrs(el: string, attrs: [string, string][]): string {
  const seen = new Set<string>();
  let out = '';
  for (const [rawName, rawValue] of attrs) {
    const lower = rawName.toLowerCase();
    let name: string | undefined;
    let value: string | undefined;
    if (lower === 'href' || lower === 'xlink:href') {
      // Yalnız belge içi başvuru (#kimlik) ve yalnız <use>; matplotlib çıktısı bunu kullanır.
      if (el === 'use' && /^#[A-Za-z0-9_.:-]+$/.test(rawValue.trim())) {
        name = lower;
        value = rawValue.trim();
      }
    } else {
      name = ATTRIBUTE_BY_LOWER.get(lower);
      if (name === 'style') value = safeStyle(rawValue);
      else if (name) value = safeValue(name, rawValue);
    }
    if (!name || value === undefined || seen.has(name)) continue;
    seen.add(name);
    out += ` ${name}="${value}"`;
  }
  return out;
}

export function sanitizeSvg(raw: string): string {
  const src = raw.trim().replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/^(?:<!DOCTYPE[^>]*>\s*|<!--[\s\S]*?-->\s*)+/gi, '');
  if (!/^<svg[\s/>]/i.test(src)) return '';
  let out = '';
  const stack: string[] = [];
  let skip: { name: string; depth: number } | undefined;
  const txt = (t: string) => escText(t);
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      if (!skip) out += txt(src.slice(i));
      break;
    }
    if (!skip && lt > i) out += txt(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const e = src.indexOf('>', i);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    const tag = readTag(src, i);
    if (!tag) {
      if (!skip) out += '&lt;';
      i += 1;
      continue;
    }
    i = tag.end;
    const lower = tag.name.toLowerCase();
    if (skip) {
      if (lower === skip.name && !tag.selfClosing) {
        skip.depth += tag.closing ? -1 : 1;
        if (skip.depth === 0) skip = undefined;
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(lower)) {
      if (!tag.closing && !tag.selfClosing) skip = { name: lower, depth: 1 };
      continue;
    }
    const el = ELEMENT_BY_LOWER.get(lower);
    if (!el) continue; // tanınmayan eleman (a, div, ...): etiket atılır, çocuk metni kalır (kaçırılmış)
    if (tag.closing) {
      const idx = stack.lastIndexOf(el);
      if (idx < 0) continue;
      while (stack.length > idx) out += `</${stack.pop()}>`;
      continue;
    }
    if (stack.length === 0 && el !== 'svg') continue;
    if (el === 'svg' && stack.length === 0 && out !== '') continue; // ikinci kök yok
    out += `<${el}${buildAttrs(el, tag.attrs)}${tag.selfClosing ? '/' : ''}>`;
    if (!tag.selfClosing) stack.push(el);
    else if (stack.length === 0) break;
  }
  while (stack.length > 0) out += `</${stack.pop()}>`;
  return out.startsWith('<svg') ? out : '';
}
