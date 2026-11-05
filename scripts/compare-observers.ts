/**
 * Claude ve Gemini gözlemcilerini aynı rızalı fotoğraflarda karşılaştırır (engine spec §1.1, §5.3, §10, §12).
 *
 * ⚠️ ÜCRETLİ: Anthropic ve Google API'lerine istek atar. CLAUDE.md gereği yalnız kullanıcının açık onayıyla ve
 * --confirm-paid bayrağıyla çalışır; bayrak yoksa yalnız plan ve çağrı sayısı yazdırılır, hiçbir istek atılmaz.
 *
 * Gizlilik: fotoğraflar yalnız şifreli yerel diskte durur ve yalnız çağrı süresince bellekte tutulur; bu betik hiçbir
 * görseli, istemi, model çıktısını veya dosya adını yazmaz/loglamaz. CSV yalnız sıra numarası, enumlar ve sayılar taşır.
 *
 * Ölçümler: alan başına κ (sağlayıcı–sağlayıcı, sağlayıcı–insan etiketi), aynı foto değişim oranı, aynı foto skor
 * tutarlılığı ve 5 foto SS (SPEC 8.6), maliyet ve gecikme; saklanan oylarla herhangi bir MOD_GAIN'de çevrimdışı skor.
 *
 * Kullanım: pnpm compare:observers <manifest.json> [--providers claude,gemini] [--repeats 3] [--mod-gain 1,1.5,2]
 *           [--csv out.csv] [--md out.md] [--confirm-paid]
 * manifest.json: { "dir": "/sifreli/klasor", "items": [ { "file": "0001.jpg", "person": "p01",
 *   "geometry": <GeometryResult, yalnız sayılar>, "context": { "headCovering": false, "presentation": "female",
 *   "beardPreference": "none" }, "labels": [<Observation insan A>, <Observation insan B>] } ] }
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ObservationOutput, type Observation } from "../lib/ai/observationSchema";
import { estUsd, getAiEnv, type TokenUsage } from "../lib/config/ai.server";
import type { GeometryResult } from "../lib/face/types";
import { ClaudeObservationProvider, GeminiObservationProvider, SampleError, type ObservationProvider } from "../lib/ai/observeProvider";
import {
  argValue,
  assertNumbersOnly,
  fieldKappas,
  fivePhotoShare,
  flattenObservation,
  flipRates,
  isMain,
  loadEngine,
  mean,
  positional,
  quantile,
  rescoreAtModGain,
  samePhotoShare,
  toCsv,
  type EngineModule,
} from "./engine-tooling";

const HELP = `compare-observers (ÜCRETLİ, yalnız onayla): Claude ve Gemini gözlemcilerini rızalı fotoğraflarda karşılaştırır.
Kullanım: pnpm compare:observers <manifest.json> [--providers claude,gemini] [--repeats 3] [--mod-gain 1,1.5,2]
          [--csv out.csv] [--md out.md] [--confirm-paid]
--confirm-paid olmadan hiçbir istek atılmaz; yalnız plan yazdırılır. Görsel, istem ve model çıktısı yazılmaz.`;

const ContextSchema = z.object({
  headCovering: z.boolean(),
  presentation: z.enum(["male", "female", "unspecified"]),
  beardPreference: z.enum(["none", "stubble", "short", "medium", "long", "any"]),
});

export const ManifestSchema = z.object({
  dir: z.string(),
  items: z.array(
    z.object({
      file: z.string(),
      person: z.string().optional(),
      // GeometryResult: yalnız sayısal ölçüler (assertNumbersOnly ayrıca landmark/görsel alanını reddeder).
      geometry: z.custom<GeometryResult>((g) => typeof g === "object" && g !== null && "metrics" in g && "quality" in g).optional(),
      context: ContextSchema.optional(),
      labels: z.array(ObservationOutput).max(2).optional(),
    }),
  ),
});
type Manifest = z.infer<typeof ManifestSchema>;

export type SampleRow = {
  photo: number;
  provider: "claude" | "gemini";
  sample: number;
  ok: boolean;
  reason: string | null;
  latencyMs: number;
  model: string;
  usage: TokenUsage;
  obs: Observation | null;
};

const FIELD_KEYS = Object.keys(
  flattenObservation({
    photo: { faceCount: "one", lighting: "even", skinVisibility: "clear", retouch: "none" },
    skin: { blemishes: "few", blemishZone: "none", texture: "smooth", evenness: "even", shine: "some", shineZone: "none", visibleSkinConcern: false, concernZone: "none" },
    hair: { visibility: "visible", neatness: "neat", shape: "defined" },
    grooming: { brows: "tidy", lips: "smooth", facialHair: "none_visible", facialHairEdges: "not_applicable" },
  }),
);

/** CSV: örnek başına bir satır; dosya adı yok, yalnız sıra numarası, enumlar ve sayılar. Saf. */
export function samplesCsv(rows: SampleRow[]): string {
  const header = ["photo", "provider", "sample", "ok", "reason", "latency_ms", "model", "input", "output", "cache_read", "cache_write", "est_usd", ...FIELD_KEYS];
  return toCsv(
    header,
    rows.map((r) => {
      const flat = r.obs ? flattenObservation(r.obs) : {};
      return [
        r.photo,
        r.provider,
        r.sample,
        r.ok,
        r.reason,
        r.latencyMs,
        r.model,
        r.usage.input,
        r.usage.output,
        r.usage.cacheRead,
        r.usage.cacheWrite5m + r.usage.cacheWrite1h,
        estUsd(r.usage, r.model),
        ...FIELD_KEYS.map((k) => flat[k] ?? ""),
      ];
    }),
  );
}

export type ProviderSummary = {
  provider: string;
  okRate: number;
  latencyP50: number;
  latencyP95: number;
  usdPerPhoto: number;
  flip: Record<string, number>;
  kappaVsHuman: Record<string, number>[];
  samePhoto: number;
  fivePhoto: Record<string, number>;
};

/**
 * Sağlayıcı özetleri ve sağlayıcılar arası κ. engine verilirse oylama ve skorlar motorla yapılır (çevrimdışı, ücretsiz).
 * Saf (motor fonksiyonları da saftır).
 */
export function summarize(manifest: Manifest, rows: SampleRow[], engine: Pick<EngineModule, "aggregateObservations" | "scoreFromVotes" | "config"> | null, modGains: number[]) {
  const providers = [...new Set(rows.map((r) => r.provider))];
  const finals = new Map<string, Map<number, Observation>>();
  const summaries: ProviderSummary[] = providers.map((p) => {
    const mine = rows.filter((r) => r.provider === p);
    const perPhoto = manifest.items.map((_, i) => mine.flatMap((r) => (r.photo === i && r.obs ? [r.obs] : [])));
    const fin = new Map<number, Observation>();
    perPhoto.forEach((s, i) => {
      if (s.length && engine) fin.set(i, engine.aggregateObservations(s).final);
    });
    finals.set(p, fin);
    const photos = manifest.items.length || 1;
    const usd = mine.reduce((s, r) => s + estUsd(r.usage, r.model), 0) / photos;
    const lat = mine.filter((r) => r.ok).map((r) => r.latencyMs);
    const kappaVsHuman = [0, 1].map((a) => {
      const pairs = manifest.items.flatMap((it, i) => {
        const label = it.labels?.[a];
        const f = fin.get(i);
        return label && f ? [{ f, label }] : [];
      });
      return fieldKappas(
        pairs.map((x) => x.f),
        pairs.map((x) => x.label),
      );
    });
    // Aynı foto skor tutarlılığı: her örnek tek başına puanlanır (geometri ve bağlam varsa).
    const sampleOveralls = engine
      ? manifest.items.map((it, i) => {
          const { geometry, context } = it;
          return geometry && context ? perPhoto[i].map((o) => engine.scoreFromVotes(geometry, context, o).overall) : [];
        })
      : [];
    // 5 foto SS: kişi başına final oylardan genel skor, her MOD_GAIN için.
    const fivePhoto: Record<string, number> = {};
    if (engine) {
      for (const g of modGains) {
        const byPerson = new Map<string, number[]>();
        manifest.items.forEach((it, i) => {
          const f = fin.get(i);
          if (!f || !it.person || !it.geometry || !it.context) return;
          const s = engine.scoreFromVotes(it.geometry, it.context, f);
          byPerson.set(it.person, [...(byPerson.get(it.person) ?? []), rescoreAtModGain(s.rawRounded, s.weights, g, engine.config.MOD_GAIN)]);
        });
        fivePhoto[String(g)] = fivePhotoShare([...byPerson.values()]);
      }
    }
    return {
      provider: p,
      okRate: mine.length ? mine.filter((r) => r.ok).length / mine.length : NaN,
      latencyP50: quantile(lat, 0.5),
      latencyP95: quantile(lat, 0.95),
      usdPerPhoto: usd,
      flip: flipRates(perPhoto),
      kappaVsHuman,
      samePhoto: samePhotoShare(sampleOveralls),
      fivePhoto,
    };
  });
  let crossKappa: Record<string, number> = {};
  const [a, b] = providers.map((p) => finals.get(p) ?? new Map<number, Observation>());
  if (a && b) {
    const pairs = [...a.entries()].flatMap(([i, fa]) => {
      const fb = b.get(i);
      return fb ? [{ fa, fb }] : [];
    });
    crossKappa = fieldKappas(
      pairs.map((x) => x.fa),
      pairs.map((x) => x.fb),
    );
  }
  return { summaries, crossKappa };
}

const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "–");

export function renderMarkdown(s: ReturnType<typeof summarize>, n: number, repeats: number): string {
  const fields = Object.keys(s.summaries[0]?.flip ?? {});
  const lines = [
    `# Gözlemci karşılaştırması`,
    ``,
    `Fotoğraf: ${n} · Tekrar: ${repeats} · Tarih: ${new Date().toISOString().slice(0, 10)}. Görsel ve kişi kimliği yok.`,
    ``,
    `| Sağlayıcı | Başarı | Gecikme p50/p95 (ms) | $/foto (tahmin) | Aynı foto ≤ 0,2 | 5 foto SS ≤ 0,4 (MOD_GAIN → pay) |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...s.summaries.map(
      (p) =>
        `| ${p.provider} | ${f2(p.okRate)} | ${f2(p.latencyP50)} / ${f2(p.latencyP95)} | ${p.usdPerPhoto.toFixed(4)} | ${f2(p.samePhoto)} | ${Object.entries(p.fivePhoto).map(([g, v]) => `${g}: ${f2(v)}`).join(" · ") || "–"} |`,
    ),
    ``,
    `| Alan | ${s.summaries.map((p) => `${p.provider} değişim`).join(" | ")} | ${s.summaries.map((p) => `${p.provider} κ insan A/B`).join(" | ")} | κ sağlayıcılar arası |`,
    `| --- | ${s.summaries.map(() => "---").join(" | ")} | ${s.summaries.map(() => "---").join(" | ")} | --- |`,
    ...fields.map(
      (f) =>
        `| ${f} | ${s.summaries.map((p) => f2(p.flip[f])).join(" | ")} | ${s.summaries.map((p) => `${f2(p.kappaVsHuman[0]?.[f] ?? NaN)} / ${f2(p.kappaVsHuman[1]?.[f] ?? NaN)}`).join(" | ")} | ${f2(s.crossKappa[f] ?? NaN)} |`,
    ),
    ``,
    `Gemini maliyeti AI_PRICING'de olmadığı için en yüksek bilinen fiyatla (fazla) tahmin edilir; gerçek fatura sağlayıcı konsolundadır.`,
    ``,
  ];
  return lines.join("\n");
}

async function runProvider(p: ObservationProvider, b64: string, photo: number, repeats: number): Promise<SampleRow[]> {
  const out: SampleRow[] = [];
  for (let s = 0; s < repeats; s++) {
    const started = Date.now();
    const controller = new AbortController();
    try {
      const r = await p.observeOnce(b64, controller.signal, 30_000);
      out.push({ photo, provider: p.name, sample: s, ok: true, reason: null, latencyMs: Date.now() - started, model: r.model, usage: r.usage, obs: r.obs });
    } catch (e) {
      const se = e instanceof SampleError ? e : null;
      out.push({
        photo,
        provider: p.name,
        sample: s,
        ok: false,
        reason: se?.reason ?? "unknown",
        latencyMs: Date.now() - started,
        model: se?.model ?? p.model,
        usage: se?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
        obs: null,
      });
    }
  }
  return out;
}

async function main(args: string[]): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const manifestPath = positional(args, ["--providers", "--repeats", "--mod-gain", "--csv", "--md"]);
  if (!manifestPath) {
    console.error(HELP);
    return 1;
  }
  const providers = (argValue(args, "--providers") ?? "claude,gemini").split(",").filter((p): p is "claude" | "gemini" => p === "claude" || p === "gemini");
  const repeats = Math.min(5, Math.max(1, Number(argValue(args, "--repeats")) || 3));
  const modGains = (argValue(args, "--mod-gain") ?? "1,1.5,2").split(",").map(Number).filter((g) => g > 0 && g <= 3);

  const raw: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  assertNumbersOnly(raw);
  const manifest = ManifestSchema.parse(raw);

  // Motor olmadan oylama/skor yapılamaz: ücretli çağrıdan ÖNCE denetlenir.
  const engine = await loadEngine();
  if (!engine) {
    console.error("Motor (lib/score/engine, lib/config/engine.server.ts) bulunamadı veya sözleşmeye uymuyor; hiçbir istek atılmadı.");
    return 2;
  }
  const calls = manifest.items.length * providers.length * repeats;
  console.log(`Plan: ${manifest.items.length} foto × ${providers.length} sağlayıcı × ${repeats} tekrar = ${calls} ücretli çağrı.`);
  if (!args.includes("--confirm-paid")) {
    console.log("--confirm-paid verilmedi: hiçbir istek atılmadı (CLAUDE.md: ücretli betik yalnız onayla).");
    return 3;
  }

  const env = getAiEnv();
  const instances: ObservationProvider[] = providers.map((p) => (p === "claude" ? new ClaudeObservationProvider({ env }) : new GeminiObservationProvider({ env })));
  const rows: SampleRow[] = [];
  for (const [i, it] of manifest.items.entries()) {
    const b64 = readFileSync(path.join(manifest.dir, it.file)).toString("base64");
    for (const p of instances) rows.push(...(await runProvider(p, b64, i, repeats)));
    console.log(`${i + 1}/${manifest.items.length}`);
  }

  const summary = summarize(manifest, rows, engine, modGains);
  const md = renderMarkdown(summary, manifest.items.length, repeats);
  console.log(md);
  const csvPath = argValue(args, "--csv");
  if (csvPath) writeFileSync(csvPath, samplesCsv(rows));
  const mdPath = argValue(args, "--md");
  if (mdPath) writeFileSync(mdPath, md);
  console.log(`Ortalama başarı: ${mean(summary.summaries.map((s) => s.okRate)).toFixed(2)}`);
  return 0;
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
