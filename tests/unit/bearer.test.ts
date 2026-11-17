import { describe, expect, it } from "vitest";
import { parseBearer } from "@/lib/api/bearer";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz0123456789";

describe("parseBearer (SPEC-MOBILE M2)", () => {
  it("geçerli Bearer JWT'yi döndürür (büyük/küçük harf ve boşluk toleranslı)", () => {
    expect(parseBearer(`Bearer ${jwt}`)).toBe(jwt);
    expect(parseBearer(`bearer   ${jwt} `)).toBe(jwt);
  });
  it("başlık yoksa, şeması farklıysa veya JWT'ye benzemiyorsa null", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer garbage")).toBeNull();
    expect(parseBearer("Bearer a.b")).toBeNull();
  });
});
