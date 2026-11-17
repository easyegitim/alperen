// Çoklu açı görünümleri (CONTRACTS_V2.md §2; KB P#4; PLAN_V2 1c). Saf, paylaşılan; mobilden içe aktarılabilir.
// Görüntü boyutları SPEC 7.2 kırpım kuralının açı başına sürümüdür; gövde toplamı Vercel sınırının altında kalır.

export const VIEW_KEYS = ["front", "profile_left", "profile_right", "left45", "right45", "hairline"] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export type ViewSpec = {
  key: ViewKey;
  /** messages/tr.json camera.views.<key>.{name,instruction,optionalNote} */
  labelKey: `camera.views.${ViewKey}`;
  /** "required": tek başına zorunlu; "required_group": gruptan en az biri zorunlu; "optional". */
  requirement: "required" | { group: "profile" } | "optional";
  /** Sunucuya giden kare JPEG kenarı (px) ve başlangıç kalitesi; boyut aşılırsa kalite düşürülür. */
  cropPx: number;
  jpegQuality: number;
  /** Ham JPEG bayt tavanı (base64 öncesi). */
  maxBytes: number;
  /** Bu açıda cihaz geometrisi (478 nokta) üretilir mi? Yalnız ön: oranlar ve yüz şekli ön fotoğrafa aittir. */
  geometry: boolean;
  /** Hedef baş dönüşü (derece, mutlak değer): [min, max]. Ön ve saç çizgisi için küçük; profil için büyük. */
  yawAbsRange: [number, number];
};

export const FRONT_MAX_BYTES = 600 * 1024;
export const SIDE_MAX_BYTES = 400 * 1024;
export const FRONT_CROP_PX = 768;
export const SIDE_CROP_PX = 640;

/** Tüm görünümlerin ham JPEG toplam tavanı (base64 ≈ ×1,37 → ~3,3 MB; Vercel gövde sınırı ~4,5 MB). */
export const TOTAL_IMAGE_MAX_BYTES = FRONT_MAX_BYTES + 4 * SIDE_MAX_BYTES + SIDE_MAX_BYTES; // 3 000 KB

const side = (key: ViewKey, requirement: ViewSpec["requirement"], yawAbsRange: [number, number]): ViewSpec => ({
  key,
  labelKey: `camera.views.${key}`,
  requirement,
  cropPx: SIDE_CROP_PX,
  jpegQuality: 0.8,
  maxBytes: SIDE_MAX_BYTES,
  geometry: false,
  yawAbsRange,
});

/** Ekran sırası = bu sıra: önce zorunlular, sonra isteğe bağlılar (KB P#4: "isteğe bağlı olduğu ve kaliteyi artıracağı yazılarak"). */
export const VIEWS: readonly ViewSpec[] = [
  { key: "front", labelKey: "camera.views.front", requirement: "required", cropPx: FRONT_CROP_PX, jpegQuality: 0.85, maxBytes: FRONT_MAX_BYTES, geometry: true, yawAbsRange: [0, 15] },
  side("profile_left", { group: "profile" }, [60, 100]),
  side("profile_right", { group: "profile" }, [60, 100]),
  side("left45", "optional", [25, 60]),
  side("right45", "optional", [25, 60]),
  side("hairline", "optional", [0, 20]),
];

export const VIEW_BY_KEY: Record<ViewKey, ViewSpec> = Object.fromEntries(VIEWS.map((v) => [v.key, v])) as Record<ViewKey, ViewSpec>;

export const PROFILE_VIEWS = ["profile_left", "profile_right"] as const satisfies readonly ViewKey[];
export const OPTIONAL_VIEWS = ["left45", "right45", "hairline"] as const satisfies readonly ViewKey[];

/**
 * Analiz modu: device_only (ödeme öncesi; yalnız cihaz sonucu) → yalnız ön zorunlu.
 * full (ödeme sonrası; Claude) → ön + en az bir profil zorunlu (KB P#4).
 */
export type AnalysisMode = "device_only" | "full";

export type ViewSetCheck = { ok: true } | { ok: false; reason: "front_missing" | "profile_missing" | "duplicate_view" | "unknown_view" };

export function checkViewSet(views: readonly string[], mode: AnalysisMode): ViewSetCheck {
  const seen = new Set<string>();
  for (const v of views) {
    if (!(VIEW_KEYS as readonly string[]).includes(v)) return { ok: false, reason: "unknown_view" };
    if (seen.has(v)) return { ok: false, reason: "duplicate_view" };
    seen.add(v);
  }
  if (!seen.has("front")) return { ok: false, reason: "front_missing" };
  if (mode === "full" && !PROFILE_VIEWS.some((p) => seen.has(p))) return { ok: false, reason: "profile_missing" };
  return { ok: true };
}

/**
 * Yaw işareti: lib/face/pose.ts eulerFromMatrix. Varsayım: pozitif yaw = yüz kameranın sağına dönük, yani kullanıcının
 * SOL yanağı kameraya bakar → "left" tarafı. /debug/landmarks ile doğrulanır; tersse yalnız bu sabit çevrilir (W1).
 */
export const YAW_POSITIVE_SIDE: "left" | "right" = "left";

export type ViewClass = { view: "front" | "left45" | "right45" | "profile_left" | "profile_right" } | { view: null; reason: "between" | "invalid" };

/**
 * Baş dönüşünden görünüm sınıfı: |yaw| ≤ 15 ön; 25–60 yarım profil; ≥ 60 profil. 15–25 arası "arada" (ne ön ne 45°).
 * Eşikler VIEWS.yawAbsRange ile aynı. Saç çizgisi yaw'dan türetilmez (kullanıcı seçer).
 */
export function classifyView(yawDeg: number): ViewClass {
  if (!Number.isFinite(yawDeg)) return { view: null, reason: "invalid" };
  const a = Math.abs(yawDeg);
  if (a <= VIEW_BY_KEY.front.yawAbsRange[1]) return { view: "front" };
  const sideOf = (yawDeg > 0) === (YAW_POSITIVE_SIDE === "left") ? "left" : "right";
  if (a >= VIEW_BY_KEY.profile_left.yawAbsRange[0]) return { view: sideOf === "left" ? "profile_left" : "profile_right" };
  if (a >= VIEW_BY_KEY.left45.yawAbsRange[0]) return { view: sideOf === "left" ? "left45" : "right45" };
  return { view: null, reason: "between" };
}
