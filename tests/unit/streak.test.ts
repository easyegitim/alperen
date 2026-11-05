import { describe, expect, it } from "vitest";
import { addDays, completionRatio, computeStreak, istanbulDate } from "@/lib/routine/streak";

const d = (day: string, items: string[]) => items.map((item_id) => ({ log_date: day, item_id, done: true }));

describe("seri (SPEC 11.1, %80, Europe/Istanbul)", () => {
  it("Istanbul günü UTC gece yarısından 3 saat önce değişir", () => {
    expect(istanbulDate(new Date("2026-10-09T21:30:00Z"))).toBe("2026-10-10");
    expect(istanbulDate(new Date("2026-10-09T20:30:00Z"))).toBe("2026-10-09");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("ardışık tam günler sayılır; bugün eksikse dünden geriye", () => {
    const items = ["a", "b", "c", "d", "e"];
    const logs = [...d("2026-10-09", items), ...d("2026-10-08", items), ...d("2026-10-07", items.slice(0, 4))]; // 7'si %80
    expect(computeStreak(logs, 5, "2026-10-09")).toBe(3);
    expect(computeStreak([...d("2026-10-08", items), ...d("2026-10-07", items)], 5, "2026-10-09")).toBe(2);
  });
  it("%80 altı gün seriyi keser", () => {
    const items = ["a", "b", "c", "d", "e"];
    const logs = [...d("2026-10-09", items), ...d("2026-10-08", items.slice(0, 3)), ...d("2026-10-07", items)];
    expect(computeStreak(logs, 5, "2026-10-09")).toBe(1);
  });
  it("done=false kayıtlar sayılmaz; adım yoksa 0", () => {
    const logs = [{ log_date: "2026-10-09", item_id: "a", done: false }];
    expect(computeStreak(logs, 1, "2026-10-09")).toBe(0);
    expect(computeStreak([], 0, "2026-10-09")).toBe(0);
  });
  it("completionRatio bugünü ölçer", () => {
    expect(completionRatio(d("2026-10-09", ["a", "b"]), ["a", "b", "c", "d"], "2026-10-09")).toBe(0.5);
  });
});
