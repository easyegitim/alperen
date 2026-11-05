/**
 * `diagnosis.run` — "Kendi çalışmam" yüklemesinin teşhisi (docs/PLAN-v2.md §2 Akış 1, §3.1). `upload.intake` kuyruğa
 * atar: {upload_ids[], enrollment_id}.
 *
 *   1. Yüklemeler → Anthropic Files API (`uploads.anthropic_file_id` saklanır, tekrar kullanılır; sahte taşımada
 *      `fake-file-<kimlik>`, ağ ve Storage yok).
 *   2. Rota solution_diagnosis (Opus 5.5 · high; görseller `image`, PDF `document` bloğu; messages.parse → zod
 *      solution-diagnosis). Sistem: ürün + ders bloğu + dossier (buildPromptSystem; kaydın dersi yoksa yalnız ürün).
 *   3. Doğrulama (§3.1 adım 3): kazanım kodları kaydın müfredatında yaprak mı (değilse düşer; hiç kalmazsa en derin
 *      var olan üst düğümün altına `proposed_subskill`), yanılgı etiketi katalogda mı, `failing_step_no ≤ adım sayısı`,
 *      hata nedeni enum'u. Düşenler `analysis.validation`'a yazılır.
 *   4. public.apply_diagnosis tek işlemde: solution_analyses + observations (careless/time ağırlık 0.5) → BKT +
 *      style_coverage (+ öneri). RPC `diagnosis.followup`'ı kuyruğa atar: Haiku memory_delta → hafıza işleyicileri →
 *      activity.completed (Bugün kartları, dossier).
 *   5. Gömme: VOYAGE_API_KEY yoksa atlanır (embedding null kalır).
 *   6. Bugün'e 'upload_result' kartı ("Çözümünü inceledim: 3. adımda işlem kuralı"); yüklemeler 'ready'. Kart öneri
 *      motorunun anahtarıyla (copy_key = analysis:<id>) ve aynı metinle yazılır (suggestions/rules.ts uploadNotice):
 *      ardından gelen suggestions.refresh kartı silmez, yerinde günceller. Web (/ogrenci/sonuc) solution_analyses
 *      satırını yükleme kimliğiyle bekler (Realtime ya da yoklama).
 * Aynı yükleme kümesi için ikinci çalıştırma yeni teşhis yazmaz (idempotent). Model çıktısı doğrulamadan önce
 * audit.events 'diagnosis.raw' satırına yazılır: sonraki bir adım (apply_diagnosis, kart) düşerse yeniden deneme Opus'u
 * yeniden çağırmaz. Ret (RefusalError) ya da şemaya uymayan çıktı (ParseError): yüklemeler 'failed' + "yeniden çek" kartı.
 * Diğer kalıcı hatalar (anahtar, istek, model erişimi) "Yüklemeni şu an işleyemedim" der ve ctx.log.error ile kaydedilir;
 * geçici hatalar pg-boss ile yeniden denenir, son denemede aynı kart. Düşen her teşhis audit.events 'diagnosis.failed'
 * satırı bırakır (row_id = ilk yükleme; {upload_ids, enrollment_id, failure, reason}): öneri motoru kartı bu satırdan
 * yeniden kurar (copy_key = upload:<ilk yükleme>).
 * Öneri yükü apply_proposal biçimine çevrilir ({parent_id, name, description, id?}; proposalForApply).
 */
import { z } from 'zod';
import type { SolutionDiagnosis } from '@ogrenmen/contracts';
import { AnthropicTransport, buildPromptSystem, classifyError, ParseError, RefusalError, type CallInput, type Gateway } from '@ogrenmen/llm';
import type { Db } from '../db.js';
import { systemPrompt } from '../prompts.js';
import { RANK_UPLOAD_RESULT, refKey, UPLOAD_CARD, uploadNotice, type UploadSignal } from '../suggestions/rules.js';
import type { StorageLike } from '../storage.js';
import { runExamDiagnosis } from './diagnosis-exam.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

export const UPLOAD_BUCKET = 'uploads';
/** Kendi çalışmam: soru + çözüm fotoğrafı en çok 4 sayfa (PLAN-v2 §2 Akış 1; web ve submit_upload aynı sınır). */
export const MAX_DIAGNOSIS_UPLOADS = 4;
/** Okul denemesi: kitapçık + optik + karalama, en çok 40 sayfa (web ve submit_upload aynı sınır). */
export const MAX_SCHOOL_EXAM_UPLOADS = 40;
/** Files API'deki kopya 90 gün sonra silinir (reşit olmayanın fotoğrafı süresiz kalmaz; API üst sınırı 7 776 000 sn). */
export const FILE_TTL_SECONDS = 7_776_000;

/**
 * Yük: Kendi çalışmam {upload_ids[1..4], enrollment_id}; deneme bağlamı (0030 exam_how_far, finish_exam_session,
 * exam.analyse karalama dağıtımı) {upload_ids[0..4], enrollment_id, context: 'exam', exam_response_id, session_id,
 * exam_id, question_no, how_far_text} → jobs/diagnosis-exam.ts.
 */
const payload = z
  .object({
    upload_ids: z.array(uuid).max(MAX_DIAGNOSIS_UPLOADS),
    enrollment_id: uuid,
    context: z.enum(['own_work', 'exam']).optional(),
    exam_response_id: uuid.optional(),
    session_id: uuid.optional(),
    exam_id: uuid.optional(),
    question_no: z.number().int().min(1).max(500).optional(),
    how_far_text: z.string().max(2000).nullable().optional(),
  })
  .refine((p) => (p.context === 'exam' ? Boolean(p.exam_response_id) : p.upload_ids.length >= 1), {
    message: 'Kendi çalışmam en az bir yükleme, deneme bağlamı exam_response_id ister',
    path: ['upload_ids'],
  });
export type DiagnosisRunPayload = z.infer<typeof payload>;

export type UserBlocks = Exclude<CallInput['user'], string>;

export interface UploadRow {
  id: string;
  student_id: string | null;
  owner_id: string;
  kind: string;
  storage_path: string;
  mime: string | null;
  status: string;
  anthropic_file_id: string | null;
}

/** Yüklemeyi Files API'ye çıkarır, `file_id` döner. */
export interface FileUploader {
  upload(u: UploadRow): Promise<string>;
}

function isPdf(u: Pick<UploadRow, 'mime' | 'kind'>): boolean {
  return u.mime === 'application/pdf' || u.kind === 'pdf';
}

function fileName(u: Pick<UploadRow, 'id' | 'mime' | 'kind' | 'storage_path'>): string {
  const last = u.storage_path.split('/').pop() ?? '';
  return last || `${u.id}${isPdf(u) ? '.pdf' : '.jpg'}`;
}

/**
 * Sahte taşımada ağ ve Storage'a gitmeden deterministik kimlik; gerçek taşımada Storage'dan indirip
 * `client.files.upload` (Files API GA; Node 22 `File` Uploadable'dır). Kopya `FILE_TTL_SECONDS` sonra düşer; süresi
 * dolmuş kimlik teşhis çağrısında "dosya yok" verirse iş kimliği boşaltıp yeniden yükler (isMissingFileError).
 */
export function fileUploaderFor(gateway: Gateway, storage: () => StorageLike): FileUploader {
  if (gateway.transport.kind === 'fake') return { upload: async (u) => `fake-file-${u.id.slice(0, 8)}` };
  const transport = gateway.transport;
  if (!(transport instanceof AnthropicTransport)) throw new PermanentJobError('Files API yalnız Anthropic taşımasında', 'OGR-JOB-140');
  return {
    upload: async (u) => {
      const bytes = await storage().download(UPLOAD_BUCKET, u.storage_path);
      const file = new File([new Uint8Array(bytes)], fileName(u), { type: u.mime ?? (isPdf(u) ? 'application/pdf' : 'image/jpeg') });
      const meta = await transport.client.files.upload({ file, expires_in_seconds: FILE_TTL_SECONDS });
      return meta.id;
    },
  };
}

/** Kullanıcı turu: her sayfa bir `image` (görsel) ya da `document` (PDF) bloğu, sonra kısa yönerge. Citations kapalı. */
export function diagnosisUserBlocks(files: { upload: Pick<UploadRow, 'mime' | 'kind'>; fileId: string }[]): UserBlocks {
  const blocks: UserBlocks = [];
  files.forEach(({ upload, fileId }, i) => {
    if (isPdf(upload)) blocks.push({ type: 'document', source: { type: 'file', file_id: fileId }, title: `Sayfa ${i + 1}` });
    else blocks.push({ type: 'image', source: { type: 'file', file_id: fileId } });
  });
  const n = files.length;
  blocks.push({
    type: 'text',
    text:
      `Öğrenci ${n === 1 ? 'bir sayfa' : `${n} sayfa`} yükledi: bir soru ve kendi çözümü ("Kendi çalışmam"). ` +
      'Soruyu ve çözümü görsellerden oku; transkripsiyon yok.',
  });
  return blocks;
}

// --- doğrulama -------------------------------------------------------------------------------------

export interface CurriculumIndex {
  /** Kazanım kodu → {ad, yaprak mı, üst}. */
  nodes: Map<string, { name: string; isLeaf: boolean; parentId: string | null }>;
  /** Yanılgı etiketi → kazanım (boş: genel). */
  tags: Map<string, string | null>;
}

export async function loadCurriculumIndex(db: Db, curriculumId: string): Promise<CurriculumIndex> {
  const [skills, tags] = await Promise.all([
    db.query('select id, name, is_leaf, parent_id from public.skills where curriculum_id = $1::uuid', [curriculumId]),
    db.query('select tag, skill_id from public.misconception_tags', []),
  ]);
  return {
    nodes: new Map(skills.rows.map((r) => [String(r.id), { name: String(r.name), isLeaf: Boolean(r.is_leaf), parentId: r.parent_id ? String(r.parent_id) : null }])),
    tags: new Map(tags.rows.map((r) => [String(r.tag), r.skill_id ? String(r.skill_id) : null])),
  };
}

export interface ValidatedDiagnosis {
  diagnosis: SolutionDiagnosis;
  /** Düşürülen ya da düzeltilen alanlar (analysis.validation). */
  issues: string[];
  dropped: { skill_ids: string[]; misconception_tags: string[]; proposed_subskill: boolean };
}

/** En derin var olan üst düğüm: 'tyt.mat.cebir.denklem.x' → 'tyt.mat.cebir.denklem' (yaprak değilse) ya da daha yukarısı. */
function deepestParent(code: string, idx: CurriculumIndex): string | null {
  const parts = code.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const cand = parts.slice(0, i).join('.');
    const node = idx.nodes.get(cand);
    if (node && !node.isLeaf) return cand;
    if (node?.isLeaf && node.parentId) return node.parentId;
  }
  return null;
}

/**
 * Model çıktısını kaydın müfredatına göre düzeltir (docs/PLAN-v2.md §3.1 adım 3). apply_diagnosis bilinmeyen kazanım ve
 * etikette hata verir (OGR-DIAG-002/003); burada önceden ayıklanır ki bir kod yüzünden teşhis kaybolmasın.
 */
export function validateDiagnosis(input: SolutionDiagnosis, idx: CurriculumIndex): ValidatedDiagnosis {
  const d: SolutionDiagnosis = structuredClone(input);
  const issues: string[] = [];
  const dropped = { skill_ids: [] as string[], misconception_tags: [] as string[], proposed_subskill: false };

  // adımlar: numara sırası ve failing_step_no ≤ adım sayısı
  if (d.failing_step_no !== null && !d.student_steps.some((s) => s.no === d.failing_step_no)) {
    issues.push(`failing_step_no ${d.failing_step_no} adımlarda yok: ilk hatalı adım alındı`);
    d.failing_step_no = d.student_steps.find((s) => s.status !== 'ok')?.no ?? null;
  }
  if (d.failing_step_no !== null && d.failing_step_no > d.student_steps.length) {
    issues.push(`failing_step_no ${d.failing_step_no} > ${d.student_steps.length} adım`);
    d.failing_step_no = null;
  }
  if (d.verdict === 'correct') {
    d.failing_step_no = null;
    d.error_cause = null;
  } else if ((d.verdict === 'wrong' || d.verdict === 'incomplete') && d.error_cause === null) {
    issues.push('yanlış/eksik çözümde error_cause yok: procedure varsayıldı');
    d.error_cause = 'procedure';
  }
  if (d.verdict === 'unreadable') {
    d.failing_step_no = null;
    d.error_cause = null;
  }

  // kazanımlar: yalnız bu müfredatın yaprakları
  const keep: string[] = [];
  for (const sid of d.skill_ids) {
    const node = idx.nodes.get(sid);
    if (node?.isLeaf) {
      if (!keep.includes(sid)) keep.push(sid);
    } else {
      dropped.skill_ids.push(sid);
      issues.push(node ? `${sid} ara düğüm (yaprak değil)` : `${sid} müfredatta yok`);
    }
  }
  d.skill_ids = keep;

  // önerilen alt kazanım: üst düğüm var olmalı, kod yeni olmalı
  if (d.proposed_subskill) {
    const p = d.proposed_subskill;
    const parent = idx.nodes.get(p.parent_code);
    if (!parent || idx.nodes.has(p.code)) {
      issues.push(`proposed_subskill düştü: ${!parent ? `üst düğüm ${p.parent_code} yok` : `${p.code} zaten var`}`);
      d.proposed_subskill = null;
      dropped.proposed_subskill = true;
    }
  }
  if (d.verdict !== 'unreadable' && d.skill_ids.length === 0 && d.proposed_subskill === null) {
    const first = dropped.skill_ids.find((c) => !idx.nodes.has(c));
    const parent = first ? deepestParent(first, idx) : null;
    if (first && parent) {
      const parentName = idx.nodes.get(parent)?.name ?? parent;
      d.proposed_subskill = { code: first, name: `Önerilen alt kazanım: ${parentName}`.slice(0, 120), parent_code: parent, description: d.why_tr.slice(0, 400) };
      issues.push(`${first} için alt kazanım önerisi (${parent} altında)`);
    } else {
      issues.push('geçerli kazanım yok: gözlem yazılmaz');
    }
  }

  // yanılgı etiketleri: katalogda olmalı (genel etiketler her yaprakla geçer)
  const tags: string[] = [];
  for (const t of d.misconception_tags) {
    if (idx.tags.has(t)) {
      if (!tags.includes(t)) tags.push(t);
    } else {
      dropped.misconception_tags.push(t);
      issues.push(`${t} etiketi katalogda yok`);
    }
  }
  d.misconception_tags = d.verdict === 'correct' || d.verdict === 'unreadable' ? [] : tags;
  return { diagnosis: d, issues, dropped };
}

/**
 * apply_diagnosis → curriculum_proposals(add_subskill) yükü: app.apply_proposal {parent_id, name, description, id?} okur
 * (sözleşmenin parent_code'u değil). Kod üst düğümün altındaysa yeni kazanımın kimliği olur; değilse RPC türetir.
 */
export function proposalForApply(p: SolutionDiagnosis['proposed_subskill']): Record<string, string> | null {
  if (!p) return null;
  const out: Record<string, string> = { parent_id: p.parent_code, name: p.name, description: p.description, code: p.code };
  if (p.code.startsWith(`${p.parent_code}.`)) out.id = p.code;
  return out;
}

// --- kopya -----------------------------------------------------------------------------------------

const CAUSE_SHORT: Record<string, string> = {
  concept: 'kavram karışmış',
  procedure: 'işlem kuralı',
  careless: 'küçük bir hesap kayması',
  reading: 'soruyu okuma',
  time: 'süre yetmemiş',
};

/** Bugün kartı ve sonuç ekranının tek cümlesi ("Çözümünü inceledim: 3. adımda işlem kuralı."). */
export function diagnosisOneLine(d: Pick<SolutionDiagnosis, 'verdict' | 'failing_step_no' | 'error_cause'>): string {
  if (d.verdict === 'unreadable') return 'Fotoğraf okunamadı, yeniden çekebilirsin.';
  if (d.verdict === 'correct') return 'Çözümünü inceledim: yolun baştan sona doğru.';
  const cause = d.error_cause ? CAUSE_SHORT[d.error_cause] : null;
  if (d.error_cause === 'time') return d.failing_step_no !== null ? `Çözümünü inceledim: ${d.failing_step_no}. adımda ${cause}.` : `Çözümünü inceledim: ${cause}.`;
  if (d.failing_step_no !== null) return `Çözümünü inceledim: ${d.failing_step_no}. adımda ${cause ?? 'bir hata'}.`;
  return `Çözümünü inceledim: ${cause ?? 'bir adımda hata var'}.`;
}

/** Kartın düşeceği an: ertesi Europe/Istanbul gününün sonu (UTC+3, yaz saati yok); gece yüklenen sonuç sabah da görünür. */
export function cardExpiry(now: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + 2, -3, 0, 0)).toISOString();
}

/**
 * Worker'ın hemen yazdığı Bugün kartı. Anahtar, başlık, alt satır ve yük öneri motorununkiyle aynıdır (uploadNotice;
 * payload.copy_key = sinyalin ref'i): sonraki suggestions.refresh (replace_suggestions) kartı silmez, yerinde günceller.
 * Aynı sayfaların başlatılmamış eski kartı (ör. bekleyen deneme) yenisiyle değişir.
 */
export async function writeUploadCard(db: Db, studentId: string, signal: UploadSignal, now: Date): Promise<void> {
  const n = uploadNotice(signal);
  await db.query(
    `with del as (
       delete from public.suggestions s
        where s.student_id = $1::uuid and s.kind = 'upload_result' and s.consumed_at is null
          and ((s.payload ->> 'copy_key') = $6 or (s.payload ->> 'upload_id') = $8)
     )
     insert into public.suggestions (student_id, enrollment_id, kind, title, subtitle, payload, rank, expires_at)
     values ($1::uuid, $2::uuid, 'upload_result', $3, $4, $5::jsonb, $9, $7::timestamptz)`,
    [studentId, signal.enrollmentId, n.title, n.subtitle, JSON.stringify({ ...n.payload, copy_key: n.key }), n.key, cardExpiry(now), signal.uploadId ?? '', RANK_UPLOAD_RESULT],
  );
}

// --- gömme (isteğe bağlı) -------------------------------------------------------------------------------

/** Voyage gömmesi (1024 boyut). Anahtar yoksa null: teşhis gömmesiz yazılır, arama P2'de geriye doldurur. */
export async function embedDiagnosisText(text: string, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<number[] | null> {
  const key = env.VOYAGE_API_KEY;
  if (!key || !text.trim()) return null;
  const res = await fetchImpl('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: [text.slice(0, 8000)], model: env.VOYAGE_MODEL ?? 'voyage-3.5', output_dimension: 1024, input_type: 'document' }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { embedding?: number[] }[] };
  const v = body.data?.[0]?.embedding;
  return Array.isArray(v) && v.length === 1024 ? v : null;
}

// --- iş --------------------------------------------------------------------------------------------

export interface DiagnosisRunResult {
  analysisId: string | null;
  verdict: string;
  reused: boolean;
  /** Önceki denemenin kaydedilmiş model çıktısı kullanıldı (Opus yeniden çağrılmadı). */
  rawReused: boolean;
  fileIds: string[];
  issues: string[];
  embedded: boolean;
}

/** Düşen işin Bugün kartı: okuma (ret, okunamayan çıktı) ile işleme (Storage, veritabanı, ağ) hatası ayrı söylenir. */
export const FAILURE_CARDS = UPLOAD_CARD.failed;
export type FailureKind = keyof typeof FAILURE_CARDS;

/** Kartı yazılmış, yüklemeleri 'failed' yapılmış kalıcı hata (dış yakalayıcı ikinci kart yazmaz). */
class FailedDiagnosisError extends PermanentJobError {}

async function setUploadStatus(db: Db, ids: string[], status: 'processing' | 'ready' | 'failed'): Promise<void> {
  await db.query('update public.uploads set status = $2 where id = any($1::uuid[])', [ids, status]);
}

/** Yüklemeler 'failed' + kalıcı neden (audit 'diagnosis.failed') + Bugün kartı (upload:<ilk yükleme>). */
async function failUploads(ctx: JobContext, p: DiagnosisRunPayload, studentId: string, reason: string, kind: FailureKind): Promise<void> {
  const first = p.upload_ids[0]!;
  await ctx.db.query(`select app.audit_event('diagnosis.failed', 'uploads', $1, $2::jsonb)`, [
    first,
    JSON.stringify({ upload_ids: p.upload_ids, enrollment_id: p.enrollment_id, failure: kind, reason }),
  ]);
  await setUploadStatus(ctx.db, p.upload_ids, 'failed');
  await writeUploadCard(
    ctx.db,
    studentId,
    {
      ref: refKey('upload', first),
      state: 'failed',
      analysisId: null,
      sessionId: null,
      uploadId: first,
      uploadIds: p.upload_ids,
      enrollmentId: p.enrollment_id,
      verdict: null,
      failure: kind,
      reason,
      at: ctx.now().toISOString(),
      net: null,
    },
    ctx.now(),
  );
}

/** Fotoğrafın/çıktının suçu mu: ret ya da şemaya uymayan model çıktısı. Anahtar, istek, model erişimi hataları değil. */
export function isReadingFailure(err: unknown): boolean {
  return err instanceof RefusalError || err instanceof ParseError;
}

/** Süresi dolmuş ya da silinmiş Files API kimliği (404 ya da "file … not found/expired" 400'ü; neden zinciri de taranır). */
export function isMissingFileError(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; e = (e as { cause?: unknown }).cause, i++) {
    const status = (e as { status?: unknown }).status;
    const msg = String((e as { message?: unknown }).message ?? '');
    if (status === 404) return true;
    if (status === 400 && /file/i.test(msg) && /not found|expired|deleted|does not exist/i.test(msg)) return true;
  }
  return false;
}

/** Eksik (ya da `force` ile tümü) yüklemeleri Files API'ye çıkarır; kimlik uploads.anthropic_file_id'de saklanır. */
export async function ensureFiles(db: Db, uploader: FileUploader, uploads: UploadRow[], force: boolean): Promise<string[]> {
  const ids: string[] = [];
  for (const u of uploads) {
    if (force || !u.anthropic_file_id) {
      if (force && u.anthropic_file_id) await db.query('update public.uploads set anthropic_file_id = null where id = $1::uuid', [u.id]);
      u.anthropic_file_id = await uploader.upload(u);
      await db.query('update public.uploads set anthropic_file_id = $2 where id = $1::uuid', [u.id, u.anthropic_file_id]);
    }
    ids.push(u.anthropic_file_id);
  }
  return ids;
}

/** Model çıktısı apply'dan ÖNCE saklanır: apply düşerse yeniden deneme Opus'u yeniden çağırmaz (ücret tek sefer). */
interface RawDiagnosis {
  data: SolutionDiagnosis;
  model: string;
  cost_usd: number;
  prompt_version: string;
  file_ids: string[];
}
const RAW_ACTION = 'diagnosis.raw';

export async function loadRawDiagnosis(db: Db, p: DiagnosisRunPayload): Promise<RawDiagnosis | null> {
  const r = await db.query(
    `select diff from audit.events
      where action = $1 and row_id = $2 and diff ->> 'enrollment_id' = $3 and diff -> 'upload_ids' = $4::jsonb
      order by created_at desc, id desc limit 1`,
    [RAW_ACTION, p.upload_ids[0], p.enrollment_id, JSON.stringify(p.upload_ids)],
  );
  const diff = r.rows[0]?.diff as (RawDiagnosis & { upload_ids: string[] }) | undefined;
  return diff && diff.data && typeof diff.data === 'object' ? diff : null;
}

async function saveRawDiagnosis(db: Db, p: DiagnosisRunPayload, raw: RawDiagnosis): Promise<void> {
  await db.query(`select app.audit_event($1, 'uploads', $2, $3::jsonb)`, [
    RAW_ACTION,
    p.upload_ids[0],
    JSON.stringify({ upload_ids: p.upload_ids, enrollment_id: p.enrollment_id, ...raw }),
  ]);
}

export interface EnrollmentRow {
  id: unknown;
  student_id: unknown;
  curriculum_id: unknown;
  course_id: unknown;
  public_ref: unknown;
}

/** 1–6. adımlar (yüklemeler 'processing'; hata dış yakalayıcıya çıkar). */
async function runDiagnosis(p: DiagnosisRunPayload, ctx: JobContext, e: EnrollmentRow, uploads: UploadRow[], studentId: string): Promise<DiagnosisRunResult> {
  let stored = await loadRawDiagnosis(ctx.db, p);
  const rawReused = stored !== null;
  if (!stored) {
    const gateway = await ctx.gateway();
    // 1. Files API (kimlik saklanır, tekrar kullanılır)
    const uploader = fileUploaderFor(gateway, ctx.storage);
    let fileIds = await ensureFiles(ctx.db, uploader, uploads, false);

    // 2. teşhis çağrısı (süresi dolmuş dosya kimliği: bir kez yeniden yükle ve dene)
    const prompt = await systemPrompt(ctx.db, 'solution_diagnosis');
    const system = e.course_id
      ? (await buildPromptSystem(ctx.db, { product: prompt.text, studentId, courseId: String(e.course_id) })).system
      : { product: prompt.text };
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await gateway.call('solution_diagnosis', {
          system,
          user: diagnosisUserBlocks(uploads.map((u, i) => ({ upload: u, fileId: fileIds[i]! }))),
          turn: { now: ctx.now() },
          promptVersion: prompt.version,
          studentRef: String(e.public_ref),
          ref: { table: 'uploads', id: p.upload_ids[0]! },
          purpose: 'diagnosis.run',
          signal: ctx.signal,
        });
        stored = { data: res.data as SolutionDiagnosis, model: res.model, cost_usd: res.costUsd, prompt_version: prompt.version, file_ids: fileIds };
        break;
      } catch (err) {
        if (attempt === 0 && isMissingFileError(err)) {
          ctx.log.warn('Files API kimliği yok ya da süresi dolmuş; yeniden yükleniyor', { uploads: p.upload_ids });
          fileIds = await ensureFiles(ctx.db, uploader, uploads, true);
          continue;
        }
        const c = classifyError(err);
        if (isReadingFailure(err)) {
          await failUploads(ctx, p, studentId, c.code, 'reading');
          throw new FailedDiagnosisError(`teşhis çağrısı düştü: ${(err as Error).message}`, 'OGR-JOB-143');
        }
        if (!c.retryable && c.code !== 'unknown') {
          // kalıcı yapılandırma/kimlik/istek hatası (401/403/400, model erişimi): fotoğrafın suçu değil, yeniden çektirme.
          // Sınıflanamayan hata ('unknown') yukarı çıkar: pg-boss yeniden dener, son denemede aynı "işleyemedim" kartı.
          ctx.log.error('teşhis çağrısı kalıcı hatayla düştü', { code: c.code, status: c.status, error: (err as Error).message, uploads: p.upload_ids });
          await failUploads(ctx, p, studentId, c.code, 'processing');
          throw new FailedDiagnosisError(`teşhis çağrısı düştü: ${(err as Error).message}`, 'OGR-JOB-146');
        }
        throw err;
      }
    }
    await saveRawDiagnosis(ctx.db, p, stored);
  }

  // 3. doğrulama
  const idx = await loadCurriculumIndex(ctx.db, String(e.curriculum_id));
  const { diagnosis: d, issues, dropped } = validateDiagnosis(stored.data, idx);
  const oneLine = diagnosisOneLine(d);

  // 5. gömme (önce: apply_diagnosis tek işlemde yazar)
  const embedding = await embedDiagnosisText(`${d.question_text}\n${d.student_work_text}\n${d.why_tr}`).catch(() => null);

  // 4. kanıt: tek işlem (RPC). Öneri yükü apply_proposal biçiminde (parent_id).
  const analysis = {
    why_tr: d.why_tr,
    one_line: oneLine,
    steps: d.student_steps,
    reference_steps: d.reference_solution_steps,
    style_hint: d.style_hint,
    confidence: d.confidence,
    proposed_subskill: d.proposed_subskill,
    // modelin kazanım sırası (apply_diagnosis skill_ids'i alfabetik saklar; web birincil kazanımı buradan okur)
    skill_order: d.skill_ids,
    file_ids: stored.file_ids,
    prompt_version: stored.prompt_version,
    validation: { issues, dropped },
  };
  const applied = await ctx.db.query('select public.apply_diagnosis($1::jsonb) as id', [
    JSON.stringify({
      enrollment_id: p.enrollment_id,
      upload_ids: p.upload_ids,
      verdict: d.verdict,
      error_cause: d.error_cause,
      failing_step_no: d.failing_step_no,
      skill_ids: d.skill_ids,
      misconception_tags: d.misconception_tags,
      proposed_subskill: proposalForApply(d.proposed_subskill),
      question_text: d.question_text,
      student_work_text: d.student_work_text,
      confidence: d.confidence,
      quote: d.why_tr,
      model: stored.model,
      cost_usd: rawReused ? 0 : stored.cost_usd,
      analysis,
      ...(embedding ? { embedding } : {}),
    }),
  ]);
  const analysisId = String(applied.rows[0]?.id);

  // 6. Bugün kartı + yükleme durumu
  await writeUploadCard(
    ctx.db,
    studentId,
    {
      ref: refKey('analysis', analysisId),
      state: 'result',
      analysisId,
      sessionId: null,
      uploadId: p.upload_ids[0]!,
      uploadIds: p.upload_ids,
      enrollmentId: p.enrollment_id,
      verdict: d.verdict,
      oneLine,
      at: ctx.now().toISOString(),
      net: null,
    },
    ctx.now(),
  );
  await setUploadStatus(ctx.db, p.upload_ids, d.verdict === 'unreadable' ? 'failed' : 'ready');
  return { analysisId, verdict: d.verdict, reused: false, rawReused, fileIds: stored.file_ids, issues, embedded: embedding !== null };
}

export const diagnosisRunJob: JobDefinition<DiagnosisRunPayload, DiagnosisRunResult> = {
  name: 'diagnosis.run',
  description: 'Kendi çalışmam: Files API → solution_diagnosis (Opus) → doğrulama → apply_diagnosis → Bugün kartı.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 20, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 600, deleteAfterSeconds: 604_800 },
  handler: async (p, ctx) => {
    if (p.context === 'exam') return runExamDiagnosis(p, ctx);
    const e = (
      await ctx.db.query(
        `select e.id, e.student_id, e.curriculum_id, e.course_id, st.public_ref
           from public.enrollments e join public.students st on st.id = e.student_id
          where e.id = $1::uuid`,
        [p.enrollment_id],
      )
    ).rows[0] as EnrollmentRow | undefined;
    if (!e) throw new PermanentJobError(`kayıt yok: ${p.enrollment_id}`, 'OGR-JOB-141');
    const studentId = String(e.student_id);

    const ups = (
      await ctx.db.query(
        `select id, student_id, owner_id, kind, storage_path, mime, status, anthropic_file_id
           from public.uploads where id = any($1::uuid[])`,
        [p.upload_ids],
      )
    ).rows as unknown as UploadRow[];
    const byId = new Map(ups.map((u) => [String(u.id), u]));
    const ordered = p.upload_ids.map((id) => byId.get(id));
    if (ordered.some((u) => !u || String(u.student_id) !== studentId)) {
      throw new PermanentJobError('yüklemeler bulunamadı ya da bu öğrencinin değil', 'OGR-JOB-142');
    }
    const uploads = ordered as UploadRow[];

    // idempotent: aynı yükleme kümesinin teşhisi zaten yazıldıysa yeniden çağrı yok
    const prev = (
      await ctx.db.query(
        `select id, verdict from public.solution_analyses
          where enrollment_id = $1::uuid and upload_ids @> $2::uuid[] and upload_ids <@ $2::uuid[]
          order by created_at desc limit 1`,
        [p.enrollment_id, p.upload_ids],
      )
    ).rows[0];
    if (prev) {
      await setUploadStatus(ctx.db, p.upload_ids, prev.verdict === 'unreadable' ? 'failed' : 'ready');
      return { analysisId: String(prev.id), verdict: String(prev.verdict), reused: true, rawReused: false, fileIds: uploads.map((u) => u.anthropic_file_id ?? ''), issues: [], embedded: false };
    }
    await setUploadStatus(ctx.db, p.upload_ids, 'processing');

    // Her adım (Storage, Files API, prompt, apply_diagnosis, kart) burada: son denemede ya da kalıcı hatada yüklemeler
    // 'failed' olur ve "yeniden dener misin" kartı yazılır; öğrenci 'processing'de asılı kalmaz.
    try {
      return await runDiagnosis(p, ctx, e, uploads, studentId);
    } catch (err) {
      if (err instanceof FailedDiagnosisError) throw err;
      const last = ctx.job.retryCount >= diagnosisRunJob.retry.retryLimit;
      if (!(err instanceof PermanentJobError) && !last) throw err;
      const code = err instanceof PermanentJobError ? err.code : 'OGR-JOB-145';
      await failUploads(ctx, p, studentId, code, 'processing').catch((cardErr: unknown) =>
        ctx.log.error('düşen teşhisin kartı yazılamadı', { error: (cardErr as Error).message }),
      );
      throw err instanceof PermanentJobError ? err : new PermanentJobError(`teşhis işlenemedi: ${(err as Error).message}`, 'OGR-JOB-145');
    }
  },
};
