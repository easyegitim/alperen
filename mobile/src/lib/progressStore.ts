// SPEC 11.2 / SPEC-MOBILE M7: ilerleme fotoğrafları yalnız cihazda (uygulama belge dizini). Hiçbir fonksiyon ağa çıkmaz.
import { Directory, File, Paths } from "expo-file-system";
import type { GhostOutline } from "@/lib/face/ghostGuide";
import { addEntry, latestGhost, orphanFiles, parseIndex, removeEntry, serializeIndex, setNote, type ProgressEntry, type ProgressIndex } from "@/mobile/src/features/progress";

const DIR_NAME = "progress";
const INDEX_NAME = "index.json";

function dir(): Directory {
  const d = new Directory(Paths.document, DIR_NAME);
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
}

async function readIndex(d: Directory): Promise<ProgressIndex> {
  const f = new File(d, INDEX_NAME);
  if (!f.exists) return parseIndex(null);
  return parseIndex(await f.text().catch(() => null));
}

function writeIndex(d: Directory, index: ProgressIndex): void {
  new File(d, INDEX_NAME).write(serializeIndex(index));
}

export type ProgressPhoto = ProgressEntry & { uri: string };

function toPhoto(d: Directory, e: ProgressEntry): ProgressPhoto {
  return { ...e, uri: new File(d, e.file).uri };
}

export type AddProgressOptions = { analysisId?: string; /** Hayalet kılavuz (CONTRACTS_V2 S3.3.4): yalnız bu dizinde kalır; ağa çıkmaz. */ ghost?: GhostOutline | null };

/** Analiz kopyasını (≤ 1280 px JPEG) sanal alana kopyalar. İkinci parametre eski imza (analysisId) ya da seçenekler. */
export async function addProgressPhoto(sourceUri: string, options?: string | AddProgressOptions): Promise<ProgressPhoto> {
  const opts: AddProgressOptions = typeof options === "string" ? { analysisId: options } : (options ?? {});
  const d = dir();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const file = `${id}.jpg`;
  await new File(sourceUri).copy(new File(d, file));
  const entry: ProgressEntry = { id, file, takenAt: Date.now(), ...(opts.analysisId ? { analysisId: opts.analysisId } : {}), ...(opts.ghost ? { ghost: opts.ghost } : {}) };
  writeIndex(d, addEntry(await readIndex(d), entry));
  return toPhoto(d, entry);
}

export async function listProgressPhotos(): Promise<ProgressPhoto[]> {
  const d = dir();
  const index = await readIndex(d);
  // yetim dosyalar temizlenir (dizin bozulduysa görseller sızmaz, yalnız silinir)
  const names = d.list().map((x) => x.name);
  for (const f of orphanFiles(index, names)) {
    try {
      new File(d, f).delete();
    } catch {
      // yok sayılır
    }
  }
  return index.items.filter((e) => new File(d, e.file).exists).map((e) => toPhoto(d, e));
}

export async function updateProgressNote(id: string, note: string): Promise<void> {
  const d = dir();
  writeIndex(d, setNote(await readIndex(d), id, note));
}

export async function deleteProgressPhoto(id: string): Promise<void> {
  const d = dir();
  const index = await readIndex(d);
  const e = index.items.find((i) => i.id === id);
  if (e) {
    const f = new File(d, e.file);
    if (f.exists) f.delete();
  }
  writeIndex(d, removeEntry(index, id));
}

/** Yeniden analizde kamera üstüne silik çizgi için son çekimin kılavuzu (yalnız cihazda). */
export async function getLatestGhost(): Promise<GhostOutline | null> {
  try {
    return latestGhost(await readIndex(dir()));
  } catch {
    return null;
  }
}

/** Hesap silme ve rıza geri alma için: tüm fotoğraflar ve dizin. */
export async function clearProgressPhotos(): Promise<void> {
  const d = new Directory(Paths.document, DIR_NAME);
  if (d.exists) d.delete();
}
