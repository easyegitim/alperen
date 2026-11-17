/**
 * Çıkmış sınav dosyaları → model sayfaları (style.ingest 1. adım).
 *
 *   Storage varsa: dosya indirilir; PDF `pdftoppm -r 150 -png` ile sayfa görüntülerine bölünür (poppler-utils; en çok
 *   MAX_PDF_PAGES sayfa), fotoğraf ve PDF sayfası sharp ile normalleştirilir (exam/images.ts: EXIF, fotoğrafta eğrilik,
 *   ≤ 2576 px, JPEG q85) ve Files API'ye çıkar (sahte taşımada ağsız deterministik kimlik).
 *   pdftoppm yoksa ya da PDF bölünemezse PDF olduğu gibi document bloğu olarak gider (uyarı).
 *   Storage yoksa (yerel geliştirme, sahte LLM): her yükleme tek sayfa sayılır; PDF document bloğu, fotoğraf image bloğu
 *   olarak gider (gerçek taşımada Files API bayt ister: OGR-JOB-151).
 * Sayfa sırası: yükleme sırası, PDF'in içinde sayfa sırası. Toplam MAX_ARCHIVE_PAGES sayfayı aşan kısım atlanır (uyarı).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Gateway } from '@ogrenmen/llm';
import type { PageUpload } from '../exam/db.js';
import { normalizePage } from '../exam/images.js';
import { uploadFile } from '../exam/llm.js';
import { UPLOAD_BUCKET } from '../jobs/diagnosis.js';
import type { StorageLike } from '../storage.js';

export const MAX_PDF_PAGES = 40;
export const MAX_ARCHIVE_PAGES = 80;
export const PDF_DPI = 150;

export interface ArchivePage {
  uploadId: string;
  /** 1'den başlayan genel sıra (yükleme sırası, PDF içinde sayfa sırası). */
  order: number;
  total: number;
  mime: string;
  fileId: string;
}

export interface PdfRasterizer {
  (pdf: Buffer, opts: { dpi: number; maxPages: number }, signal?: AbortSignal): Promise<Buffer[]>;
}

function run(cmd: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000, ...(signal ? { signal } : {}) }, (err, _out, stderr) => {
      if (err) reject(new Error(`${cmd} çalışmadı: ${String(stderr || err.message).trim().slice(-300)}`));
      else resolve();
    });
  });
}

/** `pdftoppm` ile PDF → PNG sayfaları (sıra korunur). */
export const pdftoppmRasterizer: PdfRasterizer = async (pdf, opts, signal) => {
  const dir = await mkdtemp(join(tmpdir(), 'ogrenmen-pdf-'));
  try {
    const src = join(dir, 'in.pdf');
    await writeFile(src, pdf);
    await run(process.env.OGRENMEN_PDFTOPPM || 'pdftoppm', ['-r', String(opts.dpi), '-png', '-f', '1', '-l', String(opts.maxPages), src, join(dir, 'p')], signal);
    const files = (await readdir(dir)).filter((f) => /^p-\d+\.png$/.test(f)).sort((a, b) => Number(a.slice(2, -4)) - Number(b.slice(2, -4)));
    return Promise.all(files.map((f) => readFile(join(dir, f))));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export const isPdf = (u: Pick<PageUpload, 'mime' | 'kind' | 'storage_path'>) =>
  u.mime === 'application/pdf' || u.kind === 'pdf' || /\.pdf$/i.test(u.storage_path);

export interface LoadPagesInput {
  gateway: Gateway;
  storage: StorageLike | null;
  uploads: readonly PageUpload[];
  sourceId: string;
  rasterize?: PdfRasterizer;
  signal?: AbortSignal;
}

export async function loadArchivePages(inp: LoadPagesInput): Promise<{ pages: ArchivePage[]; warnings: string[] }> {
  const warnings: string[] = [];
  const raw: { uploadId: string; mime: string; bytes: Buffer | null; seed: string }[] = [];
  for (const u of inp.uploads) {
    if (raw.length >= MAX_ARCHIVE_PAGES) {
      warnings.push(`en çok ${MAX_ARCHIVE_PAGES} sayfa okunur; kalan dosyalar atlandı`);
      break;
    }
    if (!inp.storage) {
      raw.push({ uploadId: u.id, mime: isPdf(u) ? 'application/pdf' : (u.mime ?? 'image/jpeg'), bytes: null, seed: `${inp.sourceId}:${u.id}` });
      continue;
    }
    const bytes = await inp.storage.download(UPLOAD_BUCKET, u.storage_path);
    if (isPdf(u)) {
      const left = Math.min(MAX_PDF_PAGES, MAX_ARCHIVE_PAGES - raw.length);
      let pngs: Buffer[];
      try {
        pngs = await (inp.rasterize ?? pdftoppmRasterizer)(bytes, { dpi: PDF_DPI, maxPages: left }, inp.signal);
      } catch (err) {
        // pdftoppm yok ya da PDF bölünemedi: PDF olduğu gibi document bloğu olarak gider (model PDF'i kendisi okur)
        warnings.push(`PDF sayfalara bölünemedi, belge olarak okunuyor (${(err as Error).message.slice(0, 120)})`);
        raw.push({ uploadId: u.id, mime: 'application/pdf', bytes, seed: `${inp.sourceId}:${u.id}` });
        continue;
      }
      if (pngs.length === 0) warnings.push(`PDF sayfasız ya da okunamadı (${u.id})`);
      for (const [i, png] of pngs.entries()) {
        const img = await normalizePage(png, { deskew: false });
        raw.push({ uploadId: u.id, mime: img.mime, bytes: img.bytes, seed: `${inp.sourceId}:${u.id}:${i + 1}` });
      }
    } else {
      const img = await normalizePage(bytes);
      raw.push({ uploadId: u.id, mime: img.mime, bytes: img.bytes, seed: `${inp.sourceId}:${u.id}` });
    }
  }
  const pages: ArchivePage[] = [];
  for (const [i, r] of raw.slice(0, MAX_ARCHIVE_PAGES).entries()) {
    const ext = r.mime === 'application/pdf' ? 'pdf' : 'jpg';
    const fileId = await uploadFile(inp.gateway, r.bytes, `arsiv-${inp.sourceId}-${i + 1}.${ext}`, r.mime, r.seed);
    pages.push({ uploadId: r.uploadId, order: i + 1, total: Math.min(raw.length, MAX_ARCHIVE_PAGES), mime: r.mime, fileId });
  }
  return { pages, warnings };
}
