// Ton koruması (UI spec §8.1, engine spec §7.4): yeni/değişen arayüz metinlerinde aşağılayıcı dil, looksmaxxing argosu,
// sıralama/ortalama dili, yayımlanmayan yöntem iddiaları ve saç göstermeyi isteyen ifade yok.
import { describe, expect, it } from "vitest";
import tr from "@/messages/tr.json";
import { normalizeTr } from "@/lib/ai/safety";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { VIEW_KEYS } from "@/lib/face/views";
import { CAPTURE_HINTS, LEVER_KEYS, MOD_EXPLAIN_KEYS, NOT_ASSESSED_REASONS, STRUCTURAL_EXPLAIN_KEYS } from "@/lib/score/contract";

type Tree = { [k: string]: string | Tree };
function isTree(v: unknown): v is Tree {
  return typeof v === "object" && v !== null && Object.values(v).every((x) => typeof x === "string" || isTree(x));
}
const loaded: unknown = tr;
if (!isTree(loaded)) throw new Error("tr.json yalnız iç içe metinlerden oluşmalı");
const root: Tree = loaded;

function at(path: string): string | Tree {
  let cur: string | Tree = root;
  for (const p of path.split(".")) {
    if (typeof cur === "string" || !(p in cur)) throw new Error(`tr.json'da yok: ${path}`);
    cur = cur[p]!;
  }
  return cur;
}

function leaves(path: string): [string, string][] {
  const node = at(path);
  if (typeof node === "string") return [[path, node]];
  return Object.keys(node).flatMap((k) => leaves(`${path}.${k}`));
}

/** UI spec §8.1 ve engine spec §7.4 bloklarındaki yeni veya değişen anahtarlar. */
const WALKED = [
  "analysis.pageTitle",
  "analysis.lockedAriaFor",
  "analysis.seePlan",
  "analysis.legacyNote",
  "analysis.processingRefresh",
  "analysis.disclaimerHybrid",
  "analysis.hero",
  "analysis.reference",
  "analysis.subsLegend",
  "analysis.subWhat",
  "analysis.notAssessed",
  "analysis.improveFirst",
  "analysis.levers",
  "analysis.captureHints",
  "analysis.overlay",
  "analysis.explain",
  "analysis.reveal",
  "analysis.progress.v2",
  "analysis.errors.CAPTURE_QUALITY",
  "analysis.errors.AI_SAFETY_BLOCKED",
  "analysis.obs",
  "geometry.noteV2",
  "geometry.tilt",
  "paywall.context",
  "paywall.includes.i5",
  "paywall.includes.i6",
  "paywall.notAssessedNote",
  "paywall.anchor",
  "paywall.seePlans",
  "paywall.plansTitle",
  "paywall.backAria",
  "paywall.continueWith",
  "paywall.backToAnalysis",
  "paywall.methodLink",
  "paywall.eyebrow",
  "paywall.lead",
  "paywall.perks",
  "paywall.details",
  "paywall.bestValue",
  "paywall.pageLead",
  "checkout.secure",
  "checkout.steps",
  "checkout.consentTitle",
  "account.subscription.statusActive",
  "account.subscription.statusCanceling",
  "account.subscription.statusFree",
  "camera.guide.lead",
  "camera.guide.tipsShort",
  "camera.guide.tipsMore",
  "camera.captured.lead",
  "camera.captured.sendNote",
  "tryon.lockedPerks",
  "tryon.remainingLabel",
  "tryon.retry",
  "tryon.sliderHint",
  "account.export.kvkkNote",
  "camera.trust",
  "camera.warnings",
  "camera.live.manual",
  "camera.live.manualHint",
  "camera.review.relaxedNote",
  "camera.captured.fromGallery",
  "camera.captured.qualityAria",
  "camera.captured.quality",
  "report.basis",
  "report.jumpNav",
  "common.notFound",
  "progress.trendEmptyTitle",
  "progress.trendEmptyBody",
  "progress.trendNextSlot",
  "method",
  // v2 (CONTRACTS_V2.md §7): KB'nin karara bağladığı metinler ve ayrılan ad alanları
  "common.aiGenerated",
  "auth.signIn",
  "onboarding.flow",
  "onboarding.age",
  "onboarding.gender",
  "onboarding.consents",
  "camera.views",
  "camera.qualityPrompt",
  "camera.gallery",
  "camera.live.shutter",
  "camera.live.sideHint",
  "camera.guide.tips.distance",
  "camera.captured.eyebrowV2",
  "camera.captured.leadV2",
  "camera.captured.sendNoteV2",
  "analysis.deviceProgress",
  "geometry.faceShapePrelim",
  "geometry.nearTo",
  "analysis.sub.brows",
  "analysis.scoreNote",
  "analysis.competitorsNote",
  "analysis.rangeLabel",
  "analysis.percentile",
  "analysis.noChange",
  "analysis.explain5",
  "analysis.locked",
  "analysis.faceShapeV2",
  "analysis.stage",
  "paywall.v2",
];
const walked = WALKED.flatMap(leaves);

// "kötüye kullanım" (hukuki terim, method.data.photo) yargı değildir; yalnız bu kalıp muaf.
// "sonuç zayıf olabilir" (KB §3.1 kalite pop-up'ı) fotoğrafı tarif eder; "iyi ya da kötü anlamı taşımaz" (KB P§1 oran
// notu) yargının yokluğunu söyler. Yalnız bu iki KARAR kalıbı muaf.
const BANNED = /cirkin|kotu(?!ye kullanim| anlami tasimaz)|kusur|zayif(?! olabilir)|problem|sorun|\bpsl\b|\bmog|chad|incel|yuzdelik dilim|ortalama/;
const UNPUBLISHED_METHOD_CLAIM = /diger alanlardan hesapla|notr deger|uc degerlere gitmez|temkinli degerlendirilir/;
const ASKS_TO_SHOW_HAIR = /sacinin ust kismi|basini ac|sacini goster/;

const keysOf = (path: string, omit?: string) => Object.keys(at(path) as Tree).filter((k) => k !== omit).sort();

describe("tr.json ton koruması (yeni ve değişen metinler)", () => {
  it("yürünen anahtarlar boş değil ve hepsi metin", () => {
    expect(walked.length).toBeGreaterThan(150);
    for (const [path, v] of walked) expect(typeof v, path).toBe("string");
  });

  it("aşağılayıcı dil, argo, sıralama/ortalama dili yok", () => {
    for (const [path, v] of walked) expect(normalizeTr(v), path).not.toMatch(BANNED);
  });

  it("gözlem cümlelerinde rakam ve hastalık adı yok; uzman notu kalıba uyar", () => {
    for (const [path, v] of leaves("analysis.obs")) {
      expect(v, path).not.toMatch(/\d/);
      expect(normalizeTr(v), path).not.toMatch(/rosacea|rozasea|egzama|dermatit|akne vulgaris|sedef|mantar/);
    }
    expect(at("analysis.obs.skinConcernNote")).toMatch(/dermatoloğa göstermek faydalı olabilir\.$/);
  });

  it("anahtar kümeleri sözleşmeyle birebir", () => {
    expect(keysOf("analysis.levers")).toEqual([...LEVER_KEYS].sort());
    expect(keysOf("analysis.explain.items")).toEqual([...STRUCTURAL_EXPLAIN_KEYS, ...MOD_EXPLAIN_KEYS].sort());
    expect(keysOf("analysis.captureHints", "title")).toEqual([...CAPTURE_HINTS].sort());
    expect(keysOf("analysis.notAssessed", "value")).toEqual([...NOT_ASSESSED_REASONS].sort());
  });

  it("yöntem iddiaları: cilt tanımında kızarıklık/leke yok; yayımlanmayan kurallar hiçbir yerde yok", () => {
    expect(normalizeTr(String(at("analysis.subWhat.skin")))).not.toMatch(/kizariklik|leke/);
    for (const top of ["analysis", "method", "camera"]) {
      for (const [path, v] of leaves(top)) expect(normalizeTr(v), path).not.toMatch(UNPUBLISHED_METHOD_CLAIM);
    }
    for (const [path, v] of leaves("method")) {
      expect(v, path).not.toContain("5,5");
      expect(normalizeTr(v), path).not.toContain("referans degeri");
    }
  });

  it("hiçbir metin saçı göstermeyi, başı açmayı istemez", () => {
    for (const [path, v] of [...walked, ...leaves("camera.warnings")]) expect(normalizeTr(v), path).not.toMatch(ASKS_TO_SHOW_HAIR);
  });

  it("KB'nin karara bağladığı metinler birebir (CONTRACTS_V2 §7)", () => {
    expect(at("common.aiGenerated")).toBe("Aura ile oluşturuldu · YZ simülasyonu");
    expect(at("camera.qualityPrompt.body")).toBe("Işık yetersiz ya da fotoğraf bulanık; sonuç zayıf olabilir. Yine de devam edilsin mi?");
    expect(at("camera.qualityPrompt.yes")).toBe("Evet");
    expect(at("camera.qualityPrompt.no")).toBe("Hayır");
    expect(at("analysis.locked.ratiosNote")).toBe("Bu oranlar yalnız tarif eder; iyi ya da kötü anlamı taşımaz. Skorlamaya bağlam olarak gider.");
    expect(at("analysis.scoreNote")).toBe("Bu skor yapay zekânın fotoğraf üzerinden tahminidir; ışık ve açıyla değişebilir, kişisel değerini ölçmez.");
    expect(at("analysis.percentile")).toBe("İnsanların %{p}'inden yüksek");
    expect(keysOf("onboarding.age.bands")).toEqual(["18_24", "25_34", "35_49", "50_plus", "under_18"]);
    expect(keysOf("onboarding.gender.options")).toEqual(["female", "male", "unspecified"]);
    expect(keysOf("analysis.sub")).toEqual([...SUB_KEYS_V2].sort());
    expect(keysOf("camera.views").filter((k) => (VIEW_KEYS as readonly string[]).includes(k)).sort()).toEqual([...VIEW_KEYS].sort());
    expect(keysOf("analysis.explain5", "structuralNote")).toEqual(["confidenceNote", "held", "lookedAt", "lowered", "raise"]);
    // "ücretsiz" sözü paywall'da yok (KB R2-Ö5); Yapısal/Geliştirilebilir rozetleri v2 ekranında kullanılmaz
    for (const [path, v] of leaves("paywall.v2")) expect(normalizeTr(v), path).not.toMatch(/ucretsiz|bedava/);
    expect(JSON.stringify(tr)).not.toContain("Yapay zekâ ile oluşturuldu");
  });

  it("e2e metinleri korunur (UI spec §8.4)", () => {
    expect(String(at("analysis.seePlan"))).toMatch(/planı gör/i);
    expect(at("camera.review.use")).toBe("Bu fotoğrafı kullan");
    expect(at("camera.review.retake")).toBe("Yeniden çek");
    expect(at("camera.live.cancel")).toBe("Vazgeç");
    expect(at("analysis.start")).toBe("Analizi başlat");
    expect(at("analysis.unlock")).toBe("Kilidi aç");
    expect(at("geometry.faceShape")).toMatch(/yüz şekli/i);
    expect(at("paywall.seePlans")).toBe("Planları gör");
    expect(String(at("paywall.continueWith"))).toMatch(/^Devam et/);
    expect(JSON.stringify(tr)).not.toContain("₺8.750");
  });
});
