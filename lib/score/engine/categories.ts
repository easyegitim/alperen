import "server-only";

import type { Observation } from "@/lib/ai/observationSchema";
import {
  CATEGORY_DELTAS,
  IMPUTE_DELTA,
  ITEM_FIELDS,
  MOD_GAIN,
  RETOUCH_FACTOR,
  SCORED_ITEMS,
  SKIN_VISIBILITY_FACTOR,
  STRUCT,
  WEIGHTS_H1,
  WEIGHTS_H1_HAIR_EXCLUDED,
  type ItemKey,
} from "@/lib/config/engine.server";
import type { SubKeyV1 } from "@/lib/config/teaser";
import { MOD_SUBS, type ModSub, type NotAssessed } from "@/lib/score/contract";
import type { HybridContext, ItemSignal } from "./types";

// engine spec §4: skin, hair, grooming kategori tablolarından. Saf. Sakal varlığı, saç uzunluğu/dokusu, kaş kalınlığı
// ve makyaj puanlanmaz; başörtüsü beyanı saçı kod kuralıyla hariç tutar (Claude'dan bağımsız).

export type ModifiableResult = {
  /** Yuvarlanmamış alt skorlar. Hariç saç = referans 5,5 (ağırlığı 0). */
  subs: Record<ModSub, number>;
  /** Puanlanan öğeler (evenness yok). */
  items: ItemSignal[];
  /** Skorda kullanılan etkin kategori (zorlanmış unclear / not_applicable dahil). */
  effective: Record<ItemKey, string>;
  notAssessed: NotAssessed[];
  weights: Record<SubKeyV1, number>;
  /** Güven çarpanı; 0 → fotoğraf nedeniyle değerlendirilmedi. */
  kappa: Record<ModSub, number>;
  hairExcluded: boolean;
  /** Sakal hattı bu satırda puanlanıyor mu (sakal var, sunum kadın değil, sakal tercihi "hiçbiri" değil). */
  edgesScored: boolean;
  retouchFactor: number;
};

function rawDelta(item: ItemKey, cat: string): number | null {
  const table = CATEGORY_DELTAS[item] as Record<string, number>;
  return cat in table ? table[cat] : null;
}

/** Bir öğenin en iyi kategorisinin deltası. */
export function maxDelta(item: ItemKey): number {
  return Math.max(...Object.values(CATEGORY_DELTAS[item] as Record<string, number>));
}

/**
 * Bir kategorinin skora katkısı (ham alt skor puanı): retouch (yalnız pozitif cilt deltası), κ ve MOD_GAIN dahil.
 * unclear / not_applicable → IMPUTE_DELTA. Kazanç hesabı da aynı fonksiyonu kullanır: hedef, mevcut retouch ve κ'yı korur.
 */
export function contribution(item: ItemKey, cat: string, mod: Pick<ModifiableResult, "kappa" | "retouchFactor">): number {
  const sub = ITEM_FIELDS[item].sub;
  const d = rawDelta(item, cat);
  const base = d === null ? IMPUTE_DELTA[item] : sub === "skin" && d > 0 ? d * mod.retouchFactor : d;
  const imputed = IMPUTE_DELTA[item];
  return MOD_GAIN * (imputed + mod.kappa[sub] * (base - imputed));
}

export function scoreModifiable(o: Observation, ctx: HybridContext): ModifiableResult {
  const hairExcluded = ctx.headCovering || o.hair.visibility === "no_visible_hair";
  const edgesScored =
    (o.grooming.facialHair === "stubble" || o.grooming.facialHair === "short_beard" || o.grooming.facialHair === "full_beard") &&
    ctx.presentation !== "female" &&
    ctx.beardPreference !== "none";
  const kappa: Record<ModSub, number> = {
    skin: SKIN_VISIBILITY_FACTOR[o.photo.skinVisibility],
    hair: hairExcluded || o.hair.visibility === "not_visible" ? 0 : 1,
    grooming: 1,
  };
  const retouchFactor = RETOUCH_FACTOR[o.photo.retouch];

  const effective = {} as Record<ItemKey, string>;
  for (const item of Object.keys(ITEM_FIELDS) as ItemKey[]) {
    const { group, field } = ITEM_FIELDS[item];
    effective[item] = (o[group] as Record<string, string>)[field];
  }
  if (o.photo.lighting === "harsh_or_dim") effective.shine = "unclear";
  if (!edgesScored) effective.facialHairEdges = "not_applicable";

  const ctxMod = { kappa, retouchFactor };
  const subs = {} as Record<ModSub, number>;
  const items: ItemSignal[] = [];
  const notAssessed: NotAssessed[] = [];

  for (const sub of MOD_SUBS) {
    const keys = SCORED_ITEMS[sub];
    if (sub === "hair" && hairExcluded) {
      subs.hair = STRUCT.reference;
      for (const key of keys) items.push({ key, sub, value: effective[key], delta: 0, status: "not_applicable" });
      notAssessed.push({ sub, reason: "excluded" });
      continue;
    }
    let total = 0;
    let anyClear = false;
    for (const key of keys) {
      const cat = effective[key];
      const d = rawDelta(key, cat);
      const delta = contribution(key, cat, ctxMod);
      total += delta;
      let status: ItemSignal["status"];
      if (d === null) status = cat === "not_applicable" ? "not_applicable" : "unclear";
      else if (kappa[sub] === 0) status = "unclear";
      else status = d >= maxDelta(key) ? "best" : "partial";
      if (status === "best" || status === "partial") anyClear = true;
      items.push({ key, sub, value: cat, delta: round4(delta), status });
    }
    subs[sub] = STRUCT.reference + total;
    // κ = 0 (fotoğraf) veya her puanlanan öğe belirsiz: referansla doldurulur, yeniden normalize edilmez.
    if (!anyClear) notAssessed.push({ sub, reason: "not_visible" });
  }

  return {
    subs,
    items,
    effective,
    notAssessed,
    weights: { ...(hairExcluded ? WEIGHTS_H1_HAIR_EXCLUDED : WEIGHTS_H1) },
    kappa,
    hairExcluded,
    edgesScored,
    retouchFactor,
  };
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
