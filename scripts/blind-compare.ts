/**
 * Kıyas testi (PLAN_V2 §3, §5/3; KB §4.1): aynı 20 fotoğraf seti hem Aura motoruna (hybrid.v2: cetvel + ortanca +
 * denetim) hem düz Claude'a (tek çağrı, serbest metin) verilir; ekip metinleri isimleri görmeden oylar.
 * Aura en az %70 kazanmadan sürüm çıkmaz.
 *
 * ⚠️ ÜCRETLİ: `run` gerçek API'ye istek atar; yalnız kullanıcının açık onayıyla ve --confirm-paid ile. `tally` çevrimdışıdır.
 *
 * Gizlilik: fotoğraflar şifreli yerel diskte; yalnız çağrı süresince bellekte; görsel, istem ve dosya adı yazılmaz.
 * Oy pusulasında yalnız set takma adı ve iki anonim metin (A/B) vardır; eşleme ayrı key.json dosyasındadır.
 *
 * Kullanım:
 *   run:   pnpm tsx --conditions=react-server scripts/blind-compare.ts run <manifest.json> --out ./kiyas [--seed 7] [--confirm-paid]
 *   tally: pnpm tsx scripts/blind-compare.ts tally ./kiyas/key.json ./kiyas/votes.csv       (votes.csv: id,choice ∈ A|B)
 * manifest.json: { "dir": "...", "items": [ { "id": "s01", "files": [ { "view": "front", "file": "..." } ], "geometry": <GeometryResult>,
 *   "context": { "ageBand": "25_34", "presentation": "male", "headCoveringDeclared": false } } ] }
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { argValue, isMain } from "./engine-tooling";

export const BLIND_GATE = { minAuraShare: 0.7 } as const;

export type Pair = { id: string; A: string; B: string };
export type PairKey = { id: string; aura: "A" | "B" };

/** Deterministik yarı-rastgele (mulberry32); aynı tohum aynı sıralama. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Her set için Aura ve düz metni A/B'ye tohumla karıştırır; eşleme ayrı döner. */
export function shufflePairs(items: readonly { id: string; aura: string; plain: string }[], seed: number): { pairs: Pair[]; key: PairKey[] } {
  const rnd = seededRandom(seed);
  const pairs: Pair[] = [];
  const key: PairKey[] = [];
  for (const it of items) {
    const auraIsA = rnd() < 0.5;
    pairs.push({ id: it.id, A: auraIsA ? it.aura : it.plain, B: auraIsA ? it.plain : it.aura });
    key.push({ id: it.id, aura: auraIsA ? "A" : "B" });
  }
  return { pairs, key };
}

export type Vote = { id: string; choice: "A" | "B" };
export type Tally = { total: number; aura: number; plain: number; share: number; pass: boolean; unknown: string[] };

/** Çevrimdışı: oyları eşlemeyle sayar; eşlemesi olmayan id atlanır ve listelenir. */
export function tally(votes: readonly Vote[], key: readonly PairKey[], gate = BLIND_GATE): Tally {
  const map = new Map(key.map((k) => [k.id, k.aura]));
  let aura = 0;
  let plain = 0;
  const unknown: string[] = [];
  for (const v of votes) {
    const k = map.get(v.id);
    if (!k) {
      unknown.push(v.id);
      continue;
    }
    if (v.choice === k) aura++;
    else plain++;
  }
  const total = aura + plain;
  const share = total ? aura / total : 0;
  return { total, aura, plain, share: Math.round(share * 1000) / 1000, pass: total > 0 && share >= gate.minAuraShare, unknown };
}

export function parseVotesCsv(text: string): Vote[] {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split(",").map((c) => c.trim()))
    .filter((c) => c.length >= 2 && (c[1] === "A" || c[1] === "B"))
    .map((c) => ({ id: c[0], choice: c[1] as "A" | "B" }));
}

/** Oy pusulası: yalnız takma ad ve iki anonim metin. */
export function ballotMarkdown(pairs: readonly Pair[]): string {
  const out: string[] = ["# Kör kıyas pusulası", "", "Her set için daha iyi bulduğun metni (A ya da B) votes.csv'ye yaz: `id,choice`.", ""];
  for (const p of pairs) out.push(`## ${p.id}`, "", "### A", "", p.A, "", "### B", "", p.B, "");
  return out.join("\n");
}

const FileRef = z.object({ view: z.enum(["front", "profile_left", "profile_right", "left45", "right45", "hairline"]), file: z.string() });
export const CompareManifest = z.object({
  dir: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      files: z.array(FileRef).min(1),
      geometry: z.unknown(),
      context: z.object({ ageBand: z.enum(["under_18", "18_24", "25_34", "35_49", "50_plus"]).nullable(), presentation: z.enum(["male", "female", "unspecified"]), headCoveringDeclared: z.boolean() }),
    }),
  ),
});

const PLAIN_PROMPT = "Bu fotoğraflara bakıp bir görünüm ve bakım danışmanı gibi Türkçe, kısa bir değerlendirme yaz: güçlü yanlar, bakımla değişebilecek alanlar ve öneriler.";

/** Düz Claude: aynı görseller, cetvel/denetim/kalibrasyon yok; ilk text bloğu. */
async function plainClaude(images: { view: string; data: string }[]): Promise<string> {
  const { getAnthropic, readJsonText } = await import("../lib/ai/anthropic");
  const { getAiEnv } = await import("../lib/config/ai.server");
  const env = getAiEnv();
  const res = await getAnthropic().beta.messages.create({
    model: env.claudeScoreModel,
    max_tokens: 4000,
    messages: [{ role: "user", content: [...images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: i.data } })), { type: "text", text: PLAIN_PROMPT }] }],
    output_config: { effort: env.claudeScoreEffort },
  });
  if (res.stop_reason === "refusal") return "(düz Claude bu seti değerlendirmeyi reddetti)";
  return readJsonText(res).text ?? "";
}

function auraText(report: { letter: string; regions: { key: string; strength: string; seen: string; improvements: string[] }[]; closing: string }): string {
  return [report.letter, ...report.regions.map((r) => `${r.key}: ${r.strength} ${r.seen} ${r.improvements.join(" ")}`.trim()), report.closing].join("\n\n");
}

async function main(args: string[]): Promise<void> {
  const mode = args[0];
  if (mode === "tally") {
    const key = z.array(z.object({ id: z.string(), aura: z.enum(["A", "B"]) })).parse(JSON.parse(readFileSync(args[1], "utf8")));
    const t = tally(parseVotesCsv(readFileSync(args[2], "utf8")), key);
    console.log(`Oy: ${t.total} · Aura ${t.aura} · düz ${t.plain} · Aura payı %${(t.share * 100).toFixed(0)}${t.unknown.length ? ` · eşleşmeyen: ${t.unknown.join(",")}` : ""}`);
    console.log(t.pass ? "KAPI: GEÇTİ (≥ %70)" : "KAPI: GEÇMEDİ (< %70)");
    return;
  }
  if (mode !== "run" || !args[1]) {
    console.log("Kullanım: blind-compare.ts run <manifest.json> --out <klasör> [--seed 7] [--confirm-paid] | tally <key.json> <votes.csv>");
    return;
  }
  const manifest = CompareManifest.parse(JSON.parse(readFileSync(args[1], "utf8")));
  const out = argValue(args, "--out") ?? "./kiyas";
  const seed = Number(argValue(args, "--seed") ?? "7");
  console.log(`Plan: ${manifest.items.length} set × (Aura 3–4 çalıştırma + denetim ≈ $0,45 + düz Claude ≈ $0,10); tahmini ≈ $${(manifest.items.length * 0.55).toFixed(2)}`);
  if (!args.includes("--confirm-paid")) {
    console.log("--confirm-paid verilmedi: hiçbir istek atılmadı.");
    return;
  }
  const { scoreV2 } = await import("../lib/score/engine/scoreV2");
  const { GeometrySchema } = await import("../lib/api/analysesInput");
  const items: { id: string; aura: string; plain: string }[] = [];
  for (const it of manifest.items) {
    const geometry = GeometrySchema.parse(it.geometry);
    const images = it.files.map((f) => ({ view: f.view, data: readFileSync(path.join(manifest.dir, f.file)).toString("base64") }));
    try {
      const [s, plain] = await Promise.all([scoreV2({ images, geometry, context: { ...it.context, faceShapeOverride: null } }), plainClaude(images)]);
      items.push({ id: it.id, aura: auraText(s.report), plain });
      console.log(`${it.id}: tamam`);
    } catch (e) {
      console.warn(`${it.id}: hata ${e instanceof Error ? e.name : "?"}`);
    }
  }
  const { pairs, key } = shufflePairs(items, seed);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "ballot.md"), ballotMarkdown(pairs));
  writeFileSync(path.join(out, "key.json"), JSON.stringify(key, null, 2));
  writeFileSync(path.join(out, "votes.csv"), "id,choice\n");
  console.log(`Yazıldı: ${out}/ballot.md (oylama), key.json (eşleme; oylayanlara verilmez), votes.csv (boş)`);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "hata");
    process.exit(1);
  });
}
