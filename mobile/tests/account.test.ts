import { parseConsent, readAnalyticsConsent, setAnalyticsConsent, subscribeAnalyticsConsent } from "@/mobile/src/features/analytics/consent";
import { exportFileName, fileNameFromDisposition } from "@/mobile/src/features/account/exportName";

describe("hesap yardımcıları (M7)", () => {
  it("dışa aktarma dosya adı ve content-disposition ayrıştırma", () => {
    expect(exportFileName(new Date("2026-10-13T12:00:00Z"))).toBe("aura-verilerim-2026-10-13.json");
    expect(fileNameFromDisposition('attachment; filename="aura-verilerim-2026-10-13.json"', "x.json")).toBe("aura-verilerim-2026-10-13.json");
    expect(fileNameFromDisposition(null, "x.json")).toBe("x.json");
  });
  it("analitik izni yalnız granted/denied; diğerleri unset", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
    expect(parseConsent("x")).toBe("unset");
    expect(parseConsent(null)).toBe("unset");
  });
});

describe("analitik izni saklama (AsyncStorage mock)", () => {
  it("yaz/oku/abone", async () => {
    const seen: string[] = [];
    const unsub = subscribeAnalyticsConsent((c) => seen.push(c));
    await setAnalyticsConsent(true);
    expect(await readAnalyticsConsent()).toBe("granted");
    await setAnalyticsConsent(false);
    expect(await readAnalyticsConsent()).toBe("denied");
    unsub();
    expect(seen).toEqual(["granted", "denied"]);
  });
});
