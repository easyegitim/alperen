import { describe, expect, it } from "vitest";
import { BLIND_GATE, ballotMarkdown, parseVotesCsv, seededRandom, shufflePairs, tally } from "../../scripts/blind-compare";
import { CONSISTENCY_GATE, consistencyCsv, evaluateConsistency, parseRowsCsv, type ConsistencyRow } from "../../scripts/consistency-gate";

// Ücretli betiklerin saf kısmı (PLAN_V2 §5/2–3): kapı hesapları, karıştırma ve sayım. Ağ yok, görsel yok.

describe("consistency-gate", () => {
  const rows: ConsistencyRow[] = [
    ...[5.5, 5.6, 5.4, 5.7, 5.5].map((o, i) => ({ person: "p01", set: i + 1, overall: o, subscores: { skin: 6 } })),
    ...[6.0, 6.5, 6.1, 6.2, 6.4].map((o, i) => ({ person: "p02", set: i + 1, overall: o, subscores: { skin: null } })),
    { person: "p03", set: 1, overall: 7, subscores: {} },
  ];
  it("kişi başına yayılım; 0,4 eşiği; tek setli kişi atlanır; pay ve kapı", () => {
    const r = evaluateConsistency(rows);
    expect(r.people.map((p) => p.spread)).toEqual([0.3, 0.5]);
    expect(r.skipped).toEqual(["p03"]);
    expect(r.share).toBe(0.5);
    expect(r.worst).toBe("p02");
    expect(r.pass).toBe(false);
    expect(CONSISTENCY_GATE).toEqual({ maxSpread: 0.4, minShare: 0.9 });
    const good = rows.filter((x) => x.person === "p01");
    expect(evaluateConsistency(good).pass).toBe(true);
    expect(evaluateConsistency([]).pass).toBe(false);
  });
  it("CSV yalnız takma ad ve sayılar; geri okunur", () => {
    const csv = consistencyCsv(rows.slice(0, 2));
    expect(csv.split("\n")[0]).toBe("person,set,overall,harmony,eyes,jawline,skin,hair,grooming,brows");
    expect(csv).not.toMatch(/\.jpg|data:/);
    const back = parseRowsCsv(csv);
    expect(back[0]).toMatchObject({ person: "p01", set: 1, overall: 5.5 });
    expect(back[0].subscores.skin).toBe(6);
    expect(back[0].subscores.hair).toBeNull();
  });
});

describe("blind-compare", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `s${i + 1}`, aura: `motor metni ${i}`, plain: `düz metin ${i}` }));
  it("karıştırma deterministik (aynı tohum aynı eşleme), iki taraf da kullanılır, eşleme pusulada yok", () => {
    const a = shufflePairs(items, 7);
    const b = shufflePairs(items, 7);
    expect(a).toEqual(b);
    expect(a.pairs).toHaveLength(20);
    const sides = new Set(a.key.map((k) => k.aura));
    expect(sides.size).toBe(2);
    a.pairs.forEach((p, i) => {
      const k = a.key[i];
      expect(p[k.aura]).toBe(items[i].aura);
      expect(p[k.aura === "A" ? "B" : "A"]).toBe(items[i].plain);
    });
    // Pusula eşlemeyi ele vermez: yalnız takma ad ve anonim A/B metinleri.
    expect(ballotMarkdown(a.pairs)).not.toMatch(/aura|key\.json|"A"|"B"/i);
    expect(ballotMarkdown(a.pairs)).toContain("## s1");
    expect(seededRandom(1)()).toBe(seededRandom(1)());
    expect(shufflePairs(items, 8).key).not.toEqual(a.key);
  });
  it("sayım: Aura payı ve %70 kapısı; eşleşmeyen id atlanır; votes.csv ayrıştırma", () => {
    const { key } = shufflePairs(items, 7);
    const votesAllAura = key.map((k) => ({ id: k.id, choice: k.aura }));
    expect(tally(votesAllAura, key)).toMatchObject({ total: 20, aura: 20, plain: 0, share: 1, pass: true });
    const mixed = key.map((k, i) => ({ id: k.id, choice: i < 13 ? k.aura : k.aura === "A" ? ("B" as const) : ("A" as const) }));
    expect(tally(mixed, key)).toMatchObject({ aura: 13, plain: 7, share: 0.65, pass: false });
    expect(tally([{ id: "yok", choice: "A" }], key)).toMatchObject({ total: 0, pass: false, unknown: ["yok"] });
    expect(BLIND_GATE.minAuraShare).toBe(0.7);
    expect(parseVotesCsv("id,choice\ns1,A\ns2, B\ns3,C\n")).toEqual([{ id: "s1", choice: "A" }, { id: "s2", choice: "B" }]);
  });
});
