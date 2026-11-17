/** Dışa aktarma dosya adı (web ile aynı biçim): aura-verilerim-YYYY-MM-DD.json. Saf; test edilir. */
export function exportFileName(date: Date = new Date()): string {
  return `aura-verilerim-${date.toISOString().slice(0, 10)}.json`;
}

/** content-disposition başlığından dosya adı; yoksa varsayılan. */
export function fileNameFromDisposition(header: string | null | undefined, fallback: string): string {
  const m = header?.match(/filename="([^"]+)"/);
  return m?.[1] ?? fallback;
}
