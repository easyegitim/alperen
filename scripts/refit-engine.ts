/**
 * hybrid.v1 önsellerini yeniden uydurma önerisi (engine spec §1.1, §3.5, §12 SPEC 19 kapısı madde 1). ÜCRETSİZ, ağsız.
 *
 * Girdi: rızalı ölçüm koşularından yalnız sayılar ve enumlar (GeometryResult ölçüleri, oylanmış gözlem, insan etiketli
 * alt gruplar). Görsel, landmark dizisi veya serbest metin kabul edilmez (assertNumbersOnly).
 *
 * Kısıtlar (değişmez):
 *  - Bir bant yalnız GENİŞLER; önsel birleşim bandının altına daralmaz.
 *  - Herhangi bir alt grubun bant içi payını düşüren öneri reddedilir.
 *  - MISSING_PEN uydurulmaz: ölçülemeyen bileşen asla puan düşürmez (sabit 0).
 * Çıktı yalnız öneridir; lib/config/engine.server.ts elle ve onayla güncellenir, ENGINE_STATUS.norms ancak SPEC 19
 * kapısının tamamı sağlanınca "fitted" olur.
 *
 * Kullanım: pnpm refit:engine --in <runs.json> [--out <öneri.json>] [--min-n 20] [--priors <bands.json>]
 * runs.json: { "items": [ { "metrics": { "lowerToMiddle": 1.1, "canthalTiltDeg": 5, "jawRatio": 0.86, "ipdRatio": 0.47,
 *              "eyeMouthRatio": 0.39, "symmetry": { "face": 0.012, "eyes": 0.01, "lower": 0.015 } },
 *              "quality": { "yaw": 2, "pitch": 3 }, "votes": <Observation (oylanmış)>, "groups": { "monk": "7", "presentation": "f" } } ] }
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { ObservationOutput, type Observation } from "../lib/ai/observationSchema";
import {
  BandSchema,
  COMPONENT_METRIC,
  argValue,
  flattenObservation,
  assertNumbersOnly,
  inBandShare,
  isMain,
  loadEngine,
  mean,
  refitAcceptable,
  widenBand,
  type Band,
  type EngineConfig,
} from "./engine-tooling";

const HELP = `refit-engine (ücretsiz, ağsız): hybrid.v1 bant ve kategori önsellerini rızalı ölçüm sayılarından önerir.
Kullanım: pnpm refit:engine --in <runs.json> [--out <öneri.json>] [--min-n 20] [--priors <bands.json>]
Kısıtlar: bantlar yalnız genişler; hiçbir alt grubun bant içi payı düşmez; MISSING_PEN uydurulmaz (0).`;

const MetricsSchema = z
  .object({
    lowerToMiddle: z.number().optional(),
    canthalTiltDeg: z.number().optional(),
    jawRatio: z.number().optional(),
    ipdRatio: z.number().nullable().optional(),
    eyeMouthRatio: z.number().nullable().optional(),
    symmetry: z.object({ face: z.number(), eyes: z.number(), lower: z.number() }).nullable().optional(),
  })
  .loose();

export const RunsSchema = z.object({
  items: z.array(
    z.object({
      metrics: MetricsSchema,
      quality: z.object({ yaw: z.number(), pitch: z.number() }).partial().optional(),
      votes: ObservationOutput.optional(),
      groups: z.record(z.string(), z.string()),
    }),
  ),
});
export type Runs = z.infer<typeof RunsSchema>;
type Item = Runs["items"][number];

/** Tam güvenle ölçülmüş değer mi (§3.2: g = 1). Sakal çene konturunu taşıdığında jawWidth/symLower ölçülmez. */
function measuredValue(component: string, it: Item): number | null {
  const pick = COMPONENT_METRIC[component];
  if (!pick) return null;
  const v = pick(it.metrics);
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const yaw = Math.abs(it.quality?.yaw ?? 0);
  const pitch = Math.abs(it.quality?.pitch ?? 0);
  if (component === "vertical" && pitch > 8) return null;
  if ((component === "spacing" || component === "jawWidth") && yaw > 8) return null;
  const beard = it.votes?.grooming.facialHair;
  if ((component === "jawWidth" || component === "symLower") && (beard === "short_beard" || beard === "full_beard")) return null;
  return v;
}

export type ComponentRefit = {
  component: string;
  prior: Band;
  suggested: Band;
  changed: boolean;
  insufficient: boolean;
  acceptable: boolean;
  reasons: string[];
  shares: { dimension: string; group: string; n: number; prior: number; suggested: number }[];
};

/** Bileşen başına genişletme önerisi ve alt grup bant içi payları (her boyut ayrı). Saf. */
export function refitBands(items: Item[], bands: Record<string, { band: Band }>, minN = 20): ComponentRefit[] {
  const dims = [...new Set(items.flatMap((it) => Object.keys(it.groups)))].sort();
  return Object.entries(bands).map(([component, { band: prior }]) => {
    const measured = items.map((it) => ({ it, v: measuredValue(component, it) })).filter((x): x is { it: Item; v: number } => x.v !== null);
    // Öneri, her boyutun her alt grubunun merkez aralığını kapsar.
    const all = new Map<string, number[]>();
    for (const d of dims) {
      for (const { it, v } of measured) {
        const g = it.groups[d];
        if (!g) continue;
        const key = `${d}=${g}`;
        all.set(key, [...(all.get(key) ?? []), v]);
      }
    }
    if (!dims.length) all.set("all", measured.map((m) => m.v));
    const { band: suggested, changed, insufficient } = widenBand(prior, all, { minN });
    const check = refitAcceptable(prior, suggested, all);
    const shares = [...all.entries()].map(([key, v]) => {
      const [dimension, group] = key.includes("=") ? key.split("=") : ["all", "all"];
      return { dimension, group, n: v.length, prior: inBandShare(v, prior), suggested: inBandShare(v, suggested) };
    });
    return { component, prior, suggested, changed, insufficient, acceptable: check.ok, reasons: check.reasons, shares };
  });
}

export type CategoryRefit = { item: string; modal: string | null; reference: string; n: number; suggestedImpute: number | null; priorImpute: number };

/**
 * Kategori önselleri: oylanmış gözlemlerde her öğenin en sık kategorisi (referansla karşılaştırma) ve belirsiz öğe için
 * önerilen IMPUTE_DELTA (= gözlenen kategorilerin ortalama deltası, 0,05'e yuvarlı). Saf.
 */
export function refitCategories(votes: Observation[], cfg: Pick<EngineConfig, "ITEM_FIELDS" | "CATEGORY_DELTAS" | "REF_CATEGORY" | "IMPUTE_DELTA">, minN = 20): CategoryRefit[] {
  return Object.entries(cfg.ITEM_FIELDS).map(([item, f]) => {
    const values: string[] = [];
    for (const o of votes) {
      const v = flattenObservation(o)[`${f.group}.${f.field}`];
      if (v !== undefined && v !== "unclear" && v !== "not_applicable") values.push(v);
    }
    const counts = new Map<string, number>();
    values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
    const modal = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
    const deltas = values.map((v) => cfg.CATEGORY_DELTAS[item]?.[v]).filter((d): d is number => typeof d === "number");
    const suggestedImpute = values.length >= minN && deltas.length ? Math.round(mean(deltas) * 20) / 20 : null;
    return { item, modal, reference: cfg.REF_CATEGORY[item] ?? "", n: values.length, suggestedImpute, priorImpute: cfg.IMPUTE_DELTA[item] ?? 0 };
  });
}

const fmtBand = (b: Band) => (b.kind === "twoSided" ? `${(b.c - b.h).toFixed(3)}…${(b.c + b.h).toFixed(3)} (r ${b.r})` : `≤ ${b.h.toFixed(3)} (r ${b.r})`);
const pct = (v: number) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "–");

export function renderReport(bands: ComponentRefit[], cats: CategoryRefit[], n: number): string {
  const lines = [
    `# hybrid.v1 önsel yeniden uydurma önerisi`,
    ``,
    `Kayıt: ${n}. Bantlar yalnız genişler; alt grup bant içi payı düşen öneri reddedilir. MISSING_PEN = 0 (uydurulmaz).`,
    ``,
    `| Bileşen | Önsel bölge | Önerilen bölge | Değişti | Kabul | Not |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...bands.map((b) => `| ${b.component} | ${fmtBand(b.prior)} | ${fmtBand(b.suggested)} | ${b.changed ? "evet" : "hayır"} | ${b.acceptable ? "✅" : "⛔"} | ${b.insufficient ? "yetersiz örnek" : b.reasons.join(", ")} |`),
    ``,
    `## Alt grup bant içi payları (önsel → önerilen)`,
    ``,
    `| Bileşen | Boyut | Grup | n | Önsel | Önerilen |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...bands.flatMap((b) => b.shares.map((s) => `| ${b.component} | ${s.dimension} | ${s.group} | ${s.n} | ${pct(s.prior)} | ${pct(s.suggested)} |`)),
    ``,
    `## Kategoriler`,
    ``,
    `| Öğe | En sık | Referans | n | IMPUTE önsel | IMPUTE önerilen |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...cats.map((c) => `| ${c.item} | ${c.modal ?? "–"} | ${c.reference} | ${c.n} | ${c.priorImpute} | ${c.suggestedImpute ?? "yetersiz"} |`),
    ``,
  ];
  return lines.join("\n");
}

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const inPath = argValue(args, "--in");
  if (!inPath) {
    console.error(HELP);
    return 1;
  }
  const minN = Number(argValue(args, "--min-n")) || 20;
  const json: unknown = JSON.parse(readFileSync(inPath, "utf8"));
  assertNumbersOnly(json);
  const runs = RunsSchema.parse(json);

  const engine = await loadEngine();
  const priorsPath = argValue(args, "--priors");
  const bandsSource: unknown = priorsPath ? JSON.parse(readFileSync(priorsPath, "utf8")) : engine?.config.BANDS;
  const bands = z.record(z.string(), z.object({ band: BandSchema })).safeParse(bandsSource);
  if (!bands.success) {
    console.error("Önsel bantlar bulunamadı: motor yapılandırması (lib/config/engine.server.ts) yok veya --priors geçersiz.");
    return 2;
  }
  const bandRefits = refitBands(runs.items, bands.data, minN);
  const votes = runs.items.flatMap((it) => (it.votes ? [it.votes] : []));
  const catRefits = engine ? refitCategories(votes, engine.config, minN) : [];
  console.log(renderReport(bandRefits, catRefits, runs.items.length));
  const out = argValue(args, "--out");
  if (out) {
    writeFileSync(out, `${JSON.stringify({ bands: Object.fromEntries(bandRefits.map((b) => [b.component, b.suggested])), impute: Object.fromEntries(catRefits.map((c) => [c.item, c.suggestedImpute])) }, null, 2)}\n`);
    console.log(`${out} yazıldı (yalnız öneri; engine.server.ts elle ve onayla güncellenir).`);
  }
  return bandRefits.every((b) => b.acceptable) ? 0 : 1;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : "hata");
      process.exit(1);
    },
  );
}
