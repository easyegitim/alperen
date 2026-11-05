import { describe, expect, it } from "vitest";
import { isUuid, pickReturnAnalysis, readCheckoutPayload } from "@/lib/billing/returnAnalysis";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LATEST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("pickReturnAnalysis (UI spec §4.2)", () => {
  it("kullanıcıya ait ve tamamlanmış aday tercih edilir", () => {
    expect(pickReturnAnalysis(A, { id: A, user_id: USER, status: "completed" }, LATEST, USER)).toBe(A);
  });

  it("başka kullanıcının analizi seçilmez; en son analize düşer", () => {
    expect(pickReturnAnalysis(A, { id: A, user_id: OTHER, status: "completed" }, LATEST, USER)).toBe(LATEST);
  });

  it("tamamlanmamış aday seçilmez", () => {
    expect(pickReturnAnalysis(A, { id: A, user_id: USER, status: "processing" }, LATEST, USER)).toBe(LATEST);
    expect(pickReturnAnalysis(A, { id: A, user_id: USER, status: "failed" }, LATEST, USER)).toBe(LATEST);
  });

  it("satırı bulunmayan veya satırla eşleşmeyen aday seçilmez", () => {
    expect(pickReturnAnalysis(A, null, LATEST, USER)).toBe(LATEST);
    expect(pickReturnAnalysis(A, { id: LATEST, user_id: USER, status: "completed" }, null, USER)).toBeUndefined();
  });

  it("aday yoksa veya uuid değilse en son analiz; o da yoksa undefined", () => {
    expect(pickReturnAnalysis(undefined, null, LATEST, USER)).toBe(LATEST);
    expect(pickReturnAnalysis("../../hesap", { id: "../../hesap", user_id: USER, status: "completed" }, LATEST, USER)).toBe(LATEST);
    expect(pickReturnAnalysis(undefined, null, null, USER)).toBeUndefined();
    expect(pickReturnAnalysis(undefined, null, "not-a-uuid", USER)).toBeUndefined();
  });
});

describe("readCheckoutPayload", () => {
  it("eski satırlar (analysisId yok) aynen okunur", () => {
    expect(readCheckoutPayload({ conversationId: "c", plan: "yearly", userId: USER, token: "t" })).toEqual({ userId: USER, plan: "yearly", analysisId: undefined });
  });

  it("geçersiz analysisId düşürülür; bozuk payload boş döner", () => {
    expect(readCheckoutPayload({ plan: "weekly", userId: USER, analysisId: "x" }).analysisId).toBeUndefined();
    expect(readCheckoutPayload({ plan: "weekly", userId: USER, analysisId: A }).analysisId).toBe(A);
    expect(readCheckoutPayload(null)).toEqual({});
    expect(readCheckoutPayload("str")).toEqual({});
    expect(readCheckoutPayload({ userId: 5, plan: "" })).toEqual({ userId: undefined, plan: undefined, analysisId: undefined });
  });
});

describe("isUuid", () => {
  it("yalnız uuid dizgisi", () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid([A])).toBe(false);
    expect(isUuid(`${A}/x`)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
