import { z } from 'zod';
import { MEMORY_COMPACT_ACTOR, MEMORY_CONFLICT_CODE, memoryContentHash, MemoryError, PgStore, type BatchItem, type BatchItemMeta, type Gateway } from '@ogrenmen/llm';
import { systemPrompt } from '../prompts.js';
import { nextIstanbulTime } from '../schedules.js';
import { PermanentJobError } from './errors.js';
import { oncePer } from './dedupe.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

/** Bu boyutun üstündeki dosya sıkıştırılır (PLAN-v2 §3.4: > 6 KB → ≤ 4 KB). */
export const COMPACT_ABOVE_BYTES = 6 * 1024;
export const COMPACT_TARGET_BYTES = 4 * 1024;
/** Bir gecede en çok bu kadar öğrenci (Batch öğesi). */
export const COMPACT_MAX_STUDENTS = 500;
/** Batch sonucu bekleme: 10 dk arayla en çok 24 saat. */
export const COLLECT_DELAY_SEC = 600;
export const COLLECT_MAX_ATTEMPTS = 144;

const metaSchema = z.record(
  z.string(),
  z.object({
    ref: z.object({ table: z.string(), id: z.string() }).nullable().optional(),
    studentRef: z.string().nullable().optional(),
    promptVersion: z.string().nullable().optional(),
  }),
);

const payload = acceptCamelAliases(
  { studentId: 'student_id', batchId: 'batch_id' },
  z.object({
    /** Tek öğrenci; verilmezse gece çalışması (tüm öğrenciler + gece zinciri). */
    student_id: uuid.optional(),
    /** Toplama aşaması: gönderilmiş Batch. */
    batch_id: z.string().min(1).max(200).optional(),
    meta: metaSchema.optional(),
    /** Gönderim anındaki içerik hash'leri (öğrenci → yol → md5): toplamada yalnız değişmemiş dosyalar yazılır. */
    hashes: z.record(z.string(), z.record(z.string(), z.string().regex(/^[0-9a-f]{32}$/))).optional(),
    attempt: z.number().int().min(0).max(1000).optional(),
    /** Gece zincirini (conversation.summarize, suggestions.refresh) kurma. */
    no_chain: z.boolean().optional(),
  }),
);

export type MemoryCompactResult =
  | { phase: 'submit'; students: number; files: number; batchId: string | null; chained: string[] }
  | { phase: 'collect'; pending: true; attempt: number }
  | { phase: 'collect'; pending: false; compacted: number; failed: number; retriedSync: number; deferred: number };

/** Promptu henüz packages/prompts'ta olmayan rota için yedek sistem metni (worker-memory_compaction). */
export const MEMORY_COMPACTION_FALLBACK = [
  'Sen Öğrenmen adlı eğitim koçunun hafıza düzenleyicisisin. Öğrenci başına tutulan hafıza dosyaları koçun her sohbette okuduğu kısa notlardır; öğrenci de bunları Profil ekranında görebilir.',
  'Kullanıcı mesajında bir öğrencinin büyümüş hafıza dosyaları JSON olarak gelir: her biri için yol, bayt sayısı ve içerik. Her dosyayı aynı yol ile, anlamını koruyarak ve en çok 4 KB (4096 bayt, UTF-8) olacak biçimde yeniden yazarsın.',
  'Korunacaklar: tarihli tekrar eden hata örüntüleri (patterns.md en çok 12 örüntü; her satır tanım · kazanım kodu · sayı · tarihler), öğrencinin açıkça söylediği tercihler, hedefler, işe yarayan açıklamalar ve eğitmenin vurguları. Birleştirilecekler: aynı örüntünün tekrarları tek satırda, sayıları toplanmış ve en son tarihler korunmuş biçimde. Atılacaklar: eskimiş ya da çözülmüş notlar, tekrarlar, uzun alıntılar.',
  'Yeni bilgi uydurmazsın; dosyada olmayan bir şeyi eklemezsin. Ad, okul ya da kişisel ayrıntı yazmazsın; öğrenciden "öğrenci" diye söz edersin. Biçim düz Markdown satırlarıdır; ünlem ve emoji kullanmazsın.',
  'Çıktı yalnız gönderilen dosyaları içerir (files dizisi: path ve content). Her içerik 4 KB sınırının belirgin biçimde altında olur; sınır aşılırsa dosya yazılmaz ve hafıza büyümeye devam eder.',
].join('\n\n');

interface Candidate {
  studentId: string;
  studentRef: string;
  files: { path: string; bytes: number; content: string }[];
}

async function candidates(ctx: JobContext, studentId?: string): Promise<Candidate[]> {
  const r = await ctx.db.query(
    `select mf.student_id, s.public_ref, mf.path, mf.bytes, mf.content
       from public.memory_files mf join public.students s on s.id = mf.student_id
      where mf.bytes > $1 and mf.path <> '/memories/parent_summary.md' ${studentId ? 'and mf.student_id = $2::uuid' : ''}
      order by mf.student_id, mf.path`,
    studentId ? [COMPACT_ABOVE_BYTES, studentId] : [COMPACT_ABOVE_BYTES],
  );
  const by = new Map<string, Candidate>();
  for (const row of r.rows) {
    const id = String(row.student_id);
    const c = by.get(id) ?? { studentId: id, studentRef: String(row.public_ref), files: [] };
    c.files.push({ path: String(row.path), bytes: Number(row.bytes), content: String(row.content) });
    by.set(id, c);
  }
  return [...by.values()].slice(0, COMPACT_MAX_STUDENTS);
}

const customIdOf = (studentId: string) => `mc-${studentId}`;
const studentOf = (customId: string) => (customId.startsWith('mc-') ? customId.slice(3) : null);

function itemInput(c: Candidate, system: { text: string; version: string }): BatchItem['input'] {
  return {
    system: { product: system.text },
    user: JSON.stringify({ limit_bytes: COMPACT_TARGET_BYTES, files: c.files }),
    studentRef: c.studentRef,
    promptVersion: system.version,
    ref: { table: 'students', id: c.studentId },
    purpose: 'memory.compact',
  };
}

/**
 * Sıkıştırılmış dosyaları yazar. `expected`: yol → modele giden içeriğin md5'i; yalnız bu yollar yazılır (model başka
 * yol üretirse yok sayılır) ve yazım koşulludur: o arada koç ya da memory-delta dosyayı değiştirdiyse (OGR-MEM-028)
 * dosya bu gece yazılmaz, güncel içerik ertesi gece yeniden sıkıştırılır. Hiçbir düzenleme sessizce silinmez.
 */
async function writeCompacted(ctx: JobContext, studentId: string, files: readonly { path: string; content: string }[], expected: ReadonlyMap<string, string>) {
  const store = new PgStore(ctx.db);
  let ok = 0;
  let failed = 0;
  let conflicts = 0;
  for (const f of files) {
    const hash = expected.get(f.path);
    if (hash === undefined || Buffer.byteLength(f.content, 'utf8') > COMPACT_TARGET_BYTES) {
      failed++;
      continue;
    }
    try {
      await store.write(studentId, f.path, f.content, 'compact', MEMORY_COMPACT_ACTOR, { expectedHash: hash });
      ok++;
    } catch (err) {
      if (!(err instanceof MemoryError)) throw err;
      if (err.code === MEMORY_CONFLICT_CODE) conflicts++;
      else {
        ctx.log.warn('memory.compact yazılamadı', { path: f.path, code: err.code });
        failed++;
      }
    }
  }
  return { ok, failed, conflicts };
}

const hashMap = (files: readonly { path: string; content: string }[]) => new Map(files.map((f) => [f.path, memoryContentHash(f.content)]));

async function submit(p: z.infer<typeof payload>, ctx: JobContext): Promise<MemoryCompactResult> {
  const chained: string[] = [];
  if (!p.student_id && !p.no_chain) {
    // Gece zinciri (03:00): sohbet özetleri hemen, Bugün kartları 03:30'da (pg_cron yalnız memory.compact'ı zamanlar).
    // 12 saatlik dilimde bir kez: bu iş yeniden denenirse zincir yinelenmez.
    await ctx.enqueue('conversation.summarize', {}, oncePer('nightly:conversation.summarize'));
    chained.push('conversation.summarize');
    await ctx.enqueue('suggestions.refresh', { reason: 'nightly' }, { startAfter: nextIstanbulTime(ctx.now(), 3, 30), ...oncePer('nightly:suggestions.refresh') });
    chained.push('suggestions.refresh@03:30');
  }
  const list = await candidates(ctx, p.student_id);
  if (list.length === 0) return { phase: 'submit', students: 0, files: 0, batchId: null, chained };
  const system = await systemPrompt(ctx.db, 'memory_compaction', { name: 'memory_compaction', text: MEMORY_COMPACTION_FALLBACK });
  const gateway = await ctx.gateway();
  const { batch, meta } = await gateway.submitBatch(
    'memory_compaction',
    list.map((c) => ({ customId: customIdOf(c.studentId), input: itemInput(c, system) })),
  );
  const hashes = Object.fromEntries(list.map((c) => [c.studentId, Object.fromEntries(hashMap(c.files))]));
  await ctx.enqueue('memory.compact', { batch_id: batch.id, meta, hashes, attempt: 0 }, { startAfter: 60 });
  const files = list.reduce((n, c) => n + c.files.length, 0);
  ctx.log.info('memory.compact Batch gönderildi', { batchId: batch.id, students: list.length, files });
  return { phase: 'submit', students: list.length, files, batchId: batch.id, chained };
}

async function collect(p: z.infer<typeof payload>, ctx: JobContext): Promise<MemoryCompactResult> {
  const gateway: Gateway = await ctx.gateway();
  const attempt = p.attempt ?? 0;
  const b = await gateway.transport.batches.retrieve(p.batch_id!);
  if (b.processing_status !== 'ended') {
    if (attempt + 1 >= COLLECT_MAX_ATTEMPTS) throw new PermanentJobError(`memory.compact: batch ${p.batch_id} 24 saatte bitmedi (${b.processing_status})`, 'OGR-JOB-110');
    await ctx.enqueue('memory.compact', { batch_id: p.batch_id, meta: p.meta ?? {}, ...(p.hashes ? { hashes: p.hashes } : {}), attempt: attempt + 1 }, { startAfter: COLLECT_DELAY_SEC });
    return { phase: 'collect', pending: true, attempt: attempt + 1 };
  }
  const results = await gateway.collectBatch('memory_compaction', p.batch_id!, (p.meta ?? {}) as Record<string, BatchItemMeta>);
  let compacted = 0;
  let failed = 0;
  let retriedSync = 0;
  let deferred = 0;
  const system = await systemPrompt(ctx.db, 'memory_compaction', { name: 'memory_compaction', text: MEMORY_COMPACTION_FALLBACK });
  for (const r of results) {
    const studentId = studentOf(r.customId);
    if (!studentId) continue;
    // Gönderildiğinden (≤ 24 sa) beri değişmiş olabilir: güncel büyük dosyalar yeniden okunur. Batch çıktısı yalnız
    // içeriği gönderilenle aynı kalan dosyalara yazılır; değişenler güncel içerikle senkron yeniden sıkıştırılır.
    const [cur] = await candidates(ctx, studentId);
    if (!cur) continue;
    const sentHashes = p.hashes?.[studentId] ?? {};
    const unchanged = cur.files.filter((f) => sentHashes[f.path] === memoryContentHash(f.content));
    const changed = cur.files.filter((f) => sentHashes[f.path] !== memoryContentHash(f.content));
    const batchFiles = r.status === 'ok' ? (r.data?.files ?? null) : null;
    if (batchFiles && unchanged.length > 0) {
      const w = await writeCompacted(ctx, studentId, batchFiles, hashMap(unchanged));
      compacted += w.ok;
      failed += w.failed;
      deferred += w.conflicts;
    }
    // bad_output / max_tokens / error / pause_turn (Batch içinde onarım yok) ya da gönderimden sonra değişen dosyalar
    // → güncel içerikle senkron yeniden gönderim (batchRetry); sınır dolduysa ertesi geceye kalır.
    const redo = batchFiles ? changed : cur.files;
    if (redo.length === 0) continue;
    if (retriedSync >= 20) {
      deferred += redo.length;
      continue;
    }
    retriedSync++;
    let files: { path: string; content: string }[] | null = null;
    try {
      const res = await gateway.call('memory_compaction', { ...itemInput({ ...cur, files: redo }, system), batchRetry: true, signal: ctx.signal });
      files = res.data?.files ?? null;
    } catch (err) {
      ctx.log.warn('memory.compact senkron yeniden deneme düştü', { error: (err as Error).message });
    }
    if (!files) {
      failed += redo.length;
      continue;
    }
    const w = await writeCompacted(ctx, studentId, files, hashMap(redo));
    compacted += w.ok;
    failed += w.failed;
    deferred += w.conflicts;
  }
  ctx.log.info('memory.compact toplandı', { batchId: p.batch_id, compacted, failed, retriedSync, deferred });
  return { phase: 'collect', pending: false, compacted, failed, retriedSync, deferred };
}

/**
 * Gece hafıza sıkıştırma (Sonnet 5.5, `memory_compaction` Batch rotası): > 6 KB dosyalar ≤ 4 KB'a yeniden yazılır
 * (`PgStore.write(…, 'compact', 'memory-compact')`, sürüm satırıyla). İki aşamalı: gönder (Batch) → topla (aynı iş,
 * `batch_id` ile; bitmediyse 10 dk sonra yeniden). Gece çalışması (yüksüz) ayrıca zinciri kurar: conversation.summarize
 * ve 03:30'da suggestions.refresh.
 */
export const memoryCompactJob: JobDefinition<z.infer<typeof payload>, MemoryCompactResult> = {
  name: 'memory.compact',
  description: 'Gece hafıza sıkıştırma (Batch, > 6 KB → ≤ 4 KB) + gece zinciri.',
  process: 'worker',
  payload,
  concurrency: 1,
  retry: { retryLimit: 2, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 1800, deleteAfterSeconds: 604_800 },
  handler: async (p, ctx) => (p.batch_id ? collect(p, ctx) : submit(p, ctx)),
};
