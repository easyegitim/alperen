// Glow-up "uygulanan plan adımları" başlıkları (KB §7.2): plan adımı varsa onun nötr adı, yoksa katalog adı. Saf.
import { EXERCISES } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { getPreset } from "@/content/presets";
import { SKIN_STEPS } from "@/content/skin-steps";
import type { PlanStepLite } from "@/mobile/src/features/plan/viewModel";

export function stepTitle(id: string, planSteps: readonly PlanStepLite[] = []): string {
  const fromPlan = planSteps.find((s) => s.id === id);
  if (fromPlan) return fromPlan.title;
  const preset = getPreset(id);
  if (preset) return preset.nameTr;
  const skin = SKIN_STEPS.find((s) => s.id === id);
  if (skin) return skin.nameTr;
  const habit = HABITS.find((h) => h.id === id);
  if (habit) return habit.nameTr;
  const ex = EXERCISES.find((e) => e.id === id);
  if (ex) return ex.nameTr;
  return id;
}
