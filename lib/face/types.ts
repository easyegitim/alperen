// SPEC 7.7 ve Faz 4 çalışma tipleri. 478 noktalık ham dizi yalnız bellekte durur; sunucuya gönderilmez.
export type FaceShape = "oval" | "round" | "square" | "long" | "heart" | "diamond";

export type Point = { x: number; y: number; z?: number };

export type GeometryResult = {
  version: "geo-v1";
  quality: {
    yaw: number;
    pitch: number;
    roll: number;
    brightness: number;
    sharpness: number;
    passed: boolean;
    /** Elle çekim (gevşek yumuşak eşikler). Yalnız saklanan üst veri; hiçbir skoru değiştirmez (UI spec S7, C7). */
    relaxed?: boolean;
  };
  metrics: {
    lengthRatio: number;
    jawRatio: number;
    foreheadRatio: number;
    fwhr: number;
    canthalTiltDeg: number;
    lowerToMiddle: number;
    thirds: { upper: number | null; middle: number; lower: number };
    hairlineFound: boolean;
    /**
     * fs-v2 (KB §4.10, PLAN 1d): saç çizgisi → çene ucu uzunluğu ÷ elmacık genişliği; saç çizgisi bulunmadıysa null
     * (yüz şekli o zaman 10→152 uzunluğunu MESH_TOP_TO_HAIRLINE katsayısıyla ölçekler). Eski istemciler göndermez.
     */
    faceLengthRatio?: number | null;
    /** hybrid.v1 ek metrikleri (engine spec §1.2, C1). İsteğe bağlı: eski istemciler göndermez; sürüm "geo-v1" kalır. */
    ipdRatio?: number | null;
    eyeMouthRatio?: number | null;
    /** De-rotasyon sonrası ayna RMS'i (yüz genişliğine oranla); koordinat taşımaz. */
    symmetry?: { face: number; eyes: number; lower: number } | null;
  };
  faceShape: { primary: FaceShape; secondary?: FaceShape; confidence: number };
  capturedAt: string;
};

/** Kalite kapısında kullanılan blendshape anahtarları. */
export type BlendshapeScores = {
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  mouthSmileLeft: number;
  mouthSmileRight: number;
  jawOpen: number;
};

/** Worker'ın bir kare için döndürdüğü analiz (SPEC 7.3 ölçümleri + ham noktalar). */
export type FrameAnalysis = {
  width: number;
  height: number;
  faces: number;
  /** Normalize (0–1) koordinatlar; yalnız tek yüz varsa dolu. */
  landmarks: Point[] | null;
  blendshapes: BlendshapeScores | null;
  /** 4×4 dönüşüm matrisi (16 sayı), sütun-öncelikli (SPEC 7.3). */
  matrix: number[] | null;
  /** Yüz bölgesi ortalama parlaklık 0–255. */
  brightness: number | null;
  /** Sol/sağ yanak parlaklık farkı (mutlak). */
  brightnessBalance: number | null;
  /** 128×128 gri yüz kırpımında Laplace varyansı. */
  sharpness: number | null;
  /** Segmenter saç sınıfı yüz kutusunun üstünde görünüyor mu (null = segmenter yok). */
  hairVisible: boolean | null;
  timestamp: number;
};

export type SegmentationResult = {
  width: number;
  height: number;
  /** Sınıf kimlikleri: 0 arka plan, 1 saç, 2 vücut cildi, 3 yüz cildi, 4 giysi, 5 diğer. */
  mask: Uint8Array;
};

export const SEG_CLASS = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, other: 5 } as const;
