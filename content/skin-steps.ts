// Cilt adımı türleri: marka değil ürün türü (SPEC 9.8 kural 9). İlaç/reçeteli etken madde yok.
export type SkinStep = {
  id: string;
  nameTr: string;
  noteTr: string;
  slot: "morning" | "evening" | "weekly";
  budget: "low" | "medium" | "high";
  minutes: number;
  /** Uygun cilt tipleri; boş = hepsi. */
  skinTypes: Array<"oily" | "dry" | "combination" | "normal" | "sensitive" | "unknown">;
  /**
   * Sprint 2 (PLAN 4e): bilgi tabanı alanı. Yoksa "skin". hair = saç bakımı/şekillendirme, beard = sakal ve tıraş,
   * brows = kaş ve burun-kulak düzeni, style = aksesuar/stil. lib/coach/knowledge.ts MethodRecord.area buradan okur.
   */
  area?: "hair" | "beard" | "brows" | "style";
  /** Kanıt notu (KB §6.2; A/B/C içeride kalır). Yoksa C (uzman görüşü). Yalnız SPF A: güneş korumasının kanıtı yaygın. */
  evidence?: "A" | "B" | "C";
};

export const SKIN_STEPS: SkinStep[] = [
  { id: "st_cleanser_gentle", nameTr: "Nazik temizleyici (jel/köpük olmayan)", noteTr: "Sabah ve akşam; sıcak değil ılık su", slot: "morning", budget: "low", minutes: 1, skinTypes: ["dry", "sensitive", "normal", "unknown"] },
  { id: "st_cleanser_foaming", nameTr: "Köpüren temizleyici", noteTr: "Yağlı ve karma ciltte fazla yağı alır", slot: "morning", budget: "low", minutes: 1, skinTypes: ["oily", "combination"] },
  { id: "st_cleanser_evening", nameTr: "Akşam temizliği", noteTr: "Gün sonunda kir ve güneş kremini çıkarır", slot: "evening", budget: "low", minutes: 1, skinTypes: [] },
  { id: "st_moisturizer_light", nameTr: "Hafif nemlendirici (jel)", noteTr: "Yağsız; parlama yapmaz", slot: "morning", budget: "low", minutes: 1, skinTypes: ["oily", "combination", "normal", "unknown"] },
  { id: "st_moisturizer_rich", nameTr: "Yoğun nemlendirici (krem)", noteTr: "Kuru ve hassas cilt için", slot: "evening", budget: "low", minutes: 1, skinTypes: ["dry", "sensitive", "normal"] },
  { id: "st_spf", nameTr: "Güneş koruyucu SPF 30+", noteTr: "Her sabah, bulutlu günlerde de; en etkili tek adım", slot: "morning", budget: "low", minutes: 1, skinTypes: [], evidence: "A" },
  { id: "st_exfoliant_weekly", nameTr: "Haftalık nazik peeling (yüz yıkama tipi)", noteTr: "Haftada 1; hassas ciltte atla", slot: "weekly", budget: "medium", minutes: 3, skinTypes: ["oily", "combination", "normal", "unknown"] },
  { id: "st_clay_mask_weekly", nameTr: "Haftalık kil maskesi", noteTr: "Parlama ve gözenek görünümü için", slot: "weekly", budget: "medium", minutes: 10, skinTypes: ["oily", "combination"] },
  { id: "st_hydrating_serum", nameTr: "Nem serumu", noteTr: "Nemlendiriciden önce, nemli cilde", slot: "evening", budget: "medium", minutes: 1, skinTypes: ["dry", "normal", "combination", "sensitive"] },
  { id: "st_eye_area", nameTr: "Göz çevresi nemlendirici", noteTr: "Yorgun görünüm için hafif, kokusuz", slot: "evening", budget: "medium", minutes: 1, skinTypes: [] },
  { id: "st_lip_balm", nameTr: "Dudak nemlendirici", noteTr: "SPF'li olanı tercih et", slot: "morning", budget: "low", minutes: 1, skinTypes: [] },
  { id: "st_beard_oil", nameTr: "Sakal yağı", noteTr: "Kaşıntı ve kuruluk için", slot: "evening", budget: "low", minutes: 1, skinTypes: [], area: "beard" },
  { id: "st_hair_conditioner", nameTr: "Saç kremi", noteTr: "Uçlara; haftada 2–3", slot: "weekly", budget: "low", minutes: 3, skinTypes: [], area: "hair" },
  { id: "st_scalp_scrub_weekly", nameTr: "Haftalık saç derisi temizliği", noteTr: "Kepek ve yağ birikimi için", slot: "weekly", budget: "medium", minutes: 5, skinTypes: [], area: "hair" },
  // ── Sprint 2 katalog genişletmesi (PLAN 4e; KB Ç2 "uydurma yöntem yok"): şekillendirme ürünleri, tıraş tahrişi seti,
  //    kaş / burun-kulak bakımı. Marka yok, ürün türü var; reçeteli etken madde yok.
  { id: "st_styling_cream", nameTr: "Şekillendirme kremi (hafif tutuş)", noteTr: "Nemli saça az miktarda; doğal görünüm", slot: "morning", budget: "low", minutes: 2, skinTypes: [], area: "hair" },
  { id: "st_matte_clay", nameTr: "Mat kil / pomad (orta tutuş)", noteTr: "Kuru saça; parlama yapmaz, dokuyu öne çıkarır", slot: "morning", budget: "low", minutes: 2, skinTypes: [], area: "hair" },
  { id: "st_sea_salt_spray", nameTr: "Deniz tuzu spreyi", noteTr: "Dalgalı ve ince telli saçta hacim", slot: "morning", budget: "low", minutes: 1, skinTypes: [], area: "hair" },
  { id: "st_heat_protect", nameTr: "Isı koruyucu sprey", noteTr: "Fön ya da düzleştirici kullanıyorsan önce uygula", slot: "morning", budget: "low", minutes: 1, skinTypes: [], area: "hair" },
  { id: "st_shave_prep", nameTr: "Tıraş öncesi yumuşatma (ılık su, tıraş yağı)", noteTr: "Tahrişi azaltır; sakal yönünde tıraş", slot: "morning", budget: "low", minutes: 2, skinTypes: [], area: "beard" },
  { id: "st_aftershave_balm", nameTr: "Tıraş sonrası alkolsüz balsam", noteTr: "Kızarıklık ve yanmayı azaltır", slot: "morning", budget: "low", minutes: 1, skinTypes: [], area: "beard" },
  { id: "st_razor_hygiene", nameTr: "Bıçak değişimi ve temizliği", noteTr: "Kör bıçak tahriş yapar; haftada bir yenile", slot: "weekly", budget: "low", minutes: 1, skinTypes: [], area: "beard" },
  { id: "st_beard_trim_weekly", nameTr: "Haftalık sakal hattı düzeltme", noteTr: "Yanak ve boyun hattını makineyle tazele", slot: "weekly", budget: "low", minutes: 5, skinTypes: [], area: "beard" },
  { id: "st_brow_tidy", nameTr: "Kaş düzeni (çizgi dışı kılları alma)", noteTr: "Yalnız doğal çizginin dışındakiler; inceltme yok", slot: "weekly", budget: "low", minutes: 3, skinTypes: [], area: "brows" },
  { id: "st_brow_brush", nameTr: "Kaş fırçalama ve hafif jel", noteTr: "Sabah yukarı doğru tara; şeffaf jel düzeni tutar", slot: "morning", budget: "low", minutes: 1, skinTypes: [], area: "brows" },
  { id: "st_nose_ear_trim", nameTr: "Burun ve kulak kılı düzeltme", noteTr: "Küçük makineyle; cımbız kullanma", slot: "weekly", budget: "low", minutes: 2, skinTypes: [], area: "brows" },
  { id: "st_glasses_clean", nameTr: "Gözlük camı ve burun yastığı temizliği", noteTr: "Günlük; cilt teması olan yerler", slot: "evening", budget: "low", minutes: 1, skinTypes: [], area: "style" },
];

export const SKIN_STEP_IDS = SKIN_STEPS.map((s) => s.id);
