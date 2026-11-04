/**
 * Tutarlılık kapısı (PLAN_V2 3d, §5/2; KB §4.2/5): 30 rızalı kişi × 5 fotoğraf seti; aynı kişinin setleri arasında genel
 * skor farkı en çok 0,4. Sürüm bu kapıdan geçmeden çıkmaz.
 *
 * ⚠️ ÜCRETLİ: hybrid.v2 motoru (3–4 Claude çalıştırması + denetim / set) gerçek API'ye istek atar. CLAUDE.md gereği
 * yalnız kullanıcının açık onayıyla ve --confirm-paid bayrağıyla; bayrak yoksa yalnız plan ve tahmini maliyet yazılır.
 *
 * Gizlilik: fotoğraflar yalnız şifreli yerel diskte durur, yalnız çağrı süresince bellekte tutulur; görsel, istem,
 * model metni veya dosya adı yazılmaz/loglanmaz. CSV yalnız kişi takma adı, set sırası ve sayılar taşır.
 *
 * Kullanım: pnpm tsx --conditions=react-server scripts/consistency-gate.ts <manifest.json> [--csv out.csv] [--confirm-paid]
 *           pnpm tsx scripts/consistency-gate.ts --evaluate rows.csv        (çevrimdışı: yalnız kapı hesabı)
 * manifest.json: { "dir": "/sifreli/klasor", "people": [ { "id": "p01", "context": { "ageBand": "25_34", "presentation": "male",
 *   "headCoveringDeclared": false }, "sets": [ { "files": [ { "view": "front", "file": "p01-1-front.jpg" }, { "view": "profile_left",
 *   "file": "p01-1-left.jpg" } ], "geometry": <GeometryResult, yalnız sayılar> } ] } ] }
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { argValue, isMain, mean, sd, toCsv } from "./engine-tooling";

export const CONSISTENCY_GATE = { maxSpread: 0.4, minShare: 0.9 } as const;

export type ConsistencyRow = { person: string; set: number; overall: number; subscores: Record<string, number | null> };

export type PersonStat = { person: string; n: number; spread: number; sd: number; mean: number };
export type ConsistencyResult = { people: PersonStat[]; share: number; maxSpread: number; worst: string | null; pass: boolean; skipped: string[] };

/** Saf kapı hesabı: kişi başına genel skor yayılımı (max − min); en az 2 seti olan kişiler sayılır. */
export function evaluateConsistency(rows: readonly ConsistencyRow[], gate = CONSISTENCY_GATE): ConsistencyResult {
  const byPerson = new Map<string, number[]>();
  for (const r of rows) byPerson.set(r.person, [...(byPerson.get(r.person) ?? []), r.overall]);
  const people: PersonStat[] = [];
  const skipped: string[] = [];
  for (const [person, v] of byPerson) {
    if (v.length < 2) {
      skipped.push(person);
      continue;
    }
    people.push({ person, n: v.length, spread: round2(Math.max(...v) - Math.min(...v)), sd: round2(sd(v)), mean: round2(mean(v)) });
  }
  const ok = people.filter((p) => p.spread <= gate.maxSpread + 1e-9).length;
  const share = people.length ? ok / people.length : 0;
  const worst = people.reduce<PersonStat | null>((w, p) => (w === null || p.spread > w.spread ? p : w), null);
  return { people, share: round2(share), maxSpread: worst?.spread ?? 0, worst: worst?.person ?? null, pass: people.length > 0 && share >= gate.minShare, skipped };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function consistencyCsv(rows: readonly ConsistencyRow[]): string {
  const subs = ["harmony", "eyes", "jawline", "skin", "hair", "grooming", "brows"];
  return toCsv(["person", "set", "overall", ...subs], rows.map((r) => [r.person, r.set, r.overall, ...subs.map((k) => r.subscores[k] ?? null)]));
}

export function parseRowsCsv(text: string): ConsistencyRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const get = (k: string) => cells[header.indexOf(k)];
    const subscores: Record<string, number | null> = {};
    for (const k of header.slice(3)) subscores[k] = get(k) === "" ? null : Number(get(k));
    return { person: get("person"), set: Number(get("set")), overall: Number(get("overall")), subscores };
  });
}

const FileRef = z.object({ view: z.enum(["front", "profile_left", "profile_right", "left45", "right45", "hairline"]), file: z.string() });
export const ConsistencyManifest = z.object({
  dir: z.string(),
  people: z.array(
    z.object({
      id: z.string(),
      context: z.object({ ageBand: z.enum(["under_18", "18_24", "25_34", "35_49", "50_plus"]).nullable(), presentation: z.enum(["male", "female", "unspecified"]), headCoveringDeclared: z.boolean() }),
      sets: z.array(z.object({ files: z.array(FileRef).min(1), geometry: z.unknown() })).min(1),
    }),
  ),
});

/** Set başına tahmini maliyet (PLAN_V2 3i): 3–4 çalıştırma × (~6k giriş + ~3k çıkış) + denetim ≈ $0,35–0,50. */
export const EST_USD_PER_SET = 0.45;

function printReport(res: ConsistencyResult): void {
  console.log(`Kişi: ${res.people.length} (atlanan: ${res.skipped.length}) · yayılım ≤ ${CONSISTENCY_GATE.maxSpread} olan pay: ${(res.share * 100).toFixed(0)}% · en kötü: ${res.worst ?? "-"} (${res.maxSpread})`);
  console.log(res.pass ? "KAPI: GEÇTİ" : "KAPI: GEÇMEDİ");
}

async function main(args: string[]): Promise<void> {
  const evaluate = argValue(args, "--evaluate");
  if (evaluate) {
    printReport(evaluateConsistency(parseRowsCsv(readFileSync(evaluate, "utf8"))));
    return;
  }
  const manifestPath = args.find((a) => !a.startsWith("--") && a !== argValue(args, "--csv"));
  if (!manifestPath) {
    console.log("Kullanım: consistency-gate.ts <manifest.json> [--csv out.csv] [--confirm-paid] | --evaluate rows.csv");
    return;
  }
  const manifest = ConsistencyManifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  const sets = manifest.people.reduce((n, p) => n + p.sets.length, 0);
  console.log(`Plan: ${manifest.people.length} kişi, ${sets} set, set başına 3–4 çalıştırma + denetim; tahmini ≈ $${(sets * EST_USD_PER_SET).toFixed(2)}`);
  if (!args.includes("--confirm-paid")) {
    console.log("--confirm-paid verilmedi: hiçbir istek atılmadı.");
    return;
  }
  const { scoreV2 } = await import("../lib/score/engine/scoreV2");
  const { GeometrySchema } = await import("../lib/api/analysesInput");
  const rows: ConsistencyRow[] = [];
  for (const person of manifest.people) {
    for (const [i, set] of person.sets.entries()) {
      const geometry = GeometrySchema.parse(set.geometry);
      const images = set.files.map((f) => ({ view: f.view, data: readFileSync(path.join(manifest.dir, f.file)).toString("base64") }));
      try {
        const s = await scoreV2({ images, geometry, context: { ...person.context, faceShapeOverride: null } });
        rows.push({ person: person.id, set: i + 1, overall: s.overall, subscores: s.subscores });
        console.log(`${person.id} set ${i + 1}: tamam ($${s.aiUsage.estUsd.toFixed(3)})`);
      } catch (e) {
        console.warn(`${person.id} set ${i + 1}: hata ${e instanceof Error ? e.name : "?"}`);
      }
    }
  }
  const csv = argValue(args, "--csv");
  if (csv) writeFileSync(csv, consistencyCsv(rows));
  printReport(evaluateConsistency(rows));
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "hata");
    process.exit(1);
  });
}
