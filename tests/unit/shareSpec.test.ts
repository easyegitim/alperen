// Paylaşım kartı sözleşmesi (KB §8 R2-Ö3/Ö2, K17; CONTRACTS_V2 Sprint 3 S3.3): saf spec; reklam kartında fotoğraf yok.
import { describe, expect, it } from "vitest";
import tr from "@/messages/tr.json";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { SHARE_CARD_KINDS, SHARE_CARD_SIZES, SHARE_RULES, shareFileName, shareSpecIssues, strongestSub, topSubs, type BarberShareSpec, type ScoreShareSpec, type StrongestShareSpec } from "@/lib/share/spec";

const common = { format: "story" as const, audience: "personal" as const, appName: "Aura", url: "aura.app", disclaimer: tr.share.v2.disclaimer, withPhoto: false };
const score: ScoreShareSpec = { ...common, kind: "score", overall: 6.4, potential: 7.2, subs: [{ key: "eyes", label: "Göz bölgesi", value: 7.1 }] };
const strongest: StrongestShareSpec = { ...common, kind: "strongest", sub: "eyes", title: tr.share.v2.strongestTitle.replace("{area}", "göz bölgesi"), line: "Göz çevresi dengeli ve dinlenmiş görünüyor." };
const barber: BarberShareSpec = { ...common, kind: "barber", barber: { styleName: "Buzz kesim", sidesGuard: "2", topLengthCm: 3 }, presetIds: { hair: "h_buzz" }, lines: ["Yanlar: 2 numara"], withPhoto: false };

describe("kurallar", () => {
  it("üç kart türü, iki boyut; tr.json anahtarları türlerle birebir", () => {
    expect([...SHARE_CARD_KINDS]).toEqual(["score", "strongest", "barber"]);
    expect(Object.keys(tr.share.v2.kinds).sort()).toEqual([...SHARE_CARD_KINDS].sort());
    expect(SHARE_CARD_SIZES.story).toEqual({ w: 1080, h: 1920 });
    expect(tr.share.v2.strongestTitle).toBe("En güçlü yanın: {area}");
  });
  it("geçerli spec'lerde sorun yok", () => {
    expect(shareSpecIssues(score)).toEqual([]);
    expect(shareSpecIssues({ ...score, withPhoto: true })).toEqual([]);
    expect(shareSpecIssues(strongest)).toEqual([]);
    expect(shareSpecIssues(barber)).toEqual([]);
  });
  it("reklam kartında kullanıcı fotoğrafı yok (K17); berber kartı fotoğrafsız", () => {
    expect(shareSpecIssues({ ...score, audience: "marketing", withPhoto: true })).toContain("photo_on_marketing_card");
    expect(shareSpecIssues({ ...strongest, audience: "marketing", withPhoto: true })).toContain("photo_on_marketing_card");
    expect(SHARE_RULES.photoAllowed("score", "marketing")).toBe(false);
    expect(SHARE_RULES.photoAllowed("barber", "personal")).toBe(false);
    expect(SHARE_RULES.photoAllowed("strongest", "personal")).toBe(true);
    // Tip sistemi barber.withPhoto'yu false'a zorlar; çalışma zamanı kapısı da var
    expect(shareSpecIssues({ ...barber, withPhoto: true as unknown as false })).toContain("photo_on_barber_card");
  });
  it("aralık ve uzunluk kapıları", () => {
    expect(shareSpecIssues({ ...score, overall: 10.4 })).toContain("score_out_of_range");
    expect(shareSpecIssues({ ...score, subs: Array.from({ length: 4 }, (_, i) => ({ key: SUB_KEYS_V2[i], label: "x", value: 6 })) })).toContain("too_many_subs");
    expect(shareSpecIssues({ ...strongest, line: "a".repeat(121) })).toContain("line_too_long");
    expect(shareSpecIssues({ ...barber, barber: { styleName: " " } })).toContain("barber_style_missing");
    expect(shareSpecIssues({ ...score, url: "" })).toContain("url_missing");
  });
});

describe("yardımcılar", () => {
  it("en güçlü alt skor: en yüksek açık değer; eşitlikte sıra; kilitli (null) atlanır", () => {
    expect(strongestSub({ harmony: { value: 6 }, eyes: { value: 7.5 }, skin: null, brows: { value: 7.5 } })).toBe("eyes");
    expect(strongestSub({})).toBeNull();
  });
  it("skor kartı için en yüksek 3", () => {
    const subs = topSubs({ harmony: { value: 6 }, eyes: { value: 7.5 }, jawline: { value: 7 }, skin: { value: 5 }, hair: { value: 7 } }, (k) => k);
    expect(subs.map((s) => s.key)).toEqual(["eyes", "jawline", "hair"]);
  });
  it("dosya adı", () => {
    expect(shareFileName("barber", new Date("2026-11-04T10:00:00Z"))).toBe("aura-barber-20261104.jpg");
  });
});
