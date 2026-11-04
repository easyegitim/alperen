import { BEARD_PRESETS } from "./beard-presets";
import { COLOR_PRESETS } from "./color-presets";
import { HAIR_PRESETS } from "./hair-presets";
import type { Preset, PresetKind } from "./types";

export const ALL_PRESETS: Preset[] = [...HAIR_PRESETS, ...BEARD_PRESETS, ...COLOR_PRESETS];
export const PRESET_BY_ID = new Map(ALL_PRESETS.map((p) => [p.id, p]));
export function getPreset(id: string): Preset | undefined {
  return PRESET_BY_ID.get(id);
}

/** Galeride gösterilen presetler: sürüm kapısında gizlenenler (hidden, KB §7.3/4) hariç. */
export function visiblePresets(kind?: PresetKind): Preset[] {
  return ALL_PRESETS.filter((p) => !p.hidden && (!kind || p.kind === kind));
}

/** Sakal stilleri (sürüm kapısı: 12 stil × 30 yüz; scripts/tryon-gate.ts). */
export const BEARD_PRESET_IDS = BEARD_PRESETS.map((p) => p.id);
