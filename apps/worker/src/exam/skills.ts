/**
 * Soru → kazanım eşlemesi (yedek, sözcüksel). `exam-page-items` sözleşmesi soru başına kazanım kodu taşımadığı sürece
 * (packages/contracts; istek notu: README "Açıklar") denemenin soruları burada müfredatın yapraklarına eşlenir: yaprağın
 * adı (ağırlık 2) ve açıklaması (ağırlık 1) Türkçe katlanmış sözcük köklerine (ilk 5 harf) bölünür; soru kökü ve
 * şıklardaki sözcüklerle, ayrıca matematik gösteriminden türeyen ipuçlarıyla (üs → "üslü kuvvet", |x| → "mutlak",
 * 0{,}25 → "ondalık", % → "yüzde", < ≤ → "eşitsizlik", x = → "denklem", a/b → "oran" …) karşılaştırılır. Puan nadir
 * köklere ağırlık verir (idf). Sözcüksel eşleme yalnız yüksek güvenle kabul edilir: en iyi yaprağın puanı
 * SKILL_CONFIDENT_SCORE'u geçmeli ve ikinci yaprağın en az SKILL_MIN_MARGIN katı olmalı (ör. "3x−7=11" hem denklem
 * hem mutlak değer yaprağına "denklem" sözcüğüyle eşit uyar: belirsiz). Aksi halde soru kayıtlı ama kazanımsız kalır:
 * grade_exam_session ona gözlem yazmaz (yanlış yaprağa ağırlık 1 gözlem ustalığı bozar), uyarı skill_untagged.
 * Model kodu verirse (sözleşme alanı eklendiğinde) yalnız müfredatın yaprağıysa o kullanılır.
 */

export interface SkillLeaf {
  id: string;
  name: string;
  description: string | null;
}

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

const STOP = new Set([
  've', 'ile', 'bir', 'icin', 'kac', 'olan', 'olarak', 'gore', 'hangi', 'hangisi', 'asagi', 'nedir', 'kactir', 'sonuc',
  'bu', 'su', 'de', 'da', 'ki', 'mi', 'ise', 'olur', 'olup', 'veya', 'ya', 'en', 'cok', 'az', 'ust', 'alt', 'dogru',
  'yanlis', 'soru', 'problem', 'ifade', 'iki', 'uc', 'tek', 'cift', 'tanim', 'temel', 'genel', 'kural', 'buna',
]);

/** Küçük harf (tr), aksan katlama, harf dışı → boşluk. */
export function foldTr(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]|i̇/g, (c) => FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STEM_LEN = 5;

/** Sözcük kökleri (ilk 5 harf; ≥ 3 harf, durak sözcükler hariç). */
export function stems(s: string): string[] {
  const out = new Set<string>();
  for (const w of foldTr(s).split(' ')) {
    if (w.length < 3 || /^\d+$/.test(w) || STOP.has(w) || STOP.has(w.slice(0, STEM_LEN))) continue;
    out.add(w.slice(0, STEM_LEN));
  }
  return [...out];
}

/** Matematik gösteriminden konu ipuçları (ham metin: LaTeX dahil). */
export function notationCues(raw: string): string[] {
  const cues: string[] = [];
  const letterRatio = /\\frac\{\s*[a-z]\s*\}\{\s*[a-z]\s*\}|\b[a-z]\s*\/\s*[a-z]\b|\b[a-z]\s*:\s*[a-z]\b/.test(raw);
  if (/\^\s*\{?-?\d|\^\s*\{?[a-z]/.test(raw)) cues.push('üslü', 'kuvvet');
  if (/\\sqrt|√/.test(raw)) cues.push('köklü');
  if (/\|[^|$]+\|/.test(raw)) cues.push('mutlak');
  if (/\d\{,\}\d|\d,\d/.test(raw)) cues.push('ondalık');
  if (letterRatio) cues.push('oran', 'orantı');
  else if (/\\frac|\\dfrac|\d\s*\/\s*\d/.test(raw)) cues.push('kesir', 'payda', 'rasyonel');
  if (/%|yüzde/i.test(raw)) cues.push('yüzde');
  if (/<|>|\\le|\\ge|\\lt|\\gt|≤|≥/.test(raw)) cues.push('eşitsizlik');
  if (/[a-z]\s*[-+=]|=\s*-?\d*\s*[a-z]\b|\d[a-z]\b/.test(raw.replace(/\\[a-z]+/g, ' ')) && /=/.test(raw)) cues.push('denklem');
  return cues;
}

export interface SkillIndex {
  leaves: { id: string; weights: Map<string, number> }[];
  idf: Map<string, number>;
}

export function buildSkillIndex(leaves: readonly SkillLeaf[]): SkillIndex {
  const df = new Map<string, number>();
  const out = leaves.map((l) => {
    const w = new Map<string, number>();
    for (const s of stems(l.description ?? '')) w.set(s, 1);
    for (const s of stems(l.name)) w.set(s, 2);
    for (const s of w.keys()) df.set(s, (df.get(s) ?? 0) + 1);
    return { id: l.id, weights: w };
  });
  const n = Math.max(1, leaves.length);
  const idf = new Map([...df].map(([s, d]) => [s, Math.log(1 + n / d)]));
  return { leaves: out, idf };
}

/** Soru kökü s ile yaprak kökü t eşleşir mi: aynı ya da kısa olan (≥ 3 harf) uzunun öneki. */
function stemMatch(s: string, t: string): boolean {
  if (s === t) return true;
  const [a, b] = s.length <= t.length ? [s, t] : [t, s];
  return a.length >= 3 && a.length < STEM_LEN && b.startsWith(a);
}

/** Sözcüksel eşlemenin kabul eşiği (yüksek güven) ve ikinci yaprağa karşı en küçük oran. */
export const SKILL_CONFIDENT_SCORE = 3;
export const SKILL_MIN_MARGIN = 1.25;

/** Gösterim ipucu eşleşmesinin ağırlık çarpanı (ipucu konuyu sözcükten daha güçlü söyler). */
const CUE_BOOST = 2;

/**
 * En iyi yaprak (eşik altında boş). Gösterim ipuçları yalnız kökten alınır: şıklardaki kesir ya da ondalık sorunun
 * konusunu değil cevabın biçimini söyler; şıkların sözcükleri yine sayılır.
 */
export function tagSkill(stem: string, index: SkillIndex, extra = ''): { skillId: string | null; score: number; runnerUp: number } {
  const cueStems = new Set(notationCues(stem).flatMap((c) => stems(c)));
  const qs = new Set([...stems(stem), ...stems(extra), ...cueStems]);
  let best: { id: string; score: number } | null = null;
  let runnerUp = 0;
  for (const leaf of index.leaves) {
    let score = 0;
    for (const [t, w] of leaf.weights) {
      let hit = 0;
      for (const s of qs) {
        if (stemMatch(s, t)) hit = Math.max(hit, cueStems.has(s) ? CUE_BOOST : 1);
      }
      if (hit > 0) score += hit * w * (index.idf.get(t) ?? 1);
    }
    if (!best || score > best.score + 1e-9) {
      if (best) runnerUp = Math.max(runnerUp, best.score);
      best = { id: leaf.id, score };
    } else runnerUp = Math.max(runnerUp, score);
  }
  const top = best?.score ?? 0;
  const confident = best !== null && top >= SKILL_CONFIDENT_SCORE && top >= SKILL_MIN_MARGIN * runnerUp - 1e-9;
  return { skillId: confident ? best!.id : null, score: top, runnerUp };
}

export interface TaggableQuestion {
  no: number;
  stem_text: string;
  options: readonly { key: string; text: string }[];
  figures?: readonly { description: string }[];
  skillIds: readonly string[];
}

export interface TagResult {
  skills: Map<number, string[]>;
  source: Map<number, 'model' | 'previous' | 'lexical' | 'none'>;
}

/**
 * Soru başına kazanım: model kodu (yaprak) > önceki aynı denemenin sorusu (yayıncı eşleşmesi) > sözcüksel eşleme.
 * `previous`: soru numarası → kazanımlar (eşleşen eski denemeden).
 */
export function tagQuestions(questions: readonly TaggableQuestion[], leaves: readonly SkillLeaf[], previous: ReadonlyMap<number, readonly string[]> = new Map()): TagResult {
  const leafIds = new Set(leaves.map((l) => l.id));
  const index = buildSkillIndex(leaves);
  const skills = new Map<number, string[]>();
  const source = new Map<number, 'model' | 'previous' | 'lexical' | 'none'>();
  for (const q of questions) {
    const model = q.skillIds.filter((s) => leafIds.has(s));
    if (model.length > 0) {
      skills.set(q.no, [...new Set(model)].slice(0, 3));
      source.set(q.no, 'model');
      continue;
    }
    const prev = (previous.get(q.no) ?? []).filter((s) => leafIds.has(s));
    if (prev.length > 0) {
      skills.set(q.no, [...prev]);
      source.set(q.no, 'previous');
      continue;
    }
    const extra = [...q.options.map((o) => o.text), ...(q.figures ?? []).map((f) => f.description)].join(' ');
    const t = tagSkill(q.stem_text, index, extra);
    skills.set(q.no, t.skillId ? [t.skillId] : []);
    source.set(q.no, t.skillId ? 'lexical' : 'none');
  }
  return { skills, source };
}
