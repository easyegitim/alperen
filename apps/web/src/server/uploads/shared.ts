// Yükle akışının saf kuralları: hem istemci (yukle-akisi.tsx) hem sunucu eylemi (actions.ts) kullanır; tarayıcıya
// gidebilir, bu yüzden 'server-only' değildir ve gizli bilgi içermez.

/** İki seçenek (PLAN-v2 §13 "Yükle"): Kendi çalışmam → teşhis; Okul denemesi → deneme kaydı (analiz P2). */
export const UPLOAD_KINDS = ['own_work', 'school_exam'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const UPLOAD_CHOICES: ReadonlyArray<{ value: UploadKind; label: string; sub: string }> = [
  { value: 'own_work', label: 'Kendi çalışmam', sub: 'Soru ve çözüm fotoğrafları' },
  { value: 'school_exam', label: 'Okul denemesi', sub: 'Kitapçık, optik form, karalama' },
];

export const UPLOAD_BUCKET = 'uploads';

export const UPLOAD_LIMITS = {
  /**
   * En çok sayfa, türe göre: Kendi çalışmam 4 (PLAN-v2 §2 Akış 1 "çözüm fotoğrafı ≤4"; worker diagnosis.run aynı),
   * Okul denemesi 40 (kitapçık + optik + karalama; worker upload.intake ve submit_upload aynı).
   */
  maxFiles: { own_work: 4, school_exam: 40 } as const satisfies Record<UploadKind, number>,
  /** Görselin uzun kenarı (px): istemci canvas ile küçültür (Claude görsel sınırı). */
  maxImageEdge: 2576,
  /** Küçültmeden önce kabul edilen ham görsel (bayt). */
  maxRawImageBytes: 25 * 1024 * 1024,
  /** PDF (bayt); kova sınırı 50 MB. */
  maxPdfBytes: 20 * 1024 * 1024,
  /** Gönderilen tek dosya (bayt). */
  maxStoredBytes: 20 * 1024 * 1024,
  jpegQuality: 0.85,
} as const;

/** Kovaya giden türler (0015_storage.sql allowed_mime_types alt kümesi). Küçültülen görsel her zaman JPEG olur. */
export const STORED_MIME = ['image/jpeg', 'application/pdf'] as const;
export type StoredMime = (typeof STORED_MIME)[number];

export function maxFilesFor(kind: UploadKind): number {
  return UPLOAD_LIMITS.maxFiles[kind];
}

export function isUploadKind(v: unknown): v is UploadKind {
  return typeof v === 'string' && (UPLOAD_KINDS as readonly string[]).includes(v);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * Storage nesne adı: '<owner_id>/<upload_id>.<jpg|pdf>'. İlk klasör yükleyenin auth.uid()'i olmalı: Storage politikası
 * (0018 ogrenmen_uploads_insert) ve uploads_path_owner CHECK'i (0007) bunu ister.
 */
export function uploadPath(ownerId: string, uploadId: string, mime: StoredMime): string {
  if (!isUuid(ownerId) || !isUuid(uploadId)) throw new Error('geçersiz kimlik');
  return `${ownerId}/${uploadId}.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`;
}

/** Uzun kenarı `max`'ı aşmayacak boyut (oran korunur, büyütme yok). */
export function fitWithin(width: number, height: number, max: number = UPLOAD_LIMITS.maxImageEdge): { width: number; height: number; scaled: boolean } {
  if (!(width > 0 && height > 0)) return { width: 0, height: 0, scaled: false };
  const long = Math.max(width, height);
  if (long <= max) return { width: Math.round(width), height: Math.round(height), scaled: false };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

/** Sunucuya gelen tek dosyanın üst verisi (baytlar istemciden doğrudan Storage'a gider). */
export interface SubmittedFile {
  id: string;
  path: string;
  mime: StoredMime;
  bytes: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
  pages: number | null;
}

export interface SubmitInput {
  kind: UploadKind;
  files: SubmittedFile[];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function intOrNull(v: unknown, max: number): number | null | undefined {
  if (v === null || v === undefined) return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
}

/** Sunucu eylemi girdisini doğrular; yol sahibin klasöründe ve kimlikle aynı olmalı. Hata metni öğrenciye gösterilir. */
export function parseSubmitInput(raw: unknown, ownerId: string): ParseResult<SubmitInput> {
  const bad = (error: string): ParseResult<SubmitInput> => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return bad('Gönderim okunamadı.');
  const r = raw as { kind?: unknown; files?: unknown };
  if (!isUploadKind(r.kind)) return bad('Ne yüklediğini seç: Kendi çalışmam ya da Okul denemesi.');
  if (!Array.isArray(r.files) || r.files.length === 0) return bad('En az bir sayfa ekle.');
  if (r.files.length > maxFilesFor(r.kind)) return bad(`En çok ${maxFilesFor(r.kind)} sayfa gönderebilirsin.`);
  const files: SubmittedFile[] = [];
  const seen = new Set<string>();
  for (const f of r.files as Record<string, unknown>[]) {
    if (!f || typeof f !== 'object' || !isUuid(f.id) || seen.has(f.id)) return bad('Sayfa kimliği geçersiz.');
    seen.add(f.id);
    const mime = f.mime;
    if (mime !== 'image/jpeg' && mime !== 'application/pdf') return bad('Yalnız fotoğraf ya da PDF gönderebilirsin.');
    if (f.path !== uploadPath(ownerId, f.id, mime)) return bad('Sayfa yolu geçersiz.');
    if (typeof f.bytes !== 'number' || !Number.isInteger(f.bytes) || f.bytes <= 0 || f.bytes > UPLOAD_LIMITS.maxStoredBytes) return bad('Dosya çok büyük.');
    const width = intOrNull(f.width, 20_000);
    const height = intOrNull(f.height, 20_000);
    const pages = intOrNull(f.pages, 500);
    if (width === undefined || height === undefined || pages === undefined) return bad('Sayfa bilgisi geçersiz.');
    const sha = f.sha256 === null || f.sha256 === undefined ? null : typeof f.sha256 === 'string' && /^[0-9a-f]{64}$/.test(f.sha256) ? f.sha256 : undefined;
    if (sha === undefined) return bad('Sayfa bilgisi geçersiz.');
    files.push({ id: f.id, path: f.path, mime, bytes: f.bytes, sha256: sha, width, height, pages });
  }
  return { ok: true, value: { kind: r.kind, files } };
}

/** Bekleme/sonuç ekranının adresi. */
export function resultHref(firstUploadId: string, kind: UploadKind): string {
  return `/ogrenci/sonuc?yukleme=${encodeURIComponent(firstUploadId)}${kind === 'school_exam' ? '&tur=deneme' : ''}`;
}
