// SPEC 9.3 / 12.3. AI yalnız dermatoloji, saç sağlığı, diş/ortodonti, diyetisyen, psikolog önerebilir; plastik cerrahi asla (D11).
// Sprint 2 (PLAN 4g; KB Ç4): sponsorsuz uzman dizini. Ücret ve komisyon kapalı; reklamda hekim yok (K18); partner kartında
// fiyat, kampanya, önce/sonra yok. `directory` alanı /uzman dizinindeki gruptur; `kinds` partners.kind ile eşleşir.
export type ExpertDirectoryGroup = "medical" | "grooming" | "wellbeing";

export type ExpertSpecialty = {
  id: string;
  nameTr: string;
  /** Yapay zekâ (seeProfessional) bu uzmanlığı önerebilir mi. */
  aiMayRecommend: boolean;
  /** Dizin grubu: tıbbi (hekim), bakım (berber, kuaför, estetisyen), iyi oluş (diyetisyen, psikolog). */
  directory: ExpertDirectoryGroup;
  /** partners.kind değerleri (migration 0001). */
  kinds: ReadonlyArray<"doctor" | "clinic" | "dietitian" | "psychologist" | "dentist">;
  /** Hangi plan alanlarından yönlendirilir (saç dökülmesi akışı: sac_sagligi + dermatoloji). */
  areas: ReadonlyArray<"hair" | "beard" | "color" | "skin" | "brows" | "exercise" | "habit" | "style">;
  /** Nötr tek cümle (dizin kartı). */
  descriptionTr: string;
};

export const EXPERT_SPECIALTIES: ExpertSpecialty[] = [
  { id: "dermatoloji", nameTr: "Dermatoloji", aiMayRecommend: true, directory: "medical", kinds: ["doctor", "clinic"], areas: ["skin", "hair", "beard"], descriptionTr: "Cilt ve saç derisiyle ilgili durumlar için hekim muayenesi." },
  { id: "sac_sagligi", nameTr: "Saç sağlığı", aiMayRecommend: true, directory: "medical", kinds: ["doctor", "clinic"], areas: ["hair"], descriptionTr: "Saç dökülmesi ve saç derisi sağlığı; karar muayenede hekimindir." },
  { id: "plastik_cerrahi", nameTr: "Plastik cerrahi", aiMayRecommend: false, directory: "medical", kinds: ["doctor", "clinic"], areas: [], descriptionTr: "Uygulama bu alanda öneri vermez; yalnız dizinde yer alır." },
  { id: "dis_ortodonti", nameTr: "Diş / ortodonti", aiMayRecommend: true, directory: "medical", kinds: ["dentist", "clinic"], areas: ["exercise"], descriptionTr: "Diş, çene eklemi ve gülüşle ilgili durumlar." },
  { id: "diyetisyen", nameTr: "Diyetisyen", aiMayRecommend: true, directory: "wellbeing", kinds: ["dietitian"], areas: ["habit"], descriptionTr: "Beslenme hedefleri için kişiye özel plan." },
  { id: "psikolog", nameTr: "Psikolog", aiMayRecommend: true, directory: "wellbeing", kinds: ["psychologist"], areas: [], descriptionTr: "Görünüşle ilgili düşünceler zorlayıcı olduğunda konuşabileceğin bir uzman." },
  // Bakım grubu: partners tablosunda henüz bir kind yok (0001 yalnız sağlık kayıtları); dizinde yönlendirme kartı olarak görünür.
  { id: "berber", nameTr: "Berber", aiMayRecommend: false, directory: "grooming", kinds: [], areas: ["hair", "beard"], descriptionTr: "Kesim ve sakal hattı; berber kartını göstererek anlat." },
  { id: "kuafor", nameTr: "Kuaför / renk uzmanı", aiMayRecommend: false, directory: "grooming", kinds: [], areas: ["hair", "color"], descriptionTr: "Saç rengi ve bakım işlemleri." },
  { id: "estetisyen", nameTr: "Estetisyen (cilt bakımı)", aiMayRecommend: false, directory: "grooming", kinds: [], areas: ["skin", "brows"], descriptionTr: "Cilt bakımı ve kaş düzeni; tıbbi işlem değildir." },
];

export const AI_ALLOWED_SPECIALTIES = EXPERT_SPECIALTIES.filter((s) => s.aiMayRecommend).map((s) => s.id);

export function specialtiesForArea(area: ExpertSpecialty["areas"][number]): ExpertSpecialty[] {
  return EXPERT_SPECIALTIES.filter((s) => s.areas.includes(area));
}

/** Saç dökülmesi akışı (KB §6.3): bilgi kartı → doktor katmanı (flag) → uzmana yönlendirme sırası sabittir. */
export const HAIR_LOSS_SPECIALTIES = ["sac_sagligi", "dermatoloji"] as const;
