import { describe, expect, it } from "vitest";
import { DOCTOR_LAYER } from "@/lib/config/plan";
import { bodyImageScreenResult, deliverableItems, doctorLayerState, doctorStepCard } from "@/lib/doctor/rules";
import { DELIVERABLE_STATUSES, DOCTOR_STATUSES, isAllowedSourceUrl, validateDoctorItems, type DoctorItem } from "@/lib/doctor/types";

const item = (over: Partial<DoctorItem> = {}): DoctorItem => ({ methodId: "m_sample_doctor_topical", area: "skin", rationale: "Bu konuda karar muayenede hekimindir; cilt yüzeyi için değerlendirme.", sources: ["https://www.titck.gov.tr/kubkt"], ...over });

describe("doktor katmanı (KB Ç3/Ç5, §6.1, §6.4; PLAN 4f; AUP high-risk)", () => {
  it("TESLİM İMKÂNSIZ: physician_reviewed olmadan hiçbir öğe kullanıcıya dönmez (draft/rejected → boş; ai_items asla)", () => {
    const ai = [item({ rationale: "YZ taslağı" })];
    for (const status of DOCTOR_STATUSES) {
      const row = { status, ai_items: ai, physician_items: status === "draft" || status === "rejected" ? null : [item()] };
      const out = deliverableItems(row);
      if (DELIVERABLE_STATUSES.includes(status)) expect(out).toHaveLength(1);
      else expect(out).toEqual([]);
      expect(JSON.stringify(out)).not.toContain("YZ taslağı");
    }
    // Taslak satır physician_items taşısa bile (tutarsız veri) draft durumunda dönmez
    expect(deliverableItems({ status: "draft", ai_items: ai, physician_items: [item()] })).toEqual([]);
    // physician_items bozuksa (şema dışı) onaylı satırda bile boş
    expect(deliverableItems({ status: "physician_reviewed", ai_items: ai, physician_items: [{ methodId: "x" }] })).toEqual([]);
    expect(DOCTOR_LAYER.deliverableStatus).toBe("physician_reviewed");
  });

  it("katman durumu: flag kapalı → off; 18 altı → under_18; tarama yok → screen_required; risk → screen_risk; satırlara göre", () => {
    expect(doctorLayerState({ flagEnabled: false, under18: false, screen: "ok", rows: [{ status: "physician_reviewed" }] })).toBe("off");
    expect(doctorLayerState({ flagEnabled: true, under18: true, screen: "ok", rows: [{ status: "physician_reviewed" }] })).toBe("under_18");
    expect(doctorLayerState({ flagEnabled: true, under18: false, screen: null, rows: [] })).toBe("screen_required");
    expect(doctorLayerState({ flagEnabled: true, under18: false, screen: "risk", rows: [{ status: "physician_reviewed" }] })).toBe("screen_risk");
    expect(doctorLayerState({ flagEnabled: true, under18: false, screen: "ok", rows: [{ status: "draft" }] })).toBe("pending_review");
    expect(doctorLayerState({ flagEnabled: true, under18: false, screen: "ok", rows: [{ status: "rejected" }] })).toBe("none");
    expect(doctorLayerState({ flagEnabled: true, under18: false, screen: "ok", rows: [{ status: "draft" }, { status: "delivered" }] })).toBe("available");
  });

  it("beden algısı taraması: eşik 2 evet → risk; yalnız sonuç (cevap saklanmaz)", () => {
    expect(bodyImageScreenResult({ q1: false, q2: false, q3: false, q4: false })).toBe("ok");
    expect(bodyImageScreenResult({ q1: true, q2: false, q3: false, q4: false })).toBe("ok");
    expect(bodyImageScreenResult({ q1: true, q2: true, q3: false, q4: false })).toBe("risk");
    expect(bodyImageScreenResult({ q1: false, q2: false, q3: true, q4: true })).toBe("risk");
  });

  it("öğe doğrulaması (Ç5): doz, satış/eczane, izinsiz alan adı, bilinmeyen yöntem düşer; en çok iki öğe", () => {
    const known = new Set(["m_sample_doctor_topical", "m2", "m3"]);
    expect(validateDoctorItems([item()], known).valid).toHaveLength(1);
    expect(validateDoctorItems([item({ rationale: "Günde 2 kez 5 mg" })], known).issues[0]?.issue).toBe("dose");
    expect(validateDoctorItems([item({ rationale: "%5 yoğunlukta uygula" })], known).issues[0]?.issue).toBe("dose");
    expect(validateDoctorItems([item({ rationale: "Eczaneden sipariş ver" })], known).issues[0]?.issue).toBe("sales");
    expect(validateDoctorItems([item({ sources: ["https://magaza.example.com/urun"] })], known).issues[0]?.issue).toBe("source_host");
    expect(validateDoctorItems([item({ sources: ["http://www.titck.gov.tr/x"] })], known).issues[0]?.issue).toBe("source_host");
    expect(validateDoctorItems([item({ methodId: "uydurma" })], known).issues[0]?.issue).toBe("unknown_method");
    const three = validateDoctorItems([item(), item({ methodId: "m2" }), item({ methodId: "m3" })], known);
    expect(three.valid).toHaveLength(2);
    expect(three.issues[0]?.issue).toBe("too_many");
    expect(isAllowedSourceUrl("https://doi.org/10.1000/xyz")).toBe(true);
    expect(isAllowedSourceUrl("https://pubmed.ncbi.nlm.nih.gov/1/")).toBe(true);
    expect(isAllowedSourceUrl("https://www.cochranelibrary.com/cdsr/doi/1")).toBe(true);
    expect(isAllowedSourceUrl("https://evil.titck.gov.tr.example.com/")).toBe(false);
    expect(isAllowedSourceUrl("javascript:alert(1)")).toBe(false);
  });

  it("hekim öğesi → doktor katmanı kartı (tier doctor; plana yazılmaz, okuma anında eklenir)", () => {
    const card = doctorStepCard(item(), null);
    expect(card.tier).toBe("doctor");
    expect(card.title).toBe("m_sample_doctor_topical");
    expect(card.evidence.source).toBe("https://www.titck.gov.tr/kubkt");
  });
});
