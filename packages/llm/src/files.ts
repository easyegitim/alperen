/**
 * code_execution çıktı dosyaları (PLAN-v2 §7 "çıktılar Files API ile indirilir"). Model konteynerde figür kodunu
 * çalıştırıp `figure_<n>.svg` yazınca yanıttaki `bash_code_execution_tool_result` (ya da eski
 * `code_execution_tool_result`) bloğu dosyanın `file_id`'sini taşır; dosya Files API'den indirilir.
 *
 *   const res = await gateway.call('notes_generation', { …, container });          // container: önceki çağrının
 *   const refs = collectOutputFiles(res.transcript);                               // tüm turlar (pause_turn dahil)
 *   const figures = await downloadFigureFiles(gateway.transport.files!, refs);    // { 'figure_1.svg': '<svg…' }
 *
 * Güvenlik: dosya adı modelin yazdığı addır; yalnız taban ad kullanılır (`/`, `\`, `.`, `..` reddedilir) ve
 * `match` desenine (varsayılan `figure_<n>.svg`) uymayan, `maxBytes`'ı aşan ya da indirilemeyen dosya atlanır
 * (`skipped`). İçerik veri olarak işlenir; SVG belgeye yazılmadan önce doc-render `sanitizeSvg` ile temizlenir.
 * Aynı ad birden çok kez üretildiyse (model kodu düzeltip yeniden çalıştırdı) sonuncusu kullanılır.
 */
import type { BetaContentBlock, BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { FIGURE_FILE } from '@ogrenmen/contracts';

/** Files API'nin kullandığımız dar yüzü (SDK `client.files`, GA; sahte taşımada bellek içi). */
export interface FilesClient {
  retrieveMetadata(fileId: string): Promise<{ id: string; filename: string; mime_type: string; size_bytes: number }>;
  download(fileId: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Dosyayı Files API deposundan siler (indirilen çıktılar öğrenciye özel olabilir; birikmesin). */
  delete?(fileId: string): Promise<unknown>;
}

export interface OutputFileRef {
  fileId: string;
  /** Dosyayı üreten sunucu aracı çağrısı. */
  toolUseId: string;
  /** bash (code_execution_20260120 kabuk/Python) ya da eski python sonucu. */
  source: 'bash' | 'python';
}

export interface DownloadedFile {
  fileId: string;
  /** Güvenli taban ad. */
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface SkippedFile {
  fileId: string;
  filename: string | null;
  reason: 'name' | 'pattern' | 'size' | 'error';
}

export interface DownloadOptions {
  /** Kabul edilen dosya adları (varsayılan `figure_<n>.svg`). */
  match?: RegExp;
  /** Dosya başına üst sınır (varsayılan 2 MB). */
  maxBytes?: number;
  /** İşlenen her dosyayı (kabul edilen ve atlanan) en iyi çabayla siler (varsayılan true). */
  deleteAfter?: boolean;
}

type Source = BetaMessage | readonly BetaMessageParam[] | readonly (BetaContentBlock | Record<string, unknown>)[];

function blocksOf(src: Source): unknown[] {
  if (!Array.isArray(src)) return [...(src as BetaMessage).content];
  return (src as readonly unknown[]).flatMap((x) => {
    const m = x as { role?: unknown; content?: unknown };
    if (typeof m.role === 'string' && 'content' in m) return Array.isArray(m.content) ? (m.content as unknown[]) : [];
    return [x];
  });
}

/** Yanıt, transcript ya da blok listesinden code_execution çıktı dosyalarını sırayla toplar (tekrarsız). */
export function collectOutputFiles(src: Source): OutputFileRef[] {
  const out: OutputFileRef[] = [];
  const seen = new Set<string>();
  for (const raw of blocksOf(src)) {
    const b = raw as { type?: string; tool_use_id?: string; content?: { type?: string; content?: unknown } };
    const kind =
      b.type === 'bash_code_execution_tool_result' && b.content?.type === 'bash_code_execution_result'
        ? 'bash'
        : b.type === 'code_execution_tool_result' && b.content?.type === 'code_execution_result'
          ? 'python'
          : null;
    if (!kind || !Array.isArray(b.content?.content)) continue;
    for (const f of b.content.content as { type?: string; file_id?: string }[]) {
      const ok = f.type === 'bash_code_execution_output' || f.type === 'code_execution_output';
      if (!ok || typeof f.file_id !== 'string' || seen.has(f.file_id)) continue;
      seen.add(f.file_id);
      out.push({ fileId: f.file_id, toolUseId: b.tool_use_id ?? '', source: kind });
    }
  }
  return out;
}

/** Modelin verdiği addan güvenli taban ad; geçersizse null. */
export function safeFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? '';
  if (base === '' || base === '.' || base === '..' || base.includes('\0')) return null;
  return base;
}

/** Dosyaları indirir; desen/boyut/ad kuralına uymayanlar `skipped`'e düşer. Aynı ad: sonuncusu kalır. */
export async function downloadOutputFiles(
  files: FilesClient,
  refs: readonly OutputFileRef[],
  opts: DownloadOptions = {},
): Promise<{ files: DownloadedFile[]; skipped: SkippedFile[] }> {
  const match = opts.match ?? FIGURE_FILE;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const byName = new Map<string, DownloadedFile>();
  const skipped: SkippedFile[] = [];
  const del = opts.deleteAfter ?? true;
  const cleanup = async (id: string): Promise<void> => {
    if (!del || !files.delete) return;
    try {
      await files.delete(id);
    } catch {
      /* en iyi çaba: silinemeyen dosya üretimi bozmaz */
    }
  };
  for (const ref of refs) {
    try {
      await one(ref);
    } finally {
      await cleanup(ref.fileId);
    }
  }
  return { files: [...byName.values()], skipped };

  async function one(ref: OutputFileRef): Promise<void> {
    let meta: Awaited<ReturnType<FilesClient['retrieveMetadata']>>;
    try {
      meta = await files.retrieveMetadata(ref.fileId);
    } catch {
      skipped.push({ fileId: ref.fileId, filename: null, reason: 'error' });
      return;
    }
    const filename = safeFileName(meta.filename);
    if (!filename) {
      skipped.push({ fileId: ref.fileId, filename: meta.filename, reason: 'name' });
      return;
    }
    if (!match.test(filename)) {
      skipped.push({ fileId: ref.fileId, filename, reason: 'pattern' });
      return;
    }
    if (meta.size_bytes > maxBytes) {
      skipped.push({ fileId: ref.fileId, filename, reason: 'size' });
      return;
    }
    try {
      const bytes = new Uint8Array(await (await files.download(ref.fileId)).arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        skipped.push({ fileId: ref.fileId, filename, reason: 'size' });
        return;
      }
      byName.delete(filename); // sıra: son üretilen sona
      byName.set(filename, { fileId: ref.fileId, filename, mimeType: meta.mime_type, bytes });
    } catch {
      skipped.push({ fileId: ref.fileId, filename, reason: 'error' });
    }
  }
}

/** Figür SVG'leri: dosya adı → UTF-8 metin (`figure_<n>.svg`). */
export async function downloadFigureFiles(
  files: FilesClient,
  src: Source | readonly OutputFileRef[],
  opts: Omit<DownloadOptions, 'match'> = {},
): Promise<{ svgs: Record<string, string>; skipped: SkippedFile[] }> {
  const refs = isRefList(src) ? src : collectOutputFiles(src as Source);
  const { files: got, skipped } = await downloadOutputFiles(files, refs, { ...opts, match: FIGURE_FILE });
  const dec = new TextDecoder('utf-8', { fatal: false });
  return { svgs: Object.fromEntries(got.map((f) => [f.filename, dec.decode(f.bytes)])), skipped };
}

function isRefList(x: unknown): x is readonly OutputFileRef[] {
  return Array.isArray(x) && x.every((r) => typeof (r as OutputFileRef).fileId === 'string' && 'toolUseId' in (r as object));
}
