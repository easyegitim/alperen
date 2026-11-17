import { describe, expect, it } from "vitest";
import {
  FRONT_MAX_BYTES,
  OPTIONAL_VIEWS,
  PROFILE_VIEWS,
  SIDE_MAX_BYTES,
  TOTAL_IMAGE_MAX_BYTES,
  VIEWS,
  VIEW_BY_KEY,
  VIEW_KEYS,
  YAW_POSITIVE_SIDE,
  checkViewSet,
  classifyView,
} from "@/lib/face/views";

describe("VIEWS (CONTRACTS_V2 §2, KB P#4)", () => {
  it("6 görünüm; ön zorunlu ve tek geometri kaynağı; profil grubu; 45° ve saç çizgisi isteğe bağlı", () => {
    expect(VIEWS.map((v) => v.key)).toEqual([...VIEW_KEYS]);
    expect(VIEW_BY_KEY.front.requirement).toBe("required");
    expect(VIEWS.filter((v) => v.geometry).map((v) => v.key)).toEqual(["front"]);
    for (const p of PROFILE_VIEWS) expect(VIEW_BY_KEY[p].requirement).toEqual({ group: "profile" });
    for (const o of OPTIONAL_VIEWS) expect(VIEW_BY_KEY[o].requirement).toBe("optional");
  });

  it("boyut tavanları: ön 768 px / 600 KB; diğerleri 640 px / 400 KB; toplam ≤ 3 MB", () => {
    expect(VIEW_BY_KEY.front).toMatchObject({ cropPx: 768, maxBytes: 600 * 1024, jpegQuality: 0.85 });
    for (const k of VIEW_KEYS.filter((k) => k !== "front")) expect(VIEW_BY_KEY[k]).toMatchObject({ cropPx: 640, maxBytes: 400 * 1024 });
    expect(FRONT_MAX_BYTES + 5 * SIDE_MAX_BYTES).toBe(TOTAL_IMAGE_MAX_BYTES);
    expect(TOTAL_IMAGE_MAX_BYTES).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it("etiket anahtarları camera.views.<key>", () => {
    for (const v of VIEWS) expect(v.labelKey).toBe(`camera.views.${v.key}`);
  });
});

describe("checkViewSet", () => {
  it("device_only: yalnız ön yeter; full: ön + en az bir profil", () => {
    expect(checkViewSet(["front"], "device_only")).toEqual({ ok: true });
    expect(checkViewSet(["front"], "full")).toEqual({ ok: false, reason: "profile_missing" });
    expect(checkViewSet(["front", "profile_right"], "full")).toEqual({ ok: true });
    expect(checkViewSet(["front", "left45", "right45", "hairline"], "full")).toEqual({ ok: false, reason: "profile_missing" });
    expect(checkViewSet(["profile_left"], "device_only")).toEqual({ ok: false, reason: "front_missing" });
  });
  it("tekrar ve bilinmeyen görünüm reddedilir", () => {
    expect(checkViewSet(["front", "front"], "device_only")).toEqual({ ok: false, reason: "duplicate_view" });
    expect(checkViewSet(["front", "top"], "device_only")).toEqual({ ok: false, reason: "unknown_view" });
  });
});

describe("classifyView(yaw)", () => {
  const left = YAW_POSITIVE_SIDE === "left" ? 1 : -1;
  it("|yaw| ≤ 15 ön; 25–60 yarım profil; ≥ 60 profil; 15–25 arada; sayı değilse geçersiz", () => {
    expect(classifyView(0)).toEqual({ view: "front" });
    expect(classifyView(-15)).toEqual({ view: "front" });
    expect(classifyView(20)).toEqual({ view: null, reason: "between" });
    expect(classifyView(40 * left)).toEqual({ view: "left45" });
    expect(classifyView(-40 * left)).toEqual({ view: "right45" });
    expect(classifyView(75 * left)).toEqual({ view: "profile_left" });
    expect(classifyView(-90 * left)).toEqual({ view: "profile_right" });
    expect(classifyView(Number.NaN)).toEqual({ view: null, reason: "invalid" });
  });
  it("eşikler VIEWS.yawAbsRange ile aynı", () => {
    expect(classifyView(VIEW_BY_KEY.left45.yawAbsRange[0] * left)).toEqual({ view: "left45" });
    expect(classifyView(VIEW_BY_KEY.profile_left.yawAbsRange[0] * left)).toEqual({ view: "profile_left" });
  });
});
