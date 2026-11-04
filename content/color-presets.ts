import type { Preset } from "./types";

// SPEC 10.2: 6 saç rengi + PLAN 4e genişletme (6 → 12). Yalnız saç rengi değişir; yüz ovali korunur (below_brows).
const ALL = ["oval", "round", "square", "heart", "long", "diamond"] as const;

export const COLOR_PRESETS: Preset[] = [
  { id: "darker_natural", kind: "color", nameTr: "Doğal koyu", suits: [...ALL], prompt: "hair color one to two shades darker than the natural tone, natural finish", protect: "below_brows", noteTr: "Risksiz, kontrastı artırır" },
  { id: "lighter_brown", kind: "color", nameTr: "Açık kahve", suits: [...ALL], prompt: "warm light brown hair color, natural-looking", protect: "below_brows" },
  { id: "ash_blonde", kind: "color", nameTr: "Küllü sarı", suits: [...ALL], prompt: "cool ash blonde hair color with low warmth", protect: "below_brows", noteTr: "Bakım ister" },
  { id: "jet_black", kind: "color", nameTr: "Simsiyah", suits: [...ALL], prompt: "jet black hair color with a soft natural sheen", protect: "below_brows" },
  { id: "auburn", kind: "color", nameTr: "Kızıl kahve", suits: [...ALL], prompt: "rich auburn hair color, red-brown, natural", protect: "below_brows" },
  { id: "silver_gray", kind: "color", nameTr: "Gümüş gri", suits: [...ALL], prompt: "silver gray hair color, even tone", protect: "below_brows", noteTr: "Cesur; bakım ister" },
  // PLAN 4e genişletme
  { id: "chocolate_brown", kind: "color", nameTr: "Çikolata kahve", suits: [...ALL], prompt: "deep chocolate brown hair color with a glossy, even tone", protect: "below_brows", noteTr: "Sıcak ten tonlarıyla uyumlu" },
  { id: "cool_dark_brown", kind: "color", nameTr: "Soğuk koyu kahve", suits: [...ALL], prompt: "cool-toned dark brown hair color, no red or warm reflections", protect: "below_brows" },
  { id: "caramel_balayage", kind: "color", nameTr: "Karamel balyaj", suits: [...ALL], prompt: "caramel balayage: natural dark base with hand-painted warm caramel highlights through the lengths", protect: "below_brows", noteTr: "Uzun saçta hacim hissi" },
  { id: "honey_blonde", kind: "color", nameTr: "Bal sarısı", suits: [...ALL], prompt: "warm honey blonde hair color, soft golden tone", protect: "below_brows", noteTr: "Bakım ister" },
  { id: "copper_red", kind: "color", nameTr: "Bakır kızıl", suits: [...ALL], prompt: "vivid copper red hair color, natural-looking", protect: "below_brows", noteTr: "Cesur; bakım ister" },
  { id: "platinum_blonde", kind: "color", nameTr: "Platin sarı", suits: [...ALL], prompt: "icy platinum blonde hair color, even and bright", protect: "below_brows", noteTr: "Cesur; sık bakım ister" },
];
