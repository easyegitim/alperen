/**
 * Çıkmış sınav maddelerinin tarz kümelemesi (docs/PLAN-v2.md §11; v1 `pipelines/kalem/src/ogrenmen_kalem/cluster.py`
 * mantığının Node karşılığı). Saf ve deterministiktir: aynı girdi aynı kümeleri ve aynı küme kimliklerini verir.
 *
 * Mesafe (0..1):
 *   - Bütün maddelerde gömme (Voyage, 1024) varsa kosinüs mesafesi; yoksa yerel yedek: madde metni + konu + tür/biçim
 *     belirteçlerinin tf-idf vektörlerinde kosinüs mesafesi. Sayılar tek belirtece (`#`) iner: aynı tarzın farklı yıllardaki
 *     sorusu farklı sayılar taşır. KaTeX komutları belirteç olarak kalır (\frac, \cdot tarzın parçasıdır).
 *   - Aynı-kazanım bonusu: iki maddenin kazanım kümelerinin Jaccard benzerliği × SKILL_BONUS mesafeden düşülür (v1'de aynı
 *     kazanım mesafeyi 0 yapardı; bonus, aynı kazanımın iki farklı tarzını metin çok farklıysa ayrı tutar).
 *   - Aynı normalleştirilmiş konu: TOPIC_BONUS düşülür. Farklı cevap türü (ispat ↔ hesap): KIND_PENALTY eklenir.
 * Algoritma: ortalama bağlantılı (average linkage) birleştirici kümeleme, eşik altındaki en yakın küme çifti birleşir
 * (Lance–Williams güncellemesi; eşitlikte küçük dizin). Eşik: gömmede 0,30, tf-idf'te 0,60.
 *
 * Var olan tarzlar (`assignStyles`): eğitmenin onayladığı/düzenlediği tarzın maddeleri (pinned) yerinde kalır ve kümelerini
 * o tarza çeker; onaysız tarzlar en çok ortak maddeye göre yeniden kullanılır (her tarz bir kümeye); kalan kümeler yeni
 * tarzdır ve adlandırılır (style_definition). Küme kimlikleri `k1, k2, …` ilk üyenin girdi sırasına göredir.
 */

export const EMBEDDING_THRESHOLD = 0.3;
export const TFIDF_THRESHOLD = 0.6;
export const SKILL_BONUS = 0.35;
export const TOPIC_BONUS = 0.2;
export const KIND_PENALTY = 0.1;
/** Tek çağrıda kümelenen en çok madde (O(n³) birleştirme; ders arşivleri bunun çok altındadır). */
export const MAX_CLUSTER_ITEMS = 800;

export interface ClusterItem {
  id: string;
  /** Madde metni (OCR); yalnız kümeleme için. */
  text: string;
  topic: string | null;
  skillIds: readonly string[];
  kind: string;
  format: string | null;
  embedding?: readonly number[] | null;
}

export interface ClusterResult {
  /** Kümeler: üye dizinleri (girdi sırası), küme sırası ilk üyeye göre. */
  groups: number[][];
  method: 'embedding' | 'tfidf';
  threshold: number;
}

const STOP = new Set(
  'bir ve ile bu şu o da de ki mi mı mu mü ise için gibi olan olarak aynı her hangi kaç kaçtır nedir nedir? bulunuz hesaplayınız gösteriniz yazınız veriliyor verilmiştir göre ifadesinin ifadesini işleminin sonucu sonucunu değeri değerini'
    .split(/\s+/),
);

/** Türkçe küçük harf + harf/sayı dışı ayraç; sayılar `#`, tek harfli belirteçler atılır. */
export function tokenize(text: string): string[] {
  const lower = text.toLocaleLowerCase('tr').replace(/\\[a-z]+/g, (m) => ` ${m.slice(1)}_cmd `);
  const out: string[] = [];
  for (const raw of lower.split(/[^\p{L}\p{N}_]+/u)) {
    if (!raw) continue;
    const tok = /^\p{N}+$/u.test(raw) ? '#' : raw;
    if (tok.length < 2 && tok !== '#') continue;
    if (STOP.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** Konu adının karşılaştırma biçimi (küçük harf, tek boşluk, noktalama yok). */
export function normTopic(t: string | null | undefined): string {
  return (t ?? '').toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function itemTokens(it: ClusterItem): string[] {
  const toks = tokenize(it.text);
  if (it.topic) for (const t of tokenize(it.topic)) toks.push(`t:${t}`, `t:${t}`);
  toks.push(`kind:${it.kind}`);
  if (it.format) toks.push(`format:${it.format}`);
  return toks;
}

/** tf-idf vektörleri (L2 normlu, seyrek). idf = ln((1+N)/(1+df)) + 1. */
export function tfidfVectors(docs: readonly string[][]): Map<string, number>[] {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * (Math.log((1 + n) / (1 + (df.get(t) ?? 0))) + 1);
      v.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
}

function sparseCos(a: Map<string, number>, b: Map<string, number>): number {
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of s) {
    const x = l.get(t);
    if (x !== undefined) dot += w * x;
  }
  return dot;
}

function denseCos(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

const PROOF_LIKE = new Set(['proof']);

/** Mesafe matrisi ve kullanılan yöntem. */
export function distanceMatrix(items: readonly ClusterItem[]): { dist: Float64Array; n: number; method: ClusterResult['method'] } {
  const n = items.length;
  const useEmb = n > 0 && items.every((it) => Array.isArray(it.embedding) && it.embedding.length > 0);
  const vecs = useEmb ? null : tfidfVectors(items.map(itemTokens));
  const topics = items.map((it) => normTopic(it.topic));
  const dist = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = useEmb ? denseCos(items[i]!.embedding!, items[j]!.embedding!) : sparseCos(vecs![i]!, vecs![j]!);
      let d = 1 - Math.max(-1, Math.min(1, sim));
      d -= SKILL_BONUS * jaccard(items[i]!.skillIds, items[j]!.skillIds);
      if (topics[i] && topics[i] === topics[j]) d -= TOPIC_BONUS;
      if (PROOF_LIKE.has(items[i]!.kind) !== PROOF_LIKE.has(items[j]!.kind)) d += KIND_PENALTY;
      d = Math.round(Math.min(1, Math.max(0, d)) * 1e9) / 1e9; // kayan nokta gürültüsü sırayı bozmasın
      dist[i * n + j] = d;
      dist[j * n + i] = d;
    }
  }
  return { dist, n, method: useEmb ? 'embedding' : 'tfidf' };
}

/** Ortalama bağlantılı birleştirici kümeleme (deterministik). */
export function averageLinkage(dist: Float64Array, n: number, threshold: number): number[][] {
  const members: (number[] | null)[] = Array.from({ length: n }, (_, i) => [i]);
  const d = Float64Array.from(dist);
  for (;;) {
    let best = Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < n; i++) {
      if (!members[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!members[j]) continue;
        const x = d[i * n + j]!;
        if (x < best) {
          best = x;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best >= threshold) break;
    const si = members[bi]!.length;
    const sj = members[bj]!.length;
    for (let k = 0; k < n; k++) {
      if (!members[k] || k === bi || k === bj) continue;
      const v = (si * d[k * n + bi]! + sj * d[k * n + bj]!) / (si + sj);
      d[k * n + bi] = v;
      d[bi * n + k] = v;
    }
    members[bi] = [...members[bi]!, ...members[bj]!].sort((a, b) => a - b);
    members[bj] = null;
  }
  return members.filter((m): m is number[] => m !== null).sort((a, b) => a[0]! - b[0]!);
}

export function clusterItems(items: readonly ClusterItem[], opts: { threshold?: number } = {}): ClusterResult {
  if (items.length > MAX_CLUSTER_ITEMS) throw new RangeError(`kümeleme en çok ${MAX_CLUSTER_ITEMS} madde alır (gelen ${items.length})`);
  if (items.length === 0) return { groups: [], method: 'tfidf', threshold: opts.threshold ?? TFIDF_THRESHOLD };
  const { dist, n, method } = distanceMatrix(items);
  const threshold = opts.threshold ?? (method === 'embedding' ? EMBEDDING_THRESHOLD : TFIDF_THRESHOLD);
  return { groups: averageLinkage(dist, n, threshold), method, threshold };
}

/** Kümenin ortasına en yakın üyeler (medoid sırası; örnek madde seçimi). */
export function medoidOrder(dist: Float64Array, n: number, group: readonly number[]): number[] {
  return [...group]
    .map((i) => ({ i, s: group.reduce((acc, j) => acc + (i === j ? 0 : dist[i * n + j]!), 0) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.i);
}

// --- var olan tarzlarla eşleme -------------------------------------------------------------------------------------------

export interface StyleRef {
  id: string;
  code: string;
  /** Eğitmen onayladı/düzenledi ya da tarz etkin: maddeleri yerinde kalır, adı worker'ca değişmez. */
  pinned: boolean;
}

export interface AssignInput {
  /** Maddenin şimdiki tarzı (yoksa null). Dizin girdi sırasıdır. */
  styleOf: readonly (string | null)[];
  styles: readonly StyleRef[];
  groups: readonly number[][];
}

export interface AssignedCluster {
  /** `k1, k2, …` (ilk üyenin sırası). */
  key: string;
  members: number[];
  /** Yeniden kullanılan tarz; null ise yeni tarz (adlandırılır). */
  styleId: string | null;
  /** Bu kümede tarzına yazılacak maddeler (sabit maddeler hariç). */
  assign: number[];
}

export function assignStyles(inp: AssignInput): AssignedCluster[] {
  const byId = new Map(inp.styles.map((s) => [s.id, s]));
  const taken = new Set<string>();
  const out: AssignedCluster[] = [];
  inp.groups.forEach((members, gi) => {
    const pinnedVotes = new Map<string, number>();
    const priorVotes = new Map<string, number>();
    for (const i of members) {
      const sid = inp.styleOf[i] ?? null;
      const st = sid ? byId.get(sid) : undefined;
      if (!st) continue;
      const m = st.pinned ? pinnedVotes : priorVotes;
      m.set(st.id, (m.get(st.id) ?? 0) + 1);
    }
    const pick = (votes: Map<string, number>, exclude: Set<string> | null): string | null => {
      const cands = [...votes.entries()].filter(([id]) => !exclude || !exclude.has(id));
      if (cands.length === 0) return null;
      cands.sort((a, b) => b[1] - a[1] || (byId.get(a[0])!.code < byId.get(b[0])!.code ? -1 : 1));
      return cands[0]![0];
    };
    const target = pick(pinnedVotes, null) ?? pick(priorVotes, taken);
    if (target && !byId.get(target)!.pinned) taken.add(target);
    const assign = members.filter((i) => {
      const sid = inp.styleOf[i] ?? null;
      const st = sid ? byId.get(sid) : undefined;
      return !(st && st.pinned) && (target === null || sid !== target);
    });
    out.push({ key: `k${gi + 1}`, members: [...members], styleId: target, assign });
  });
  return out;
}

// --- adlar ve kodlar -----------------------------------------------------------------------------------------------------

const TR_ASCII: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Tarz kodu: küçük harf ASCII, rakam ve tire (contracts STYLE_CODE, en çok 60). */
export function slugCode(name: string, max = 50): string {
  const s = name
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (c) => TR_ASCII[c] ?? c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return s.length >= 2 ? s : 'tarz';
}

/** `base` kodunu kullanılmış kodlardan ayırır (`-2`, `-3` …); `taken` güncellenir. */
export function uniqueCode(base: string, taken: Set<string>): string {
  let code = slugCode(base);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code)) code = 'tarz';
  let out = code;
  for (let k = 2; taken.has(out); k++) out = `${code.slice(0, 55)}-${k}`;
  taken.add(out);
  return out;
}

/** Öğrenciye giden ad ve tanımda geçmemesi gereken öngörü sözcükleri (ürün kuralı: plan tahmin değildir). */
export const FORBIDDEN_WORDS = /(tahmin|çıkacak|kesin)/iu;

export function mostCommon<T>(values: readonly (T | null | undefined)[], cmp?: (a: T, b: T) => number): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== null && v !== undefined && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
  if (counts.size === 0) return null;
  const best = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, c]) => c === best).map(([v]) => v);
  tied.sort(cmp ?? ((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)));
  return tied[0]!;
}

/** Ad/tanım bir üyenin metninden bu kadar karakterlik bir parçayı aynen taşıyorsa kullanılmaz (telif; v1 COPY_WINDOW). */
export const COPY_WINDOW = 30;

const normCopy = (x: string) => x.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

/** Metin, üyelerden birinin metninden `window` karakterlik bir parçayı aynen taşıyor mu (boşluklar tekleştirilir). */
export function copiesSource(label: string, sources: readonly string[], window = COPY_WINDOW): boolean {
  const l = normCopy(label);
  if (l.length < window) return false;
  const texts = sources.map(normCopy);
  for (let i = 0; i + window <= l.length; i++) {
    const w = l.slice(i, i + window);
    if (texts.some((t) => t.includes(w))) return true;
  }
  return false;
}

/**
 * Üretilen soru metni için pencere: soru kökleri kalıp ifadeler taşır ("… işleminin sonucu kaçtır?"), 30 karakter
 * kalıp + kısa formülle tutar; çıkmış sorunun aynen yeniden üretimi bu kadar uzun ortak parça bırakır.
 */
export const QUESTION_COPY_WINDOW = 60;

/**
 * Üretilen kök/şık çıkmış sınav metnini yeniden üretiyor mu: metnin tamamı (≥ COPY_WINDOW karakter) bir arşiv metninde
 * aynen geçiyor ya da QUESTION_COPY_WINDOW karakterlik bir parçası aynen geçiyor (telif: çıkmış soru bankaya girmez).
 */
export function copiesArchiveQuestion(text: string, sources: readonly string[]): boolean {
  const l = normCopy(text);
  if (l.length < COPY_WINDOW || sources.length === 0) return false;
  if (sources.some((s) => normCopy(s).includes(l))) return true;
  return copiesSource(l, sources, QUESTION_COPY_WINDOW);
}

/** Öğrenciye gidecek tarz metni kullanılabilir mi: uzunluk, öngörü sözcüğü yok, üye metninden kopya yok. */
export function usableStyleText(s: string | null | undefined, sources: readonly string[], min: number, max: number): s is string {
  return !!s && s.trim().length >= min && s.length <= max && !FORBIDDEN_WORDS.test(s) && !copiesSource(s, sources);
}

/**
 * Model adlandırmazsa (ya da adı kurala uymazsa) yedek ad: en sık konu (v1 `cluster_label`), olmazsa en sık kazanımın adı,
 * o da olmazsa "Soru tarzı N".
 */
export function fallbackName(members: readonly { topic: string | null; text: string; skillIds: readonly string[] }[], skillNames: ReadonlyMap<string, string>, ordinal: number): string {
  const texts = members.map((m) => m.text);
  const topic = mostCommon(members.map((m) => m.topic?.trim() || null), (a, b) => a.localeCompare(b, 'tr'));
  if (usableStyleText(topic, texts, 3, 80)) return topic;
  const skill = mostCommon(members.flatMap((m) => m.skillIds));
  const skillName = skill ? (skillNames.get(skill) ?? null) : null;
  if (usableStyleText(skillName, texts, 3, 80)) return skillName;
  return `Soru tarzı ${ordinal}`;
}
