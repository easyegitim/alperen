/**
 * SPEC 8.8 / Faz 15 madde 2: adalet (önyargı) kontrolü; hybrid.v1 için engine spec §12 SPEC 8.8 kapısı.
 * Ücretli AI çağrısı yapar; CLAUDE.md gereği yalnız açık onayla ve --confirm-paid ile çalışır. Fotoğraflar yalnız
 * şifreli yerel diskte durur; bu betik hiçbir görseli yazmaz, yüklemez veya loglamaz. Dosya adları kişi kimliği taşımamalı.
 *
 * Motor seçimi (--engine, varsayılan SCORE_ENGINE):
 *  - legacy: Gemini sayısal skor (score.v1, v0). Kapı: bir grup > 0,5 puan düşükse yayın durur (FAIRNESS_MAX_GAP).
 *  - hybrid.v1: Claude/Gemini enum gözlemi + koddaki skor (scoreHybrid, sözleşme C4). Kapı mutlak düzey değil FARK:
 *    (a) yapısal bileşen bant içi pay farkı ≤ 10 puan, (b) alt skor ortalama farkı ≤ 0,1, (c) genel ≤ 0,15,
 *    (d) alan başına κ (2 değerlendiriciye karşı) Monk kovaları arasında fark ≤ 0,1, (e) çekim oranları farkı ≤ 5 puan,
 *    (f) hariç tutulan grupların tavan (potansiyel) farkı raporlanır.
 *
 * Kullanım: pnpm fairness <manifest.json> [--engine legacy|hybrid.v1] [--calls 3] [--out docs/fairness.md] [--confirm-paid]
 * manifest.json: { "dir": "/sifreli/disk/klasor", "items": [ { "file": "a1.jpg",
 *   "groups": { "monk": "7", "presentation": "f", "beard": "no", "glasses": "no", "headCovering": "yes", "hairType": "coily", "noHair": "no" },
 *   "geometry": <GeometryResult, yalnız sayılar; hybrid.v1 için gerekli>,
 *   "context": { "headCovering": true, "presentation": "female", "beardPreference": "none" },
 *   "labels": [<Observation insan A>, <Observation insan B>],
 *   "capture": { "tooDark": false, "manual": false, "rejected": false } } ] }
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { ObservationOutput, type Observation } from "../lib/ai/observationSchema";
import { OBSERVE_PROMPT_VERSION } from "../lib/ai/prompts/observe.v2";
import { buildScorePrompt } from "../lib/ai/prompts/score.v1";
import { SCORE_OUTPUT_JSON_SCHEMA, ScoreOutput } from "../lib/ai/scoreSchema";
import { SUB_KEYS, type SubKeyV1 } from "../lib/config/teaser";
import type { GeometryResult } from "../lib/face/types";
import { aggregateScores } from "../lib/score/aggregate";
import { calibrate } from "../lib/score/calibration";
import { fairnessSummary, type FairnessItem } from "../lib/score/fairness";
import {
  ENGINE_FAIRNESS_GATE,
  argValue,
  assertNumbersOnly,
  fieldKappas,
  gapBy,
  isMain,
  loadEngine,
  mean,
  positional,
  type GapResult,
} from "./engine-tooling";

const HELP = `fairness (ÜCRETLİ, yalnız onayla): alt gruplar arası skor farkı raporu (SPEC 8.8).
Kullanım: pnpm fairness <manifest.json> [--engine legacy|hybrid.v1] [--calls 3] [--out docs/fairness.md] [--confirm-paid]
--confirm-paid olmadan hiçbir istek atılmaz. hybrid.v1 için her kayıtta geometry ve context gerekir.`;

// ---------------------------------------------------------------------------------------------------------------------
// hybrid.v1 kapısı (saf; birim testi var)

export type HybridRow = {
  groups: Record<string, string>;
  overall: number;
  potential: number;
  subscores: Record<SubKeyV1, number>;
  /** Değerlendirilmeyen bakım alanları (o alanın ortalamasına girmez). */
  notAssessed: string[];
  components: { key: string; status: "measured" | "not_measured"; pen: number }[];
  obs: Observation | null;
  labels?: Observation[];
  capture?: { tooDark?: boolean; manual?: boolean; rejected?: boolean };
};

export type EngineFairness = { checks: (GapResult & { gate: string })[]; ceiling: GapResult[]; pass: boolean };

const G = ENGINE_FAIRNESS_GATE;

export function engineFairness(rows: HybridRow[], minN = 3): EngineFairness {
  const dims = [...new Set(rows.flatMap((r) => Object.keys(r.groups)))].sort();
  const checks: (GapResult & { gate: string })[] = [];
  const add = (gate: string, g: GapResult) => checks.push({ ...g, gate });
  const rate = (pick: (r: HybridRow) => boolean | undefined) => (rs: HybridRow[]) => {
    const known = rs.filter((r) => pick(r) !== undefined);
    return known.length ? (known.filter((r) => pick(r)).length / known.length) * 100 : NaN;
  };
  for (const d of dims) {
    const groupOf = (r: HybridRow) => r.groups[d];
    add("c overall", gapBy(rows, `${d} · genel`, groupOf, (rs) => mean(rs.map((r) => r.overall)), G.overallMeanGap, minN));
    for (const k of SUB_KEYS) {
      const assessed = rows.filter((r) => !r.notAssessed.includes(k));
      add("b sub", gapBy(assessed, `${d} · ${k}`, groupOf, (rs) => mean(rs.map((r) => r.subscores[k])), G.subMeanGap, minN));
    }
    const comps = [...new Set(rows.flatMap((r) => r.components.map((c) => c.key)))].sort();
    for (const c of comps) {
      const measured = rows.filter((r) => r.components.some((x) => x.key === c && x.status === "measured"));
      add(
        "a band share",
        gapBy(measured, `${d} · ${c} bant içi %`, groupOf, (rs) => (rs.filter((r) => r.components.some((x) => x.key === c && x.pen === 0)).length / rs.length) * 100, G.componentShareGapPts, minN),
      );
    }
    add("e capture", gapBy(rows, `${d} · too_dark %`, groupOf, rate((r) => r.capture?.tooDark), G.captureRateGapPts, minN));
    add("e capture", gapBy(rows, `${d} · elle çekim %`, groupOf, rate((r) => r.capture?.manual), G.captureRateGapPts, minN));
    add("e capture", gapBy(rows, `${d} · CAPTURE_QUALITY %`, groupOf, rate((r) => r.capture?.rejected), G.captureRateGapPts, minN));
    add("e capture", gapBy(rows, `${d} · retouch %`, groupOf, rate((r) => (r.obs ? r.obs.photo.retouch !== "none" : undefined)), G.captureRateGapPts, minN));
    add("e capture", gapBy(rows, `${d} · cilt kapalı %`, groupOf, rate((r) => (r.obs ? r.obs.photo.skinVisibility === "obscured" : undefined)), G.captureRateGapPts, minN));
  }
  // (d) κ: alan başına, Monk kovaları (ve saç tipi) arasında; her değerlendiriciye karşı ayrı.
  for (const d of dims.filter((x) => x === "monk" || x === "hairType")) {
    const labelled = rows.filter((r) => r.obs && r.labels?.length);
    for (const a of [0, 1]) {
      const fields = new Set<string>();
      const kappaOf = (rs: HybridRow[]) => {
        const pairs = rs.flatMap((r) => (r.obs && r.labels?.[a] ? [{ o: r.obs, l: r.labels[a] }] : []));
        return fieldKappas(
          pairs.map((p) => p.o),
          pairs.map((p) => p.l),
        );
      };
      const sample = kappaOf(labelled);
      Object.keys(sample).forEach((f) => fields.add(f));
      for (const f of fields) add("d kappa", gapBy(labelled, `${d} · κ${a === 0 ? "A" : "B"} ${f}`, (r) => r.groups[d], (rs) => kappaOf(rs)[f] ?? NaN, G.kappaGap, minN));
    }
  }
  // (f) Tavan farkı (yalnız rapor): potansiyel ortalaması, başörtüsü ve saçsız alt grupları dahil her boyut için.
  const ceiling = dims.map((d) => gapBy(rows, `${d} · potansiyel`, (r) => r.groups[d], (rs) => mean(rs.map((r) => r.potential)), Infinity, minN));
  const real = checks.filter((c) => c.groups.length > 1);
  return { checks: real, ceiling: ceiling.filter((c) => c.groups.length > 1), pass: real.every((c) => c.pass) };
}

export function renderEngineReport(f: EngineFairness, meta: { model: string; n: number; date: string }): string {
  const lines = [
    "# Adalet (önyargı) raporu — hybrid.v1",
    "",
    `Tarih: ${meta.date} · Gözlemci: ${meta.model} · n=${meta.n} · İstem: ${OBSERVE_PROMPT_VERSION} · Kalibrasyon: h1`,
    "",
    `Kapı (engine spec §12, SPEC 8.8): yapısal bant içi pay farkı ≤ ${G.componentShareGapPts} puan · alt skor farkı ≤ ${G.subMeanGap} · genel ≤ ${G.overallMeanGap} · κ farkı ≤ ${G.kappaGap} · çekim oranı farkı ≤ ${G.captureRateGapPts} puan.`,
    "",
    "| Kapı | Ölçüt | Gruplar (n) | Değerler | Fark | Sınır | Sonuç |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...f.checks.map(
      (c) =>
        `| ${c.gate} | ${c.dimension} | ${c.groups.map((g) => `${g.name} (${g.n})`).join(", ")} | ${c.groups.map((g) => g.value.toFixed(2)).join(" / ")} | ${c.gap.toFixed(2)} | ${c.limit} | ${c.pass ? "✅" : "⛔"} |`,
    ),
    "",
    "## Tavan (potansiyel) farkı — yalnız rapor",
    "",
    "| Ölçüt | Gruplar (n) | Ortalamalar | Fark |",
    "| --- | --- | --- | --- |",
    ...f.ceiling.map((c) => `| ${c.dimension} | ${c.groups.map((g) => `${g.name} (${g.n})`).join(", ")} | ${c.groups.map((g) => g.value.toFixed(2)).join(" / ")} | ${c.gap.toFixed(2)} |`),
    "",
    `Sonuç: ${f.pass ? "✅ tüm fark ölçütleri kapının içinde" : "⛔ en az bir ölçüt kapının dışında; ENGINE_STATUS fitted yapılamaz, üretim açılamaz"}`,
    "",
    "Fotoğraflar yalnız şifreli yerel diskte; bu rapor görsel veya kişi kimliği içermez. Köken bölgesi yalnız çevrimdışı rızalı değerlendirme setinde tutulur.",
  ];
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Çalıştırma

const ManifestSchema = z.object({
  dir: z.string(),
  items: z.array(
    z.object({
      file: z.string(),
      groups: z.record(z.string(), z.string()),
      geometry: z.custom<GeometryResult>((g) => typeof g === "object" && g !== null && "metrics" in g && "quality" in g).optional(),
      context: z
        .object({
          headCovering: z.boolean(),
          presentation: z.enum(["male", "female", "unspecified"]),
          beardPreference: z.enum(["none", "stubble", "short", "medium", "long", "any"]),
        })
        .optional(),
      labels: z.array(ObservationOutput).max(2).optional(),
      capture: z.object({ tooDark: z.boolean(), manual: z.boolean(), rejected: z.boolean() }).partial().optional(),
    }),
  ),
});

/** scoreHybrid sonucunun bu raporun okuduğu kısmı (C4 HybridScored). */
const HybridOut = z.object({
  overall: z.number(),
  potential: z.number(),
  subscores: z.object({ harmony: z.number(), eyes: z.number(), jawline: z.number(), skin: z.number(), hair: z.number(), grooming: z.number() }),
  model: z.string(),
  signals: z.object({
    notAssessed: z.array(z.object({ sub: z.string(), reason: z.string() })),
    components: z.array(z.object({ key: z.string(), status: z.enum(["measured", "not_measured"]), pen: z.number() })),
    obs: ObservationOutput,
  }),
});

async function runLegacy(manifest: z.infer<typeof ManifestSchema>, calls: number, out: string): Promise<number> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY gerekli.");
    return 1;
  }
  const model = process.env.GEMINI_SCORE_MODEL || "gemini-3.5-flash-lite";
  const ai = new GoogleGenAI({ apiKey });
  const scoreOnce = async (b64: string, prompt: string) => {
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: b64 } }, { text: prompt }] }],
      config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: SCORE_OUTPUT_JSON_SCHEMA },
    });
    return ScoreOutput.parse(JSON.parse(res.text ?? ""));
  };
  const prompt = buildScorePrompt({ presentation: "unspecified", geometry: { note: "fairness run, no geometry" }, bodyFatContextAllowed: false });
  const items: FairnessItem[] = [];
  for (const [i, it] of manifest.items.entries()) {
    const b64 = readFileSync(path.join(manifest.dir, it.file)).toString("base64");
    const settled = await Promise.allSettled(Array.from({ length: calls }, () => scoreOnce(b64, prompt)));
    try {
      const agg = aggregateScores(settled);
      items.push({ groups: it.groups, overall: calibrate(agg.rawOverall, "v0"), subscores: Object.fromEntries(SUB_KEYS.map((k) => [k, agg.rawSubscores[k]])) });
      console.log(`${i + 1}/${manifest.items.length} tamam`);
    } catch (e) {
      console.log(`${i + 1}: atlandı (${e instanceof Error ? e.message : "hata"})`);
    }
  }
  const summary = fairnessSummary(items);
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    "# Adalet (önyargı) raporu",
    "",
    `Tarih: ${today} · Model: ${model} · Çağrı/foto: ${calls} · n=${items.length} · Prompt: score.v1 · Kalibrasyon: v0`,
    "",
    "Ölçüm: grup ortalamaları arasındaki en büyük fark / grup içi havuzlanmış SS (SPEC 8.8). Yayın kapısı: hiçbir grup > 0,5 puan düşük değil; hedef ≤ 0,3 (SPEC 17.2).",
    "",
    "| Boyut | Gruplar (n) | Ortalamalar | En büyük fark | Oran (fark/SS) | Kapı |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const d of summary.dimensions) {
    lines.push(
      `| ${d.dimension} | ${d.groups.map((g) => `${g.name} (${g.n})`).join(", ")} | ${d.groups.map((g) => g.mean.toFixed(2)).join(" / ")} | ${d.maxGap.toFixed(2)} | ${d.ratio.toFixed(2)} | ${d.pass ? "✅" : "⛔ yayın durur"} |`,
    );
  }
  lines.push("", `Sonuç: ${summary.pass ? "✅ tüm boyutlar kapının içinde" : "⛔ en az bir boyut kapının dışında; prompt veya kalibrasyon düzeltilmeden yayın yok"}`, "");
  lines.push("Fotoğraflar yalnız şifreli yerel diskte; bu rapor görsel veya kişi kimliği içermez.");
  writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(`\n${out} yazıldı. Sonuç: ${summary.pass ? "GEÇTİ" : "KALDI"}`);
  return 0;
}

async function runHybrid(manifest: z.infer<typeof ManifestSchema>, out: string): Promise<number> {
  const engine = await loadEngine();
  if (!engine) {
    console.error("Motor (lib/score/engine, lib/config/engine.server.ts) bulunamadı veya sözleşmeye uymuyor; hiçbir istek atılmadı.");
    return 2;
  }
  const missing = manifest.items.filter((it) => !it.geometry || !it.context).length;
  if (missing) {
    console.error(`${missing} kayıtta geometry veya context yok; hybrid.v1 için gerekli. Hiçbir istek atılmadı.`);
    return 1;
  }
  const { getObservationProvider } = await import("../lib/ai/observeProvider");
  const provider = getObservationProvider();
  const rows: HybridRow[] = [];
  for (const [i, it] of manifest.items.entries()) {
    const { geometry, context } = it;
    if (!geometry || !context) continue;
    const b64 = readFileSync(path.join(manifest.dir, it.file)).toString("base64");
    try {
      const r = HybridOut.parse(await engine.scoreHybrid(b64, geometry, context, provider));
      rows.push({
        groups: it.groups,
        overall: r.overall,
        potential: r.potential,
        subscores: r.subscores,
        notAssessed: r.signals.notAssessed.map((n) => n.sub),
        components: r.signals.components,
        obs: r.signals.obs,
        labels: it.labels,
        capture: it.capture,
      });
      console.log(`${i + 1}/${manifest.items.length} tamam`);
    } catch (e) {
      // Yalnız hata kodu/adı: görsel, istem veya model çıktısı yazılmaz.
      console.log(`${i + 1}: atlandı (${e instanceof Error ? e.name : "hata"})`);
    }
  }
  const f = engineFairness(rows);
  writeFileSync(out, renderEngineReport(f, { model: provider.model, n: rows.length, date: new Date().toISOString().slice(0, 10) }));
  console.log(`\n${out} yazıldı. Sonuç: ${f.pass ? "GEÇTİ" : "KALDI"}`);
  return f.pass ? 0 : 1;
}

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const manifestPath = positional(args, ["--engine", "--calls", "--out"]);
  if (!manifestPath) {
    console.error(HELP);
    return 1;
  }
  const engineArg = argValue(args, "--engine") ?? (process.env.SCORE_ENGINE === "hybrid.v1" ? "hybrid.v1" : "legacy");
  if (engineArg !== "legacy" && engineArg !== "hybrid.v1") {
    console.error(HELP);
    return 1;
  }
  const calls = Number(argValue(args, "--calls")) || 3;
  const out = argValue(args, "--out") ?? "docs/fairness.md";
  const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertNumbersOnly(raw);
  const manifest = ManifestSchema.parse(raw);
  console.log(`Plan: ${engineArg}, ${manifest.items.length} foto (${engineArg === "legacy" ? `${calls} çağrı/foto` : "OBSERVE_CALLS çağrı/foto"}), ücretli.`);
  if (!args.includes("--confirm-paid")) {
    console.log("--confirm-paid verilmedi: hiçbir istek atılmadı (CLAUDE.md: ücretli betik yalnız onayla).");
    return 3;
  }
  return engineArg === "legacy" ? runLegacy(manifest, calls, out) : runHybrid(manifest, out);
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
