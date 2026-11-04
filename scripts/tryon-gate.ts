/**
 * Sanal deneme sürüm kapısı (KB §7.3 R2-C10/4 KARAR; PLAN_V2 5f; lib/tryon/types.ts TRYON_RELEASE_GATE):
 * 30 rızalı test yüzü × 12 sakal stili = 360 görsel. Her sürümde en az %95'i geçmeli; %90'ın altında kalan stil
 * listeden gizlenir (content/*-presets.ts `hidden: true`). Geçiş = görsel modeli üretti VE Claude kalite kontrolü
 * (lib/ai/tryonQc.ts; ≤ TRYON_QC_MAX_REGEN yeniden üretim) geçti. İstemci tarafı sapma/kompozit kontrolü (worker)
 * Node'da çalışmaz; bu kapı üretim + kalite kontrolünü ölçer.
 *
 * ⚠️ ÜCRETLİ: görsel modeli (Gemini) + Claude kalite kontrolü gerçek API'ye istek atar. CLAUDE.md gereği yalnız
 * kullanıcının açık onayıyla ve --confirm-paid bayrağıyla; bayrak yoksa yalnız plan ve tahmini maliyet yazılır.
 *
 * Gizlilik: test fotoğrafları yalnız şifreli yerel diskte durur, yalnız çağrı süresince bellekte tutulur; görsel,
 * istem, model çıktısı veya dosya adı yazılmaz/loglanmaz. CSV yalnız yüz takma adı, stil kimliği ve sonuç kodları taşır.
 * Üretilen görseller kaydedilmez (yalnız geç/kal).
 *
 * Kullanım: pnpm tsx --conditions=react-server scripts/tryon-gate.ts <manifest.json> [--csv out.csv] [--confirm-paid]
 *           pnpm tsx scripts/tryon-gate.ts --evaluate rows.csv        (çevrimdışı: yalnız kapı hesabı ve gizlenecek stiller)
 * manifest.json: { "dir": "/sifreli/klasor", "faces": [ { "id": "f01", "file": "f01-front.jpg" } ], "styles"?: ["van_dyke", …] (varsayılan 12 sakal) }
 * Fotoğraf: 1024 px kare yüz kırpımı JPEG (lib/face/crop.ts ile aynı), tek yüz, rızalı.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { BEARD_PRESET_IDS, PRESET_BY_ID } from "../content/presets";
import { TRYON_IMAGE_MODEL_DEFAULT, getTryonConfig } from "../lib/config/tryon";
import { TRYON_RELEASE_GATE, type QcReason } from "../lib/tryon/types";
import { argValue, isMain, toCsv } from "./engine-tooling";

export type GateOutcome = "pass" | "qc_failed" | "unchecked" | "error";
export type GateRow = { face: string; style: string; outcome: GateOutcome; regenCount: number; reasons: QcReason[] };

export type StyleStat = { style: string; total: number; passed: number; rate: number; hide: boolean };
export type GateResult = { total: number; passed: number; rate: number; pass: boolean; styles: StyleStat[]; hiddenStyles: string[]; unchecked: number };

/**
 * Saf kapı hesabı: geçen = outcome "pass". "unchecked" (kontrol yapılamadı) geçmiş SAYILMAZ (kapı Claude kontrolünü ölçer);
 * sayısı ayrıca raporlanır. Stil başına oran < hideStyleBelow → hide; toplam oran ≥ minPassRate → kapı geçti.
 */
export function evaluateTryonGate(rows: readonly GateRow[], gate = TRYON_RELEASE_GATE): GateResult {
  const byStyle = new Map<string, GateRow[]>();
  for (const r of rows) byStyle.set(r.style, [...(byStyle.get(r.style) ?? []), r]);
  const styles: StyleStat[] = [...byStyle].map(([style, rs]) => {
    const passed = rs.filter((r) => r.outcome === "pass").length;
    const rate = rs.length ? passed / rs.length : 0;
    return { style, total: rs.length, passed, rate: round3(rate), hide: rate < gate.hideStyleBelow };
  });
  const passed = rows.filter((r) => r.outcome === "pass").length;
  const rate = rows.length ? passed / rows.length : 0;
  return {
    total: rows.length,
    passed,
    rate: round3(rate),
    pass: rows.length > 0 && rate >= gate.minPassRate,
    styles,
    hiddenStyles: styles.filter((s) => s.hide).map((s) => s.style),
    unchecked: rows.filter((r) => r.outcome === "unchecked").length,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function gateCsv(rows: readonly GateRow[]): string {
  return toCsv(["face", "style", "outcome", "regenCount", "reasons"], rows.map((r) => [r.face, r.style, r.outcome, r.regenCount, r.reasons.join(";")]));
}

export function parseGateCsv(text: string): GateRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const get = (cells: string[], k: string) => cells[header.indexOf(k)] ?? "";
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return {
      face: get(cells, "face"),
      style: get(cells, "style"),
      outcome: get(cells, "outcome") as GateOutcome,
      regenCount: Number(get(cells, "regenCount")) || 0,
      reasons: get(cells, "reasons").split(";").filter(Boolean) as QcReason[],
    };
  });
}

export const GateManifest = z.object({
  dir: z.string(),
  faces: z.array(z.object({ id: z.string(), file: z.string() })).min(1),
  styles: z.array(z.string()).min(1).optional(),
});
export type GateManifest = z.infer<typeof GateManifest>;

/**
 * Maliyet tahmini (SPEC 10.7: görsel ≈ $0,0336 lite / $0,067 flash; kalite kontrolü Opus 5.5 ≈ 2 görsel + istem ≈ 3,6k
 * giriş $4/M + ~150 çıkış $20/M ≈ $0,018). En kötü durum = her görsel (1 + maxRegen) kez üretilir ve kontrol edilir.
 */
export const IMAGE_USD: Record<string, number> = { "gemini-3.1-flash-lite-image": 0.0336, "gemini-3.1-flash-image": 0.067 };
export const QC_USD_PER_CHECK = 0.018;
export function estimateGateCost(faces: number, styles: number, opts: { imageModel: string; maxRegen: number }): { images: number; perImageUsd: number; expectedUsd: number; worstUsd: number } {
  const images = faces * styles;
  const perImageUsd = (IMAGE_USD[opts.imageModel] ?? IMAGE_USD[TRYON_IMAGE_MODEL_DEFAULT]) + QC_USD_PER_CHECK;
  return { images, perImageUsd: round3(perImageUsd), expectedUsd: round3(images * perImageUsd), worstUsd: round3(images * perImageUsd * (1 + opts.maxRegen)) };
}

function printReport(res: GateResult, gate = TRYON_RELEASE_GATE): void {
  console.log(`Görsel: ${res.total} · geçen: ${res.passed} (${(res.rate * 100).toFixed(1)}%) · kontrolsüz: ${res.unchecked} · eşik ${gate.minPassRate * 100}%`);
  for (const s of res.styles) console.log(`  ${s.style.padEnd(18)} ${s.passed}/${s.total} (${(s.rate * 100).toFixed(0)}%)${s.hide ? "  → GİZLE (< " + gate.hideStyleBelow * 100 + "%)" : ""}`);
  console.log(res.pass ? "KAPI: GEÇTİ" : "KAPI: GEÇMEDİ");
  if (res.hiddenStyles.length) console.log(`Gizlenecek stiller (content/*-presets.ts hidden: true): ${res.hiddenStyles.join(", ")}`);
}

async function main(args: string[]): Promise<void> {
  const evaluate = argValue(args, "--evaluate");
  if (evaluate) {
    printReport(evaluateTryonGate(parseGateCsv(readFileSync(evaluate, "utf8"))));
    return;
  }
  const csvOut = argValue(args, "--csv");
  const manifestPath = args.find((a) => !a.startsWith("--") && a !== csvOut);
  if (!manifestPath) {
    console.log("Kullanım: tryon-gate.ts <manifest.json> [--csv out.csv] [--confirm-paid] | --evaluate rows.csv");
    return;
  }
  const manifest = GateManifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const styles = manifest.styles ?? BEARD_PRESET_IDS;
  const unknown = styles.filter((s) => !PRESET_BY_ID.has(s));
  if (unknown.length) throw new Error(`bilinmeyen stil: ${unknown.join(", ")}`);
  const cfg = getTryonConfig();
  const cost = estimateGateCost(manifest.faces.length, styles.length, { imageModel: cfg.imageModel, maxRegen: cfg.qcMaxRegen });
  console.log(`Plan: ${manifest.faces.length} yüz × ${styles.length} stil = ${cost.images} görsel (hedef ${TRYON_RELEASE_GATE.images}); model ${cfg.imageModel}, kontrol ${cfg.qc === "on" ? cfg.qcModel : "KAPALI"}, ≤ ${cfg.qcMaxRegen} yeniden üretim`);
  console.log(`Tahmini maliyet ≈ $${cost.expectedUsd.toFixed(2)} (en kötü $${cost.worstUsd.toFixed(2)}; görsel başına $${cost.perImageUsd.toFixed(3)})`);
  if (manifest.faces.length < TRYON_RELEASE_GATE.faces) console.log(`Not: ${TRYON_RELEASE_GATE.faces} rızalı yüz hedefinin altında (${manifest.faces.length}).`);
  if (!args.includes("--confirm-paid")) {
    console.log("--confirm-paid verilmedi: hiçbir istek atılmadı.");
    return;
  }
  const { getTryonProvider } = await import("../lib/ai/tryonProvider");
  const { getQcProvider } = await import("../lib/ai/tryonQc");
  const { generateWithQc } = await import("../lib/tryon/pipeline.server");
  const { buildTryonPromptV2, describeExpectation } = await import("../lib/ai/prompts/tryon.v2");
  const { resolvePresets } = await import("../lib/tryon/combo");
  const provider = getTryonProvider();
  const qc = getQcProvider(cfg);
  const rows: GateRow[] = [];
  for (const face of manifest.faces) {
    const image = readFileSync(path.join(manifest.dir, face.file)).toString("base64");
    for (const style of styles) {
      const preset = PRESET_BY_ID.get(style)!;
      const presets = { [preset.kind]: preset.id };
      const promptInput = { mode: "style" as const, presets: resolvePresets(presets) };
      const prompt = buildTryonPromptV2(promptInput);
      const expectation = describeExpectation(promptInput);
      try {
        const out = await generateWithQc({
          generate: () => provider.generateTryOn({ imageBase64: image, prompt, mode: "style", presets }),
          qc,
          qcRequest: (r) => ({ originalBase64: image, originalMime: "image/jpeg", resultBase64: r.imageBase64, resultMime: r.mimeType, mode: "style", expectation }),
          maxRegen: cfg.qcMaxRegen,
        });
        rows.push({ face: face.id, style, outcome: out.outcome, regenCount: out.regenCount, reasons: out.verdict?.reasons ?? [] });
        console.log(`${face.id} × ${style}: ${out.outcome} (yeniden ${out.regenCount}, kontrol $${out.qcEstUsd.toFixed(3)})`);
      } catch (e) {
        rows.push({ face: face.id, style, outcome: "error", regenCount: 0, reasons: [] });
        console.warn(`${face.id} × ${style}: hata ${e instanceof Error ? e.name : "?"}`);
      }
    }
  }
  if (csvOut) writeFileSync(csvOut, gateCsv(rows));
  printReport(evaluateTryonGate(rows));
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
