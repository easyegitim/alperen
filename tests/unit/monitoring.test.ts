import { describe, expect, it } from "vitest";
import { sanitizeProps } from "@/lib/analytics";
import { beforeSend, scrubText, scrubValue } from "@/lib/monitoring/sentry";

describe("Sentry gövde temizliği (SPEC 16.4)", () => {
  it("base64 JPEG ve e-posta maskelenir", () => {
    const s = scrubText("img=/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL mail=ali@example.com");
    expect(s).not.toContain("/9j/4AAQ");
    expect(s).toContain("[jpeg]");
    expect(s).toContain("[email]");
  });
  it("hassas anahtarlar kızartılır, uzun diziler kısaltılır", () => {
    const v = scrubValue({ image: "x", overall: 7.2, nested: { landmarks: [1, 2, 3], ok: "a" }, big: Array.from({ length: 478 }, () => 1) }) as Record<string, unknown>;
    expect(v.image).toBe("[redacted]");
    expect(v.overall).toBe("[redacted]");
    expect((v.nested as Record<string, unknown>).landmarks).toBe("[redacted]");
    expect(v.big).toBe("[array:478]");
  });
  it("beforeSend istek gövdesi, çerez, başlık ve kullanıcıyı siler", () => {
    const ev = beforeSend(
      {
        type: undefined,
        request: { data: { image: "/9j/…" }, cookies: { sb: "x" }, headers: { cookie: "x" }, url: "https://aura.app/analiz?auth_error=1", query_string: "auth_error=1" },
        user: { id: "u1", email: "a@b.co" },
        message: "hata a@b.co",
        extra: { overall: 7, photo: "x" },
        breadcrumbs: [{ message: "fetch /9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8", data: { email: "a@b.co" } }],
        exception: { values: [{ type: "Error", value: "x a@b.co" }] },
      },
      {},
    );
    expect(ev).not.toBeNull();
    expect(ev?.request?.data).toBeUndefined();
    expect(ev?.request?.cookies).toBeUndefined();
    expect(ev?.request?.headers).toBeUndefined();
    expect(ev?.request?.url).toBe("https://aura.app/analiz");
    expect(ev?.user).toBeUndefined();
    expect(ev?.message).toBe("hata [email]");
    expect((ev?.extra as Record<string, unknown>).overall).toBe("[redacted]");
    expect(ev?.breadcrumbs?.[0].message).toContain("[jpeg]");
    expect(ev?.exception?.values?.[0].value).toBe("x [email]");
  });
});

describe("analitik özellik filtresi (SPEC 17.1)", () => {
  it("fotoğraf, skor, metrik, e-posta anahtarları ve nesneler düşer", () => {
    expect(sanitizeProps({ tier: "free", image: "x", overall: 7, email: "a@b", geometry: { a: 1 }, nested: { b: 1 }, long: "x".repeat(300) })).toEqual({ tier: "free" });
    expect(sanitizeProps(undefined)).toBeUndefined();
  });
});
