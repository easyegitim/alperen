import { describe, expect, it } from "vitest";
import { SAFETY_RULES, scanReport, scanTextV2 } from "@/lib/ai/safety";

// PLAN_V2 3f: safety.ts genişletmesi (yapısal eleştiri, kıyas, düz yazıda sayı) ve "dolgu" kelime sınırı düzeltmesi.

const rules = (t: string, allow = false) => scanTextV2(t, "p", { allowMaybeDiagnosis: allow }).map((v) => v.rule);

describe("dolgu kelime sınırı", () => {
  it("'dolgun sakal' ihlal değil; 'dolgu yaptır' medical_procedure (v1 scanReport da aynı)", () => {
    expect(rules("Orta dolgun sakal çeneyi dengeler.")).toEqual([]);
    expect(rules("Dudağa dolgu yaptırabilirsin.")).toContain("medical_procedure");
    expect(scanReport({ style: ["Orta dolgun sakal dene."] }, { faceContoursEnabled: false })).toEqual([]);
    expect(scanReport({ style: ["Dolgu düşünebilirsin."] }, { faceContoursEnabled: false }).map((v) => v.rule)).toEqual(["medical_procedure"]);
  });
});

describe("scanTextV2 kuralları", () => {
  it("yapısal eleştiri (Ek B 1–5) ve kıyas/sıralama (Ek B 6, 9) yakalanır; tarif dili geçer", () => {
    expect(rules("Burnun basık burun yapısında.")).toContain("structural_critique");
    expect(rules("En büyük sorunun çene hattı.")).toContain("structural_critique");
    expect(rules("Dudakların ince dudak sayılır, ideal değil.")).toContain("structural_critique");
    expect(rules("Yüzün asimetrik.")).toContain("structural_critique");
    expect(rules("Çoğu insandan daha iyi görünüyorsun.")).toContain("comparison");
    expect(rules("Daha erkeksi görünmek için…")).toContain("comparison");
    expect(rules("Ünlü bir oyuncuya benziyorsun.")).toContain("comparison");
    expect(rules("Çene hattı yan profilde yumuşak geçişli; sakal hattı netleştirir.")).toEqual([]);
    expect(rules("Dudak yüzeyi nemli ve düzenli.")).toEqual([]);
  });
  it("'kusursuz' (olumlu) ihlal değil; 'kusur', 'kusurlu', 'kusurlar' yakalanır", () => {
    expect(rules("Cilt dokusu neredeyse kusursuz görünüyor.")).toEqual([]);
    expect(rules("Burnunda belirgin bir kusur var.")).toContain("structural_critique");
    expect(rules("Kusurlar dikkat çekiyor.")).toContain("structural_critique");
    expect(rules("Kusurlu bir yapı.")).toContain("slur");
  });
  it("'ışık çok düşük' çekim notu serbest; 'puanın çok düşük' / 'çene çok düşük' yakalanır", () => {
    expect(rules("Işık çok düşük olduğu için güven orta.")).toEqual([]);
    expect(rules("Kontrast çok düşük; ikinci açı yardımcı olur.")).toEqual([]);
    expect(rules("Çene belirginliği çok düşük.")).toContain("structural_critique");
    expect(rules("Bu alanda puanın çok düşük.")).toContain("structural_critique");
  });
  it("kelime sınırı: 'birkaç' ırk sayılmaz; 'ırk' sayılır", () => {
    expect(rules("Birkaç hafta düzenli bakım yeter.")).toEqual([]);
    expect(rules("Irk özelliklerine göre…")).toContain("comparison");
  });
  it("düz yazıda rakam → score_in_text; kalori → calorie; hastalık adı yalnız 'olabilir' kalıbıyla serbest", () => {
    expect(rules("Cildin 7,5 puan.")).toContain("score_in_text");
    expect(rules("SPF 30 kullan.")).toContain("score_in_text");
    expect(rules("Günde 500 kcal açık")).toEqual(expect.arrayContaining(["calorie", "score_in_text"]));
    expect(rules("Rozasea belirtisi var.")).toContain("diagnosis");
    expect(rules("Yanaklardaki kızarıklık için bir dermatoloğa göstermek faydalı olabilir.", true)).toEqual([]);
    expect(rules("Rozasea olabilir.", true)).toEqual([]);
    expect(rules("Rozasea olabilir.", false)).toContain("diagnosis");
  });
  it("aşağılayıcı dil ve argo, ilaç/işlem, zararlı pratik yine yakalanır", () => {
    expect(rules("Berbat bir görünüm.")).toContain("slur");
    expect(rules("Mewing dene.")).toContain("harmful_practice");
    expect(rules("Minoksidil kullan.")).toContain("drugs");
    expect(rules("Botoks önerilir.")).toContain("medical_procedure");
    expect(SAFETY_RULES).toEqual(expect.arrayContaining(["structural_critique", "comparison", "score_in_text"]));
  });
});
