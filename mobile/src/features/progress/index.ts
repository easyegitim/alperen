// İlerleme fotoğrafı dizini (SPEC 11.2, SPEC-MOBILE M7; CONTRACTS_V2 S3.3.4): meta veriler JSON dizinde, görseller
// uygulama sanal alanında. `ghost`: önceki çekimin 43 noktalık yüz çizgisi (hayalet kılavuz) — yalnız cihazda, hiçbir
// isteğe/analitiğe/loga girmez. Saf; birim testli.
import { parseGhostOutline, type GhostOutline } from "@/lib/face/ghostGuide";

export type ProgressEntry = { id: string; file: string; takenAt: number; analysisId?: string; note?: string; ghost?: GhostOutline };
export type ProgressIndex = { version: 1; items: ProgressEntry[] };

export const EMPTY_INDEX: ProgressIndex = { version: 1, items: [] };

function cleanEntry(i: unknown): ProgressEntry | null {
  if (!i || typeof i !== "object") return null;
  const r = i as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.file !== "string") return null;
  const ghost = r.ghost === undefined ? null : parseGhostOutline(r.ghost);
  return {
    id: r.id,
    file: r.file,
    takenAt: typeof r.takenAt === "number" ? r.takenAt : 0,
    ...(typeof r.analysisId === "string" ? { analysisId: r.analysisId } : {}),
    ...(typeof r.note === "string" ? { note: r.note } : {}),
    ...(ghost ? { ghost } : {}),
  };
}

export function parseIndex(raw: string | null | undefined): ProgressIndex {
  if (!raw) return EMPTY_INDEX;
  try {
    const v = JSON.parse(raw) as Partial<ProgressIndex>;
    if (v && v.version === 1 && Array.isArray(v.items)) return { version: 1, items: v.items.map(cleanEntry).filter((e): e is ProgressEntry => e !== null) };
  } catch {
    // bozuk dizin: boş kabul edilir, dosyalar temizlikte silinir
  }
  return EMPTY_INDEX;
}

export function serializeIndex(index: ProgressIndex): string {
  return JSON.stringify(index);
}

export function addEntry(index: ProgressIndex, entry: ProgressEntry): ProgressIndex {
  return { version: 1, items: [...index.items.filter((i) => i.id !== entry.id), entry].sort((a, b) => b.takenAt - a.takenAt) };
}

export function removeEntry(index: ProgressIndex, id: string): ProgressIndex {
  return { version: 1, items: index.items.filter((i) => i.id !== id) };
}

export function setNote(index: ProgressIndex, id: string, note: string): ProgressIndex {
  const trimmed = note.trim().slice(0, 120);
  return { version: 1, items: index.items.map((i) => (i.id === id ? { ...i, note: trimmed || undefined } : i)) };
}

/** Dizinde olmayan dosyalar (yetim) silinmelidir. */
export function orphanFiles(index: ProgressIndex, files: string[]): string[] {
  const known = new Set(index.items.map((i) => i.file));
  return files.filter((f) => f !== "index.json" && !known.has(f));
}

/** En son çekimin hayalet kılavuzu (yeniden analizde kamera üstüne silik çizgi); yoksa null. */
export function latestGhost(index: ProgressIndex): GhostOutline | null {
  const withGhost = [...index.items].sort((a, b) => b.takenAt - a.takenAt).find((i) => i.ghost);
  return withGhost?.ghost ?? null;
}
