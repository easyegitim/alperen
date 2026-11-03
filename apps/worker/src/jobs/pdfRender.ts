import { z } from 'zod';
import { PdfRenderError } from '../pdf/render.js';
import { assertStoragePath } from '../storage.js';
import { PermanentJobError } from './errors.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const storageRef = z.object({ bucket: z.string().min(1).max(64).optional(), path: z.string().min(1).max(512) });

const payload = acceptCamelAliases(
  { documentId: 'document_id' },
  z
  .object({
    /** HTML doğrudan (küçük belgeler; büyükler için `htmlRef`). */
    html: z.string().min(1).max(2_000_000).optional(),
    /** Storage'daki HTML (generated_documents.html_path). */
    htmlRef: storageRef.optional(),
    /** PDF'in yazılacağı yer (kova varsayılanı STORAGE_BUCKET_DOCUMENTS). */
    output: storageRef,
    /** Verilirse `generated_documents.pdf_path` güncellenir ve durum `rendered`a ilerler. */
    document_id: uuid.optional(),
    options: z
      .object({
        format: z.enum(['A4', 'A3', 'Letter']).optional(),
        landscape: z.boolean().optional(),
        printBackground: z.boolean().optional(),
        displayHeaderFooter: z.boolean().optional(),
        headerTemplate: z.string().max(20_000).optional(),
        footerTemplate: z.string().max(20_000).optional(),
        allowedHosts: z.array(z.string().max(253)).max(10).optional(),
      })
      .optional(),
  })
  .refine((p) => Boolean(p.html) !== Boolean(p.htmlRef), { message: 'html ile htmlRef\'ten tam biri verilmeli' })
  .refine((p) => !p.document_id || !p.output.bucket, { message: 'document_id verilince output.bucket verilemez (belge PDF\'leri STORAGE_BUCKET_DOCUMENTS kovasındadır)' }),
);

export interface PdfRenderJobResult {
  bucket: string;
  path: string;
  pages: number;
  bytes: number;
}

/** HTML → A4 PDF (Playwright) → Storage. Yalnız `pdf` süreci çalıştırır (Chromium orada kurulu). */
export const pdfRenderJob: JobDefinition<z.infer<typeof payload>, PdfRenderJobResult> = {
  name: 'pdf.render',
  description: 'HTML → PDF (Playwright Chromium, A4) → Supabase Storage; isteğe bağlı generated_documents.pdf_path.',
  process: 'pdf',
  payload,
  concurrency: (c) => c.pdfConcurrency,
  retry: { retryLimit: 2, retryDelay: 15, retryBackoff: true, retryDelayMax: 300, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    const bucket = p.output.bucket ?? ctx.config.documentsBucket;
    try {
      assertStoragePath(p.output.path);
      if (p.htmlRef) assertStoragePath(p.htmlRef.path);
    } catch (err) {
      throw new PermanentJobError((err as Error).message, 'OGR-PDF-001');
    }
    const storage = ctx.storage();
    const html = p.html ?? (await storage.download(p.htmlRef?.bucket ?? ctx.config.documentsBucket, p.htmlRef?.path ?? '')).toString('utf8');

    let out;
    try {
      out = await ctx.pdf.render(html, p.options);
    } catch (err) {
      // Boş HTML gibi girdi hataları yeniden denenmez; tarayıcı/zaman aşımı hataları denenir.
      if (err instanceof PdfRenderError && /HTML boş/.test(err.message)) throw new PermanentJobError(err.message, 'OGR-PDF-002');
      throw err;
    }
    await storage.upload(bucket, p.output.path, out.pdf, 'application/pdf');
    if (p.document_id) {
      await ctx.db.query(`update public.generated_documents
         set pdf_path = $2, status = case when status in ('queued','generating') then 'rendered' else status end
         where id = $1::uuid`, [p.document_id, p.output.path]);
    }
    ctx.log.info('pdf üretildi', { pages: out.pages, bytes: out.bytes });
    return { bucket, path: p.output.path, pages: out.pages, bytes: out.bytes };
  },
};
