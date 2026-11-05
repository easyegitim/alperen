// SPEC 8.8: adalet ölçümü. Saf fonksiyonlar; birim testi var. scripts/fairness-report.ts kullanır.
export type FairnessItem = { groups: Record<string, string>; overall: number; subscores?: Record<string, number> };

export type GroupStat = { name: string; n: number; mean: number; sd: number };
export type DimensionResult = { dimension: string; groups: GroupStat[]; maxGap: number; pooledSd: number; ratio: number; pass: boolean };
export type FairnessSummary = { dimensions: DimensionResult[]; pass: boolean };

/** Bir grup diğerlerinden > 0,5 puan düşükse yayın durur (SPEC 8.8). */
export const FAIRNESS_MAX_GAP = 0.5;
/** Hedef (SPEC 17.2): gruplar arası fark ≤ 0,3; alt sınır 0,5. */
export const FAIRNESS_TARGET_GAP = 0.3;

function meanSd(v: number[]): { mean: number; sd: number } {
  if (v.length === 0) return { mean: 0, sd: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : 0;
  return { mean, sd };
}

export function dimensionResult(dimension: string, items: FairnessItem[], minGroupSize = 3): DimensionResult {
  const byGroup = new Map<string, number[]>();
  for (const it of items) {
    const g = it.groups[dimension];
    if (!g) continue;
    byGroup.set(g, [...(byGroup.get(g) ?? []), it.overall]);
  }
  const groups: GroupStat[] = [...byGroup.entries()]
    .filter(([, v]) => v.length >= minGroupSize)
    .map(([name, v]) => ({ name, n: v.length, ...meanSd(v) }))
    .sort((a, b) => a.name.localeCompare(b.name, "tr"));
  const means = groups.map((g) => g.mean);
  const maxGap = means.length > 1 ? Math.max(...means) - Math.min(...means) : 0;
  const dof = groups.reduce((s, g) => s + (g.n - 1), 0);
  const pooledSd = dof > 0 ? Math.sqrt(groups.reduce((s, g) => s + (g.n - 1) * g.sd ** 2, 0) / dof) : 0;
  const ratio = pooledSd > 0 ? maxGap / pooledSd : maxGap > 0 ? Infinity : 0;
  return { dimension, groups, maxGap, pooledSd, ratio, pass: maxGap <= FAIRNESS_MAX_GAP };
}

export function fairnessSummary(items: FairnessItem[], minGroupSize = 3): FairnessSummary {
  const dims = [...new Set(items.flatMap((it) => Object.keys(it.groups)))].sort();
  const dimensions = dims.map((d) => dimensionResult(d, items, minGroupSize)).filter((d) => d.groups.length > 1);
  return { dimensions, pass: dimensions.every((d) => d.pass) };
}
