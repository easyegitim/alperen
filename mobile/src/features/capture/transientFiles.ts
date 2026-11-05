// Geçici görsel dosyaların temizliği (SPEC-MOBILE M7; CLAUDE.md fotoğraf kuralı: cihazda yalnız geçici dosya).
// Uygulama önbelleğinde kalabilecek kalıntılar: expo-image-picker kopyaları (ImagePicker/), expo-image-manipulator
// çıktıları (ImageManipulator/: analiz kopyaları, bekleyen set, kırpımlar), aura-* adlı oturum selfie'si / deneme /
// kart dosyaları. Uygulama yeniden başladığında bellekteki hiçbir referans kalmadığından hepsi silinebilir.
// İlerleme fotoğrafları belge dizinindedir (progressStore) ve BU TEMİZLİĞE GİRMEZ.
import { Directory, File, Paths } from "expo-file-system";

/** Yerel modüllerin önbellek alt dizinleri (iOS MediaHandler.swift / Android ImagePickerConstants.kt, FileUtils.kt). */
export const TRANSIENT_CACHE_DIRS: readonly string[] = ["ImagePicker", "ImageManipulator"];
/** Uygulamanın kendi geçici dosya adları (aura-session-selfie.jpg, aura-out-*.jpg, aura-g-*.jpg, aura-kart-*.jpg, aura-deneme-*.jpg). */
export const TRANSIENT_FILE_PATTERN = /^aura-.+\.jpe?g$/i;

/** Bir önbellek girdisi geçici mi (saf; test edilebilir). */
export function isTransientEntry(entry: { name: string; kind: "file" | "directory" }): boolean {
  return entry.kind === "directory" ? TRANSIENT_CACHE_DIRS.includes(entry.name) : TRANSIENT_FILE_PATTERN.test(entry.name);
}

/**
 * Uygulama açılışında (kök düzen modülü yüklenirken, henüz hiçbir ekran dosya üretmeden) çağrılır. Senkron; hata
 * yutulur (temizlik akışı engellemez). Silinen girdi sayısını döner (yalnız bilgi; analitiğe gitmez).
 */
export function sweepTransientFiles(root: Directory = Paths.cache): number {
  let removed = 0;
  try {
    if (!root.exists) return 0;
    for (const entry of root.list()) {
      const kind = entry instanceof Directory ? "directory" : "file";
      if (!isTransientEntry({ name: entry.name, kind })) continue;
      try {
        entry.delete();
        removed++;
      } catch {
        // kilitli ya da zaten silinmiş girdi
      }
    }
  } catch {
    // önbellek dizini okunamadı
  }
  return removed;
}

/** Tek bir geçici dosyayı sessizce siler (expo-file-system; Skia'sız — birim testler yükleyebilsin). */
export function removeFileQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // geçici dosya zaten yok
  }
}
