import { describe, expect, it } from "vitest";
import { isPremium } from "@/lib/billing/entitlement";
import { iyzicoConfigured } from "@/lib/billing/iyzico";
import { PAST_DUE_GRACE_DAYS, applyRemoteStatus, periodEndFor, webhookEventKey, type SubscriptionRow } from "@/lib/billing/sync";

const now = new Date("2026-10-09T12:00:00Z");
// Testler sabit "now" ile çalışır; gerçek saat kullanılmaz (tarih geçince kırılmasın).
const future = new Date("2026-10-20T12:00:00Z").toISOString();
const row = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  plan: "monthly",
  status: "pending",
  current_period_start: null,
  current_period_end: null,
  cancel_at_period_end: false,
  ...over,
});

describe("isPremium (SPEC 15.2)", () => {
  it("yalnız active/past_due ve dönem sonu gelecekte", () => {
    expect(isPremium({ status: "active", current_period_end: future }, now)).toBe(true);
    expect(isPremium({ status: "past_due", current_period_end: future }, now)).toBe(true);
    expect(isPremium({ status: "canceled", current_period_end: future }, now)).toBe(false);
    expect(isPremium({ status: "active", current_period_end: "2020-01-01T00:00:00Z" })).toBe(false);
    expect(isPremium({ status: "active", current_period_end: null })).toBe(false);
    expect(isPremium(null)).toBe(false);
  });
});

describe("applyRemoteStatus", () => {
  it("ACTIVE: dönem iyzico'dan, yoksa plandan hesaplanır", () => {
    const r = applyRemoteStatus(row(), { status: "ACTIVE" }, now);
    expect(r.status).toBe("active");
    expect(r.current_period_start).toBe(now.toISOString());
    expect(r.current_period_end).toBe(periodEndFor("monthly", now).toISOString());
    const r2 = applyRemoteStatus(row(), { status: "ACTIVE", periodStart: now.toISOString(), periodEnd: future }, now);
    expect(r2.current_period_end).toBe(future);
  });
  it("UNPAID: past_due ve 3 gün ek süre (bir kez)", () => {
    const r = applyRemoteStatus(row({ status: "active", current_period_end: now.toISOString() }), { status: "UNPAID" }, now);
    expect(r.status).toBe("past_due");
    expect(new Date(r.current_period_end!).getTime() - now.getTime()).toBe(PAST_DUE_GRACE_DAYS * 86_400_000);
    const again = applyRemoteStatus(r, { status: "UNPAID" }, now);
    expect(again.current_period_end).toBe(r.current_period_end);
  });
  it("CANCELED: kullanıcı iptaliyse dönem sonuna kadar erişim sürer", () => {
    const r = applyRemoteStatus(row({ status: "active", current_period_end: future, cancel_at_period_end: true }), { status: "CANCELED" }, now);
    expect(r.status).toBe("active");
    expect(isPremium({ status: r.status, current_period_end: r.current_period_end }, now)).toBe(true);
    const r2 = applyRemoteStatus(row({ status: "active", current_period_end: future }), { status: "CANCELED" }, now);
    expect(r2.status).toBe("canceled");
  });
  it("EXPIRED → expired; bilinmeyen durum mevcut durumu korur", () => {
    expect(applyRemoteStatus(row({ status: "active" }), { status: "EXPIRED" }, now).status).toBe("expired");
    expect(applyRemoteStatus(row({ status: "active" }), { status: "SOMETHING_NEW" }, now).status).toBe("active");
  });
  it("periodEndFor: haftalık 7 gün, aylık 1 ay, yıllık 1 yıl", () => {
    expect(periodEndFor("weekly", now).toISOString()).toBe("2026-10-16T12:00:00.000Z");
    expect(periodEndFor("monthly", now).toISOString()).toBe("2026-11-09T12:00:00.000Z");
    expect(periodEndFor("yearly", now).toISOString()).toBe("2027-10-09T12:00:00.000Z");
  });
});

describe("webhookEventKey", () => {
  it("aynı bildirim aynı anahtar; farklı olay farklı anahtar", () => {
    const a = { iyziEventType: "subscription.order.success", subscriptionReferenceCode: "S1", orderReferenceCode: "O1" };
    expect(webhookEventKey(a)).toBe(webhookEventKey({ ...a }));
    expect(webhookEventKey(a)).not.toBe(webhookEventKey({ ...a, orderReferenceCode: "O2" }));
  });
  it("tanınan alan yoksa gövdenin tamamı anahtardır", () => {
    expect(webhookEventKey({ foo: 1 })).toBe('{"foo":1}');
  });
});

describe("iyzicoConfigured (checkout anahtar yokken 500 yerine açık hata, bekleyen satır yok)", () => {
  it("iki anahtar da dolu olmalı; boş veya yalnız boşluk yok sayılır", () => {
    expect(iyzicoConfigured({ IYZICO_API_KEY: "sandbox-a", IYZICO_SECRET_KEY: "sandbox-b" })).toBe(true);
    expect(iyzicoConfigured({ IYZICO_API_KEY: "", IYZICO_SECRET_KEY: "sandbox-b" })).toBe(false);
    expect(iyzicoConfigured({ IYZICO_API_KEY: "sandbox-a", IYZICO_SECRET_KEY: "   " })).toBe(false);
    expect(iyzicoConfigured({})).toBe(false);
  });
});
