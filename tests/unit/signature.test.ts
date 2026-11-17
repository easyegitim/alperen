import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthorization, randomKey } from "@/lib/billing/signature";

describe("IYZWSv2 imzası (resmi SDK utils.generateHashV2 ile aynı)", () => {
  it("başlık biçimi ve HMAC-SHA256 hex imza", () => {
    const apiKey = "sandbox-key", secret = "sandbox-secret", path = "/v2/subscription/checkoutform/initialize", body = JSON.stringify({ locale: "tr" }), rnd = "1733000000abcdef";
    const header = buildAuthorization(apiKey, secret, path, body, rnd);
    expect(header.startsWith("IYZWSv2 ")).toBe(true);
    const decoded = Buffer.from(header.slice("IYZWSv2 ".length), "base64").toString("utf8");
    const expectedSig = createHmac("sha256", secret).update(rnd + path + body).digest("hex");
    expect(decoded).toBe(`apiKey:${apiKey}&randomKey:${rnd}&signature:${expectedSig}`);
  });
  it("yol veya gövde değişince imza değişir; GET'te gövde '{}'", () => {
    const a = buildAuthorization("k", "s", "/v2/a", "{}", "r");
    expect(a).not.toBe(buildAuthorization("k", "s", "/v2/b", "{}", "r"));
    expect(a).not.toBe(buildAuthorization("k", "s", "/v2/a", '{"x":1}', "r"));
  });
  it("randomKey her çağrıda farklı ve yeterince uzun", () => {
    const a = randomKey(), b = randomKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});
