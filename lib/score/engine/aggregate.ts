import "server-only";

import { GRADED_ITEMS, ORDER, readField, type FieldPath, type Observation } from "@/lib/ai/observationSchema";
import { ITEM_FIELDS, REF_CATEGORY, type ItemKey } from "@/lib/config/engine.server";

// engine spec §2.6: örneklerin oylanması. Saf. Anlaşmazlık yalnız referansa doğru çeker (yukarı yanlılık yok);
// fotoğraf kapılarında daha kötü koşul seçilir (skorları referansa çeker). Erken durma değişmezi testle korunur.

export type Voted = { final: Observation; agreement: number };

/** Alan yolu → öğe anahtarı (referans kategori için). */
const ITEM_BY_PATH = Object.fromEntries(
  (Object.keys(ITEM_FIELDS) as ItemKey[]).map((k) => [`${ITEM_FIELDS[k].group}.${ITEM_FIELDS[k].field}`, k]),
) as Record<string, ItemKey>;

function countOf<T>(vals: T[], v: T): number {
  return vals.filter((x) => x === v).length;
}

/** Mod; eşitlikte precedence sırası (önce gelen kazanır). */
function mode<T extends string>(vals: T[], precedence: readonly T[]): T {
  let best: T = vals[0];
  let bestN = -1;
  const order = [...precedence, ...vals.filter((v) => !precedence.includes(v))];
  for (const v of order) {
    const n = countOf(vals, v);
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

/** Sıra (kötüden iyiye) üzerinde medyan; ortadaki iki oy ayrışırsa tie(lo, hi) karar verir. */
function medianRank(ranks: number[], tie: (lo: number, hi: number) => number): number {
  const s = [...ranks].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2) return s[m];
  const lo = s[m - 1];
  const hi = s[m];
  return lo === hi ? lo : tie(lo, hi);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Derecelendirilen alan: unclear ≥ yarı → unclear; değilse medyan, ayrışmada referansa doğru. */
function voteGraded(path: FieldPath, values: string[], refOverride?: string): string {
  const order = ORDER[path as keyof typeof ORDER] as readonly string[];
  const unclear = values.filter((v) => !order.includes(v));
  if (unclear.length * 2 >= values.length) return "unclear";
  const ranks = values.filter((v) => order.includes(v)).map((v) => order.indexOf(v));
  const ref = order.indexOf(refOverride ?? REF_CATEGORY[ITEM_BY_PATH[path]]);
  return order[medianRank(ranks, (lo, hi) => clamp(ref, lo, hi))];
}

/** Fotoğraf kapısı: medyan; ayrışmada daha kötü koşul (düşük sıra). */
function votePhoto<P extends "photo.lighting" | "photo.skinVisibility" | "photo.retouch">(path: P, values: string[]): string {
  const order = ORDER[path] as readonly string[];
  return order[medianRank(values.map((v) => order.indexOf(v)), (lo) => lo)];
}

const HAIR_VIS_PRECEDENCE = ["not_visible", "very_short", "no_visible_hair", "partly_visible", "visible"] as const;
const FACIAL_HAIR_PRECEDENCE = ["full_beard", "short_beard", "stubble", "none_visible", "unclear"] as const;

/**
 * Saç görünürlüğü: mod; eşitlikte not_visible > very_short > no_visible_hair > partly_visible > visible.
 * Hariç tutma (no_visible_hair) açık bir mod ister: eşitlikte seçilmez, sıradaki değerlendirilen değer kazanır (§2.6, §4.5).
 */
function voteHairVisibility(values: Observation["hair"]["visibility"][]): Observation["hair"]["visibility"] {
  const max = Math.max(...HAIR_VIS_PRECEDENCE.map((v) => countOf(values, v)));
  const tied = HAIR_VIS_PRECEDENCE.filter((v) => countOf(values, v) === max);
  if (tied.length === 1) return tied[0];
  return tied.find((v) => v !== "no_visible_hair") ?? tied[0];
}

function voteZone<T extends string>(values: T[], none: T): T {
  const max = Math.max(...values.map((v) => countOf(values, v)));
  const tied = [...new Set(values.filter((v) => countOf(values, v) === max))];
  return tied.length === 1 ? tied[0] : none;
}

/**
 * Sakal hattı normalleştirmesi (§2.6): sakal yok veya belirsizse not_applicable; sakal varken not_applicable
 * denmişse unclear (ceza yok). aggregate'in son adımıdır ve erken durma değişmezinde kullanılır.
 */
export function normalizeObservation(o: Observation): Observation {
  const fh = o.grooming.facialHair;
  let edges = o.grooming.facialHairEdges;
  if (fh === "none_visible" || fh === "unclear") edges = "not_applicable";
  else if (edges === "not_applicable") edges = "unclear";
  return edges === o.grooming.facialHairEdges ? o : { ...o, grooming: { ...o.grooming, facialHairEdges: edges } };
}

/** Şemadaki her alanda derin eşitlik (erken durma). */
export function samplesIdentical(a: Observation, b: Observation): boolean {
  for (const g of Object.keys(a) as (keyof Observation)[]) {
    const ga = a[g] as Record<string, unknown>;
    const gb = b[g] as Record<string, unknown>;
    for (const k of Object.keys(ga)) if (ga[k] !== gb[k]) return false;
  }
  return true;
}

export function aggregateObservations(samples: Observation[]): Voted {
  if (samples.length === 0) throw new Error("no_samples");
  const pick = <P extends FieldPath>(p: P) => samples.map((s) => readField(s, p) as string);
  const graded = (p: FieldPath) => voteGraded(p, pick(p));

  const badFace = samples.filter((s) => s.photo.faceCount !== "one").map((s) => s.photo.faceCount);
  const faceCount: Observation["photo"]["faceCount"] = badFace.length * 2 >= samples.length ? mode(badFace, ["multiple", "none"]) : "one";

  const facialHair = mode(
    samples.map((s) => s.grooming.facialHair),
    FACIAL_HAIR_PRECEDENCE,
  );
  let facialHairEdges: Observation["grooming"]["facialHairEdges"];
  if (facialHair === "none_visible" || facialHair === "unclear") facialHairEdges = "not_applicable";
  else {
    const edges = samples.map((s) => s.grooming.facialHairEdges);
    const skip = edges.filter((e) => e === "not_applicable" || e === "unclear").length;
    facialHairEdges =
      skip * 2 >= edges.length
        ? "unclear"
        : (voteGraded("grooming.facialHairEdges", edges.filter((e) => e !== "not_applicable" && e !== "unclear"), REF_CATEGORY.facialHairEdges) as Observation["grooming"]["facialHairEdges"]);
  }

  const concernVotes = samples.filter((s) => s.skin.visibleSkinConcern).length;
  const visibleSkinConcern = concernVotes * 2 > samples.length;
  // Bölge, sonuçla aynı yanıtı veren örneklerin modu (true ise: true diyenler).
  const concernZone = voteZone(
    samples.filter((s) => s.skin.visibleSkinConcern === visibleSkinConcern).map((s) => s.skin.concernZone),
    "none",
  );

  const final: Observation = {
    photo: {
      faceCount,
      lighting: votePhoto("photo.lighting", pick("photo.lighting")) as Observation["photo"]["lighting"],
      skinVisibility: votePhoto("photo.skinVisibility", pick("photo.skinVisibility")) as Observation["photo"]["skinVisibility"],
      retouch: votePhoto("photo.retouch", pick("photo.retouch")) as Observation["photo"]["retouch"],
    },
    skin: {
      blemishes: graded("skin.blemishes") as Observation["skin"]["blemishes"],
      blemishZone: voteZone(
        samples.map((s) => s.skin.blemishZone),
        "none",
      ),
      texture: graded("skin.texture") as Observation["skin"]["texture"],
      evenness: graded("skin.evenness") as Observation["skin"]["evenness"],
      shine: graded("skin.shine") as Observation["skin"]["shine"],
      shineZone: voteZone(
        samples.map((s) => s.skin.shineZone),
        "none",
      ),
      visibleSkinConcern,
      concernZone,
    },
    hair: {
      visibility: voteHairVisibility(samples.map((s) => s.hair.visibility)),
      neatness: graded("hair.neatness") as Observation["hair"]["neatness"],
      shape: graded("hair.shape") as Observation["hair"]["shape"],
    },
    grooming: {
      brows: graded("grooming.brows") as Observation["grooming"]["brows"],
      lips: graded("grooming.lips") as Observation["grooming"]["lips"],
      facialHair,
      facialHairEdges,
    },
  };

  const agree = GRADED_ITEMS.filter((p) => new Set(pick(p)).size === 1).length;
  return { final, agreement: Math.round((agree / GRADED_ITEMS.length) * 1000) / 1000 };
}
