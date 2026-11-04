/**
 * TSV → content/methods/<ad>.json içe aktarma (PLAN 4e / Sprint 3; KB Ç2 "uydurma yöntem yok").
 *
 * Kullanım: pnpm tsx scripts/import-methods.ts --in aura-yontem-kutuphanesi.tsv [--flaws aura-kusur-taksonomisi.tsv] [--out content/methods/library.json] [--dry]
 *
 * Sütun sözleşmesi lib/coach/knowledge.ts TSV_METHOD_COLUMNS / TSV_FLAW_COLUMNS içindedir ve VARSAYIMDIR (ekip dosyaları
 * henüz gelmedi). Betik başlık satırını sözleşmeyle eşleştirir (küçük harf, boşluk → _), eksik zorunlu sütunda durur ve
 * raporlar; geçersiz satırı atlar ve nedenini yazar; hiçbir alanı uydurmaz. Çıktı MethodsFile şemasından geçer.
 * Saf ayrıştırma fonksiyonları dışa aktarılır (birim testi tests/unit/importMethods.test.ts; örnek fikstür
 * tests/fixtures/methods-sample.tsv — ÖRNEKTİR, ürüne girmez). Ağ ve AI çağrısı yok.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { EVIDENCE_FROM_GRADE, PLAN_AREAS, PLAN_TIERS, type PlanArea, type PlanTier } from "../lib/config/plan";
import { CONTRAINDICATIONS, COST_BANDS, COST_BAND_TRY, MethodRecord, MethodsFile, TSV_FLAW_COLUMNS, TSV_METHOD_COLUMNS, type Contraindication, type CostBand } from "../lib/coach/knowledge";
import { normalizeTr } from "../lib/ai/safety";
import { REGION_KEYS, type RegionKey } from "../lib/score/contract";

export type TsvTable = { header: string[]; rows: Record<string, string>[] };

/** Başlık normalizasyonu: "Cost Band" → "cost_band". */
export function normalizeHeader(h: string): string {
  return normalizeTr(h.trim()).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Basit TSV: sekme ayrımı, satır sonu CRLF/LF; tırnak işlenmez (TSV'de alanlar sekme içermez). Boş satır atlanır. */
export function parseTsv(text: string): TsvTable {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0]!.split("\t").map(normalizeHeader);
  const rows = lines.slice(1).map((l) => {
    const cells = l.split("\t");
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
  return { header, rows };
}

export function missingRequired(header: readonly string[], required: readonly string[]): string[] {
  const set = new Set(header);
  return required.filter((c) => !set.has(c));
}

const list = (v: string | undefined, sep: string) => (v ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
const intIn = (v: string, lo: number, hi: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};
const level3 = (v: string): 1 | 2 | 3 | null => {
  const n = intIn(v, 1, 3);
  return n === 1 || n === 2 || n === 3 ? n : null;
};

export type RowResult = { ok: true; record: MethodRecord } | { ok: false; line: number; id: string; reason: string };

/** Bir TSV satırını MethodRecord'a çevirir; her alan doğrulanır, geçersizse satır nedeniyle düşer. */
export function rowToRecord(row: Record<string, string>, line: number, sourceFile: string): RowResult {
  const id = row.id ?? "";
  const fail = (reason: string): RowResult => ({ ok: false, line, id, reason });
  if (!/^[a-z0-9_\-]{1,80}$/.test(id)) return fail("id");
  const area = row.area as PlanArea;
  if (!(PLAN_AREAS as readonly string[]).includes(area)) return fail("area");
  const tier = row.tier as PlanTier;
  if (!(PLAN_TIERS as readonly string[]).includes(tier)) return fail("tier");
  const grade = (row.evidence_grade ?? "").toUpperCase();
  if (grade !== "A" && grade !== "B" && grade !== "C") return fail("evidence_grade");
  const costBand = row.cost_band as CostBand;
  if (!(COST_BANDS as readonly string[]).includes(costBand)) return fail("cost_band");
  const per = row.frequency_per;
  if (per !== "once" && per !== "day" && per !== "week" && per !== "month") return fail("frequency_per");
  const times = intIn(row.frequency_times ?? "", 1, 14);
  if (times === null) return fail("frequency_times");
  const minutes = Number(row.minutes_per_day);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 180) return fail("minutes_per_day");
  const difficulty = level3(row.difficulty ?? "");
  const impact = level3(row.impact ?? "");
  const effort = level3(row.effort ?? "");
  if (!difficulty || !impact || !effort) return fail("difficulty/impact/effort");
  const sep = TSV_METHOD_COLUMNS.listSeparator;
  const regions = list(row.regions, sep);
  if (!regions.every((r) => (REGION_KEYS as readonly string[]).includes(r))) return fail("regions");
  const contraindications = list(row.contraindications, sep);
  if (!contraindications.every((c) => (CONTRAINDICATIONS as readonly string[]).includes(c))) return fail("contraindications");
  const title = (row.user_label_tr || row.title_tr || "").trim();
  if (!title) return fail("title_tr");
  const summary = (row.summary_tr ?? "").trim();
  const min = row.cost_min_try ? Number(row.cost_min_try) : null;
  const max = row.cost_max_try ? Number(row.cost_max_try) : null;
  const costTryRange = min !== null && Number.isFinite(min) ? { min: Math.max(0, Math.round(min)), max: max !== null && Number.isFinite(max) ? Math.round(max) : null } : COST_BAND_TRY[costBand];
  const source = (row.source_url ?? "").trim();
  const record = {
    id,
    area,
    title: title.slice(0, 120),
    summary: summary.slice(0, 400),
    tier,
    evidence: { level: EVIDENCE_FROM_GRADE[grade], grade, ...(source ? { source: source.slice(0, 300) } : {}) },
    costBand,
    costTryRange,
    frequency: { per, times },
    minutesPerDay: minutes,
    difficulty,
    impact,
    effort,
    tags: [...new Set(list(row.tags, sep).map((t) => normalizeTr(t)))].slice(0, 20),
    regions: regions as RegionKey[],
    contraindications: contraindications as Contraindication[],
    flawIds: list(row.flaw_ids, sep).slice(0, 20),
    ...(row.tryon_preset_id ? { tryonPresetId: row.tryon_preset_id } : {}),
    source: { kind: "tsv" as const, ref: `${sourceFile}#${line}` },
  };
  const parsed = MethodRecord.safeParse(record);
  return parsed.success ? { ok: true, record: parsed.data } : fail(`schema:${parsed.error.issues[0]?.path.join(".") ?? "?"}`);
}

export type ImportReport = { file: MethodsFile | null; missingColumns: string[]; imported: number; skipped: { line: number; id: string; reason: string }[]; duplicates: string[] };

/** TSV metnini MethodsFile'a çevirir (saf). Eksik zorunlu sütunda file null. */
export function importMethodsTsv(text: string, sourceFile: string, importedAt = new Date().toISOString()): ImportReport {
  const table = parseTsv(text);
  const missing = missingRequired(table.header, TSV_METHOD_COLUMNS.required);
  if (missing.length > 0) return { file: null, missingColumns: missing, imported: 0, skipped: [], duplicates: [] };
  const records: MethodRecord[] = [];
  const skipped: ImportReport["skipped"] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, i) => {
    const r = rowToRecord(row, i + 2, sourceFile);
    if (!r.ok) return skipped.push({ line: r.line, id: r.id, reason: r.reason });
    if (seen.has(r.record.id)) return duplicates.push(r.record.id);
    seen.add(r.record.id);
    records.push(r.record);
  });
  const file = MethodsFile.parse({ version: "methods.v1", importedAt, sourceFile, records });
  return { file, missingColumns: [], imported: records.length, skipped, duplicates };
}

export type FlawRow = { flawId: string; region: RegionKey; userLabelTr: string; methodIds: string[] };

/** Kusur taksonomisi (660): iç ad (internal_name_tr) ÜRÜNE GİRMEZ; yalnız nötr kullanıcı etiketi ve yöntem bağları alınır. */
export function importFlawsTsv(text: string): { rows: FlawRow[]; missingColumns: string[]; skipped: number } {
  const table = parseTsv(text);
  const missing = missingRequired(table.header, TSV_FLAW_COLUMNS.required);
  if (missing.length > 0) return { rows: [], missingColumns: missing, skipped: 0 };
  const rows: FlawRow[] = [];
  let skipped = 0;
  for (const r of table.rows) {
    const region = r.region as RegionKey;
    if (!r.flaw_id || !(REGION_KEYS as readonly string[]).includes(region) || !r.user_label_tr) {
      skipped += 1;
      continue;
    }
    rows.push({ flawId: r.flaw_id, region, userLabelTr: r.user_label_tr, methodIds: list(r.method_ids, TSV_FLAW_COLUMNS.listSeparator) });
  }
  return { rows, missingColumns: [], skipped };
}

/** Yöntem kayıtlarına kusur bağlarını (flawIds) ekler: yöntem → kusur ters indeksi. Saf. */
export function attachFlawIds(file: MethodsFile, flaws: readonly FlawRow[]): MethodsFile {
  const byMethod = new Map<string, Set<string>>();
  for (const f of flaws) for (const m of f.methodIds) (byMethod.get(m) ?? byMethod.set(m, new Set()).get(m)!).add(f.flawId);
  return { ...file, records: file.records.map((r) => ({ ...r, flawIds: [...new Set([...r.flawIds, ...(byMethod.get(r.id) ?? [])])].slice(0, 20) })) };
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(): void {
  const args = process.argv.slice(2);
  const input = argValue(args, "--in");
  if (!input || args.includes("--help")) {
    console.log("Kullanım: pnpm tsx scripts/import-methods.ts --in <yontemler.tsv> [--flaws <kusurlar.tsv>] [--out content/methods/<ad>.json] [--dry]");
    process.exit(input ? 0 : 1);
  }
  const text = readFileSync(input, "utf8");
  const report = importMethodsTsv(text, basename(input));
  if (!report.file) {
    console.error(`Eksik zorunlu sütun: ${report.missingColumns.join(", ")} — sözleşme: ${TSV_METHOD_COLUMNS.required.join(", ")}`);
    process.exit(2);
  }
  let file = report.file;
  const flawsPath = argValue(args, "--flaws");
  if (flawsPath) {
    const flaws = importFlawsTsv(readFileSync(flawsPath, "utf8"));
    if (flaws.missingColumns.length > 0) {
      console.error(`Kusur dosyasında eksik sütun: ${flaws.missingColumns.join(", ")}`);
      process.exit(2);
    }
    file = attachFlawIds(file, flaws.rows);
    console.log(`kusur satırı: ${flaws.rows.length} (atlanan ${flaws.skipped})`);
  }
  for (const s of report.skipped) console.warn(`atlandı satır ${s.line} (${s.id || "-"}): ${s.reason}`);
  if (report.duplicates.length) console.warn(`tekrar eden kimlik: ${report.duplicates.join(", ")}`);
  console.log(`içe aktarılan: ${report.imported}, atlanan: ${report.skipped.length}`);
  const out = argValue(args, "--out") ?? `content/methods/${basename(input).replace(/\.tsv$/i, "")}.json`;
  if (args.includes("--dry")) return;
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`yazıldı: ${out} — content/methods/index.ts METHOD_FILES listesine ekle.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
