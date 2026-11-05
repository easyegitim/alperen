import { ROUTINE_FORGIVING } from "@/lib/config/routine";
import { canUseFreeze, computeForgivingStreak, restDaysLeftThisWeek } from "@/lib/routine/forgiving";
import { freezeStoreError, freezesFromRows, recentDays } from "@/mobile/src/features/routine/forgivingView";

const done = (d: string) => [{ log_date: d, item_id: "a", done: true }, { log_date: d, item_id: "b", done: true }];

describe("affedici seri görünümü (PLAN Faz 6 [ÖNERİ]; CONTRACTS_V2 S3.3.2)", () => {
  it("son 7 gün: yapılan / dinlenme köprüsü / dondurulmuş / yapılmadı / bugün bekliyor", () => {
    // 2026-11-04 Çarşamba; 2026-11-02 Pzt yapılmadı (dinlenme), 2026-10-30 Cuma yapılmadı (önceki hafta dinlenme)
    const logs = [...done("2026-11-03"), ...done("2026-11-01"), ...done("2026-10-31"), ...done("2026-10-29")];
    const days = recentDays({ logs, activeItemCount: 2, today: "2026-11-04", freezes: [{ date: "2026-10-28" }] });
    expect(days.map((d) => `${d.date}:${d.status}`)).toEqual([
      "2026-10-29:done",
      "2026-10-30:rest",
      "2026-10-31:done",
      "2026-11-01:done",
      "2026-11-02:rest",
      "2026-11-03:done",
      "2026-11-04:pending",
    ]);
    const streak = computeForgivingStreak({ logs, activeItemCount: 2, today: "2026-11-04", freezes: [{ date: "2026-10-28" }] });
    expect(streak.streak).toBe(4);
    expect(streak.restDaysBridged).toBe(2);
    expect(streak.today).toBe("pending");
    expect(restDaysLeftThisWeek({ logs, activeItemCount: 2, today: "2026-11-04" })).toBe(0);
  });
  it("aynı haftada ikinci eksik gün zinciri koparır: sonrası 'missed'; aktif adım yoksa hepsi missed/pending", () => {
    // 2026-11-06 Cuma; 11-05 yapıldı; 11-04 dinlenme adayı ama daha eski yapılan gün yok (11-03 ikinci eksik → zincir
    // kopar): motor 11-04'ü köprülemez (restDaysBridged 0) → takvimde de "missed" (rest yalnız zincir içinde affedilen gün)
    const logs = [...done("2026-11-05")];
    const days = recentDays({ logs, activeItemCount: 2, today: "2026-11-06", days: 4 });
    expect(days.map((d) => d.status)).toEqual(["missed", "missed", "done", "pending"]);
    expect(computeForgivingStreak({ logs, activeItemCount: 2, today: "2026-11-06" }).restDaysBridged).toBe(0);
    // 11-03 de yapıldıysa 11-04 zincir içinde köprü → "rest"
    const chained = recentDays({ logs: [...done("2026-11-05"), ...done("2026-11-03")], activeItemCount: 2, today: "2026-11-06", days: 4 });
    expect(chained.map((d) => d.status)).toEqual(["done", "rest", "done", "pending"]);
    expect(recentDays({ logs: [], activeItemCount: 0, today: "2026-11-04", days: 2 }).map((d) => d.status)).toEqual(["missed", "pending"]);
    expect(recentDays({ logs: [], activeItemCount: 1, today: "bozuk" })).toEqual([]);
  });
  it("dondurma: aylık hak, aynı gün, gelecek; sunucu hata eşlemesi", () => {
    expect(canUseFreeze([], "2026-11-04", "2026-11-04")).toEqual({ ok: true });
    expect(canUseFreeze([{ date: "2026-11-02" }], "2026-11-04", "2026-11-04", ROUTINE_FORGIVING)).toEqual({ ok: false, reason: "limit_reached" });
    expect(freezeStoreError({ code: "P0001", message: "routine_freeze_limit: limit_reached" })).toBe("limit_reached");
    expect(freezeStoreError({ code: "23505", message: "duplicate" })).toBe("already_frozen");
    expect(freezeStoreError({ code: "42P01", message: "relation does not exist" })).toBe("unavailable");
    expect(freezeStoreError({ code: "PGRST205", message: "" })).toBe("unavailable");
    expect(freezeStoreError(null)).toBe("unknown");
    expect(freezesFromRows([{ freeze_date: "2026-11-02" }, { freeze_date: 5 }, { freeze_date: "2026-11-01T00:00:00" }])).toEqual([{ date: "2026-11-02" }, { date: "2026-11-01" }]);
  });
});
