import { describe, expect, it } from "vitest";
import { ObservationOutput, type Observation } from "@/lib/ai/observationSchema";
import { aggregateObservations, normalizeObservation, samplesIdentical } from "@/lib/score/engine/aggregate";
import { REF_OBS, obs } from "../helpers/engineFixtures";

const vote = (...s: Observation[]) => aggregateObservations(s).final;

describe("oylama (engine spec §2.6)", () => {
  it("3 oyun medyanı", () => {
    const f = vote(obs({ skin: { blemishes: "none" } }), obs({ skin: { blemishes: "several" } }), obs({ skin: { blemishes: "many" } }));
    expect(f.skin.blemishes).toBe("several");
  });

  it("2 oy ayrışınca referansa doğru (none vs several → few); referans arada değilse yakın olan", () => {
    expect(vote(obs({ skin: { blemishes: "none" } }), obs({ skin: { blemishes: "several" } })).skin.blemishes).toBe("few");
    expect(vote(obs({ skin: { blemishes: "several" } }), obs({ skin: { blemishes: "many" } })).skin.blemishes).toBe("several");
    expect(vote(obs({ hair: { neatness: "neat" } }), obs({ hair: { neatness: "slightly_untidy" } })).hair.neatness).toBe("slightly_untidy");
    // 3 oydan biri belirsiz: kalan iki oy ayrışırsa yine referansa doğru.
    expect(vote(obs({ grooming: { lips: "smooth" } }), obs({ grooming: { lips: "dry_cracked" } }), obs({ grooming: { lips: "unclear" } })).grooming.lips).toBe(
      "slightly_dry",
    );
  });

  it("belirsiz çoğunluk → unclear", () => {
    expect(vote(obs({ skin: { texture: "unclear" } }), obs({ skin: { texture: "unclear" } }), obs({ skin: { texture: "smooth" } })).skin.texture).toBe("unclear");
    expect(vote(obs({ skin: { shine: "unclear" } }), obs({ skin: { shine: "very" } })).skin.shine).toBe("unclear");
  });

  it("sakal hattı normalleştirmesi: sakal yok → not_applicable; referans soft; na+unclear ≥ yarı → unclear", () => {
    const beard = (facialHairEdges: Observation["grooming"]["facialHairEdges"]) => obs({ grooming: { facialHair: "short_beard", facialHairEdges } });
    expect(vote(obs({ grooming: { facialHair: "none_visible", facialHairEdges: "untidy" } })).grooming.facialHairEdges).toBe("not_applicable");
    expect(vote(beard("defined"), beard("untidy")).grooming.facialHairEdges).toBe("soft");
    expect(vote(beard("not_applicable"), beard("unclear"), beard("defined")).grooming.facialHairEdges).toBe("unclear");
    expect(vote(beard("not_applicable"), beard("defined"), beard("defined")).grooming.facialHairEdges).toBe("defined");
  });

  it("fotoğraf kapısında 2 oy ayrışınca daha kötü koşul", () => {
    const f = vote(
      obs({ photo: { lighting: "even", skinVisibility: "clear", retouch: "none" } }),
      obs({ photo: { lighting: "harsh_or_dim", skinVisibility: "obscured", retouch: "possible" } }),
    );
    expect(f.photo).toMatchObject({ lighting: "harsh_or_dim", skinVisibility: "obscured", retouch: "possible" });
  });

  it("nominal öncelikler: saç görünürlüğü ve sakal", () => {
    const vis = (...v: Observation["hair"]["visibility"][]) => vote(...v.map((visibility) => obs({ hair: { visibility } }))).hair.visibility;
    expect(vis("visible", "not_visible")).toBe("not_visible");
    expect(vis("very_short", "no_visible_hair")).toBe("very_short");
    expect(vis("visible", "partly_visible")).toBe("partly_visible");
    expect(vis("no_visible_hair", "no_visible_hair", "visible")).toBe("no_visible_hair");
    // Hariç tutma açık bir mod ister: eşitlikte değerlendirilen değer kazanır.
    expect(vis("no_visible_hair", "visible")).toBe("visible");
    const fh = (...v: Observation["grooming"]["facialHair"][]) => vote(...v.map((facialHair) => obs({ grooming: { facialHair } }))).grooming.facialHair;
    expect(fh("stubble", "short_beard", "full_beard")).toBe("full_beard");
    expect(fh("none_visible", "stubble")).toBe("stubble");
    expect(fh("unclear", "none_visible")).toBe("none_visible");
  });

  it("bölge eşitliği → none; cilt endişesi kesin çoğunluk, bölgesi true diyenlerin modu", () => {
    expect(vote(obs({ skin: { blemishZone: "cheeks" } }), obs({ skin: { blemishZone: "forehead" } })).skin.blemishZone).toBe("none");
    const yes = (concernZone: Observation["skin"]["concernZone"]) => obs({ skin: { visibleSkinConcern: true, concernZone } });
    const no = obs({ skin: { visibleSkinConcern: false, concernZone: "none" } });
    expect(vote(yes("cheeks"), yes("forehead"), yes("cheeks")).skin).toMatchObject({ visibleSkinConcern: true, concernZone: "cheeks" });
    expect(vote(yes("cheeks"), no).skin.visibleSkinConcern).toBe(false);
    expect(vote(yes("cheeks"), yes("cheeks"), no).skin).toMatchObject({ visibleSkinConcern: true, concernZone: "cheeks" });
  });

  it("faceCount çoğunluğu ve agreement", () => {
    expect(vote(obs({ photo: { faceCount: "none" } }), REF_OBS, REF_OBS).photo.faceCount).toBe("one");
    expect(vote(obs({ photo: { faceCount: "none" } }), obs({ photo: { faceCount: "multiple" } }), REF_OBS).photo.faceCount).toBe("multiple");
    expect(aggregateObservations([REF_OBS, REF_OBS]).agreement).toBe(1);
    expect(aggregateObservations([REF_OBS, obs({ skin: { texture: "smooth" } })]).agreement).toBeCloseTo(7 / 8, 3);
  });

  it("samplesIdentical derin eşitlik", () => {
    expect(samplesIdentical(REF_OBS, obs())).toBe(true);
    expect(samplesIdentical(REF_OBS, obs({ skin: { visibleSkinConcern: true } }))).toBe(false);
  });
});

/** Tohumlu sözde rastgele (Mulberry32): test tekrarlanabilir. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomObservation(r: () => number): Observation {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const shape = ObservationOutput.shape;
  const group = <G extends keyof Observation>(g: G): Observation[G] => {
    const out: Record<string, unknown> = {};
    for (const [k, schema] of Object.entries(shape[g].shape)) {
      out[k] = "options" in schema ? pick(schema.options as readonly string[]) : r() < 0.5;
    }
    return ObservationOutput.shape[g].parse(out) as Observation[G];
  };
  return { photo: group("photo"), skin: group("skin"), hair: group("hair"), grooming: group("grooming") };
}

describe("erken durma değişmezi (özellik testi)", () => {
  it("aggregate([a,a,x]).final ≡ aggregate([a,a]).final ≡ normalize(a), 500 rastgele x", () => {
    const r = rng(20261030);
    for (let i = 0; i < 500; i++) {
      const a = randomObservation(r);
      const x = randomObservation(r);
      const two = aggregateObservations([a, a]).final;
      expect(two).toEqual(normalizeObservation(a));
      expect(aggregateObservations([a, a, x]).final).toEqual(two);
      expect(aggregateObservations([x, a, a]).final).toEqual(two);
    }
  });
});
