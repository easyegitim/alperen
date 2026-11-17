import { describe, expect, it } from "vitest";
import { ensureTestLoginFlag, isSettingsFileName, pickNewest, TEST_LOGIN_LINE } from "../../scripts/aura-launcher.mjs";

describe("aura-launcher: ayar dosyası adı", () => {
  it("indirme sırasında değişen adları tanır", () => {
    for (const n of ["aura-ayarlar.env", "aura-ayarlar (1).env", "aura-ayarlar (2).env", "aura-ayarlar-1.env", "aura-ayarlar.env.txt", "Aura-Ayarlar.env"]) {
      expect(isSettingsFileName(n)).toBe(true);
    }
  });
  it("başka dosyaları almaz", () => {
    for (const n of [".env.local", ".env", "aura-ayarlar.zip", "baska.env", "aura-ayarlar.env.bak"]) {
      expect(isSettingsFileName(n)).toBe(false);
    }
  });
});

describe("aura-launcher: en yeni dosya", () => {
  it("değişiklik zamanı en büyük olanı seçer", () => {
    expect(pickNewest([{ path: "a", mtimeMs: 1 }, { path: "b", mtimeMs: 3 }, { path: "c", mtimeMs: 2 }])).toBe("b");
  });
  it("aday yoksa null", () => {
    expect(pickNewest([])).toBeNull();
  });
});

describe("aura-launcher: test girişi bayrağı", () => {
  it("yoksa sona ekler", () => {
    expect(ensureTestLoginFlag("A=1\n")).toBe(`A=1\n${TEST_LOGIN_LINE}\n`);
    expect(ensureTestLoginFlag("A=1")).toBe(`A=1\n${TEST_LOGIN_LINE}\n`);
    expect(ensureTestLoginFlag("")).toBe(`${TEST_LOGIN_LINE}\n`);
  });
  it("zaten açıksa dokunmaz (CRLF dahil)", () => {
    expect(ensureTestLoginFlag(`A=1\n${TEST_LOGIN_LINE}\n`)).toBe(`A=1\n${TEST_LOGIN_LINE}\n`);
    expect(ensureTestLoginFlag(`A=1\r\n${TEST_LOGIN_LINE}\r\n`)).toBe(`A=1\r\n${TEST_LOGIN_LINE}\r\n`);
  });
  it("boş ya da kapalı değeri son satırla açar", () => {
    expect(ensureTestLoginFlag("NEXT_PUBLIC_TEST_PASSWORD_LOGIN=\n")).toBe(`NEXT_PUBLIC_TEST_PASSWORD_LOGIN=\n${TEST_LOGIN_LINE}\n`);
    expect(ensureTestLoginFlag(`${TEST_LOGIN_LINE}\nNEXT_PUBLIC_TEST_PASSWORD_LOGIN=false\n`)).toContain(`false\n${TEST_LOGIN_LINE}\n`);
  });
});
