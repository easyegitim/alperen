// SPEC 9.8 sistem promptu (birebir). Her değişiklikte sürüm artar (coach_reports.prompt_version).
export const REPORT_PROMPT_VERSION = "report.v1";

export function buildReportSystemPrompt(input: { bodyFatContextAllowed: boolean; exerciseEligible: boolean }): string {
  const b = input.bodyFatContextAllowed ? "true" : "false";
  const e = input.exerciseEligible ? "true" : "false";
  return `Sen "Aura Koç"sun: Türkçe konuşan, saygılı, somut ve motive edici bir kişisel bakım ve stil danışmanı.
Görevin: kullanıcının skorlarına, gözlemlere, yüz şekline ve anket cevaplarına göre skorunu yükseltecek
uygulanabilir bir plan yazmak.

Kesin kurallar:
1. Skorları değiştirme, yeniden puanlama yapma; sana verilen skorları nötr bir dille açıkla.
2. Doğuştan gelen yüz ve kemik yapısını kusur olarak niteleme. "Kötü, zayıf, çirkin, sorunlu, düzeltilmeli" deme.
3. Saç, sakal, renk önerilerini YALNIZ verilen preset listesinden seç (presetId). Egzersizleri yalnız verilen
   egzersiz listesinden, alışkanlıkları yalnız verilen alışkanlık listesinden, cilt adımlarını yalnız verilen
   adım türlerinden seç. Listede olmayan hiçbir şey önerme.
4. Teşhis koyma. Hastalık adını yalnız seeProfessional.text içinde ve "… gibi durumlar için bir dermatoloğa
   göstermek faydalı olabilir" kalıbıyla kullan.
5. İlaç, etken madde dozu, takviye, hormon, steroid, reçeteli ürün, cerrahi, estetik işlem, botoks, dolgu,
   mewing, bonesmashing, aç kalma, öğün atlama önerme.
6. faceContours.enabled = ${b}. false ise kilo/kalori/yağ oranından hiç bahsetme.
   true ise yalnız ılımlı ve sürdürülebilir öneriler ver; günlük açık 500 kcal'yi geçmesin.
7. exerciseEligible = ${e}. false ise exercises dizisini boş bırak.
8. headCovering = evet ise hair dizisini ve hairColor'ı boş bırak.
9. Cilt adımlarında marka değil ürün türü; bütçe ve günlük süreye uy.
10. Her potansiyel kazanç için linkedActions içine ilgili presetId / egzersiz / adım id'lerini yaz.
11. Dil: sade Türkçe, "sen" hitabı, kısa cümleler; looksmaxxing argosu yok.
12. Yalnız verilen JSON şemasına uygun çıktı üret.`;
}

/** Güvenlik ihlalinde 1 kez yeniden üretim için ek uyarı (SPEC 9.9). */
export function safetyRetryNote(rules: string[]): string {
  return `\n\nÖNEMLİ: Önceki yanıtta şu yasak içerik türleri bulundu: ${rules.join(", ")}. Bu içerikleri tamamen çıkar; aynı anlamı taşıyan ifadeler de yasaktır.`;
}

export type ReportUserInput = {
  overall: number;
  potential: number;
  subscores: Record<string, number>;
  gains: Record<string, { value: number; lever: string }>;
  observations: Record<string, string>;
  flags: { visibleSkinConcern: boolean; skinConcernNote: string | null };
  faceShape: { primary: string; secondary?: string; nameTr: string; descriptionTr: string };
  geometrySummary: Record<string, unknown>;
  questionnaire: Record<string, unknown>;
  catalog: Record<string, unknown>;
  headCovering: boolean;
};

export function buildReportUserMessage(i: ReportUserInput): string {
  return [
    `SKORLAR (kalibre, 1–10): genel ${i.overall}, potansiyel ${i.potential}, alt skorlar ${JSON.stringify(i.subscores)}`,
    `POTANSİYEL KAZANÇLAR (alan → değer ve ana kaldıraç): ${JSON.stringify(i.gains)}`,
    `GÖZLEMLER (fotoğraftan, nötr): ${JSON.stringify(i.observations)}`,
    `BAYRAKLAR: ${JSON.stringify(i.flags)}`,
    `YÜZ ŞEKLİ: ${i.faceShape.nameTr} (${i.faceShape.primary}${i.faceShape.secondary ? `, ${i.faceShape.secondary} ile arası` : ""}) — ${i.faceShape.descriptionTr}`,
    `GEOMETRİ ÖZETİ: ${JSON.stringify(i.geometrySummary)}`,
    `ANKET: ${JSON.stringify(i.questionnaire)}`,
    `headCovering = ${i.headCovering ? "evet" : "hayır"}`,
    `KATALOGLAR (yalnız bunlardan seç; id'leri birebir kullan): ${JSON.stringify(i.catalog)}`,
    `Çıktı: yalnız JSON.`,
  ].join("\n\n");
}
