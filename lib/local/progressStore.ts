"use client";

// SPEC 11.2: ilerleme fotoğrafları yalnız cihazda (IndexedDB, Dexie). Hiçbir fonksiyon ağa çıkmaz.
// Faz 6 (CONTRACTS_V2 S3.3.4): kayıt, hayalet kılavuz için 43 noktalık normalize yüz çizgisini (GhostOutline) de taşır;
// 478 nokta tutulmaz. Dexie v2: alan indekslenmez, şema aynı; sürüm artışı sözleşme gereği.
import Dexie, { type EntityTable } from "dexie";
import { parseGhostOutline, type GhostOutline } from "@/lib/face/ghostGuide";

export type ProgressPhoto = {
  id: string;
  takenAt: number; // epoch ms
  blob: Blob; // JPEG (analiz kopyası ≤ 1280 px)
  analysisId?: string;
  note?: string;
  /** Çekim karesinin yüz çizgisi altkümesi (yalnız cihazda; yeniden analizde kamera üstüne silik çizilir). */
  ghost?: GhostOutline;
};

class ProgressDB extends Dexie {
  photos!: EntityTable<ProgressPhoto, "id">;
  constructor() {
    super("aura-progress");
    this.version(1).stores({ photos: "id, takenAt, analysisId" });
    this.version(2).stores({ photos: "id, takenAt, analysisId" });
  }
}

let db: ProgressDB | null = null;
function getDb(): ProgressDB {
  if (!db) db = new ProgressDB();
  return db;
}

export async function addProgressPhoto(input: Omit<ProgressPhoto, "id" | "takenAt"> & { takenAt?: number }): Promise<ProgressPhoto> {
  const photo: ProgressPhoto = { id: crypto.randomUUID(), takenAt: input.takenAt ?? Date.now(), blob: input.blob, analysisId: input.analysisId, note: input.note, ghost: input.ghost };
  await getDb().photos.add(photo);
  return photo;
}

export async function listProgressPhotos(): Promise<ProgressPhoto[]> {
  return getDb().photos.orderBy("takenAt").reverse().toArray();
}

/** En yeni kayıttaki geçerli yüz çizgisi (hayalet kılavuz); yoksa ya da depolama kapalıysa null. */
export async function latestGhostOutline(): Promise<GhostOutline | null> {
  try {
    const photos = await listProgressPhotos();
    for (const p of photos) {
      const g = parseGhostOutline(p.ghost);
      if (g) return g;
    }
    return null;
  } catch {
    return null;
  }
}

export async function updateProgressNote(id: string, note: string): Promise<void> {
  await getDb().photos.update(id, { note });
}

export async function deleteProgressPhoto(id: string): Promise<void> {
  await getDb().photos.delete(id);
}

/** Hesap silme / rıza geri alma: cihazdaki tüm ilerleme fotoğrafları (SPEC Faz 13). */
export async function clearProgressPhotos(): Promise<void> {
  await getDb().photos.clear();
}
