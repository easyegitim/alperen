// Affedici seri (PLAN Faz 6 [ÖNERİ]; CONTRACTS_V2 Sprint 3 S3.3): saf kurallar.
import { describe, expect, it } from "vitest";
import { ROUTINE_FORGIVING, getRoutineForgiving } from "@/lib/config/routine";
import { canUseFreeze, computeForgivingStreak, dayStatus, freezesUsedInMonth, isoWeekKey, monthKey, restDaysLeftThisWeek } from "@/lib/routine/forgiving";
import { computeStreak, type DayLog } from "@/lib/routine/streak";

const log = (day: string, done = true): DayLog[] => [{ log_date: day, item_id: "a", done }, { log_date: day, item_id: "b", done }];
const days = (...ds: string[]) => ds.flatMap((d) => log(d));

describe("yapılandırma (ÖNERİ, yer tutucu)", () => {
  it("varsayılan 1 dinlenme/hafta, 1 dondurma/ay; env sınırlı", () => {
    expect(ROUTINE_FORGIVING).toMatchObject({ restDaysPerWeek: 1, freezesPerMonth: 1, placeholder: true });
    expect(getRoutineForgiving({})).toEqual({ restDaysPerWeek: 1, freezesPerMonth: 1 });
    expect(getRoutineForgiving({ ROUTINE_REST_DAYS_PER_WEEK: "9", ROUTINE_FREEZES_PER_MONTH: "-1" })).toEqual({ restDaysPerWeek: 3, freezesPerMonth: 0 });
    expect(getRoutineForgiving({ EXPO_PUBLIC_ROUTINE_REST_DAYS_PER_WEEK: "2" }).restDaysPerWeek).toBe(2);
    expect(getRoutineForgiving({ ROUTINE_REST_DAYS_PER_WEEK: "x" }).restDaysPerWeek).toBe(1);
  });
  it("ISO haftası ve ay anahtarı", () => {
    expect(isoWeekKey("2026-11-02")).toBe("2026-W45"); // Pazartesi
    expect(isoWeekKey("2026-11-08")).toBe("2026-W45"); // Pazar aynı hafta
    expect(isoWeekKey("2026-11-09")).toBe("2026-W46");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(monthKey("2026-11-04")).toBe("2026-11");
  });
});

describe("dinlenme günü", () => {
  it("haftada bir eksik gün seriyi köprüler, sayılmaz; eski computeStreak ile fark burada", () => {
    const logs = days("2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05"); // 3 Kasım eksik
    expect(computeStreak(logs, 2, "2026-11-05")).toBe(2);
    const r = computeForgivingStreak({ logs, activeItemCount: 2, today: "2026-11-05" });
    expect(r).toEqual({ streak: 4, restDaysBridged: 1, freezesBridged: 0, restUsedThisWeek: expect.any(Number), today: "done" });
  });
  it("aynı haftada ikinci eksik gün seriyi bitirir", () => {
    const logs = days("2026-11-02", "2026-11-05", "2026-11-07"); // W45: 3,4,6 eksik
    const r = computeForgivingStreak({ logs, activeItemCount: 2, today: "2026-11-07" });
    expect(r.streak).toBe(2); // 7 ve (6 köprü) 5; 4 ikinci eksik → dur
    expect(r.restDaysBridged).toBe(1);
  });
  it("farklı haftalardaki eksik günler ayrı hak kullanır", () => {
    const logs = days("2026-11-06", "2026-11-07", "2026-11-09", "2026-11-10"); // 8 (W45) eksik; 11 (W46) eksik, bugün 12 pending
    const r = computeForgivingStreak({ logs, activeItemCount: 2, today: "2026-11-12" });
    expect(r).toEqual({ streak: 4, restDaysBridged: 2, freezesBridged: 0, restUsedThisWeek: expect.any(Number), today: "pending" });
  });
  it("bugün tamamlanmadıysa eksik sayılmaz; aktif adım yoksa 0; hiç yapılan gün yoksa köprü 0", () => {
    expect(computeForgivingStreak({ logs: days("2026-11-03"), activeItemCount: 2, today: "2026-11-04" }).streak).toBe(1);
    expect(computeForgivingStreak({ logs: days("2026-11-03"), activeItemCount: 0, today: "2026-11-04" }).streak).toBe(0);
    expect(computeForgivingStreak({ logs: [], activeItemCount: 2, today: "2026-11-04" })).toEqual({ streak: 0, restDaysBridged: 0, freezesBridged: 0, restUsedThisWeek: 0, today: "pending" });
  });
  it("kalan dinlenme günü haftaya göre", () => {
    const logs = days("2026-11-02", "2026-11-04");
    expect(restDaysLeftThisWeek({ logs, activeItemCount: 2, today: "2026-11-04" })).toBe(0); // 3 Kasım eksik
    expect(restDaysLeftThisWeek({ logs, activeItemCount: 2, today: "2026-11-03" })).toBe(1);
    expect(restDaysLeftThisWeek({ logs, activeItemCount: 2, today: "2026-11-04", freezes: [{ date: "2026-11-03" }] })).toBe(1);
  });
});

describe("dondurma", () => {
  it("ayda bir; aynı gün iki kez olmaz; gelecek gün olmaz", () => {
    expect(canUseFreeze([], "2026-11-03", "2026-11-04")).toEqual({ ok: true });
    expect(canUseFreeze([{ date: "2026-11-01" }], "2026-11-03", "2026-11-04")).toEqual({ ok: false, reason: "limit_reached" });
    expect(canUseFreeze([{ date: "2026-10-30" }], "2026-11-03", "2026-11-04")).toEqual({ ok: true });
    expect(canUseFreeze([{ date: "2026-11-03" }], "2026-11-03", "2026-11-04", { restDaysPerWeek: 1, freezesPerMonth: 3 })).toEqual({ ok: false, reason: "already_frozen" });
    expect(canUseFreeze([], "2026-11-05", "2026-11-04")).toEqual({ ok: false, reason: "future_date" });
    expect(canUseFreeze([], "bugün", "2026-11-04")).toEqual({ ok: false, reason: "bad_date" });
    expect(freezesUsedInMonth([{ date: "2026-11-01" }, { date: "2026-10-31" }], "2026-11")).toBe(1);
  });
  it("dondurulan gün dinlenme hakkını harcamaz; köprü olarak sayılır", () => {
    const logs = days("2026-11-02", "2026-11-04", "2026-11-06"); // 3 ve 5 eksik (W45)
    const noFreeze = computeForgivingStreak({ logs, activeItemCount: 2, today: "2026-11-06" });
    expect(noFreeze.streak).toBe(2);
    const r = computeForgivingStreak({ logs, activeItemCount: 2, today: "2026-11-06", freezes: [{ date: "2026-11-05" }] });
    expect(r).toEqual({ streak: 3, restDaysBridged: 1, freezesBridged: 1, restUsedThisWeek: expect.any(Number), today: "done" });
  });
  it("gün durumu", () => {
    const base = { logs: days("2026-11-02"), activeItemCount: 2, today: "2026-11-04", freezes: [{ date: "2026-11-03" }] };
    expect(dayStatus("2026-11-02", base)).toBe("done");
    expect(dayStatus("2026-11-03", base)).toBe("frozen");
    expect(dayStatus("2026-11-04", base)).toBe("pending");
    expect(dayStatus("2026-11-01", base)).toBe("missed");
    expect(dayStatus("2026-11-05", base)).toBe("pending");
  });
});
