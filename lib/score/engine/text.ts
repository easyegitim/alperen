import "server-only";

import type { Observation } from "@/lib/ai/observationSchema";
import { CATEGORY_DELTAS, REF_CATEGORY, SCORED_ITEMS, type ComponentKey, type ItemKey } from "@/lib/config/engine.server";
import type { SubKeyV1 } from "@/lib/config/teaser";
import {
  CAPTURE_HINTS,
  type CaptureHint,
  type ExplainItem,
  type LeverKey,
  type ModExplainKey,
  type StructuralExplainKey,
} from "@/lib/score/contract";
import tr from "@/messages/tr.json";
import type { ModifiableResult } from "./categories";
import type { StructuralResult } from "./geometry";
import type { HybridContext } from "./types";

// engine spec §7.4: deterministik Türkçe metin (Claude serbest metin üretmez). Tüm kalıplar messages/tr.json
// "analysis.obs" altında. Yapısal metin hiç üretilmez; fotoğraf koşulları yalnız captureHints'te. Rakam yok.

const OBS = tr.analysis.obs;
type Dict = Record<string, string>;

export type ObservationKey = "skin" | "hair" | "brows" | "facialHair";

/** İlk harfi Türkçe kurala göre büyütür (i → İ). */
export function capitalizeTr(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("tr") + s.slice(1) : s;
}

function zone(z: string): string {
  return (OBS.zone as Dict)[z] ?? "";
}

/** Parçaları tek cümlede birleştirir: büyük harfle başlar, noktayla biter. */
function sentence(fragments: string[]): string {
  return `${capitalizeTr(fragments.join("; "))}.`;
}

/** Referans dışı öğeler önce (|delta| büyükten), sonra referanstakiler sabit sırada. */
function ordered(items: ItemKey[], mod: ModifiableResult): ItemKey[] {
  const absDelta = (k: ItemKey) => Math.abs((CATEGORY_DELTAS[k] as Record<string, number>)[mod.effective[k]] ?? 0);
  const isRef = (k: ItemKey) => mod.effective[k] === REF_CATEGORY[k];
  const non = items.filter((k) => !isRef(k)).sort((a, b) => absDelta(b) - absDelta(a));
  return [...non, ...items.filter(isRef)];
}

function skinFragment(k: ItemKey, o: Observation, mod: ModifiableResult): string {
  const cat = mod.effective[k];
  if (k === "blemishes") return (OBS.skin.blemishes as Dict)[cat].replace("{zone}", zone(o.skin.blemishZone));
  if (k === "texture") return (OBS.skin.texture as Dict)[cat];
  return (OBS.skin.shine as Dict)[cat].replace("{zone}", zone(o.skin.shineZone));
}

function hairFragment(k: ItemKey, mod: ModifiableResult): string {
  const cat = mod.effective[k];
  return k === "hairNeat" ? (OBS.hair.neatness as Dict)[cat] : (OBS.hair.shape as Dict)[cat];
}

/**
 * Gözlem cümleleri. Yalnız skin, hair, brows, facialHair anahtarları. Hariç saçta hair anahtarı yazılmaz (örtü veya saç
 * kaybını ima eden metin yok); sakal hattı yalnız puanlandığında anlatılır (kadın veya "hiçbiri" tercihinde asla).
 */
export function composeObservations(o: Observation, mod: ModifiableResult, ctx: HybridContext): Partial<Record<ObservationKey, string>> {
  const out: Partial<Record<ObservationKey, string>> = {};
  const scoredClear = (sub: "skin" | "hair" | "grooming") =>
    SCORED_ITEMS[sub].filter((k) => mod.effective[k] in (CATEGORY_DELTAS[k] as Record<string, number>));

  // Cilt
  const skinNotAssessed = mod.notAssessed.some((n) => n.sub === "skin");
  if (skinNotAssessed) out.skin = OBS.skin.notAssessed;
  else {
    const evenClear = o.skin.evenness in CATEGORY_DELTAS.evenness;
    const scored = ordered(scoredClear("skin"), mod).slice(0, evenClear ? 2 : 3);
    const frags = scored.map((k) => skinFragment(k, o, mod));
    if (evenClear) frags.push((OBS.skin.evenness as Dict)[o.skin.evenness]);
    const parts = [sentence(frags)];
    if (o.photo.retouch !== "none") parts.push(OBS.skin.retouch);
    if (o.photo.lighting === "harsh_or_dim") parts.push(OBS.skin.harshLight);
    out.skin = parts.join(" ");
  }

  // Saç
  if (!mod.hairExcluded) {
    if (mod.notAssessed.some((n) => n.sub === "hair")) out.hair = OBS.hair.notVisible;
    else out.hair = sentence(ordered(scoredClear("hair"), mod).map((k) => hairFragment(k, mod)));
  }

  // Kaşlar (belirsiz için de tam cümle var)
  out.brows = (OBS.brows as Dict)[mod.effective.brows] ?? OBS.brows.unclear;

  // Sakal hattı (yalnız puanlanıyorsa) + dudaklar
  const fh: string[] = [];
  const beardNarrated = mod.edgesScored && ctx.presentation !== "female" && ctx.beardPreference !== "none";
  if (beardNarrated && mod.effective.facialHairEdges in CATEGORY_DELTAS.facialHairEdges) {
    fh.push((OBS.facialHair.edges as Dict)[mod.effective.facialHairEdges]);
  }
  if (mod.effective.lips in CATEGORY_DELTAS.lips) fh.push((OBS.facialHair.lips as Dict)[mod.effective.lips]);
  if (fh.length) out.facialHair = fh.join(" ");
  return out;
}

/** "… için bir dermatoloğa göstermek faydalı olabilir" kalıbı; hastalık adı yok. Endişe yoksa null. */
export function skinConcernNote(o: Observation): string | null {
  if (!o.skin.visibleSkinConcern) return null;
  return capitalizeTr(OBS.skinConcernNote.replace("{zone}", zone(o.skin.concernZone)));
}

const STRUCT_EXPLAIN: Record<ComponentKey, StructuralExplainKey> = {
  symFace: "symmetry",
  vertical: "vertical",
  eyeMouth: "eyeMouth",
  spacing: "spacing",
  symEyes: "symmetry",
  tilt: "tilt",
  jawWidth: "jawWidth",
  symLower: "symmetry",
};

const MOD_EXPLAIN: Partial<Record<ItemKey, ModExplainKey>> = {
  blemishes: "blemishes",
  texture: "texture",
  shine: "shine",
  hairNeat: "hairNeat",
  hairShape: "hairShape",
  brows: "brows",
  lips: "lips",
  facialHairEdges: "facialHairEdges",
};

/**
 * Alt skor başına açıklama öğeleri (contract.ts biçimi). Yapısal: yalnız measured / not_measured (yüzü yargılayan
 * durum yok). Geliştirilebilir: best / partial / unclear; uygulanmaz öğe ve evenness listelenmez; hariç saç yazılmaz.
 */
export function composeExplain(mod: ModifiableResult, struct: StructuralResult): Partial<Record<SubKeyV1, ExplainItem[]>> {
  const out: Partial<Record<SubKeyV1, ExplainItem[]>> = {};
  for (const c of struct.components) {
    (out[c.sub] ??= []).push({ key: STRUCT_EXPLAIN[c.key], status: c.status });
  }
  for (const it of mod.items) {
    if (it.sub === "hair" && mod.hairExcluded) continue;
    const key = MOD_EXPLAIN[it.key];
    if (!key || it.status === "not_applicable") continue;
    (out[it.sub] ??= []).push({ key, status: it.status });
  }
  return out;
}

/**
 * Çekim ipuçları (sabit CAPTURE_HINTS sırası). pose: son karenin pozu bir tüm-kare bileşenini azalttıysa
 * (StructuralResult.poseLimited). Saç ipucu yoktur.
 */
export function captureHints(o: Observation, _mod: ModifiableResult, struct?: Pick<StructuralResult, "poseLimited">): CaptureHint[] {
  const set = new Set<CaptureHint>();
  if (o.photo.lighting !== "even") set.add("lighting");
  if (struct?.poseLimited) set.add("pose");
  if (o.photo.skinVisibility !== "clear") set.add("skin_visibility");
  if (o.photo.retouch !== "none") set.add("retouch");
  return CAPTURE_HINTS.filter((h) => set.has(h));
}

/** analysis.levers.* etiketi (eski gains.lever alanı için). */
export function leverLabel(k: LeverKey): string {
  return (tr.analysis.levers as Dict)[k] ?? "";
}

