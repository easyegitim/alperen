/**
 * Dossier ve ders blokları (docs/PLAN-v2.md §3.3-3.4): geçidin `system[1]` (ders, 1 sa önbellek) ve `system[2]`
 * (dossier, 5 dk önbellek) metinleri.
 *
 *   renderDossier(db, studentId, courseId)  public.render_dossier RPC'si → deterministik metin + sha256;
 *                                           student_dossier_cache'i okur (maxAgeMs) ve metin değişince yazar
 *   renderCourseBlock(db, courseId)         müfredat ağacı ("kod · ad"), ön koşullar, yanılgı etiketleri, tarzlar;
 *                                           süreç içi ders başına önbellek (CourseBlockCache)
 *   buildPromptSystem(db, {...})            ürün + ders + dossier → SystemParts (buildSystemBlocks ile 3 blok)
 *
 * Determinizm: aynı RPC JSON'u her zaman aynı metni (ve hash'i) verir; sıralar açıktır, tarihler gün hassasiyetindedir,
 * görünen ad yoktur (öğrenci yalnız `public_ref` ile anılır).
 * Kullanıcı metni system'e girmez: öğrencinin yazdığı serbest alanlar (enrollments.goal, students.school) metne hiç
 * yazılmaz; öğrencinin değiştirebildiği kısa etiketler (sınıf, hedef sınav, dönem) yalnız alana özgü izin listesine
 * uyuyorsa yazılır (`gradeLabel`, `targetExamLabel`, `periodLabel`), uymuyorsa düşer. Ders bloğunda ders adı ve müfredat
 * etiketi, onaylanmamış ai_draft müfredatta ya da öğrencinin açtığı derste (onboarding serbest metni) yazılmaz; yalnız
 * kod ([A-Z0-9-]) ve kod@sürüm kalır (`courseTextTrust`). Hedef koça hafızadan (goals.md) ya da araç sonucundan veri olarak gelir. Sınırlar (§3.4): en zayıf 20 + en güçlü 10 yaprak,
 * ≤ 8 açık yanılgı, ≤ 10 satır etkinlik. Kanıt metni yoktur: koç kanıtı araçla çağırır.
 *
 * `db` yalnız `query` isteyen dar arayüzdür (`pg.Pool`, worker `Db`); service_role ya da doğrudan Postgres rolü.
 * apps/web kullanıcı JWT'siyle `render_dossier` RPC'sini çağırıp `renderDossierText` (saf) ile aynı metni üretebilir.
 */
import { createHash } from 'node:crypto';
import type { PgQueryLike } from './memory/pgMemory.js';
import type { SystemParts } from './prompt.js';

/** Metin biçimi sürümü: biçim değişince artırılır (hash metinden alındığı için önbellek kendiliğinden yenilenir). */
export const DOSSIER_FORMAT_VERSION = 4;
export const DOSSIER_LIMITS = { weakest: 20, strongest: 10, misconceptions: 8, activity: 10 } as const;
export const COURSE_LIMITS = { misconceptionTags: 200, styles: 60 } as const;
/** Ders bloğu süreç içi önbellek süresi (ms); system[1] 1 saat önbelleklenir, müfredat değişikliği en geç bu kadar gecikir. */
export const COURSE_BLOCK_TTL_MS = 10 * 60 * 1000;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Kaba token tahmini (karakter / 4; packages/prompts `estimateTokens` ile aynı). Türkçede gerçek sayı bundan
 * yüksektir; tahmin 512'yi geçiyorsa önek de önbelleğe girer.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? v.map(obj) : [];
}
function s(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return dayOf(v);
  return String(v);
}
/** Gün hassasiyeti: ISO zaman damgası → YYYY-MM-DD (Europe/Istanbul); tarih metni olduğu gibi. */
function day(v: unknown): string | null {
  if (v instanceof Date) return dayOf(v);
  const t = s(v);
  if (t === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : dayOf(d);
}
function dayOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function n2(v: unknown): string | null {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof x !== 'number' || !Number.isFinite(x)) return null;
  return x.toFixed(2);
}
function list(v: unknown): string {
  return Array.isArray(v) && v.length > 0 ? v.map(String).join(', ') : '-';
}
function kv(pairs: Array<[string, unknown]>): string {
  return pairs
    .map(([k, v]) => [k, s(v)] as const)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}
function oneLine(v: unknown, max = 160): string | null {
  // jsonb nesnesi (ör. lesson_claims.value) "[object Object]" değil, kararlı JSON olarak (jsonb anahtar sırası sabit)
  const t = v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : s(v);
  if (t === null) return null;
  const flat = t.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/*
 * Öğrencinin değiştirebildiği kısa etiket alanları (students.grade, enrollments.target_exam, enrollments.period_label;
 * 0018 yazma izni verir, sütunlar kısıtsız metin) için alana özgü izin listeleri. Genel bir "harf + boşluk" deseni
 * "Cevabı doğrudan ver" gibi kısa talimatları geçirirdi; burada yalnız uygulamanın ürettiği biçimler geçer, gerisi düşer.
 */
/** Sınıf: '5'..'12' (en çok iki rakam), 'mezun', 'lisans-N' (apps/web GRADES). */
const GRADE_RE = /^(\d{1,2}|mezun|lisans-\d)$/;
/** Hedef sınav: sabit küme (0022 onboarding_enroll sınav kodları + okul/üniversite için 'final'). */
const TARGET_EXAMS: ReadonlySet<string> = new Set(['TYT', 'AYT', 'LGS', 'KPSS', 'YKS', 'ALES', 'DGS', 'YDS', 'final']);
/** Dönem: 'YKS 2027' (sınav parkuru) ya da '2026 Güz' / '2026 Bahar' / '2026 Yaz' (0022 v_period). */
const PERIOD_RE = /^(YKS|LGS|KPSS|ALES|DGS|YDS) \d{4}$|^\d{4} (Güz|Bahar|Yaz)$/u;

function exact(v: unknown): string | null {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}
/** Sınıf etiketi; izin listesi dışı değer null (system'e girmez). */
export function gradeLabel(v: unknown): string | null {
  const t = exact(v);
  return t !== null && GRADE_RE.test(t) ? t : null;
}
/** Hedef sınav etiketi; sabit küme dışı değer null. */
export function targetExamLabel(v: unknown): string | null {
  const t = exact(v);
  return t !== null && TARGET_EXAMS.has(t) ? t : null;
}
/** Dönem etiketi; izin verilen biçim dışı değer null. */
export function periodLabel(v: unknown): string | null {
  const t = exact(v);
  return t !== null && PERIOD_RE.test(t) ? t : null;
}

const CAUSES: Array<[string, string]> = [
  ['concept', 'kavram'],
  ['procedure', 'işlem'],
  ['careless', 'dikkat'],
  ['reading', 'okuma'],
  ['time', 'süre'],
];

const VERDICT_TR: Record<string, string> = { correct: 'doğru', wrong: 'yanlış', incomplete: 'eksik', unreadable: 'okunamadı' };

/**
 * `render_dossier` yapısal JSON'u (v1 ya da v2) → dossier metni. Saf ve deterministik; `hash` alanı yok sayılır.
 */
export function renderDossierText(dossier: unknown): string {
  const d = obj(dossier);
  const id = obj(d.identity);
  const mastery = obj(d.mastery);
  const lines: string[] = [];

  lines.push(`# Öğrenci dosyası (kayıt: ${s(id.student_ref) ?? '-'}) — ${day(d.as_of) ?? '-'}`);
  // Okul ve hedef (öğrencinin serbest metni) yazılmaz; sınıf yalnız izin listesindeyse
  const who = kv([['Sınıf', gradeLabel(id.grade)]]);
  if (who) lines.push(who);
  lines.push(
    kv([
      ['Ders', [s(id.course_code), s(id.course_title)].filter(Boolean).join(' ')],
      ['Müfredat', id.curriculum],
      ['Dönem', periodLabel(id.period)],
      ['Hedef sınav', targetExamLabel(id.target_exam)],
      ['Sınav tarihi', day(id.exam_date)],
      ['Kalan gün', id.days_to_exam],
    ]),
  );

  lines.push('', '## Ustalık');
  lines.push(
    kv([
      ['Kanıtlı yaprak', `${s(mastery.leaves_with_evidence) ?? 0}/${s(mastery.leaves_total) ?? 0}`],
      ['Toplam kanıt', mastery.evidence_total ?? 0],
    ]),
  );
  const leaf = (x: Obj) => {
    const trend = n2(x.trend_14d);
    return `- ${s(x.skill_id) ?? '?'} · ${s(x.name) ?? ''} p=${n2(x.p) ?? '-'} n=${s(x.n) ?? 0}${trend !== null ? ` eğilim14g=${trend}` : ''}`;
  };
  const weakest = arr(mastery.weakest).slice(0, DOSSIER_LIMITS.weakest);
  const strongest = arr(mastery.strongest).slice(0, DOSSIER_LIMITS.strongest);
  lines.push('En zayıf yapraklar:', ...(weakest.length ? weakest.map(leaf) : ['- (yok)']));
  lines.push('En güçlü yapraklar:', ...(strongest.length ? strongest.map(leaf) : ['- (yok)']));

  lines.push('', '## Açık yanılgılar');
  const misc = arr(d.open_misconceptions).slice(0, DOSSIER_LIMITS.misconceptions);
  lines.push(
    ...(misc.length
      ? misc.map(
          (m) =>
            `- ${s(m.tag) ?? '(etiketsiz)'} (${s(m.skill_id) ?? '-'}) kanıt=${s(m.evidence) ?? 0} son=${day(m.last_seen) ?? '-'}${oneLine(m.text) ? `: ${oneLine(m.text)}` : ''}`,
        )
      : ['- (yok)']),
  );

  lines.push('', '## Hata nedenleri (son 30 gün)');
  const causes = obj(d.error_causes_30d);
  lines.push(CAUSES.map(([k, tr]) => `${tr}: ${s(causes[k]) ?? 0}`).join(' · '));

  // Etkinlik: teşhis, deneme, alıştırma ve onaylı ders gözlemleri tek listede, yeniden eskiye, en çok 10 satır
  lines.push('', '## Son etkinlik');
  const activity: { date: string; order: number; i: number; text: string }[] = [];
  arr(d.recent_diagnoses).forEach((x, i) => {
    const verdict = s(x.verdict);
    const parts = [
      `teşhis (${s(x.source) === 'exam' ? 'deneme' : 'soru'})`,
      verdict ? (VERDICT_TR[verdict] ?? verdict) : '-',
      s(x.error_cause) ? `neden=${CAUSES.find(([k]) => k === s(x.error_cause))?.[1] ?? s(x.error_cause)}` : null,
      s(x.failing_step_no) ? `adım=${s(x.failing_step_no)}` : null,
      `beceri=${list(x.skill_ids)}`,
      Array.isArray(x.misconception_tags) && x.misconception_tags.length ? `yanılgı=${list(x.misconception_tags)}` : null,
    ].filter(Boolean);
    activity.push({ date: day(x.date) ?? '', order: 1, i, text: parts.join(' ') });
  });
  arr(d.recent_exams).forEach((e, i) => {
    activity.push({
      date: day(e.date) ?? '',
      order: 0,
      i,
      text: `deneme ${oneLine(e.title, 60) ?? '-'} (${s(e.kind) ?? '-'}) net=${s(e.net) ?? '-'} doğru=${s(e.correct) ?? '-'} yanlış=${s(e.wrong) ?? '-'} boş=${s(e.blank) ?? '-'}`,
    });
  });
  const lp = d.last_practice && typeof d.last_practice === 'object' ? obj(d.last_practice) : null;
  if (lp) {
    activity.push({
      date: day(lp.date) ?? '',
      order: 2,
      i: 0,
      text: `alıştırma ${s(lp.correct) ?? '-'}/${s(lp.total) ?? '-'} doğru beceri=${list(lp.skill_ids)}${s(lp.weak_skill) ? ` zayıf=${s(lp.weak_skill)}` : ''}${s(lp.top_misconception) ? ` yanılgı=${s(lp.top_misconception)}` : ''}`,
    });
  }
  arr(d.recent_lesson_claims).forEach((c, i) => {
    activity.push({ date: day(c.date) ?? '', order: 3, i, text: `ders gözlemi ${s(c.kind) ?? '-'} ${s(c.skill_id) ?? '-'}: ${oneLine(c.value, 120) ?? '-'}` });
  });
  activity.sort((a, b) => (a.date === b.date ? a.order - b.order || a.i - b.i : a.date < b.date ? 1 : -1));
  const shown = activity.slice(0, DOSSIER_LIMITS.activity);
  lines.push(...(shown.length ? shown.map((a) => `- ${a.date || '-'} ${a.text}`) : ['- (yok)']));

  lines.push('', '## Soru tarzı boşlukları');
  const gaps = arr(d.style_gaps);
  lines.push(
    ...(gaps.length
      ? gaps.map((g) => `- ${s(g.code) ?? '?'} · ${s(g.name) ?? ''} sıklık=${n2(g.frequency) ?? '-'} görülen=${s(g.seen) ?? 0} doğru=${s(g.correct) ?? 0}`)
      : ['- (yok)']),
  );

  if ('active_suggestions' in d || 'memory_paths' in d) {
    lines.push('', '## Koç durumu');
    // v2 gövdesinde (0024) aktif öneri sayısı yoktur (hash kararlı kalsın); yalnız verildiyse yazılır
    if ('active_suggestions' in d) lines.push(`Bugün için aktif öneri: ${s(d.active_suggestions) ?? 0}`);
    const paths = Array.isArray(d.memory_paths) ? d.memory_paths.map(String) : [];
    lines.push(`Hafıza dosyaları (içerik hafıza aracıyla okunur): ${paths.length ? paths.join(', ') : '(yok)'}`);
  }

  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
}

// --- dossier: RPC + önbellek -------------------------------------------------------------------------------

export interface DossierCacheRow {
  hash: string;
  rendered: string;
  updatedAt: Date;
}

export interface DossierBlock {
  studentId: string;
  courseId: string;
  /** system[2] metni. */
  text: string;
  /** Metnin sha256'sı (student_dossier_cache.hash). */
  hash: string;
  /** RPC gövdesinin hash'i (önbellekten okunduysa null). */
  sourceHash: string | null;
  /** Önbellekteki satır güncellendi mi (metin değişti). */
  changed: boolean;
  /** Metin RPC çağrılmadan önbellekten mi geldi (maxAgeMs). */
  fromCache: boolean;
  /** RPC kimlik alanları (önbellekten okunduysa null). */
  enrollmentId: string | null;
  curriculumId: string | null;
  studentRef: string | null;
}

export class DossierError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code} ${message}`);
    this.name = 'DossierError';
    this.code = code;
  }
}

function asJson(raw: unknown): Obj | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return JSON.parse(raw) as Obj;
  return raw as Obj;
}

/** student_dossier_cache satırını okur (yoksa null). */
export async function readDossierCache(db: PgQueryLike, studentId: string, courseId: string): Promise<DossierCacheRow | null> {
  const r = await db.query(
    'select hash, rendered, updated_at from public.student_dossier_cache where student_id = $1::uuid and course_id = $2::uuid',
    [studentId, courseId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { hash: String(row.hash), rendered: String(row.rendered), updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)) };
}

/** `public.render_dossier` çağrısı; OGR-DOS-001 (kayıt yok) `DossierError` olur. */
export async function fetchDossierJson(db: PgQueryLike, studentId: string, courseId: string): Promise<Obj> {
  let body: Obj | null;
  try {
    const r = await db.query('select public.render_dossier($1::uuid, $2::uuid) as dossier', [studentId, courseId]);
    body = asJson(r.rows[0]?.dossier);
  } catch (err) {
    const m = /OGR-DOS-\d{3}/.exec((err as Error).message ?? '');
    if (m) throw new DossierError(m[0], (err as Error).message);
    throw err;
  }
  if (!body || typeof body.hash !== 'string') throw new DossierError('OGR-DOS-002', 'render_dossier hash döndürmedi');
  return body;
}

export interface RenderDossierOptions {
  /** Önbellek bu kadar tazeyse (ms) RPC çağrılmaz; verilmezse her zaman yeniden kurulur. */
  maxAgeMs?: number;
  /** false: önbelleğe yazma (salt okunur bağlam). Varsayılan true. */
  write?: boolean;
  now?: () => Date;
}

/**
 * Dossier bloğu: önbellek tazeyse onu döndürür; değilse RPC → metin → sha256, metin değiştiyse
 * `student_dossier_cache`'e yazar. Metin aynıysa içerik ve hash'e dokunmaz (önbellek öneki korunur), yalnız satır
 * bayatsa `updated_at`'i ileri alır: yoksa maxAgeMs bir kez bayatlayınca her çağrı ağır RPC'yi yeniden koştururdu.
 */
export async function renderDossier(db: PgQueryLike, studentId: string, courseId: string, opts: RenderDossierOptions = {}): Promise<DossierBlock> {
  const now = opts.now ?? (() => new Date());
  const cached = opts.maxAgeMs !== undefined || opts.write !== false ? await readDossierCache(db, studentId, courseId) : null;
  if (cached && opts.maxAgeMs !== undefined && now().getTime() - cached.updatedAt.getTime() <= opts.maxAgeMs) {
    return { studentId, courseId, text: cached.rendered, hash: cached.hash, sourceHash: null, changed: false, fromCache: true, enrollmentId: null, curriculumId: null, studentRef: null };
  }
  const body = await fetchDossierJson(db, studentId, courseId);
  const text = renderDossierText(body);
  const hash = sha256Hex(text);
  const identity = obj(body.identity);
  let changed = false;
  if (opts.write !== false && cached?.hash !== hash) {
    await db.query(
      `insert into public.student_dossier_cache (student_id, course_id, hash, rendered)
       values ($1::uuid, $2::uuid, $3, $4)
       on conflict (student_id, course_id) do update
         set hash = excluded.hash, rendered = excluded.rendered, updated_at = now()`,
      [studentId, courseId, hash, text],
    );
    changed = true;
  } else if (opts.write !== false && cached && opts.maxAgeMs !== undefined) {
    // Aynı metin, bayat satır (taze olsaydı yukarıda dönerdi): tazelik damgası ilerler, metin ve hash aynı kalır
    await db.query('update public.student_dossier_cache set updated_at = now() where student_id = $1::uuid and course_id = $2::uuid', [studentId, courseId]);
  }
  return {
    studentId,
    courseId,
    text,
    hash,
    sourceHash: String(body.hash),
    changed,
    fromCache: false,
    enrollmentId: s(identity.enrollment_id),
    curriculumId: s(identity.curriculum_id),
    studentRef: s(identity.student_ref),
  };
}

// --- ders bloğu --------------------------------------------------------------------------------------------

export interface CourseSkill {
  id: string;
  parentId: string | null;
  name: string;
  kind: string | null;
  isLeaf: boolean;
  orderNo: number;
  examWeightHint: number | null;
}

export interface CourseBlockData {
  /** createdByStudent: dersi öğrenci açtı (0022 onboarding_enroll; başlık öğrencinin serbest metni). */
  course: { id: string; code: string; title: string; kind: string | null; createdByStudent: boolean };
  /** origin: 'seed' | 'ai_draft' | 'instructor'; ai_draft + status <> 'active' iken label öğrencinin serbest metnidir. */
  curriculum: { id: string; code: string; version: string; label: string; status: string; origin: string } | null;
  skills: CourseSkill[];
  prerequisites: { skillId: string; prereqId: string }[];
  misconceptionTags: { tag: string; skillId: string | null; prereqSkillId: string | null; text: string }[];
  styles: { code: string; name: string; format: string | null; trick: string | null; difficulty: string | null; frequency: number | null; skillIds: string[] }[];
}

const DIFF_TR: Record<string, string> = { easy: 'kolay', mid: 'orta', hard: 'zor' };

/**
 * Ders adı ve müfredat etiketi system[1]'e yazılabilir mi (0024 course_title kuralının ders bloğu karşılığı)?
 *   label: müfredat onaylanmamış bir ai_draft değilse (origin <> 'ai_draft' ya da status = 'active': eğitmen yayımladı).
 *   title: müfredat etiketi güvenliyse ve dersi öğrenci açmadıysa. Öğrencinin açtığı dersin başlığı, müfredat sonradan
 *          yayımlansa ya da etkin müfredata taşınsa da öğrencinin metni kalır; yerine güvenli müfredat etiketi yazılır.
 * Bilinmeyen köken güvensiz sayılır (origin boşsa label yazılmaz).
 */
export function courseTextTrust(data: Pick<CourseBlockData, 'course' | 'curriculum'>): { title: string | null; label: string | null } {
  const cur = data.curriculum;
  const labelOk = cur !== null && typeof cur.origin === 'string' && cur.origin !== '' && !(cur.origin === 'ai_draft' && cur.status !== 'active');
  const curOk = cur === null || labelOk;
  const titleOk = curOk && data.course.createdByStudent === false;
  const label = labelOk ? oneLine(cur!.label, 120) : null;
  return { title: titleOk ? oneLine(data.course.title, 120) : label, label };
}

/** Ders bloğu metni (saf, deterministik): ağaç sırası order_no sonra kod; etiketler ve tarzlar kod sırasıyla. */
export function renderCourseText(data: CourseBlockData): string {
  const lines: string[] = [];
  const c = data.course;
  const cur = data.curriculum;
  const trust = courseTextTrust(data);
  lines.push(`# Ders: ${c.code}${trust.title ? ` · ${trust.title}` : ''}`);
  lines.push(
    cur
      ? `Müfredat: ${cur.code}@${cur.version}${trust.label ? ` · ${trust.label}` : ''} (${cur.status === 'draft' ? 'taslak' : cur.status === 'active' ? 'etkin' : 'emekli'})`
      : 'Müfredat: henüz kurulmadı',
  );
  lines.push(
    'Kazanım kodları bu bloktaki biçimiyle kullanılır; öğrenciye kod değil ad gösterilir. Ustalık yalnız yapraklarda (•) tutulur.',
  );

  lines.push('', '## Kazanım ağacı (kod · ad)');
  const byParent = new Map<string, CourseSkill[]>();
  const ids = new Set(data.skills.map((k) => k.id));
  for (const k of data.skills) {
    const p = k.parentId && ids.has(k.parentId) ? k.parentId : '';
    const l = byParent.get(p) ?? [];
    l.push(k);
    byParent.set(p, l);
  }
  for (const l of byParent.values()) l.sort((a, b) => a.orderNo - b.orderNo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    for (const k of byParent.get(parent) ?? []) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      const w = k.examWeightHint !== null && Number.isFinite(k.examWeightHint) ? ` (ağırlık ${k.examWeightHint.toFixed(2)})` : '';
      lines.push(`${'  '.repeat(depth)}- ${k.isLeaf ? '•' : '▸'} ${k.id} · ${k.name}${w}`);
      if (depth < 6) walk(k.id, depth + 1);
    }
  };
  walk('', 0);
  if (data.skills.length === 0) lines.push('- (kazanım yok)');

  if (data.prerequisites.length) {
    lines.push('', '## Ön koşullar (kazanım ← ön koşul)');
    const grouped = new Map<string, string[]>();
    for (const p of data.prerequisites) grouped.set(p.skillId, [...(grouped.get(p.skillId) ?? []), p.prereqId]);
    for (const k of [...grouped.keys()].sort()) lines.push(`- ${k} ← ${[...new Set(grouped.get(k))].sort().join(', ')}`);
  }

  lines.push('', '## Yanılgı etiketleri (etiket · kazanım · açıklama)');
  const tags = [...data.misconceptionTags].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0)).slice(0, COURSE_LIMITS.misconceptionTags);
  lines.push(
    ...(tags.length
      ? tags.map((t) => `- ${t.tag} · ${t.skillId ?? 'genel'}${t.prereqSkillId ? ` (asıl sorun: ${t.prereqSkillId})` : ''} · ${oneLine(t.text, 140) ?? ''}`)
      : ['- (yok)']),
  );

  lines.push('', '## Soru tarzları (kod · ad · biçim · püf · zorluk)');
  const styles = [...data.styles]
    .sort((a, b) => (b.frequency ?? -1) - (a.frequency ?? -1) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .slice(0, COURSE_LIMITS.styles);
  lines.push(
    ...(styles.length
      ? styles.map((st) =>
          [
            `- ${st.code} · ${st.name}`,
            st.format ? oneLine(st.format, 60) : null,
            st.trick ? `püf: ${oneLine(st.trick, 100)}` : null,
            st.difficulty ? (DIFF_TR[st.difficulty] ?? st.difficulty) : null,
            st.frequency !== null ? `sıklık ${st.frequency.toFixed(2)}` : null,
            st.skillIds.length ? `kazanım ${[...st.skillIds].sort().join(', ')}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        )
      : ['- (henüz tarz yok)']),
  );
  return lines.join('\n') + '\n';
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** Ders bloğu verisini okur. `curriculumId` verilmezse dersin eşlendiği müfredat (`courses.curriculum_id`). */
export async function loadCourseBlockData(db: PgQueryLike, courseId: string, curriculumId?: string | null): Promise<CourseBlockData> {
  const cr = await db.query(
    `select co.id, co.code, co.title, co.kind, co.curriculum_id,
            exists (select 1 from public.profiles p where p.id = co.created_by and p.role = 'student') as created_by_student
       from public.courses co where co.id = $1::uuid`,
    [courseId],
  );
  const row = cr.rows[0];
  if (!row) throw new DossierError('OGR-DOS-003', `ders yok: ${courseId}`);
  const cur = curriculumId ?? (row.curriculum_id ? String(row.curriculum_id) : null);
  const course = {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    kind: row.kind ? String(row.kind) : null,
    // sürücü boolean döndürmezse güvensiz say (yalnız açık false başlığı yazdırır)
    createdByStudent: row.created_by_student !== false,
  };
  if (!cur) return { course, curriculum: null, skills: [], prerequisites: [], misconceptionTags: [], styles: await loadStyles(db, courseId) };
  const [cu, sk, pr, mt] = await Promise.all([
    db.query('select id, code, version, label, status, origin from public.curricula where id = $1::uuid', [cur]),
    db.query(
      'select id, parent_id, name, kind, is_leaf, order_no, exam_weight_hint from public.skills where curriculum_id = $1::uuid order by order_no, id',
      [cur],
    ),
    db.query('select skill_id, prereq_id from public.skill_prerequisites where curriculum_id = $1::uuid order by skill_id, prereq_id', [cur]),
    db.query(
      `select mt.tag, mt.skill_id, mt.prereq_skill_id, mt.text_instructor from public.misconception_tags mt
        where mt.curriculum_id = $1::uuid
           or exists (select 1 from public.skills s where s.curriculum_id = $1::uuid and s.id = mt.skill_id)
        order by mt.tag`,
      [cur],
    ),
  ]);
  const c0 = cu.rows[0];
  return {
    course,
    curriculum: c0
      ? { id: String(c0.id), code: String(c0.code), version: String(c0.version), label: String(c0.label), status: String(c0.status), origin: c0.origin ? String(c0.origin) : '' }
      : null,
    skills: sk.rows.map((r) => ({
      id: String(r.id),
      parentId: r.parent_id ? String(r.parent_id) : null,
      name: String(r.name),
      kind: r.kind ? String(r.kind) : null,
      isLeaf: Boolean(r.is_leaf),
      orderNo: Number(r.order_no ?? 0),
      examWeightHint: num(r.exam_weight_hint),
    })),
    prerequisites: pr.rows.map((r) => ({ skillId: String(r.skill_id), prereqId: String(r.prereq_id) })),
    misconceptionTags: mt.rows.map((r) => ({
      tag: String(r.tag),
      skillId: r.skill_id ? String(r.skill_id) : null,
      prereqSkillId: r.prereq_skill_id ? String(r.prereq_skill_id) : null,
      text: String(r.text_instructor ?? ''),
    })),
    styles: await loadStyles(db, courseId),
  };
}

async function loadStyles(db: PgQueryLike, courseId: string): Promise<CourseBlockData['styles']> {
  const r = await db.query(
    `select code, name, format, trick, difficulty_band, frequency_score, skill_ids from public.question_styles
      where course_id = $1::uuid and status = 'active' order by frequency_score desc nulls last, code`,
    [courseId],
  );
  return r.rows.map((x) => ({
    code: String(x.code),
    name: String(x.name),
    format: x.format ? String(x.format) : null,
    trick: x.trick ? String(x.trick) : null,
    difficulty: x.difficulty_band ? String(x.difficulty_band) : null,
    frequency: num(x.frequency_score),
    skillIds: Array.isArray(x.skill_ids) ? x.skill_ids.map(String) : [],
  }));
}

export interface CourseBlock {
  courseId: string;
  curriculumId: string | null;
  text: string;
  hash: string;
  fromCache: boolean;
}

/** Ders başına süreç içi önbellek (anahtar: ders + müfredat); TTL dolunca yeniden okunur. */
export class CourseBlockCache {
  private readonly map = new Map<string, { block: CourseBlock; at: number }>();
  constructor(
    private readonly ttlMs: number = COURSE_BLOCK_TTL_MS,
    private readonly clock: () => number = Date.now,
  ) {}
  get(key: string): CourseBlock | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (this.clock() - e.at > this.ttlMs) {
      this.map.delete(key);
      return null;
    }
    return e.block;
  }
  set(key: string, block: CourseBlock): void {
    this.map.set(key, { block, at: this.clock() });
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

const defaultCourseCache = new CourseBlockCache();

/** Ders bloğu (system[1]); önbellekteyse veritabanına gitmez. */
export async function renderCourseBlock(
  db: PgQueryLike,
  courseId: string,
  opts: { curriculumId?: string | null; cache?: CourseBlockCache | null } = {},
): Promise<CourseBlock> {
  const cache = opts.cache === undefined ? defaultCourseCache : opts.cache;
  const key = `${courseId}:${opts.curriculumId ?? ''}`;
  const hit = cache?.get(key);
  if (hit) return { ...hit, fromCache: true };
  const data = await loadCourseBlockData(db, courseId, opts.curriculumId);
  const text = renderCourseText(data);
  const block: CourseBlock = { courseId, curriculumId: data.curriculum?.id ?? null, text, hash: sha256Hex(text), fromCache: false };
  cache?.set(key, block);
  return block;
}

export interface PromptSystemInput {
  /** system[0]: ürün + rol + rota metni (packages/prompts `loadPrompt(route).text`). */
  product: string;
  studentId: string;
  courseId: string;
  dossier?: RenderDossierOptions;
  courseCache?: CourseBlockCache | null;
}

/**
 * Üç system parçası: ürün (verilen), ders bloğu (öğrencinin kaydındaki müfredat sürümüyle) ve dossier.
 * Sonuç `gateway.call(route, { system })`'e verilir; `buildSystemBlocks` 1 sa / 1 sa / 5 dk kesme noktalarını koyar.
 */
export async function buildPromptSystem(
  db: PgQueryLike,
  input: PromptSystemInput,
): Promise<{ system: SystemParts; dossier: DossierBlock; course: CourseBlock }> {
  const dossier = await renderDossier(db, input.studentId, input.courseId, input.dossier);
  let curriculumId = dossier.curriculumId;
  if (curriculumId === null) {
    const r = await db.query(
      `select curriculum_id from public.enrollments where student_id = $1::uuid and course_id = $2::uuid
        order by (status = 'active') desc, started_at desc, created_at desc limit 1`,
      [input.studentId, input.courseId],
    );
    curriculumId = r.rows[0]?.curriculum_id ? String(r.rows[0].curriculum_id) : null;
  }
  const course = await renderCourseBlock(db, input.courseId, { curriculumId, ...(input.courseCache !== undefined ? { cache: input.courseCache } : {}) });
  return { system: { product: input.product, course: course.text, dossier: dossier.text }, dossier, course };
}
