"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import {
  ACTIVITIES,
  BEARD_GROWTHS,
  BEARD_PREFERENCES,
  BUDGETS,
  GOALS,
  HAIR_LENGTHS,
  HAIR_TYPES,
  JAW_HEALTH_ISSUES,
  MINUTES_PER_DAY,
  QuestionnaireSchema,
  SKIN_TYPES,
  type Questionnaire,
} from "@/lib/questionnaire";

type Draft = Partial<Omit<Questionnaire, "body">> & {
  body?: { heightCm?: string; weightKg?: string; activity?: (typeof ACTIVITIES)[number] };
  bodySkipped?: boolean;
};

// v2 (KB R2-C13, CONTRACTS_V2 §5): cinsiyet ödeme öncesi ayrı ekranda sorulur (profiles.presentation); burada sorulmaz,
// değeri profil üzerinden taşınır (şema alanı dolu kalır; W3 analysisContextFromQuestionnaire profili önce okur).
const STEPS = ["goals", "hair", "beard", "skin", "budget", "accessories", "body", "jawHealth", "note"] as const;
type Step = (typeof STEPS)[number];
const DRAFT_KEY = "aura.questionnaire.draft.v1";

function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : {};
  } catch {
    return {};
  }
}

function toDraft(initial?: Partial<Questionnaire>): Draft {
  if (!initial) return { jawHealth: [] };
  const { body, ...rest } = initial;
  return {
    ...rest,
    jawHealth: initial.jawHealth ?? [],
    body: body ? { heightCm: String(body.heightCm), weightKg: String(body.weightKg), activity: body.activity } : undefined,
  };
}

const noop = () => () => {};

/** Sunucuda iskelet, istemcide (hidrasyon sonrası) sihirbaz: sessionStorage taslağı güvenle okunur. */
export function QuestionnaireWizard(props: { nextPath: string; initial?: Partial<Questionnaire>; presentation: Questionnaire["presentation"] }) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  if (!hydrated) return <Skeleton className="h-72 w-full rounded-xl" />;
  return <Wizard {...props} />;
}

/** SPEC 9.2 anketi: ekran başına bir konu, ilerleme çubuğu, geri; boy/kilo atlanabilir; çene sağlığı çoklu seçim. */
function Wizard({ nextPath, initial, presentation }: { nextPath: string; initial?: Partial<Questionnaire>; presentation: Questionnaire["presentation"] }) {
  const t = useTranslations("questionnaire");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => ({ ...toDraft(initial), ...loadDraft() }));
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const step: Step = STEPS[index];

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // yerel depolama kapalı olabilir
    }
  }, [draft]);

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const canContinue = useMemo(() => {
    switch (step) {
      case "goals":
        return (draft.goals?.length ?? 0) > 0;
      case "hair":
        return Boolean(draft.hairType && draft.hairLength);
      case "beard":
        return Boolean(draft.beardPreference && draft.beardGrowth);
      case "skin":
        return Boolean(draft.skinType);
      case "budget":
        return Boolean(draft.budget && draft.minutesPerDay);
      case "accessories":
        return typeof draft.glasses === "boolean" && typeof draft.headCovering === "boolean";
      case "body": {
        if (draft.bodySkipped) return true;
        const b = draft.body;
        return Boolean(b?.heightCm && b?.weightKg && b?.activity);
      }
      case "jawHealth":
        return Array.isArray(draft.jawHealth);
      case "note":
        return (draft.note?.length ?? 0) <= 300;
    }
  }, [step, draft]);

  function toPayload(): Questionnaire | null {
    const body =
      !draft.bodySkipped && draft.body?.heightCm && draft.body?.weightKg && draft.body?.activity
        ? { heightCm: Number(draft.body.heightCm), weightKg: Number(draft.body.weightKg), activity: draft.body.activity }
        : undefined;
    const candidate = { ...draft, presentation, body, note: draft.note?.trim() || undefined };
    delete (candidate as Draft).bodySkipped;
    const parsed = QuestionnaireSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  }

  async function next() {
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
      return;
    }
    const payload = toPayload();
    if (!payload) {
      toast.error(t("invalid"));
      return;
    }
    setBusy(true);
    try {
      await postJson("/api/onboarding/questionnaire", payload);
      track("questionnaire_completed");
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // yok say
      }
      router.push(nextPath);
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  const progress = Math.round(((index + 1) / STEPS.length) * 100);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="eyebrow">{t("progress", { current: index + 1, total: STEPS.length })}</span>
          <span className="num font-semibold text-brand">{progress}%</span>
        </div>
        <Progress
          value={progress}
          aria-label={t("progress", { current: index + 1, total: STEPS.length })}
          className="h-1.5 bg-track *:data-[slot=progress-indicator]:rounded-full *:data-[slot=progress-indicator]:bg-brand-gradient"
        />
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{t(`steps.${step}.title`)}</h1>
          <p className="text-sm text-muted-foreground">{t(`steps.${step}.description`)}</p>
        </div>
        <div className="space-y-5">
          {step === "goals" ? (
            <CheckList
              options={GOALS}
              selected={draft.goals ?? []}
              label={(k) => t(`options.goals.${k}`)}
              onChange={(goals) => patch({ goals })}
            />
          ) : null}
          {step === "hair" ? (
            <>
              <Field label={t("fields.hairType")}>
                <Radio options={HAIR_TYPES} value={draft.hairType} label={(k) => t(`options.hairType.${k}`)} onChange={(hairType) => patch({ hairType })} />
              </Field>
              <Field label={t("fields.hairLength")}>
                <Radio options={HAIR_LENGTHS} value={draft.hairLength} label={(k) => t(`options.hairLength.${k}`)} onChange={(hairLength) => patch({ hairLength })} />
              </Field>
            </>
          ) : null}
          {step === "beard" ? (
            <>
              <Field label={t("fields.beardPreference")}>
                <Radio options={BEARD_PREFERENCES} value={draft.beardPreference} label={(k) => t(`options.beardPreference.${k}`)} onChange={(beardPreference) => patch({ beardPreference })} />
              </Field>
              <Field label={t("fields.beardGrowth")}>
                <Radio options={BEARD_GROWTHS} value={draft.beardGrowth} label={(k) => t(`options.beardGrowth.${k}`)} onChange={(beardGrowth) => patch({ beardGrowth })} />
              </Field>
            </>
          ) : null}
          {step === "skin" ? (
            <Radio options={SKIN_TYPES} value={draft.skinType} label={(k) => t(`options.skinType.${k}`)} onChange={(skinType) => patch({ skinType })} />
          ) : null}
          {step === "budget" ? (
            <>
              <Field label={t("fields.budget")}>
                <Radio options={BUDGETS} value={draft.budget} label={(k) => t(`options.budget.${k}`)} onChange={(budget) => patch({ budget })} />
              </Field>
              <Field label={t("fields.minutesPerDay")}>
                <Radio
                  options={MINUTES_PER_DAY.map(String)}
                  value={draft.minutesPerDay ? String(draft.minutesPerDay) : undefined}
                  label={(k) => t("options.minutes", { n: Number(k) })}
                  onChange={(v) => patch({ minutesPerDay: Number(v) as Questionnaire["minutesPerDay"] })}
                />
              </Field>
            </>
          ) : null}
          {step === "accessories" ? (
            <>
              <ToggleRow id="glasses" label={t("fields.glasses")} checked={draft.glasses} onChange={(glasses) => patch({ glasses })} />
              <ToggleRow id="headCovering" label={t("fields.headCovering")} hint={t("fields.headCoveringHint")} checked={draft.headCovering} onChange={(headCovering) => patch({ headCovering })} />
            </>
          ) : null}
          {step === "body" ? (
            <>
              {!draft.bodySkipped ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">{t("fields.heightCm")}</span>
                    <Input type="number" inputMode="numeric" min={100} max={250} value={draft.body?.heightCm ?? ""} onChange={(e) => patch({ body: { ...draft.body, heightCm: e.target.value } })} />
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="font-medium">{t("fields.weightKg")}</span>
                    <Input type="number" inputMode="decimal" min={30} max={300} step="0.1" value={draft.body?.weightKg ?? ""} onChange={(e) => patch({ body: { ...draft.body, weightKg: e.target.value } })} />
                  </label>
                  <div className="col-span-2">
                    <Field label={t("fields.activity")}>
                      <Radio options={ACTIVITIES} value={draft.body?.activity} label={(k) => t(`options.activity.${k}`)} onChange={(activity) => patch({ body: { ...draft.body, activity } })} />
                    </Field>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("bodySkipped")}</p>
              )}
              <Button type="button" variant="ghost" className="w-full" onClick={() => patch({ bodySkipped: !draft.bodySkipped })}>
                {draft.bodySkipped ? t("bodyFill") : t("skip")}
              </Button>
            </>
          ) : null}
          {step === "jawHealth" ? (
            <CheckList
              options={JAW_HEALTH_ISSUES}
              selected={draft.jawHealth ?? []}
              label={(k) => t(`options.jawHealth.${k}`)}
              onChange={(jawHealth) => patch({ jawHealth })}
              noneLabel={t("options.jawHealth.none")}
            />
          ) : null}
          {step === "note" ? (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{t("fields.note")}</span>
              <textarea
                className="min-h-32 w-full rounded-xl border border-input bg-card p-4 text-[15px] shadow-card"
                maxLength={300}
                value={draft.note ?? ""}
                onChange={(e) => patch({ note: e.target.value })}
                placeholder={t("fields.notePlaceholder")}
              />
              <span className="num block text-right text-xs text-muted-foreground">{draft.note?.length ?? 0}/300</span>
            </label>
          ) : null}

        </div>
      </div>
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border/60 bg-background/85 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
        <Button type="button" variant="outline" className="h-12 flex-1" disabled={index === 0 || busy} onClick={() => setIndex(index - 1)}>
          {t("back")}
        </Button>
        <Button type="button" className="h-12 flex-[2]" disabled={!canContinue || busy} onClick={next}>
          {index === STEPS.length - 1 ? t("finish") : t("next")}
        </Button>
      </div>
    </div>
  );
}

const OPTION_TILE =
  "flex min-h-13 cursor-pointer items-center gap-3 rounded-xl border bg-card px-4 py-3 text-[15px] font-medium shadow-card transition-colors hover:bg-accent has-[[data-state=checked]]:border-brand has-[[data-state=checked]]:bg-brand-soft has-focus-visible:ring-2 has-focus-visible:ring-ring/50";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="eyebrow mb-2">{label}</legend>
      {children}
    </fieldset>
  );
}

function Radio<T extends string>({ options, value, label, onChange }: { options: readonly T[]; value?: T; label: (k: T) => string; onChange: (v: T) => void }) {
  return (
    <RadioGroup value={value ?? ""} onValueChange={(v) => onChange(v as T)} className="grid gap-2">
      {options.map((k) => (
        <label key={k} className={OPTION_TILE}>
          <RadioGroupItem value={k} />
          {label(k)}
        </label>
      ))}
    </RadioGroup>
  );
}

function CheckList<T extends string>({ options, selected, label, onChange, noneLabel }: { options: readonly T[]; selected: T[]; label: (k: T) => string; onChange: (v: T[]) => void; noneLabel?: string }) {
  const toggle = (k: T, on: boolean) => onChange(on ? [...selected, k] : selected.filter((x) => x !== k));
  return (
    <div className="grid gap-2">
      {options.map((k) => (
        <label key={k} className={OPTION_TILE}>
          <Checkbox checked={selected.includes(k)} onCheckedChange={(v) => toggle(k, v === true)} />
          {label(k)}
        </label>
      ))}
      {noneLabel ? (
        <label className={OPTION_TILE}>
          <Checkbox checked={selected.length === 0} onCheckedChange={(v) => (v === true ? onChange([]) : undefined)} />
          {noneLabel}
        </label>
      ) : null}
    </div>
  );
}

function ToggleRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-card">
      <label htmlFor={id} className="space-y-0.5">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </label>
      <Switch id={id} checked={checked ?? false} onCheckedChange={onChange} />
    </div>
  );
}
