import { describe, expect, it } from "vitest";
import { adminEmails, isAdminUser } from "@/lib/api/admin";
import { generateRefCode, signStatusLink, verifyStatusLink } from "@/lib/experts/refCode";

const env = { REFERRAL_SIGNING_SECRET: "test-secret" };

describe("ref_code ve imzalı durum linki (SPEC 12.3)", () => {
  it("AU-XXXX-XXXX biçimi, karışabilen karakter yok, benzersiz", () => {
    const a = generateRefCode(), b = generateRefCode();
    expect(a).toMatch(/^AU-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(a).not.toBe(b);
  });
  it("imza doğrulanır; durum veya kod değişince geçersiz", () => {
    const sig = signStatusLink("AU-AAAA-BBBB", "contacted", env);
    expect(verifyStatusLink("AU-AAAA-BBBB", "contacted", sig, env)).toBe(true);
    expect(verifyStatusLink("AU-AAAA-BBBB", "booked", sig, env)).toBe(false);
    expect(verifyStatusLink("AU-AAAA-BBBC", "contacted", sig, env)).toBe(false);
    expect(verifyStatusLink("AU-AAAA-BBBB", "contacted", "", env)).toBe(false);
    expect(verifyStatusLink("AU-AAAA-BBBB", "hacked", sig, env)).toBe(false);
  });
  it("gizli anahtar yoksa imzalanamaz", () => {
    expect(() => signStatusLink("x", "sent", {})).toThrow(/REFERRAL_SIGNING_SECRET/);
  });
});

describe("ADMIN_EMAILS", () => {
  it("virgülle ayrılır, küçük harfe çevrilir; anonim asla admin değil", () => {
    const e = { ADMIN_EMAILS: " Kurucu@Aura.app, ops@aura.app " };
    expect(adminEmails(e)).toEqual(["kurucu@aura.app", "ops@aura.app"]);
    expect(isAdminUser({ email: "KURUCU@aura.app" }, e)).toBe(true);
    expect(isAdminUser({ email: "kurucu@aura.app", is_anonymous: true }, e)).toBe(false);
    expect(isAdminUser({ email: "x@aura.app" }, e)).toBe(false);
    expect(isAdminUser(null, e)).toBe(false);
    expect(isAdminUser({ email: "a@b.c" }, {})).toBe(false);
  });
});
