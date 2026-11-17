import { describe, expect, it } from "vitest";
import { freezeStoreError, recentDays } from "@/lib/routine/calendar";
import { canUseFreeze, computeForgivingStreak, isoWeekKey, restDaysLeftThisWeek } from "@/lib/routine/forgiving";
import { addDays, computeStreak, istanbulDate, type DayLog } from "@/lib/routine/streak";

// Faz 6 affedici seri kenar durumları (PLAN [ÖNERİ]; S3.3.2): ISO hafta sınırı, ay sınırı, Istanbul günü, eski kayıt uyumu.
const ITEMS = ["a", "b", "c", "d", "e"];
const CFG = { restDaysPerWeek: 1, freezesPerMonth: 1 };
/** Verilen günler için 5/5 yapılmış kayıt. */
const doneDays = (days: string[]): DayLog[] => days.flatMap((d) => ITEMS.map((item_id) => ({ log_date: d, item_id, done: true })));
const range = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

describe("recentDays (takvim şeridi)", () => {
  it("yapıldı / dinlenme / donduruldu / yapılmadı / bugün: computeForgivingStreak ile aynı yürüyüş", () => {
    // Bugün Çar 2026-11-04. Sal yapıldı, Pzt eksik (dinlenme, W45), Paz donduruldu, Cmt yapıldı, Cum eksik (W44 dinlenme), Per eksik (W44 ikinci) → kırılır.
    const today = "2026-11-04";
    const logs = doneDays(["2026-11-03", "2026-10-31"]);
    const days = recentDays({ logs, activeItemCount: 5, today, freezes: [{ date: "2026-11-01" }], config: CFG, days: 7 });
    expect(days.map((d) => `${d.date}:${d.status}`)).toEqual([
      "2026-10-29:missed",
      "2026-10-30:missed",
      "2026-10-31:done",
      "2026-11-01:frozen",
      "2026-11-02:rest",
      "2026-11-03:done",
      "2026-11-04:pending",
    ]);
    const s = computeForgivingStreak({ logs, activeItemCount: 5, today, freezes: [{ date: "2026-11-01" }], config: CFG });
    // Sal + Cmt = 2 yapılan; Pzt dinlenme, Paz dondurma köprü; Cum (30 Eki, hafta 44) dinlenme hakkı var ama sonrasında yapılan gün yok → baştaki köprü sayılmaz (takvimde de "missed")
    expect(s).toMatchObject({ streak: 2, restDaysBridged: 1, freezesBridged: 1, today: "pending" });
  });
  it("yeni rutin (hiç log yok): dün 'rest' değil 'missed' — dinlenme yalnız zincir içinde affedilen gündür", () => {
    const days = recentDays({ logs: [], activeItemCount: 1, today: "2026-11-04", config: CFG });
    expect(days.map((d) => d.status)).toEqual(["missed", "missed", "missed", "missed", "missed", "missed", "pending"]);
    // Zincir var: Sal yapıldı, Pzt eksik, Paz yapıldı → Pzt köprü (rest); daha eski eksikler zincir kopunca missed
    const chain = recentDays({ logs: doneDays(["2026-11-03", "2026-11-01"]), activeItemCount: 1, today: "2026-11-04", config: CFG, days: 5 });
    expect(chain.map((d) => `${d.date}:${d.status}`)).toEqual(["2026-10-31:missed", "2026-11-01:done", "2026-11-02:rest", "2026-11-03:done", "2026-11-04:pending"]);
    // Pencere sonundaki aday: pencere dışında yapılan gün varsa rest, yoksa missed
    const tail = recentDays({ logs: doneDays(["2026-11-03", "2026-10-31"]), activeItemCount: 1, today: "2026-11-04", config: CFG, days: 3 });
    expect(tail.map((d) => d.status)).toEqual(["rest", "done", "pending"]);
    const tailBroken = recentDays({ logs: doneDays(["2026-11-03"]), activeItemCount: 1, today: "2026-11-04", config: CFG, days: 3 });
    expect(tailBroken.map((d) => d.status)).toEqual(["missed", "done", "pending"]);
  });
  it("aktif adım yoksa bugün pending, gerisi missed; en eski önce; en fazla 31 gün", () => {
    const days = recentDays({ logs: [], activeItemCount: 0, today: "2026-11-04", days: 3 });
    expect(days.map((d) => d.status)).toEqual(["missed", "missed", "pending"]);
    expect(recentDays({ logs: [], activeItemCount: 1, today: "2026-11-04", days: 99 })).toHaveLength(31);
    expect(recentDays({ logs: [], activeItemCount: 1, today: "bozuk" })).toEqual([]);
  });
});

describe("hafta sınırı (ISO, Pazartesi başlangıç)", () => {
  it("Pazar ve Pazartesi art arda eksikse iki ayrı haftanın dinlenme hakkı kullanılır; seri kopmaz", () => {
    // Bugün Çar 2026-11-04; Sal yapıldı; Pzt 02 (W45) ve Paz 01 (W44) eksik; Cmt 31 ve öncesi yapıldı.
    const logs = doneDays(["2026-11-03", ...range("2026-10-25", 7)]);
    expect(isoWeekKey("2026-11-02")).toBe("2026-W45");
    expect(isoWeekKey("2026-11-01")).toBe("2026-W44");
    const s = computeForgivingStreak({ logs, activeItemCount: 5, today: "2026-11-04", config: CFG });
    expect(s.streak).toBe(8);
    expect(s.restDaysBridged).toBe(2);
    // Aynı haftada (Cmt+Paz) iki eksik gün: ikinci seriyi bitirir
    const s2 = computeForgivingStreak({ logs: doneDays(["2026-11-03", "2026-11-02", ...range("2026-10-25", 6)]), activeItemCount: 5, today: "2026-11-04", config: CFG });
    expect(s2.streak).toBe(2);
    expect(s2.restDaysBridged).toBe(0); // kırılma noktasındaki dinlenme iki yapılan gün arasında değil → sayılmaz
  });
  it("yıl sınırı: 2027-01-01 (Cuma) 2026-W53'tedir; Pzt 28 Aralık aynı hafta", () => {
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
    expect(isoWeekKey("2026-12-28")).toBe("2026-W53");
    expect(isoWeekKey("2027-01-04")).toBe("2027-W01");
    // 31 Ara ve 1 Oca eksik (aynı ISO haftası): ikincisi seriyi bitirir
    const logs = doneDays(["2027-01-03", "2027-01-02", "2026-12-30", "2026-12-29"]);
    const s = computeForgivingStreak({ logs, activeItemCount: 5, today: "2027-01-04", config: CFG });
    expect(s.streak).toBe(2);
    // 3 Oca (Paz, W53) ve 4 Oca (Pzt, W01) eksikse iki hafta → köprü
    const logs2 = doneDays(["2027-01-05", "2027-01-02", "2027-01-01"]);
    expect(computeForgivingStreak({ logs: logs2, activeItemCount: 5, today: "2027-01-06", config: CFG })).toMatchObject({ streak: 3, restDaysBridged: 2 });
  });
  it("kalan dinlenme günü hafta başında tam, zincir içinde dinlenmeden sonra 0; Pazartesi günü yeni hak", () => {
    const base = { activeItemCount: 5, config: CFG };
    expect(restDaysLeftThisWeek({ ...base, logs: [], today: "2026-11-02" })).toBe(1); // Pzt: geriye bu haftada gün yok
    // Sal, Pzt eksik ama hiç yapılan gün yok: zincir yok → motor Pzt'yi köprülemez, hak harcanmamıştır
    expect(restDaysLeftThisWeek({ ...base, logs: [], today: "2026-11-03" })).toBe(1);
    // Çar; Sal yapıldı, Pzt eksik, Paz (W44) yapıldı: Pzt zincir içinde köprü → bu haftanın hakkı harcandı
    expect(restDaysLeftThisWeek({ ...base, logs: doneDays(["2026-11-03", "2026-11-01"]), today: "2026-11-04" })).toBe(0);
    expect(restDaysLeftThisWeek({ ...base, logs: doneDays(["2026-11-02"]), today: "2026-11-03" })).toBe(1);
    expect(restDaysLeftThisWeek({ ...base, logs: [], freezes: [{ date: "2026-11-02" }], today: "2026-11-03" })).toBe(1); // dondurma hakkı harcamaz
  });
  it("kalan hak motorla aynı: zincirden önceki eksik günler (rutin Çarşamba başladı) hakkı harcamaz", () => {
    const base = { activeItemCount: 5, config: CFG };
    // Rutin Çar 4 Kasım'da başladı; Çar+Per yapıldı; Cum bekliyor. Pzt+Sal zincir dışı → hak hâlâ 1.
    const logs = doneDays(["2026-11-04", "2026-11-05"]);
    expect(restDaysLeftThisWeek({ ...base, logs, today: "2026-11-06" })).toBe(1);
    expect(computeForgivingStreak({ ...base, logs, today: "2026-11-06" })).toMatchObject({ streak: 2, restDaysBridged: 0, restUsedThisWeek: 0 });
    // Cuma atlandı: Cumartesi motor Cuma'yı köprüler (seri 2 kalır) — kart Cuma günü "hak yok" dememeliydi.
    expect(computeForgivingStreak({ ...base, logs, today: "2026-11-07" })).toMatchObject({ streak: 2, restDaysBridged: 1, restUsedThisWeek: 1 });
    expect(restDaysLeftThisWeek({ ...base, logs, today: "2026-11-07" })).toBe(0);
  });
});

describe("ay sınırı (dondurma takvim ayına göre)", () => {
  it("31 Ekim ve 1 Kasım ayrı aylar; 1 ve 30 Kasım aynı ay", () => {
    expect(canUseFreeze([{ date: "2026-10-31" }], "2026-11-01", "2026-11-01", CFG)).toEqual({ ok: true });
    expect(canUseFreeze([{ date: "2026-11-01" }], "2026-11-30", "2026-11-30", CFG)).toEqual({ ok: false, reason: "limit_reached" });
    expect(canUseFreeze([{ date: "2026-12-31" }], "2027-01-01", "2027-01-01", CFG)).toEqual({ ok: true });
    expect(canUseFreeze([], "2026-11-05", "2026-11-04", CFG)).toEqual({ ok: false, reason: "future_date" });
  });
  it("sunucu hata eşlemesi (0015 trigger mesajı, 23505, tablo yok)", () => {
    expect(freezeStoreError({ code: "P0001", message: "routine_freeze_limit: limit_reached" })).toBe("limit_reached");
    expect(freezeStoreError({ code: "23514", message: "routine_freeze_limit: future_date" })).toBe("future_date");
    expect(freezeStoreError({ code: "23505", message: "duplicate key" })).toBe("already_frozen");
    expect(freezeStoreError({ code: "42P01", message: 'relation "public.routine_freezes" does not exist' })).toBe("unavailable");
    expect(freezeStoreError({ code: "PGRST205", message: "Could not find the table" })).toBe("unavailable");
    expect(freezeStoreError(null)).toBe("unknown");
  });
});

describe("Istanbul günü ve eski kayıt uyumu", () => {
  it("gün UTC 21:00'de değişir (Türkiye kalıcı +03, yaz saati yok)", () => {
    expect(istanbulDate(new Date("2026-11-04T20:59:59Z"))).toBe("2026-11-04");
    expect(istanbulDate(new Date("2026-11-04T21:00:00Z"))).toBe("2026-11-05");
    expect(istanbulDate(new Date("2026-07-04T21:00:00Z"))).toBe("2026-07-05");
    expect(istanbulDate(new Date("2026-12-31T21:30:00Z"))).toBe("2027-01-01");
  });
  it("eksik gün yoksa computeStreak (v1) ve affedici seri aynı sayıyı verir; eksik varsa v1 keser, v2 köprüler", () => {
    const today = "2026-11-04";
    const full = doneDays(range("2026-10-20", 16)); // 20 Eki … 4 Kas
    expect(computeStreak(full, 5, today)).toBe(16);
    expect(computeForgivingStreak({ logs: full, activeItemCount: 5, today, config: CFG }).streak).toBe(16);
    const gap = doneDays(range("2026-10-20", 16).filter((d) => d !== "2026-10-30"));
    expect(computeStreak(gap, 5, today)).toBe(5);
    expect(computeForgivingStreak({ logs: gap, activeItemCount: 5, today, config: CFG })).toMatchObject({ streak: 15, restDaysBridged: 1 });
  });
});
