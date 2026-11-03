/**
 * `curriculum.draft` — dinamik müfredat taslağı (docs/PLAN-v2.md §3.5). onboarding_enroll (0022) ya da eğitmen
 * (curriculum_draft_retry, 0025: düşen taslağı isteğe bağlı kaynak yüklemeleriyle yeniden kurar) kuyruğa atar:
 * {curriculum_id, course_text, upload_ids[]} (+ course_id, enrollment_id, student_id, target_exam, course_kind,
 * requested_by). İş yalnız SQL'den (SECURITY DEFINER RPC) ya da worker'dan atılır; yine de yüklemeler sahiplikle süzülür:
 * müfredatı açanın, işi isteyen eğitmenin ya da kayıtlı öğrencinin yüklemesi; belge bloğu yalnız PDF/metin.
 *
 * Akış ve durum (curricula.draft_status/draft_progress; istemci Realtime ile izler):
 *   queued → researching (10) → drafting (45) → saving (85) → ready (100)   |   failed (+ draft_error)   |   skipped
 *   1. Müfredatta kazanım varsa iş tekrar çalışıyordur: yazmadan biter (idempotent).
 *   2. Aynı ders metni için aktif bir müfredat varsa taslak üretilmez: kayıtlar ona taşınır (curriculum_draft_supersede).
 *   3. Araştırma: rota curriculum_research (Opus 5.5 · high, web_search_20260209 + web_fetch_20260209, en çok 8 kullanım,
 *      atıflı serbest metin). Yapılandırılmış çıktı Citations ile uyumsuz olduğundan araştırma ve biçim iki adımdır.
 *   4. Taslak: rota curriculum_draft (Opus 5.5 · high, araçsız, curriculum-draft şeması); yüklenen dosyalar `document`
 *      bloğu (Files API file_id ya da çıkarılmış metin).
 *   5. Doğrulama (checkDraft: tek kök, döngüsüz, derinlik ≤ 4, kod benzersiz) → public.save_curriculum_draft tek
 *      işlemde: kazanımlar + kind'a göre BKT varsayılanları + ön koşullar + yanılgı etiketleri; otopilot etkinse
 *      (TYT/AYT/LGS) kayıtlı öğrencilere ilk 'practice' önerisi — kapalıysa öneri eğitmenin yayınıyla gelir.
 *   6. Kaydı açan öğrenci için practice.prewarm (ilk öneri için soru bankası; ai_draft dersin bankası hep boştu); otopilotta
 *      ilk kartla birlikte SQL atar (app.first_practice_suggestion), eğitmen yayınında da (curriculum_publish).
 * Hata: draft_status = 'failed' + draft_error; geçici hatalar pg-boss ile yeniden denenir (bir sonraki deneme durumu
 * yeniden researching'e çeker); kalıcı hatada eğitmen editörde "Taslağı yeniden kur" der (curriculum_draft_retry).
 * Sahte taşımada (OGRENMEN_LLM=fake) taslak packages/llm/fixtures/curriculum_draft'tan
 * gelir (2 ünite × 3 kazanım × 2 alt kazanım TYT örneği).
 */
import { z } from 'zod';
import type { CurriculumDraft } from '@ogrenmen/contracts';
import { classifyError } from '@ogrenmen/llm';
import {
  checkDraft,
  citationRefs,
  codePrefix,
  DOCUMENT_MIME_SQL,
  documentBlocks,
  draftMessage,
  examOf,
  normText,
  researchMessage,
  type CourseContext,
  type UploadSource,
} from '../curriculum/draft.js';
import type { Db } from '../db.js';
import { routePrompt } from '../curriculum/prompt.js';
import { oncePer } from './dedupe.js';
import { PermanentJobError } from './errors.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

const payload = acceptCamelAliases(
  { curriculumId: 'curriculum_id', courseText: 'course_text', uploadIds: 'upload_ids' },
  z.object({
    curriculum_id: uuid,
    course_text: z.string().trim().min(2).max(200),
    upload_ids: z.array(uuid).max(20).default([]),
    course_id: uuid.nullish(),
    enrollment_id: uuid.nullish(),
    student_id: uuid.nullish(),
    target_exam: z.string().max(20).nullish(),
    course_kind: z.string().max(20).nullish(),
    /** İşi isteyen eğitmen (curriculum_draft_retry): onun yüklemeleri kaynak olabilir. */
    requested_by: uuid.nullish(),
  }),
);

export type CurriculumDraftPayload = z.infer<typeof payload>;

export type DraftStatus = 'queued' | 'researching' | 'drafting' | 'saving' | 'ready' | 'failed' | 'skipped';

export interface CurriculumDraftResult {
  curriculum_id: string;
  status: 'ready' | 'skipped' | 'already_built';
  skills?: number;
  leaves?: number;
  prerequisites?: number;
  tags?: number;
  tags_dropped?: string[];
  autopilot?: boolean;
  suggestions?: number;
  superseded_by?: string;
  cost_usd?: number;
  prompt_versions?: Record<string, string>;
}

/** Durum yazımı (Realtime: curricula satırı güncellenir). */
export async function setDraftStatus(db: Db, id: string, status: DraftStatus, progress: number, error: string | null = null): Promise<void> {
  await db.query(
    `update public.curricula set draft_status = $2, draft_progress = $3, draft_error = $4, draft_updated_at = now() where id = $1`,
    [id, status, Math.max(0, Math.min(100, Math.round(progress))), error === null ? null : error.slice(0, 500)],
  );
}

interface CurriculumRow {
  id: string;
  code: string;
  label: string;
  status: string;
  origin: string;
  skills: number;
  course_title: string | null;
  course_kind: string | null;
}

async function loadCurriculum(db: Db, id: string): Promise<CurriculumRow | null> {
  const r = await db.query(
    `select c.id, c.code, c.label, c.status, c.origin,
            (select count(*)::int from public.skills s where s.curriculum_id = c.id) as skills,
            co.title as course_title, co.kind as course_kind
       from public.curricula c
       left join lateral (select x.title, x.kind from public.courses x where x.curriculum_id = c.id order by x.created_at limit 1) co on true
      where c.id = $1`,
    [id],
  );
  return (r.rows[0] as CurriculumRow | undefined) ?? null;
}

/** Aynı ders metnine (kod, ad ya da dersin adı/kodu) uyan BAŞKA bir aktif müfredat. */
async function findActiveTwin(db: Db, id: string, courseText: string): Promise<string | null> {
  const q = normText(courseText);
  const r = await db.query(
    `select c.id from public.curricula c
      where c.status = 'active' and c.id <> $1
        and (app.norm_text(c.code) = $2 or app.norm_text(c.label) = $2
             or exists (select 1 from public.courses co
                         where co.curriculum_id = c.id and (app.norm_text(co.code) = $2 or app.norm_text(co.title) = $2)))
      order by c.published_at desc nulls last, c.created_at desc limit 1`,
    [id, q],
  );
  return (r.rows[0]?.id as string | undefined) ?? null;
}

/**
 * Kaynak yüklemeleri: yalnız müfredatı açanın (curricula.created_by), işi isteyen eğitmenin (requested_by) ya da kayıtlı
 * öğrencinin (student_id) yüklemesi; PDF/metin ya da çıkarılmış metni olanlar (görsel file_id belge bloğunda 400 verir).
 * Süzülen kimlikler günlüğe yazılır.
 */
export async function loadUploads(
  db: Db,
  ids: readonly string[],
  owner: { curriculumId: string; studentId?: string | null; requestedBy?: string | null },
): Promise<UploadSource[]> {
  if (ids.length === 0) return [];
  const r = await db.query(
    `select u.id, u.kind, u.mime, coalesce(nullif(regexp_replace(u.storage_path, '^.*/', ''), ''), u.kind) as title,
            u.anthropic_file_id, u.extracted_text
       from public.uploads u
      where u.id = any($1::uuid[]) and u.status <> 'failed'
        and (u.owner_id = (select c.created_by from public.curricula c where c.id = $2)
             or ($3::uuid is not null and u.owner_id = $3::uuid)
             or ($4::uuid is not null and u.student_id = $4::uuid))
        and (${DOCUMENT_MIME_SQL} or nullif(btrim(u.extracted_text), '') is not null)
      order by array_position($1::uuid[], u.id)`,
    [ids, owner.curriculumId, owner.requestedBy ?? null, owner.studentId ?? null],
  );
  return r.rows as unknown as UploadSource[];
}

/** Ücretli çağrı izni (yalnız gerçek taşımada; sahte taşıma ücretsizdir). */
async function assertPaidAllowed(ctx: JobContext): Promise<void> {
  const r = await ctx.db.query(`select paid_allowed, state from public.check_spend('curriculum.draft')`);
  const row = r.rows[0] as { paid_allowed?: boolean; state?: string } | undefined;
  if (row && row.paid_allowed === false) {
    throw new PermanentJobError(`ücretli LLM çağrısı kapalı (${row.state ?? 'disabled'}); taslak eğitmen onayıyla yeniden başlatılır`, 'OGR-JOB-110');
  }
}

export async function runCurriculumDraft(p: CurriculumDraftPayload, ctx: JobContext): Promise<CurriculumDraftResult> {
  const cur = await loadCurriculum(ctx.db, p.curriculum_id);
  if (!cur) throw new PermanentJobError(`müfredat yok: ${p.curriculum_id}`, 'OGR-JOB-111');
  if (cur.skills > 0) {
    ctx.log.info('müfredat zaten kurulmuş; taslak üretilmedi', { curriculum: cur.id, skills: cur.skills });
    await ctx.db.query(`update public.curricula set draft_status = 'ready', draft_progress = 100, draft_error = null where id = $1 and draft_status is distinct from 'ready' and origin = 'ai_draft'`, [cur.id]);
    return { curriculum_id: cur.id, status: 'already_built', skills: cur.skills };
  }
  if (cur.status !== 'draft') throw new PermanentJobError(`müfredat taslak değil (${cur.status})`, 'OGR-JOB-111');

  const twin = await findActiveTwin(ctx.db, cur.id, p.course_text);
  if (twin) {
    const r = await ctx.db.query('select public.curriculum_draft_supersede($1, $2) as r', [cur.id, twin]);
    ctx.log.info('aynı ders için aktif müfredat var; taslak üretilmedi, kayıtlar taşındı', { curriculum: cur.id, target: twin, result: r.rows[0]?.r });
    return { curriculum_id: cur.id, status: 'skipped', superseded_by: twin };
  }

  const course: CourseContext = {
    courseText: p.course_text,
    courseTitle: cur.course_title ?? cur.label,
    courseKind: p.course_kind ?? cur.course_kind ?? 'other',
    targetExam: p.target_exam ?? examOf(p.course_text),
    prefix: codePrefix(p.course_text),
  };
  const gateway = await ctx.gateway();
  if (gateway.transport.kind !== 'fake') await assertPaidAllowed(ctx);
  const uploads = await loadUploads(ctx.db, p.upload_ids, { curriculumId: cur.id, studentId: p.student_id, requestedBy: p.requested_by });
  if (uploads.length < p.upload_ids.length) {
    const kept = new Set(uploads.map((u) => u.id));
    ctx.log.warn('kaynak yüklemelerinin bir kısmı kullanılmadı (sahiplik ya da tür)', { curriculum: cur.id, skipped: p.upload_ids.filter((x) => !kept.has(x)) });
  }

  await setDraftStatus(ctx.db, cur.id, 'researching', 10);
  const research = await routePrompt(ctx.db, 'curriculum_research');
  const ref = { table: 'curricula', id: cur.id };
  const res1 = await gateway.call('curriculum_research', {
    system: { product: research.text },
    user: researchMessage(course, uploads),
    promptVersion: research.version,
    ref,
    purpose: 'curriculum.draft',
    signal: ctx.signal,
  });
  if (res1.refusal) throw new PermanentJobError(`araştırma reddedildi (${res1.refusal.category ?? 'belirsiz'})`, 'OGR-JOB-112');
  const sourceRefs = citationRefs(res1.message.content);

  await setDraftStatus(ctx.db, cur.id, 'drafting', 45);
  const drafting = await routePrompt(ctx.db, 'curriculum_draft');
  const res2 = await gateway.call('curriculum_draft', {
    system: { product: drafting.text },
    user: [{ type: 'text', text: draftMessage(course, res1.text) }, ...documentBlocks(uploads)],
    promptVersion: drafting.version,
    ref,
    purpose: 'curriculum.draft',
    signal: ctx.signal,
  });
  const draft = res2.data as CurriculumDraft;
  const check = checkDraft(draft);
  if (!check.ok) throw new PermanentJobError(`taslak doğrulanamadı: ${check.problems.slice(0, 5).join('; ')}`, 'OGR-JOB-113');

  await setDraftStatus(ctx.db, cur.id, 'saving', 85);
  const costUsd = Number((res1.costUsd + res2.costUsd).toFixed(6));
  const meta = {
    source_refs: [
      ...sourceRefs,
      ...uploads.map((u) => ({ kind: 'upload', ref: u.id, title: u.title })),
    ],
    upload_ids: uploads.map((u) => u.id),
    research_chars: res1.text.length,
    model: res2.model,
    prompt_versions: { curriculum_research: research.version, curriculum_draft: drafting.version },
    cost_usd: costUsd,
    job_id: ctx.job.id,
  };
  const saved = await ctx.db.query('select public.save_curriculum_draft($1, $2::jsonb, $3::jsonb) as r', [cur.id, JSON.stringify(draft), JSON.stringify(meta)]);
  const r = (saved.rows[0]?.r ?? {}) as Record<string, unknown>;
  const tagsDropped = Array.isArray(r.tags_dropped) ? (r.tags_dropped as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  if (tagsDropped.length > 0) ctx.log.warn('yanılgı etiketleri çakıştı, yazılmadı', { curriculum: cur.id, tags: tagsDropped });
  ctx.log.info('müfredat taslağı kaydedildi', { curriculum: cur.id, ...check.stats, costUsd, autopilot: r.autopilot === true });
  // ilk öneri için soru bankasını ısıt (practice.prewarm; alıştırması açılamayan taslakta iş ücretli üretim yapmaz).
  // Otopilotta ilk kartı ekleyen app.first_practice_suggestion (0027) kartın yapraklarına ön ısıtmayı zaten attı.
  if (p.enrollment_id && !(Number(r.suggestions ?? 0) > 0)) {
    try {
      await ctx.enqueue('practice.prewarm', { enrollment_id: p.enrollment_id, reason: 'curriculum.draft' }, oncePer(`prewarm:${p.enrollment_id}:draft`, 3600));
    } catch (err) {
      ctx.log.warn('practice.prewarm kuyruğa atılamadı', { curriculum: cur.id, error: (err as Error).message });
    }
  }
  return {
    curriculum_id: cur.id,
    status: 'ready',
    skills: Number(r.skills ?? check.stats.nodes),
    leaves: Number(r.leaves ?? check.stats.leaves),
    prerequisites: Number(r.prerequisites ?? 0),
    tags: Number(r.tags ?? 0),
    tags_dropped: tagsDropped,
    autopilot: r.autopilot === true,
    suggestions: Number(r.suggestions ?? 0),
    cost_usd: costUsd,
    prompt_versions: meta.prompt_versions,
  };
}

/** Hata metni (öğrenciye/eğitmene görünür; kısa Türkçe, iç ayrıntı yok). */
export function draftErrorText(err: unknown): string {
  if (err instanceof PermanentJobError) return err.message;
  const c = classifyError(err);
  if (c.retryable) return 'Geçici bir sorun oldu; taslak yeniden deneniyor.';
  return err instanceof Error ? err.message.slice(0, 300) : 'Bilinmeyen hata';
}

const RETRY = { retryLimit: 3, retryDelay: 60, retryBackoff: true, retryDelayMax: 1800, expireInSeconds: 1800, deleteAfterSeconds: 7 * 86_400 };

export const curriculumDraftJob: JobDefinition<CurriculumDraftPayload, CurriculumDraftResult> = {
  name: 'curriculum.draft',
  description: 'Müfredat taslağı: araştırma (web) + curriculum-draft (Opus) → doğrulama → kazanımlar, BKT, ön koşullar, etiketler, ilk öneri.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: RETRY,
  handler: async (p, ctx) => {
    try {
      return await runCurriculumDraft(p, ctx);
    } catch (err) {
      const c = classifyError(err);
      // LLM/API hatası yeniden denenemezse (ret, bozuk çıktı, 4xx) kalıcıdır; veritabanı vb. hatalar pg-boss ile yeniden denenir
      const last = err instanceof PermanentJobError || ctx.job.retryCount >= RETRY.retryLimit || (c.code !== 'unknown' && !c.retryable);
      try {
        await setDraftStatus(ctx.db, p.curriculum_id, last ? 'failed' : 'queued', last ? 100 : 0, draftErrorText(err));
      } catch (e2) {
        ctx.log.error('taslak durumu yazılamadı', { error: (e2 as Error).message });
      }
      if (last && !(err instanceof PermanentJobError)) throw new PermanentJobError(draftErrorText(err), 'OGR-JOB-114');
      throw err;
    }
  },
};
