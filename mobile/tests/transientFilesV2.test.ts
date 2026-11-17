import { Directory, File, Paths } from "expo-file-system";
import { clearCaptureState, getLastGhost, getPendingSet, setLastGhost, setPendingSet } from "@/mobile/src/features/capture/captureSession";
import { clearSessionSelfie, getSessionSelfie, setSessionSelfie } from "@/mobile/src/features/capture/sessionSelfie";
import { isTransientEntry, sweepTransientFiles } from "@/mobile/src/features/capture/transientFiles";
import { uploadPendingSet } from "@/mobile/src/features/capture/upload";
import type { EncodedView } from "@/mobile/src/features/capture/payload";
import type { AuraApi } from "@/mobile/src/lib/api";

/** jest-expo'nun bellek içi dosya sistemi (expo-file-system/mocks): gerçek dosya yok; yollar file:///mock/cache/. */
function writeCache(name: string, dir?: string): File {
  const parent = dir ? new Directory(Paths.cache, dir) : Paths.cache;
  if (dir && !parent.exists) parent.create({ intermediates: true, idempotent: true });
  const f = new File(parent, name);
  f.write("x");
  return f;
}

const ghost = { version: 1 as const, aspect: 0.75, mirrored: false, oval: Array.from({ length: 36 }, () => [0.5, 0.5] as [number, number]), eyes: [[0.4, 0.4], [0.45, 0.4], [0.55, 0.4], [0.6, 0.4]] as [number, number][], nose: [0.5, 0.5] as [number, number], mouth: [[0.45, 0.7], [0.55, 0.7]] as [number, number][], takenAt: 1 };

describe("geçici görsel temizliği (SPEC-MOBILE M7; CLAUDE.md fotoğraf kuralı)", () => {
  it("açılış süpürmesi: ImagePicker/ ve ImageManipulator/ dizinleri ile aura-*.jpg silinir; başka dosyaya dokunulmaz", () => {
    const selfie = writeCache("aura-session-selfie.jpg");
    const out = writeCache("aura-out-123.jpg");
    const picker = writeCache("abc.jpg", "ImagePicker");
    const manip = writeCache("def.jpg", "ImageManipulator");
    const keep = writeCache("keep.txt");
    const other = writeCache("x.bin", "Other");
    expect(sweepTransientFiles()).toBe(4);
    expect(selfie.exists).toBe(false);
    expect(out.exists).toBe(false);
    expect(picker.exists).toBe(false);
    expect(manip.exists).toBe(false);
    expect(keep.exists).toBe(true);
    expect(other.exists).toBe(true);
    expect(isTransientEntry({ name: "progress", kind: "directory" })).toBe(false);
    expect(isTransientEntry({ name: "aura-kart-1.jpg", kind: "file" })).toBe(true);
    expect(isTransientEntry({ name: "index.json", kind: "file" })).toBe(false);
  });

  it("clearSessionSelfie işaretçiyi VE önbellek dosyasını düşürür; setSessionSelfie(null) yalnız işaretçiyi", () => {
    const f = writeCache("aura-session-selfie.jpg");
    setSessionSelfie({ uri: f.uri, width: 10, height: 10, landmarksPx: [], capturedAt: 1 });
    setSessionSelfie(null);
    expect(f.exists).toBe(true);
    setSessionSelfie({ uri: f.uri, width: 10, height: 10, landmarksPx: [], capturedAt: 2 });
    clearSessionSelfie();
    expect(getSessionSelfie()).toBeNull();
    expect(f.exists).toBe(false);
  });

  it("clearCaptureState (çıkış / hesap silme / kullanıcı değişimi): bekleyen set dosyaları, selfie ve hayalet çizgi gider", async () => {
    const selfie = writeCache("aura-session-selfie.jpg");
    const v1 = writeCache("p1.jpg", "ImageManipulator");
    const v2 = writeCache("p2.jpg", "ImageManipulator");
    setSessionSelfie({ uri: selfie.uri, width: 10, height: 10, landmarksPx: [], capturedAt: 1 });
    setPendingSet({ analysisId: "an1", capturedAt: 1, views: [{ view: "front", uri: v1.uri, width: 10, height: 10, landmarksPx: [], sourceHash: null }, { view: "profile_left", uri: v2.uri, width: 10, height: 10, landmarksPx: null, sourceHash: null }] });
    setLastGhost(ghost);
    await clearCaptureState();
    expect(getPendingSet()).toBeNull();
    expect(getSessionSelfie()).toBeNull();
    expect(getLastGhost()).toBeNull();
    expect(selfie.exists).toBe(false);
    expect(v1.exists).toBe(false);
    expect(v2.exists).toBe(false);
  });
});

describe("gönderim sonrası dosya sahipliği (ilerleme kopyası gönderimden ÖNCE, kararlı kopyadan)", () => {
  it("başarılı gönderim set dosyalarını siler: ilerleme kopyası için set dosyası değil, oturum selfie kopyası kullanılmalı", async () => {
    const front = writeCache("front.jpg", "ImageManipulator");
    const stable = writeCache("aura-session-selfie.jpg");
    setPendingSet({ analysisId: "an1", capturedAt: 1, views: [{ view: "front", uri: front.uri, width: 10, height: 10, landmarksPx: [], sourceHash: null }, { view: "profile_left", uri: front.uri, width: 10, height: 10, landmarksPx: null, sourceHash: null }] });
    const aura = { analyses: { run: async () => ({ id: "an1", stage: "queued" }) } } as unknown as Pick<AuraApi, "analyses">; // test çifti
    const encode = async (uri: string, _lm: unknown, _w: number, _h: number, view: EncodedView["view"]): Promise<EncodedView> => {
      if (!new File(uri).exists) throw new Error("ENOENT");
      return { view, base64: `/9j/${view}`, bytes: 1000, sourceHash: null };
    };
    const r = await uploadPendingSet(aura, "an1", { encode });
    expect(r.ok).toBe(true);
    expect(front.exists).toBe(false); // set dosyası gitti → tara.tsx ilerleme kopyasını bundan alamaz
    expect(stable.exists).toBe(true); // kararlı kopya durur → ilerleme/bekleme ekranı buradan okur
    stable.delete();
  });

  it("set dosyası silinmişse (ekrandan ayrılınca) kodlama hatası fırlatmaz: { ok:false, api, GENERIC } ve set düşer", async () => {
    setPendingSet({ analysisId: "an2", capturedAt: 1, views: [{ view: "front", uri: "file:///mock/cache/yok.jpg", width: 10, height: 10, landmarksPx: [], sourceHash: null }] });
    const aura = { analyses: { run: async () => ({ id: "an2", stage: "queued" }) } } as unknown as Pick<AuraApi, "analyses">; // test çifti
    const encode = async () => {
      throw new Error("ENOENT");
    };
    await expect(uploadPendingSet(aura, "an2", { encode })).resolves.toEqual({ ok: false, reason: "api", code: "GENERIC" });
    expect(getPendingSet()).toBeNull();
  });
});
