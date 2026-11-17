/**
 * SPEC 10.7 / Faz 10 madde 6: rızalı yerel fotoğraflarda sağlayıcı/model karşılaştırması → yerel HTML galeri.
 * Ücretli AI çağrısı yapar; CLAUDE.md gereği yalnız onayla çalıştırılır. Görseller yerelde kalır; hiçbir yere yüklenmez.
 * Burada yalnız modelin ham çıktısı karşılaştırılır; yüz koruma kompoziti istemcide (worker) uygulanır.
 *
 * Kullanım: GEMINI_API_KEY=… [FAL_KEY=…] pnpm exec tsx scripts/compare-tryon.ts <giriş-klasörü> <çıkış-klasörü> [--presets buzz_cut,stubble_light] [--providers gemini,fal]
 * Giriş: 1024 px kare JPEG'ler (lib/face/crop.ts çıktısı). fal yolu için aynı adda .mask.png (saç maskesi) beklenir; yoksa fal atlanır.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPreset } from "../content/presets";
import { buildTryonPrompt } from "../lib/ai/prompts/tryon.v1";
import { FalTryonProvider, GeminiTryonProvider, type TryonProvider } from "../lib/ai/tryonProvider";

const args = process.argv.slice(2);
const [inDir, outDir] = args.filter((a) => !a.startsWith("--"));
const opt = (name: string, def: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
if (!inDir || !outDir) {
  console.error("Kullanım: compare-tryon.ts <giriş> <çıkış> [--presets a,b] [--providers gemini,fal]");
  process.exit(1);
}
const presetIds = opt("presets", "buzz_cut,textured_crop,stubble_light,short_boxed,ash_blonde").split(",");
const providerNames = opt("providers", "gemini").split(",");
const providers: Record<string, TryonProvider> = { gemini: new GeminiTryonProvider(), fal: new FalTryonProvider() };

mkdirSync(outDir, { recursive: true });
const files = readdirSync(inDir).filter((f) => /\.jpe?g$/i.test(f) && !f.includes(".mask."));
const rows: string[] = [];
const times: Record<string, number[]> = {};

for (const f of files) {
  const imageBase64 = readFileSync(path.join(inDir, f)).toString("base64");
  const maskPath = path.join(inDir, f.replace(/\.jpe?g$/i, ".mask.png"));
  const maskBase64 = existsSync(maskPath) ? readFileSync(maskPath).toString("base64") : undefined;
  const cells: string[] = [`<td><img src="${path.relative(outDir, path.join(inDir, f))}" width="200"></td>`];
  for (const pid of presetIds) {
    const preset = getPreset(pid);
    if (!preset) continue;
    for (const pn of providerNames) {
      const provider = providers[pn];
      if (!provider || (pn === "fal" && !maskBase64)) {
        cells.push("<td>—</td>");
        continue;
      }
      const t0 = Date.now();
      try {
        const out = await provider.generateTryOn({ imageBase64, maskBase64, prompt: buildTryonPrompt(preset), preset });
        const ms = Date.now() - t0;
        (times[pn] ??= []).push(ms);
        const ext = out.mimeType.includes("jpeg") ? "jpg" : "png";
        const name = `${path.parse(f).name}__${pid}__${pn}.${ext}`;
        writeFileSync(path.join(outDir, name), Buffer.from(out.imageBase64, "base64"));
        cells.push(`<td><img src="${name}" width="200"><br><small>${pn} · ${pid} · ${ms} ms</small></td>`);
        console.log(`${f} ${pid} ${pn}: ${ms} ms`);
      } catch (e) {
        cells.push(`<td>hata: ${e instanceof Error ? e.message : "?"}</td>`);
      }
    }
  }
  rows.push(`<tr>${cells.join("")}</tr>`);
}

const p95 = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length * 0.95)] : null);
const stats = Object.entries(times).map(([k, v]) => `<li>${k}: n=${v.length}, p95=${p95(v)} ms</li>`).join("");
writeFileSync(
  path.join(outDir, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Deneme karşılaştırma</title><style>td{vertical-align:top;padding:4px;font:12px sans-serif}</style>
<h1>Sanal deneme karşılaştırması (yalnız yerel)</h1><ul>${stats}</ul><table>${rows.join("")}</table>
<p>Yüz koruma kompoziti bu galeride uygulanmamıştır; istemcide (worker) uygulanır. Görselleri paylaşma.</p>`,
);
console.log(`Galeri: ${path.join(outDir, "index.html")}`);
