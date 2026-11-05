// Plan seçimi istemi (PLAN 4e; KB §6.1, Ç2, K6–K10, Ek B). Sürüm: lib/ai/reportSchema.v3.ts PLAN_SELECTION_PROMPT_VERSION.
// Veri en aza indirilmiştir: skor, potansiyel, oran, boy, kilo, VKİ, çene sağlığı koşulları ve serbest not modele gitmez.
// Model yalnız verilen kayıtlardan kimlik seçer; kısıt kuralları (başörtüsü, sakal, egzersiz, yağ oranı) kodda uygulanır,
// liste zaten süzülmüş gelir. Rakam yazmaz; yapısal bölgeyi yargılamaz (Ek B dili).
import type { GoalDirection, PlanArea } from "@/lib/config/plan";
import type { MethodRecord } from "@/lib/coach/knowledge";
import type { ReportV3 } from "@/lib/score/contract";

export const PLAN_V3_SYSTEM = `Sen "Aura Koç"sun: Türkçe konuşan, saygılı, somut bir kişisel bakım ve stil danışmanı.
Görevin: sana verilen rapor bölgelerine, fotoğrafta görülen bakım ayrıntılarına ve kullanıcının cevaplarına göre
YÖNTEM LİSTESİNDEN uygun adımları seçmek. Planı kod kurar; sen yalnız seçer ve bir cümlelik gerekçe yazarsın.

Kesin kurallar:
1. Yalnız verilen listedeki "id" değerlerini birebir kullan. Listede olmayan hiçbir şeyi önerme, yeni yöntem uydurma.
2. 8–14 adım seç; alanları dengele (cilt, saç, sakal, kaş, alışkanlık, egzersiz, stil — hangileri listede varsa).
   Aynı kimliği iki kez seçme.
3. Her adım için "phase": ilk 4 hafta (weeks_0_4) kolay ve etkili adımlar; 1–3 ay (months_1_3) alışkanlık ve doku;
   3–6 ay (months_3_6) uzun süreli. Tek seferlik kesim/stil adımları ilk faza.
4. Her adım için "region": adımın cevap verdiği rapor bölgesi (brows, eyeArea, nose, lipsSmile, cheeks, jawline, skin, hair,
   beard). Yapısal bölgeler (eyeArea, nose, cheeks, jawline) bakımla değişmez; onlara yalnız saç, sakal, kaş, renk ve stil
   adımı bağla ve gerekçede "algıyı etkiler" dilini kullan.
5. "rationale": bir cümle, "sen" hitabı, nötr. Rakam, yüzde, skor, puan yazma. Kimseyle kıyaslama, sıralama yapma.
6. Doğuştan gelen yüz ve kemik yapısını kusur gibi niteleme; "kötü, zayıf, çirkin, sorunlu, düzeltilmeli" deme. Teşhis
   koyma, hastalık adı yazma.
7. İlaç, etken madde, doz, takviye, hormon, steroid, reçeteli ürün, cerrahi, estetik işlem, botoks, dolgu, mewing,
   bonesmashing, aç kalma, öğün atlama, kilo, kalori, yağ oranı yazma.
8. Hedef yönüne uy: "sharper_mature" kesim ve sakal hattını belirginleştiren stiller; "softer_younger" yumuşak doku ve
   hacim; "as_is_groomed" mevcut stili tazeleyen düzen adımları.
9. Kullanıcının günlük süresine ve bütçe bandına sığmayan adımları seçme; listede her kaydın dakika ve maliyet bandı var.
   Tek seferlik adımlar (kesim, uzman, klinik) için "oneTimeBudget" bandı geçerlidir; "none" ise aylık bandı aşan tek
   seferlik adım seçme. "presentation" sunumuna uymayan saç/sakal stili seçme.
10. Yalnız verilen JSON şemasına uygun çıktı üret.`;

export type PlanPromptQuestionnaire = {
  goals: string[];
  goalDirection: GoalDirection;
  budget: string;
  /** Tek seferlik uzman/klinik bütçe bandı (none/unknown dahil); kesim ve uzman adımları buna sığmalı. */
  oneTimeBudget: string;
  /** Sunum (profil): sakal/stil seçimi için; liste zaten kodla süzülmüş gelir. */
  presentation: "male" | "female" | "unspecified";
  minutesPerDay: number;
  sportDays: string;
  work: string;
  hairLengthPref: string;
  beardLengthPref: string;
  skinType: string;
  glasses: boolean | null;
  headCovering: boolean | null;
};

export type PlanPromptInput = {
  report: Pick<ReportV3, "letter" | "regions"> | null;
  /** Fotoğrafta görünen bakım ayrıntıları (nötr cümleler). */
  photoFacts: string[];
  /** "Önce odaklan" adım adları (kimlik + metin; sayı yok). */
  improveFirst: { stepId: string; step: string }[];
  faceShape: { primary: string; nameTr: string; descriptionTr: string } | null;
  questionnaire: PlanPromptQuestionnaire;
  allowedAreas: PlanArea[];
  records: readonly MethodRecord[];
};

/** Modele giden kompakt kayıt: id, alan, katman, ad, özet, kanıt, maliyet bandı, dakika, etiketler (ilk 6). */
export function recordForPrompt(r: MethodRecord) {
  return {
    id: r.id,
    area: r.area,
    tier: r.tier,
    title: r.title,
    summary: r.summary.slice(0, 160),
    evidence: r.evidence.level,
    cost: r.costBand,
    minutes: r.minutesPerDay,
    per: r.frequency.per,
    tags: r.tags.slice(0, 6),
  };
}

export function buildPlanUserMessageV3(i: PlanPromptInput): string {
  const regions = i.report?.regions.map((r) => ({ key: r.key, strength: r.strength, seen: r.seen, improvements: r.improvements })) ?? [];
  return [
    `RAPOR (bölge bölge; güçlü yan → görülen → fırsatlar; yapısal bölgeler tarif edilir, yargılanmaz): ${JSON.stringify(regions)}`,
    `FOTOĞRAFTA GÖRÜLEN BAKIM AYRINTILARI: ${JSON.stringify(i.photoFacts)}`,
    `ÖNCE ODAKLAN (motorun sırası; kimlikleri listede varsa önceliklendir): ${JSON.stringify(i.improveFirst)}`,
    `YÜZ ŞEKLİ (yalnız saç/sakal seçimi için): ${i.faceShape ? `${i.faceShape.nameTr} (${i.faceShape.primary}) — ${i.faceShape.descriptionTr}` : "bilinmiyor"}`,
    `ANKET (skoru etkilemez; yalnız planı): ${JSON.stringify(i.questionnaire)}`,
    `İZİNLİ ALANLAR (kod süzdü; başka alandan seçme): ${JSON.stringify(i.allowedAreas)}`,
    `YÖNTEM LİSTESİ (yalnız bunlardan seç; id'leri birebir kullan): ${JSON.stringify(i.records.map(recordForPrompt))}`,
    `Çıktı: yalnız JSON.`,
  ].join("\n\n");
}
