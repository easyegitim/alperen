import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { METHOD_FROM, parseMethodFrom } from "@/lib/config/method";

describe("parseMethodFrom (UI spec §5.2)", () => {
  it("kapalı listedeki değerler aynen", () => {
    for (const f of METHOD_FROM) expect(parseMethodFrom(f)).toBe(f);
  });
  it("bilinmeyen, dizi veya boş değer direct olur", () => {
    expect(parseMethodFrom("x@y.com")).toBe("direct");
    expect(parseMethodFrom(["guide"])).toBe("direct");
    expect(parseMethodFrom(undefined)).toBe("direct");
    expect(parseMethodFrom("")).toBe("direct");
  });
});

describe("/yontem sunucu sınırı", () => {
  it('"use client" izleyicisi yalnız bileşeni dışa aktarır (sunucu bileşeni istemci fonksiyonu çağıramaz)', () => {
    const src = readFileSync("components/marketing/MethodViewTracker.tsx", "utf8");
    expect(src.trimStart().startsWith('"use client"')).toBe(true);
    const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)].map((m) => m[1]);
    expect(exported).toEqual(["MethodViewTracker"]);
    const page = readFileSync("app/(marketing)/yontem/page.tsx", "utf8");
    expect(page).toMatch(/import \{ MethodViewTracker \} from "@\/components\/marketing\/MethodViewTracker"/);
  });
});
