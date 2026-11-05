import { scoped, t } from "@/mobile/src/lib/i18n";

describe("i18n t() — messages/tr.json (CLAUDE.md: metinler tek kaynakta)", () => {
  it("iç içe anahtar ve değişken yerleştirme", () => {
    expect(t("common.startAnalysis")).toBe("Analizini başlat");
    expect(t("auth.codeSentTo", { email: "a@b.co" })).toBe("a@b.co adresine 6 haneli bir kod gönderdik.");
    expect(scoped("nav")("analysis")).toBe("Analiz");
  });
  it("eksik anahtar anahtarın kendisini döner (sessiz boş metin yok)", () => {
    expect(t("yok.boyle.bir.anahtar")).toBe("yok.boyle.bir.anahtar");
  });
});
