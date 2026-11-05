// Öğrenmen PII temizleyici (TypeScript).
//
// LLM'e gidecek metinden kişisel veriyi deterministik kurallarla siler. Python eşleniği
// `packages/pii/py/ogrenmen_pii/scrub.py`; iki uygulama `packages/pii/cases.json`
// vakalarını birebir aynı çıktıyla geçer ve `dump` çıktıları CI'da diff'lenir. Dump
// desen dizgelerini ve kelime listelerini de içerir: iki dil arasındaki her sapma görünür.
//
// Kural sırası (bir kuralın çıktısı sonrakinin girdisidir):
//    1. url            → [URL]        (https://, http://, www., t.me/)
//    2. email          → [E-POSTA]
//    3. iban           → [IBAN]       (TR + 24 hane; 4'lü boşluklu yazım da)
//    4. tckn           → [TCKN]       (11 hane + mod-10 denetimi; geçersiz sayı dokunulmaz)
//    5. phone          → [TELEFON]    (TR cep: (+90|0)? 5xx xxx xx xx)
//    6. username       → [KULLANICI]  (@kullanici; `@hoca` yönlendirme anahtarı hariç)
//    7. ad-token hash  → [ÖĞRENCİ] | [EĞİTMEN] | [VELİ] (roleHashes) ya da [AD] (nameHashes)
//    8. intro_name     → "adım [AD]"  ("adım X", "benim adım X", "ismim X")
//    9. honorific_name → "[AD] Hoca"  ("X Hoca", "X Bey", "X Hanım", "X Öğretmen")
//   10. school         → [OKUL]
//   11. class_section  → [SINIF]      ("11-C", "9/A"; yalnız 9–12, soru/şık bağlamı hariç)
//
// Düz ad listesi asla girdi değildir: adlar sha256(normalizeToken(token)) hex hash'leriyle
// gelir. Girdi önce NFC'ye çevrilir. Tüm düzenli ifadeler modül yüklenirken bir kez derlenir
// (Worker CPU bütçesi). Hatalı girdi sessizce geçmez: OGR-SCR-00x hataları (README "Sapma notu").

import { sha256Hex } from './sha256.js';

export const RULES_VERSION = '1.1';

/** Temizleyici hata kodları (blueprint'teki OGR-PII-001 `update_student_pii`'ye aittir). */
export const ERROR_CODES = {
  badOptions: 'OGR-SCR-001',
  badHash: 'OGR-SCR-002',
  badRole: 'OGR-SCR-003',
  badText: 'OGR-SCR-004',
} as const;

// --- Karakter sınıfları (Python ile birebir aynı dizgeler) ---------------------------
const UPPER = 'A-ZÇĞİÖŞÜÂÎÛ';
const LOWER = 'a-zçğıöşüâîû';
const LETTERS = UPPER + LOWER;

// --- Kelime listeleri (Python ile birebir aynı; dump'a yazılır) ------------------------
/** Büyük harfle başlayan ama ad/okul sözcüğü olmayan cümle başı sözcükleri. */
export const STOP_CAP: readonly string[] = [
  'Acaba', 'Adım', 'Ama', 'Artık', 'Az', 'Bana', 'Belki', 'Ben', 'Bence', 'Beni', 'Bir', 'Biz',
  'Bu', 'Buna', 'Bunlar', 'Bunu', 'Bunun', 'Bugün', 'Çok', 'Çünkü', 'Daha', 'Dün', 'En', 'Evet',
  'Galiba', 'Hangi', 'Hani', 'Hayır', 'Hep', 'Her', 'Hiç', 'Hoca', 'Hocam', 'Kim', 'Lütfen',
  'Merhaba', 'Nasıl', 'Ne', 'Neden', 'O', 'Ona', 'Onlar', 'Onu', 'Onun', 'Önce', 'Peki', 'Sana',
  'Selam', 'Sen', 'Seni', 'Siz', 'Sonra', 'Şimdi', 'Şu', 'Şuna', 'Şunu', 'Tamam', 'Teşekkürler',
  'Ve', 'Veya', 'Yani', 'Yarın',
];
/** "X Hoca" kalıbında X olamayacak branş ve kurum sözcükleri. */
export const SUBJECTS: readonly string[] = [
  'Almanca', 'Beden', 'Biyoloji', 'Branş', 'Coğrafya', 'Dershane', 'Din', 'Edebiyat',
  'Eski', 'Felsefe', 'Fen', 'Fizik', 'Geometri', 'İngilizce', 'Kimya', 'Kurs', 'Lise',
  'Matematik', 'Müzik', 'Okul', 'Özel', 'Rehberlik', 'Resim', 'Sınıf', 'Sosyal',
  'Tarih', 'Türkçe', 'Yeni',
];
/** "ismim x" / "benim adım x" kalıbında küçük harfli ad sayılmayacak sözcükler. */
export const LOW_STOP: readonly string[] = [
  'belli', 'bu', 'da', 'de', 'gizli', 'ile', 'mi', 'mu', 'mı', 'mü', 'ne', 'o',
  'önemli', 'şu', 'var', 've', 'yok',
];
export const SCHOOL_WORDS: readonly string[] = [
  '[Ll]isesi', '[Kk]oleji', '[Oo]rtaokulu', '[İi]lkokulu', '[Oo]kulu',
  '[Üü]niversitesi', '[Dd]ershanesi',
];

/** class_section'ı soru/şık atfı yapan önceki ya da sonraki sözcükler (kök; çekimli biçimler de eşleşir). */
export const ANSWER_WORDS: readonly string[] = [
  '[Ss]oru', '[Cc]evap', '[Cc]evab', '[Şş]ık', '[Ss]eçene', '[Yy]anıt', '[Mm]adde',
];
/** class_section'dan hemen sonra gelince cevap değerlendirmesi sayılan sözcükler ("11-C doğru mu"). */
export const VERDICT_WORDS: readonly string[] = ['[Dd]oğru', '[Yy]anlış'];

export type RoleLabel = 'ÖĞRENCİ' | 'EĞİTMEN' | 'VELİ';
export const ROLE_LABELS: Readonly<Record<RoleLabel, Kind>> = {
  'ÖĞRENCİ': 'student',
  'EĞİTMEN': 'instructor',
  'VELİ': 'guardian',
};

/** Çıktıdaki replacements sırası (yalnız count > 0 olanlar yazılır). */
export const KINDS = [
  'url', 'email', 'iban', 'tckn', 'phone', 'username',
  'student', 'instructor', 'guardian', 'name',
  'intro_name', 'honorific_name', 'school', 'class_section',
] as const;
export type Kind = (typeof KINDS)[number];

export const PLACEHOLDERS: Readonly<Record<Kind, string>> = {
  url: '[URL]', email: '[E-POSTA]', iban: '[IBAN]', tckn: '[TCKN]',
  phone: '[TELEFON]', username: '[KULLANICI]', student: '[ÖĞRENCİ]',
  instructor: '[EĞİTMEN]', guardian: '[VELİ]', name: '[AD]',
  intro_name: '[AD]', honorific_name: '[AD]', school: '[OKUL]',
  class_section: '[SINIF]',
};

const alt = (words: readonly string[]): string => words.join('|');

const STOP = alt(STOP_CAP);
const NOT_STOP = String.raw`(?!(?:${STOP})(?![${LETTERS}]))`;
const NOT_STOP_OR_SUBJECT = String.raw`(?!(?:${STOP}|${alt(SUBJECTS)})(?![${LETTERS}]))`;
const CAP_WORD = String.raw`[${UPPER}][${LOWER}]+`;
const WS = '[ \\t\\r\\n]*';
const PAIR = '[0-9]{1,3}[ ]?[-/][ ]?[A-Ha-h]';

// --- Desenler (Python ile birebir aynı dizgeler; dump'a yazılır) -----------------------
// Not: ASCII dışı karakter içeren parçalar String.raw şablonu yerine düz dizgeyle yazılır;
// bun dönüştürücüsü şablon ham metnindeki ASCII dışı karakterleri \uXXXX'e çevirir ve
// desen dizgesi (anlamı aynı kalsa da) Python'dan farklılaşır — parite dump'ı bunu yakalar.
const APOS_CHARS = "'’";
export const PATTERNS = {
  url: String.raw`(?<![A-Za-z0-9@])(?:https?://|www\.|t\.me/)[^ \t\n\r<>"']*[^ \t\n\r<>"'.,;:!?)\]]`,
  email: String.raw`(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`,
  iban: String.raw`(?<![A-Za-z0-9])TR[0-9]{2}(?:[ ]?[0-9]{4}){5}[ ]?[0-9]{2}(?![0-9])`,
  tckn: String.raw`(?<![0-9])[1-9][0-9]{10}(?![0-9])`,
  phone:
    String.raw`(?<![0-9A-Za-z+])(?:(?:\+90|0)[ -]?)?(?:\(5[0-9]{2}\)|5[0-9]{2})` +
    String.raw`[ -]?[0-9]{3}[ -]?[0-9]{2}[ -]?[0-9]{2}(?![0-9])`,
  username: String.raw`(?<![A-Za-z0-9_.])@(?!hoca(?![A-Za-z0-9_]))[A-Za-z][A-Za-z0-9_]{2,31}(?![A-Za-z0-9_])`,
  token: String.raw`(?<![${LETTERS}\[])[${LETTERS}]+(?:[` + APOS_CHARS + `][${LOWER}]+)?`,
  intro_cap:
    '(?<![' + LETTERS + '])((?:[Bb]enim[ ]+)?[Aa]dım[ ]+|[İi]smim[ ]+)' + NOT_STOP +
    '(' + CAP_WORD + '(?:[ ]+' + NOT_STOP + CAP_WORD + ')?)',
  intro_low:
    '(?<![' + LETTERS + '])((?:[Bb]enim[ ]+[Aa]dım|[İi]smim)[ ]+)' +
    '(?!(?:' + alt(LOW_STOP) + ')(?![' + LETTERS + ']))([' + LOWER + ']+)',
  honorific:
    String.raw`(?<![${LETTERS}\[])${NOT_STOP_OR_SUBJECT}${CAP_WORD}(?:[ ]+${NOT_STOP_OR_SUBJECT}${CAP_WORD})?` +
    '(?=[ ]+(?:[Hh]oca|Bey(?![' + LETTERS + '])|Hanım|[Öö]ğretmen))',
  school:
    String.raw`(?<![${LETTERS}0-9])(?:${NOT_STOP}(?:[${UPPER}][${LOWER}]*|[0-9]{1,4})\.?[ ]+){1,4}` +
    String.raw`(?:${alt(SCHOOL_WORDS)})[${LOWER}]*`,
  class_section: String.raw`(?<![${LETTERS}0-9/.,^])(?:1[0-2]|9)[ ]?[-/][ ]?[A-H](?![${LETTERS}0-9])`,
  // class_section adayı soru/şık bağlamındaysa dokunulmaz ("Soru 10-A şıkkı", "Cevap: 9-B, 10-C").
  // Önceki metnin sonuna (class_prev) ve sonraki metnin başına (class_next) bakılır.
  class_prev:
    '(?:^|[^' + LETTERS + '])(?:' + alt(ANSWER_WORDS) + ')[' + LETTERS + ']*' + WS + '[:.]?' + WS + '$' +
    '|' + PAIR + WS + '[,;]' + WS + '$',
  class_next:
    '^' + WS + '(?:[,;]' + WS + PAIR + '(?![' + LETTERS + '0-9])|(?:' + alt(ANSWER_WORDS) + '|' +
    alt(VERDICT_WORDS) + '))',
} as const;
export type PatternName = keyof typeof PATTERNS;

const RE: Readonly<Record<PatternName, RegExp>> = Object.fromEntries(
  Object.entries(PATTERNS).map(([k, v]) => [k, new RegExp(v, 'gu')]),
) as Record<PatternName, RegExp>;
// Bağlam desenleri tek seferlik test edilir; global bayraksız (lastIndex durumu yok).
const CLASS_PREV = new RegExp(PATTERNS.class_prev, 'u');
const CLASS_NEXT = new RegExp(PATTERNS.class_next, 'u');
const APOS = /['’]/u;
const HASH_RE = /^[0-9a-fA-F]{64}$/;

// Ad tokenı katlama tablosu (yerelden bağımsız): İ, I ve ı → i; diğer büyük harfler Türkçe
// küçük karşılığına. Böylece ELIF / ELİF / Elif / elıf aynı hash'i verir. Yalnız LETTERS kümesi
// tanımlıdır; token zaten yalnız bu harflerden oluşur. SQL eşleniği (M02 `app.refresh_name_hashes`,
// `app.staff_name_hashes`): packages/pii/sql/name_token_hashes.sql — düz lower() KULLANILMAZ.
export const FOLD_FROM = 'ABCÇDEFGĞHIİıJKLMNOÖPQRSŞTUÜVWXYZÂÎÛ';
export const FOLD_TO = 'abcçdefgğhiiijklmnoöpqrsştuüvwxyzâîû';
const FOLD_MAP: ReadonlyMap<string, string> = new Map(
  Array.from(FOLD_FROM).map((c, i) => [c, Array.from(FOLD_TO)[i]!] as const),
);
if (Array.from(FOLD_FROM).length !== Array.from(FOLD_TO).length) throw new Error('FOLD tablosu uzunlukları farklı');

export interface Replacement {
  kind: Kind;
  count: number;
}
export interface ScrubResult {
  text: string;
  replacements: Replacement[];
}
export interface ScrubOptions {
  /** sha256(normalizeToken(token)) hex listesi — düz ad DEĞİL (64 haneli hex olmayan girdi OGR-SCR-002). */
  nameHashes: readonly string[];
  /** {hash: 'ÖĞRENCİ' | 'EĞİTMEN' | 'VELİ'} — rol etiketi; yoksa [AD]. */
  roleHashes?: Readonly<Record<string, RoleLabel>>;
}

/** Ad tokenı katlama: NFC, sonra FOLD tablosu (İ/I/ı → i, Ç → ç …); tablo dışı karakterler aynen kalır. */
export function normalizeToken(token: string): string {
  let out = '';
  for (const ch of token.normalize('NFC')) out += FOLD_MAP.get(ch) ?? ch;
  return out;
}

function fail(code: string, message: string): never {
  throw new TypeError(`${code} ${message}`);
}

function baseOf(token: string): string {
  const i = token.search(APOS);
  return i < 0 ? token : token.slice(0, i);
}

/** Tek ad tokenının hash'i: kesme işaretli ek atılır, küçük harfe çevrilir, sha256 hex. */
export function tokenHash(token: string): string {
  return sha256Hex(normalizeToken(baseOf(token)));
}

/**
 * Tam addan ad-token hash listesi (3+ harfli tokenlar; sıra korunur, tekrar yok).
 * `app.refresh_name_hashes` tetikleyicisi ve Worker FakeDb aynı türetimi kullanır.
 */
export function nameTokenHashes(fullName: string): string[] {
  if (typeof fullName !== 'string') fail(ERROR_CODES.badText, 'ad metni string olmalı');
  const name = fullName.normalize('NFC');
  const out: string[] = [];
  const re = RE.token;
  re.lastIndex = 0;
  for (let m = re.exec(name); m !== null; m = re.exec(name)) {
    const base = baseOf(m[0]);
    if (base.length < 3) continue;
    const h = sha256Hex(normalizeToken(base));
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/** T.C. kimlik numarası denetimi: 11 hane, ilk hane 0 değil, iki kontrol hanesi. */
export function isValidTckn(digits: string): boolean {
  if (!/^[0-9]{11}$/.test(digits) || digits[0] === '0') return false;
  const d = Array.from(digits, (c) => c.charCodeAt(0) - 48);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  if ((((odd * 7 - even) % 10) + 10) % 10 !== d[9]) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += d[i]!;
  return sum % 10 === d[10];
}

type Rule = (m: RegExpExecArray) => readonly [Kind, string] | null;

/** Python re.sub ile aynı anlam: soldan sağa, örtüşmeyen eşleşmeler; null → dokunma. */
function replaceAll(text: string, re: RegExp, fn: Rule, counts: Record<Kind, number>): string {
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const r = fn(m);
    if (r === null) continue;
    counts[r[0]] += 1;
    out += text.slice(last, m.index) + r[1];
    last = m.index + m[0].length;
  }
  return last === 0 ? text : out + text.slice(last);
}

/** Seçenekleri doğrular; hatalı girdi sessizce geçmez (PII kapısı kapalı kalır). */
function readOptions(opts: unknown): { names: Set<string>; roles: Map<string, RoleLabel> } {
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
    fail(ERROR_CODES.badOptions, 'seçenekler { nameHashes, roleHashes? } nesnesi olmalı');
  }
  const o = opts as { nameHashes?: unknown; roleHashes?: unknown };
  if (!Array.isArray(o.nameHashes)) fail(ERROR_CODES.badOptions, 'nameHashes bir hash listesi olmalı');
  const names = new Set<string>();
  for (const h of o.nameHashes as unknown[]) {
    if (typeof h !== 'string' || !HASH_RE.test(h)) {
      fail(ERROR_CODES.badHash, 'düz ad değil 64 haneli hex sha256 hash bekleniyor (nameHashes)');
    }
    names.add(h.toLowerCase());
  }
  const roles = new Map<string, RoleLabel>();
  const rh = o.roleHashes;
  if (rh !== undefined && rh !== null) {
    if (typeof rh !== 'object' || Array.isArray(rh)) fail(ERROR_CODES.badOptions, 'roleHashes {hash: rol} nesnesi olmalı');
    for (const [h, label] of Object.entries(rh as Record<string, unknown>)) {
      if (!HASH_RE.test(h)) fail(ERROR_CODES.badHash, 'düz ad değil 64 haneli hex sha256 hash bekleniyor (roleHashes)');
      if (typeof label !== 'string' || !Object.hasOwn(ROLE_LABELS, label)) {
        fail(ERROR_CODES.badRole, `bilinmeyen rol etiketi: ${String(label)}`);
      }
      roles.set(h.toLowerCase(), label as RoleLabel);
    }
  }
  return { names, roles };
}

/** class_section adayı soru/şık atfı mı ("Soru 10-A şıkkı", "Cevap: 9-B, 10-C", "11-D doğru mu")? */
function isAnswerReference(text: string, start: number, end: number): boolean {
  return CLASS_PREV.test(text.slice(0, start)) || CLASS_NEXT.test(text.slice(end));
}

/** Metni temizler; `{ text, replacements: [{kind, count}] }` döner. */
export function scrub(text: string, opts: ScrubOptions): ScrubResult {
  if (typeof text !== 'string') fail(ERROR_CODES.badText, 'metin string olmalı');
  const { names, roles } = readOptions(opts);
  const counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  const fixed = (kind: Kind): Rule => () => [kind, PLACEHOLDERS[kind]];

  let t = text.normalize('NFC');
  t = replaceAll(t, RE.url, fixed('url'), counts);
  t = replaceAll(t, RE.email, fixed('email'), counts);
  t = replaceAll(t, RE.iban, fixed('iban'), counts);
  t = replaceAll(t, RE.tckn, (m) => (isValidTckn(m[0]) ? ['tckn', PLACEHOLDERS.tckn] : null), counts);
  t = replaceAll(t, RE.phone, fixed('phone'), counts);
  t = replaceAll(t, RE.username, fixed('username'), counts);

  if (names.size > 0 || roles.size > 0) {
    t = replaceAll(
      t,
      RE.token,
      (m) => {
        const tok = m[0];
        const base = baseOf(tok);
        if (base.length < 3) return null;
        const suffix = tok.slice(base.length);
        const h = sha256Hex(normalizeToken(base));
        const label = roles.get(h);
        if (label !== undefined) {
          const kind = ROLE_LABELS[label];
          return [kind, PLACEHOLDERS[kind] + suffix];
        }
        if (names.has(h)) return ['name', PLACEHOLDERS.name + suffix];
        return null;
      },
      counts,
    );
  }
  t = replaceAll(t, RE.intro_cap, (m) => ['intro_name', (m[1] ?? '') + PLACEHOLDERS.intro_name], counts);
  t = replaceAll(t, RE.intro_low, (m) => ['intro_name', (m[1] ?? '') + PLACEHOLDERS.intro_name], counts);
  t = replaceAll(t, RE.honorific, fixed('honorific_name'), counts);
  t = replaceAll(t, RE.school, fixed('school'), counts);
  const section = t;
  t = replaceAll(
    t,
    RE.class_section,
    (m) => (isAnswerReference(section, m.index, m.index + m[0].length) ? null : ['class_section', PLACEHOLDERS.class_section]),
    counts,
  );

  return {
    text: t,
    replacements: KINDS.filter((k) => counts[k] > 0).map((k) => ({ kind: k, count: counts[k] })),
  };
}

/** `bot_responses.pii_replacements` için toplam değişiklik sayısı. */
export function totalReplacements(result: ScrubResult): number {
  return result.replacements.reduce((s, r) => s + r.count, 0);
}

/** Dump ve parite testi için kural yapılandırması (Python `config()` ile aynı). */
export function config(): Record<string, unknown> {
  return {
    rules_version: RULES_VERSION,
    kinds: [...KINDS],
    placeholders: { ...PLACEHOLDERS },
    stop_cap: [...STOP_CAP],
    subjects: [...SUBJECTS],
    low_stop: [...LOW_STOP],
    school_words: [...SCHOOL_WORDS],
    answer_words: [...ANSWER_WORDS],
    verdict_words: [...VERDICT_WORDS],
    fold_from: FOLD_FROM,
    fold_to: FOLD_TO,
    error_codes: { ...ERROR_CODES },
    patterns: { ...PATTERNS },
  };
}
