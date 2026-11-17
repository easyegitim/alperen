// SPEC 7.4: MediaPipe yüz ağı standart indeksleri. Görüntüde kişinin sağı solda kalır.
// Yanlış çıkan indeks /debug/landmarks sayfasında doğrulanıp burada düzeltilir.
export const IDX = {
  top: 10, // ağın tepesi (alın üstü, saç çizgisi değil)
  glabella: 9, // kaş arası
  nasion: 168, // burun kökü
  noseTip: 1,
  subnasale: 2, // burun altı
  upperLipMid: 0,
  menton: 152, // çene ucu
  cheekR: 234, // elmacık hizası en dış (kişinin sağı)
  cheekL: 454,
  gonionR: 172, // çene köşesi (yaklaşık)
  gonionL: 397,
  foreheadR: 54,
  foreheadL: 284,
  browTopR: 105,
  browTopL: 334,
  eyeOuterR: 33,
  eyeOuterL: 263,
  eyeInnerR: 133,
  eyeInnerL: 362,
  irisR: 468,
  irisL: 473,
  mouthR: 61,
  mouthL: 291,
  // hybrid.v1 ek noktaları (engine spec §1.2). /debug/landmarks'ta doğrulanır.
  stomionUpper: 13, // üst dudak iç orta
  stomionLower: 14, // alt dudak iç orta
  midBrow: 8, // kaş arası, 9'un hemen altı
  noseBridge: 6, // burun sırtı, 168'in altı
  foreheadMid: 151, // alın orta hattı, 10 ile 9 arası
} as const;

/** Yüz ovali (kompozit maskesi için, sırayla). */
export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;

/** Kompozit hizalaması için sabit noktalar (SPEC 10.4 adım 2). */
export const ALIGN_POINTS = [33, 263, 133, 362, 168, 1, 152] as const;

export const LANDMARK_COUNT = 478;

// ── Kontur listeleri (PLAN 5a; lib/tryon/mask.ts features_* maskeleri). MediaPipe FACEMESH_* bağlantılarının poligon
// sırasına dizilmiş hâli; "sağ" kişinin sağı (görüntüde sol). Yanlış çıkan indeks /debug/landmarks'ta doğrulanıp düzeltilir.
/** Kişinin sağ gözü (göz kapağı dış hattı), saat yönünde. */
export const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246] as const;
/** Kişinin sol gözü. */
export const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466] as const;
/** Kişinin sağ kaşı: üst hat (70→107) + alt hat geri (55→46). */
export const RIGHT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46] as const;
/** Kişinin sol kaşı. */
export const LEFT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276] as const;
/** Burun: köprü kökü (168) → sol kanat → burun altı (2) → sağ kanat → köprü. */
export const NOSE = [168, 351, 419, 456, 420, 360, 279, 358, 327, 326, 2, 97, 98, 129, 49, 131, 236, 196, 122] as const;
/** Dudaklar (dış hat): alt dudak 61→291, üst dudak 291→61. */
export const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185] as const;
/** Orta yanak poligonu için türetilmiş noktalar (lib/tryon/mask.ts midCheekPolygon): alt göz kapağı ve burun kanadı. */
export const CHEEK_REF = { eyeBottomR: 145, eyeBottomL: 374, noseAlaR: 129, noseAlaL: 358 } as const;
