import { getPreset } from "@/content/presets";
import type { BarberSpec } from "./planTypes";

// Berber kartı (KB §8, R2-Ö2; PLAN 4d/6): stil adı, yanlar kaç numara, üstte kaç cm, sakal hattı. YAPILANDIRILMIŞ alan:
// Claude yazmaz, kod preset kimliğinden üretir (uydurma ölçü yok; değerler berber pratiğindeki yaygın başlangıç değerleridir,
// kullanıcı berberle uyarlar). Saf, paylaşılan. Bilinmeyen preset → yalnız stil adı.

type HairSpec = { sidesGuard: string; topLengthCm: number; notes?: string };
type BeardSpec = { beardLine: string; notes?: string };

/** Yanlar: makine numarası (1 ≈ 3 mm, 2 ≈ 6 mm, 3 ≈ 10 mm, 4 ≈ 13 mm); "makas" = makine yok. Üst: cm. */
const HAIR: Record<string, HairSpec> = {
  textured_crop: { sidesGuard: "1–2", topLengthCm: 4, notes: "Üstte nokta kesimle doku; ön kâkül hafif uzun" },
  french_crop: { sidesGuard: "1–2", topLengthCm: 3, notes: "Önde düz, kısa kâkül" },
  buzz_cut: { sidesGuard: "1", topLengthCm: 0.6, notes: "Her yer tek numara; ense temiz" },
  crew_cut: { sidesGuard: "2", topLengthCm: 3, notes: "Önde biraz uzun" },
  caesar: { sidesGuard: "2", topLengthCm: 2.5, notes: "Kısa yatay kâkül" },
  burst_fade: { sidesGuard: "0.5 → 2", topLengthCm: 6, notes: "Kulak çevresinde burst fade; üst doğal kıvırcık" },
  low_taper: { sidesGuard: "1 → 3", topLengthCm: 5, notes: "Yalnız ense ve favoride taper" },
  mid_fade: { sidesGuard: "0.5 → 2", topLengthCm: 6, notes: "Orta hizada fade" },
  high_fade: { sidesGuard: "0 → 2", topLengthCm: 4, notes: "Yüksek fade; üst kısa dokulu" },
  side_part_classic: { sidesGuard: "makas", topLengthCm: 7, notes: "Makasla yanlar; yan ayrım" },
  side_part_fade: { sidesGuard: "1 → 2", topLengthCm: 7, notes: "Ayrım çizgisi (hard part) ve orta fade" },
  quiff: { sidesGuard: "2", topLengthCm: 8, notes: "Önde hacim; geriye ve yukarı" },
  pompadour: { sidesGuard: "2", topLengthCm: 10, notes: "Önde yüksek hacim" },
  slick_back_short: { sidesGuard: "2", topLengthCm: 6, notes: "Geriye taranır" },
  slick_back_long: { sidesGuard: "makas", topLengthCm: 12, notes: "Yanlar makasla, geriye tarama" },
  ivy_league: { sidesGuard: "2", topLengthCm: 4, notes: "Crew'un biraz uzunu; yan ayrım" },
  faux_hawk: { sidesGuard: "1", topLengthCm: 6, notes: "Ortada yukarı doğru doku" },
  undercut: { sidesGuard: "1", topLengthCm: 9, notes: "Yanlar tek numara, üst bağlantısız" },
  two_block_korean: { sidesGuard: "2", topLengthCm: 9, notes: "Üst blok uzun; yan ve arka kısa" },
  curtain_bangs_men: { sidesGuard: "makas", topLengthCm: 10, notes: "Ortadan ayrılan uzun kâkül" },
  middle_part_flow: { sidesGuard: "makas", topLengthCm: 12, notes: "Ortadan ayrım; akışkan" },
  mid_length_wavy: { sidesGuard: "makas", topLengthCm: 12, notes: "Katlı; dalga korunur" },
  messy_textured_top: { sidesGuard: "2", topLengthCm: 6, notes: "Üstte nokta kesim; dağınık doku" },
  curly_top_fade: { sidesGuard: "0.5 → 2", topLengthCm: 7, notes: "Kıvırcık üst, fade yanlar" },
  afro_taper: { sidesGuard: "1 → 3", topLengthCm: 8, notes: "Taper yanlar; üst doğal" },
  shoulder_length: { sidesGuard: "makas", topLengthCm: 25, notes: "Omuz boyu; uçlar yenilenir" },
  man_bun: { sidesGuard: "makas", topLengthCm: 25, notes: "Toplanacak uzunluk korunur" },
  modern_mullet: { sidesGuard: "1 → 2", topLengthCm: 7, notes: "Arka uzun, yanlar kısa" },
  wolf_cut: { sidesGuard: "makas", topLengthCm: 12, notes: "Katlı, dağınık" },
  edgar_soft: { sidesGuard: "1", topLengthCm: 4, notes: "Önde düz kâkül; yumuşak geçiş" },
  long_layers: { sidesGuard: "makas", topLengthCm: 30, notes: "Uzun katlar" },
  curtain_bangs: { sidesGuard: "makas", topLengthCm: 30, notes: "Ortadan ayrılan kâkül" },
  bob_classic: { sidesGuard: "makas", topLengthCm: 14, notes: "Çene hizası" },
  lob: { sidesGuard: "makas", topLengthCm: 20, notes: "Omuza yakın bob" },
  pixie: { sidesGuard: "makas", topLengthCm: 5, notes: "Kısa, dokulu" },
  shag: { sidesGuard: "makas", topLengthCm: 20, notes: "Katlı, kâküllü" },
  butterfly_cut: { sidesGuard: "makas", topLengthCm: 30, notes: "Yüz çevresinde kısa katlar" },
  blunt_bangs: { sidesGuard: "makas", topLengthCm: 30, notes: "Düz kâkül" },
  beach_waves: { sidesGuard: "makas", topLengthCm: 30, notes: "Uçlar yenilenir; dalga stil" },
  sleek_straight_long: { sidesGuard: "makas", topLengthCm: 35, notes: "Düz kesim" },
  curly_defined: { sidesGuard: "makas", topLengthCm: 20, notes: "Kuru kesim; bukle tanımı" },
  high_ponytail: { sidesGuard: "makas", topLengthCm: 35, notes: "Uzunluk korunur" },
};

const BEARD: Record<string, BeardSpec> = {
  clean_shaven: { beardLine: "Tam tıraş; yanak, boyun ve çene altı temiz" },
  stubble_light: { beardLine: "Yanak hattı doğal, boyun hattı âdem elmasının iki parmak üstünde; makine 1–2 mm" },
  stubble_heavy: { beardLine: "Yanak ve boyun hattı belirgin; makine 4–5 mm" },
  short_boxed: { beardLine: "Yanakta düz hat, boyun hattı net; 10 mm; bıyık kısa" },
  full_medium: { beardLine: "Yanak hattı doğal, çene altı yuvarlatılmış; 3 cm" },
  full_long: { beardLine: "Çeneye doğru daralan; boyun hattı temiz; uzunluk korunur" },
  goatee: { beardLine: "Yanaklar tıraşlı; çene ve bıyık birleşik" },
  van_dyke: { beardLine: "Yanaklar tıraşlı; sivri çene sakalı, ayrı bıyık" },
  chin_strap: { beardLine: "Çene hattı boyunca ince şerit; bıyık yok" },
  anchor: { beardLine: "Çene hattını izleyen sivri uçlu sakal ve bıyık; yanaklar tıraşlı" },
  mustache_classic: { beardLine: "Yanak ve çene tıraşlı; yalnız bıyık" },
  faded_beard: { beardLine: "Favoriden çeneye fade; çene altı dolu" },
};

/** Preset kimliğinden berber kartı; stil dışı kimlikte (cilt adımı vb.) undefined. */
export function barberSpecFor(presetId: string): BarberSpec | undefined {
  const p = getPreset(presetId);
  if (!p) return undefined;
  if (p.kind === "hair") {
    const h = HAIR[presetId];
    return { styleName: p.nameTr, ...(h ? { sidesGuard: h.sidesGuard, topLengthCm: h.topLengthCm, notes: h.notes } : {}) };
  }
  if (p.kind === "beard") {
    const b = BEARD[presetId];
    return { styleName: p.nameTr, ...(b ? { beardLine: b.beardLine, notes: b.notes } : {}) };
  }
  // Renk: berber kartı yerine kuaför notu; stil adı yeter.
  return { styleName: p.nameTr };
}
