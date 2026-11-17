import "server-only";

import type { SubKey } from "@/lib/config/teaser";
import type { RegionKey } from "@/lib/score/contract";

// hybrid.v2 şablon cümleleri (PLAN_V2 3f: "denetimden geçmeyen cümle şablona düşer; rapor asla boş gitmez").
// Yalnız sunucu; nötr dil (Ek B), sayı yok, teşhis yok, kıyas yok. Claude metni denetim veya güvenlik filtresinde
// takıldığında ilgili cümlenin yerine geçer. Arayüz etiketleri (explain5.*) messages/tr.json'dadır; bunlar cümledir.

export const SUB_NAMES_TR: Record<SubKey, string> = {
  harmony: "yüz uyumu",
  eyes: "göz bölgesi",
  jawline: "çene hattı",
  skin: "cilt",
  hair: "saç",
  grooming: "bakım",
  brows: "kaşlar",
};

export const REGION_NAMES_TR: Record<RegionKey, string> = {
  brows: "Kaşlar",
  eyeArea: "Göz çevresi",
  nose: "Burun",
  lipsSmile: "Dudak ve gülüş",
  cheeks: "Elmacık ve yanaklar",
  jawline: "Çene hattı",
  skin: "Cilt",
  hair: "Saç",
  beard: "Sakal",
};

export const STRUCTURAL_REGIONS: readonly RegionKey[] = ["nose", "lipsSmile", "cheeks", "jawline", "eyeArea"];

export const TEMPLATES = {
  lookedAt: (sub: SubKey) => `Fotoğraflarda ${SUB_NAMES_TR[sub]} alanını bütün açılardan inceledik.`,
  held: (sub: SubKey) => `${capitalize(SUB_NAMES_TR[sub])} alanında genel görünüm dengeli ve bakımlı.`,
  loweredNeutral: "Bu çekimde puanı aşağı çeken belirgin bir ayrıntı görülmedi.",
  structuralRaise: "Bu alan bakımla değişmez; saç, sakal ve kaş seçimleri algıyı etkiler.",
  confidence: (views: number, lighting: "even" | "uneven" | "harsh_or_dim", confidence: "low" | "medium" | "high") => {
    const v = views <= 1 ? "tek açı" : views === 2 ? "iki açı" : views === 3 ? "üç açı" : views === 4 ? "dört açı" : views === 5 ? "beş açı" : "altı açı";
    const l = lighting === "even" ? "ışık dengeli" : lighting === "uneven" ? "ışık tek yönlü" : "ışık sert ya da yetersiz";
    const c = confidence === "high" ? "güven yüksek" : confidence === "medium" ? "güven orta" : "güven düşük; yeni çekimde değişebilir";
    return `${capitalize(v)} kullanıldı; ${l}; ${c}.`;
  },
  letter: "Fotoğraflarına bütün açılardan baktık. Güçlü yanların ve bakımla değişebilecek alanların aşağıda bölge bölge anlatılıyor. Plan bu alanlara göre hazırlandı.",
  regionStrength: (r: RegionKey) => `${REGION_NAMES_TR[r]} bölgesinde genel görünüm dengeli.`,
  regionSeen: (r: RegionKey) => (STRUCTURAL_REGIONS.includes(r) ? `${REGION_NAMES_TR[r]} yapısal bir özellik; bakım planının konusu değil.` : `${REGION_NAMES_TR[r]} bölgesinde fotoğrafta belirgin bir ayrıntı öne çıkmadı.`),
  regionImprovementStructural: "Saç, sakal ve kaş seçimleri bu bölgenin algısını etkiler; plan bunu gözetir.",
  closing: "Değişim haftalar sürer; ışık ve açı sonucu etkiler. Tıbbi tavsiye değildir.",
  skinSurface: "Cilt yüzeyi fotoğrafta genel olarak dengeli görünüyor.",
  faceShapeReason: "Çoklu açılara göre en yakın şekil.",
} as const;

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("tr") + s.slice(1) : s;
}

export { capitalize as capitalizeTr };
