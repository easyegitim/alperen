/**
 * SPEC Faz 6 madde 7: yerel klasördeki rızalı fotoğrafları skorlar, ham dağılımı ve önerilen RAW_MEAN/SCALE'i yazdırır.
 * Ücretli AI çağrısı yapar; CLAUDE.md gereği yalnız onayla çalıştırılır. Görseller yerelde kalır; hiçbir şey yazılmaz.
 *
 * Kullanım: GEMINI_API_KEY=... pnpm calibrate <klasör> [--calls 3] [--limit 50]
 * Klasörde yalnız 768 px kare JPEG'ler olmalı (lib/face/crop.ts çıktısı). Dosya adları kişi kimliği taşımamalı.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { buildScorePrompt } from "../lib/ai/prompts/score.v1";
import { SCORE_OUTPUT_JSON_SCHEMA, ScoreOutput } from "../lib/ai/scoreSchema";
import { CALIBRATION_V0, SUB_WEIGHTS } from "../lib/config/scoring";
import { SUB_KEYS } from "../lib/config/teaser";
import { aggregateScores } from "../lib/score/aggregate";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const calls = Number(args[args.indexOf("--calls") + 1]) || 3;
const limit = Number(args[args.indexOf("--limit") + 1]) || 50;
if (!dir) {
  console.error("Kullanım: pnpm calibrate <klasör> [--calls 3] [--limit 50]");
  process.exit(1);
}
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY gerekli.");
  process.exit(1);
}
const model = process.env.GEMINI_SCORE_MODEL || "gemini-3.5-flash-lite";
const ai = new GoogleGenAI({ apiKey });

async function scoreOnce(b64: string, prompt: string) {
  const res = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: b64 }, text: undefined }, { text: prompt }] }],
    config: { temperature: 0, responseMimeType: "application/json", responseJsonSchema: SCORE_OUTPUT_JSON_SCHEMA },
  });
  return ScoreOutput.parse(JSON.parse(res.text ?? ""));
}

const files = readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).slice(0, limit);
const prompt = buildScorePrompt({ presentation: "unspecified", geometry: { note: "calibration run, no geometry" }, bodyFatContextAllowed: false });
const overalls: number[] = [];
const subs: Record<string, number[]> = Object.fromEntries(SUB_KEYS.map((k) => [k, []]));

for (const f of files) {
  const b64 = readFileSync(path.join(dir, f)).toString("base64");
  const settled = await Promise.allSettled(Array.from({ length: calls }, () => scoreOnce(b64, prompt)));
  try {
    const agg = aggregateScores(settled);
    overalls.push(agg.rawOverall);
    for (const k of SUB_KEYS) subs[k].push(agg.rawSubscores[k]);
    console.log(`${overalls.length}/${files.length} ham=${agg.rawOverall.toFixed(2)} (${agg.samples} örnek)`);
  } catch (e) {
    console.log(`${f}: atlandı (${e instanceof Error ? e.message : "hata"})`);
  }
}

function stats(v: number[]) {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, v.length - 1));
  return { mean, sd };
}

const o = stats(overalls);
console.log("\nHam genel skor: n=%d ortalama=%s sd=%s", overalls.length, o.mean.toFixed(3), o.sd.toFixed(3));
console.log("Önerilen v0: RAW_MEAN=%s SCALE=%s (hedef ortalama %s, sd 1.3)", o.mean.toFixed(2), (1.3 / Math.max(o.sd, 0.05)).toFixed(2), CALIBRATION_V0.target);
for (const k of SUB_KEYS) {
  const s = stats(subs[k]);
  console.log("  %s (ağırlık %s): ortalama=%s sd=%s", k, SUB_WEIGHTS[k], s.mean.toFixed(2), s.sd.toFixed(2));
}
