import "server-only";

import { LEVERS, hasPlanRoute } from "@/content/levers";
import { ORDER, type Observation } from "@/lib/ai/observationSchema";
import { IMPROVE_FIRST, ITEM_FIELDS, POTENTIAL_H1, REACH, SCORED_ITEMS, type ItemKey } from "@/lib/config/engine.server";
import { BEARD_LEVERS, LEVER_KEYS, MOD_SUBS, type ImproveItem, type LeverKey, type ModSub } from "@/lib/score/contract";
import { contribution, type ModifiableResult } from "./categories";
import type { HybridContext, LegacyGains } from "./types";

// engine spec §6: kazançlar, potansiyel girdisi ve "önce odaklan". Saf. Yapının kazancı yoktur (çene hattı dahil).

export type ItemGain = { key: ItemKey; sub: ModSub; lever: LeverKey; gain: number };

/** Öğe → kaldıraç (her öğenin tek kaldıracı vardır). */
const LEVER_BY_ITEM = Object.fromEntries(LEVER_KEYS.map((k) => [LEVERS[k].item, k])) as Record<ItemKey, LeverKey>;

export function leverForItem(item: ItemKey): LeverKey {
  return LEVER_BY_ITEM[item];
}

/** §6.1 hedef kategori; kazanç yoksa null. */
export function reachTarget(item: ItemKey, current: string): string | null {
  const reach = REACH[item];
  if (reach === "none") return null;
  const { group, field } = ITEM_FIELDS[item];
  const order = ORDER[`${group}.${field}` as keyof typeof ORDER] as readonly string[];
  const i = order.indexOf(current);
  if (i < 0) return null;
  return reach === "best" ? order[order.length - 1] : order[Math.min(order.length - 1, i + 1)];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Öğe kazançları (ham alt skor puanı, ≥ 0) ve eski biçimdeki gains. Belirsiz / uygulanmaz öğe, değerlendirilmeyen
 * veya hariç tutulan alt skor kazanç vermez; hedef mevcut retouch ve κ'yı korur.
 */
export function deriveGains(
  _o: Observation,
  mod: ModifiableResult,
  label: (k: LeverKey) => string = () => "",
): { gains: LegacyGains; perItem: ItemGain[]; subGains: Record<ModSub, number> } {
  const blocked = new Set(mod.notAssessed.map((n) => n.sub));
  const perItem: ItemGain[] = [];
  for (const sub of MOD_SUBS) {
    if (blocked.has(sub)) continue;
    for (const key of SCORED_ITEMS[sub]) {
      const cur = mod.effective[key];
      const target = reachTarget(key, cur);
      if (target === null) continue;
      const gain = Math.max(0, contribution(key, target, mod) - contribution(key, cur, mod));
      if (gain > 0) perItem.push({ key, sub, lever: leverForItem(key), gain });
    }
  }
  const subGains = {} as Record<ModSub, number>;
  const topLever = {} as Record<ModSub, string>;
  for (const sub of MOD_SUBS) {
    const own = perItem.filter((p) => p.sub === sub).sort(byGainThenOrder);
    subGains[sub] = Math.min(
      own.reduce((s, p) => s + p.gain, 0),
      POTENTIAL_H1.caps[sub],
    );
    topLever[sub] = own.length ? label(own[0].lever) : "";
  }
  const gains: LegacyGains = {
    skin: { value: round2(subGains.skin), lever: topLever.skin },
    hair: { value: round2(subGains.hair), lever: topLever.hair },
    grooming: { value: round2(subGains.grooming), lever: topLever.grooming },
    jawline: { value: 0, lever: "" },
  };
  return { gains, perItem, subGains };
}

/** Kazanç azalan; eşitlikte skin → hair → grooming, sonra LEVER_KEYS sırası (sözleşme C9). */
function byGainThenOrder(a: { gain: number; sub: ModSub; lever: LeverKey }, b: { gain: number; sub: ModSub; lever: LeverKey }): number {
  if (b.gain !== a.gain) return b.gain - a.gain;
  if (a.sub !== b.sub) return MOD_SUBS.indexOf(a.sub) - MOD_SUBS.indexOf(b.sub);
  return LEVER_KEYS.indexOf(a.lever) - LEVER_KEYS.indexOf(b.lever);
}

/**
 * §6.3: en çok 3 madde; her alt skorun en iyisi önce, sonra kazanca göre doldurulur. Uygunluk süzgeçleri (değerlendirilmeyen
 * veya hariç alt skor, plan yolu olmayan kaldıraç, kadın / sakal tercihi yok iken sakal kaldıracı, günlük SPF) ve minGain
 * seçimden ÖNCE uygulanır. gain = satır ağırlığı × min(öğe kazancı, tavan), 1 ondalık.
 */
export function improveFirst(perItem: ItemGain[], mod: ModifiableResult, ctx: HybridContext): ImproveItem[] {
  const blocked = new Set(mod.notAssessed.map((n) => n.sub));
  const noBeard = ctx.presentation === "female" || ctx.beardPreference === "none";
  const candidates = perItem
    .filter((p) => !blocked.has(p.sub))
    .filter((p) => hasPlanRoute(p.lever))
    .filter((p) => !(noBeard && BEARD_LEVERS.includes(p.lever)))
    .filter((p) => p.lever !== "lv_daily_spf")
    .map((p) => ({ sub: p.sub, lever: p.lever, gain: mod.weights[p.sub] * Math.min(p.gain, POTENTIAL_H1.caps[p.sub]) }))
    .filter((p) => p.gain >= IMPROVE_FIRST.minGain)
    .sort(byGainThenOrder);

  const picked: typeof candidates = [];
  for (const sub of MOD_SUBS) {
    const best = candidates.find((c) => c.sub === sub);
    if (best && picked.length < IMPROVE_FIRST.n) picked.push(best);
  }
  for (const c of candidates) {
    if (picked.length >= IMPROVE_FIRST.n) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.sort(byGainThenOrder).map((p) => ({ sub: p.sub, lever: p.lever, gain: round1(p.gain) }));
}
