"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AvatarPreview } from "@/components/onboarding/AvatarPreview";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { track } from "@/lib/analytics";
import { postJson } from "@/lib/api/client";
import {
  BEARD_LENGTH_PREFS,
  BUDGET_BANDS,
  GOAL_DIRECTIONS,
  HAIR_LENGTH_PREFS,
  ONE_TIME_BUDGET_BANDS,
  PLAN_CONFIG,
  SPORT_DAYS,
  TIME_BANDS,
  WORK_TYPES,
  type BeardLengthPref,
  type HairLengthPref,
} from "@/lib/config/plan";
import { GOALS, JAW_HEALTH_ISSUES, SKIN_TYPES } from "@/lib/questionnaire";
import { QuestionnaireV2Schema, emptyQuestionnaireV2, type PhotoConfirm, type QuestionnaireV2 } from "@/lib/questionnaireV2";
import { cn } from "@/lib/utils";

// Ödeme sonrası "Planını kişiselleştir" (KB §3.2/5–6, R2-C13/C14, Ö7, Ç17; PLAN 4c). /plan önüne gelir; SKORU DEĞİŞTİRMEZ.
// Gözlük ve başörtüsü fotoğraftan tahminle dolu gelir (onayla/değiştir); tahmin yoksa seçim zorunlu (saç önerisi için).
// Boy/kilo isteğe bağlı (K8); çene sağlığı egzersiz için (K10). Kayıt: POST /api/questionnaire (service role, Zod).

const STEPS = ["goals", "direction", "budget", "time", "activity", "hairBeard", "skin", "jaw", "photo", "body"] as const;
type Step = (typeof STEPS)[number];
const DRAFT_KEY = "aura.questionnaire.v2.draft";

type Draft = QuestionnaireV2 & { bodyDraft: { heightCm: string; weightKg: string }; bodySkipped: boolean };

export type QuestionnaireWizardV2Props = {
  nextPath: string;
  initial?: QuestionnaireV2;
  /** SignalsV2.observations'tan (Ç17); null = tahmin yok. */
  prefill: { glassesDetected: boolean | null; headCoveringDetected: boolean | null };
  presentation: "male" | "female" | "unspecified";
  under18: boolean;
};

function loadDraft(): Partial<Draft> {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : {};
  } catch {
    return {};
  }
}

function initialDraft(p: QuestionnaireWizardV2Props): Draft {
  const base = p.initial ?? emptyQuestionnaireV2(p.prefill);
  // Tahmin her açılışta güncel analizden gelir; kullanıcı cevabı korunur.
  const glasses: PhotoConfirm = { detected: p.prefill.glassesDetected, value: base.glasses.value };
  const headCovering: PhotoConfirm = { detected: p.prefill.headCoveringDetected, value: base.headCovering.value };
  return {
    ...base,
    glasses,
    headCovering,
    bodyDraft: { heightCm: base.body ? String(base.body.heightCm) : "", weightKg: base.body ? String(base.body.weightKg) : "" },
    bodySkipped: !base.body,
  };
}

/** Taslak (sessionStorage) kullanıcı cevaplarını korur; fotoğraf tahmini her açılışta güncel analizden gelir. */
function mergeDraft(p: QuestionnaireWizardV2Props): Draft {
  const base = initialDraft(p);
  const saved = loadDraft();
  return {
    ...base,
    ...saved,
    glasses: { detected: p.prefill.glassesDetected, value: saved.glasses?.value ?? base.glasses.value },
    headCovering: { detected: p.prefill.headCoveringDetected, value: saved.headCovering?.value ?? base.headCovering.value },
  };
}

const noop = () => () => {};

export function QuestionnaireWizardV2(props: QuestionnaireWizardV2Props) {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  if (!hydrated) return <Skeleton className="h-72 w-full rounded-xl" />;
  return <Wizard {...props} />;
}

function Wizard(p: QuestionnaireWizardV2Props) {
  const t = useTranslations("questionnaire.v2");
  const tq = useTranslations("questionnaire.options");
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => mergeDraft(p));
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const step: Step = STEPS[index];
  const showBeard = p.presentation !== "female";

  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // yerel depolama kapalı olabilir
    }
  }, [draft]);

  const patch = (x: Partial<Draft>) => setDraft((d) => ({ ...d, ...x }));

  const canContinue = useMemo(() => {
    switch (step) {
      case "goals":
        return draft.goals.length > 0;
      case "photo":
        // Ç17: tahmin varsa onaylanmış sayılır (value null olabilir); tahmin yoksa seçim şart.
        return (draft.glasses.detected !== null || draft.glasses.value !== null) && (draft.headCovering.detected !== null || draft.headCovering.value !== null);
      case "body": {
        if (draft.bodySkipped) return true;
        const h = Number(draft.bodyDraft.heightCm);
        const w = Number(draft.bodyDraft.weightKg);
        return h >= 100 && h <= 250 && w >= 30 && w <= 300;
      }
      default:
        return true;
    }
  }, [step, draft]);

  function toPayload(): QuestionnaireV2 | null {
    const { bodyDraft, bodySkipped, ...rest } = draft;
    const body = !bodySkipped && bodyDraft.heightCm && bodyDraft.weightKg ? { heightCm: Number(bodyDraft.heightCm), weightKg: Number(bodyDraft.weightKg) } : undefined;
    const parsed = QuestionnaireV2Schema.safeParse({ ...rest, body });
    return parsed.success ? parsed.data : null;
  }

  async function next() {
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
      return;
    }
    const payload = toPayload();
    if (!payload) {
      toast.error(t("error"));
      return;
    }
    setBusy(true);
    try {
      await postJson("/api/questionnaire", payload);
      track("questionnaire_v2_completed");
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        // yok say
      }
      router.push(p.nextPath);
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
        <Progress value={progress} aria-label={t("progress", { current: index + 1, total: STEPS.length })} className="h-1.5 bg-track *:data-[slot=progress-indicator]:rounded-full *:data-[slot=progress-indicator]:bg-brand-gradient" />
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="eyebrow">{t("title")}</p>
          <h1 className="text-2xl font-bold tracking-tight">{t(`steps.${step}`)}</h1>
          <p className="text-sm text-muted-foreground">{index === 0 ? t("intro") : t(`stepHints.${step}`)}</p>
        </div>

        {step === "goals" ? <CheckList options={GOALS} selected={draft.goals} label={(k) => tq(`goals.${k}`)} onChange={(goals) => patch({ goals: goals.length ? goals : ["general"] })} /> : null}

        {step === "direction" ? (
          <Field label={t("fields.goalDirection")}>
            <Radio options={GOAL_DIRECTIONS} value={draft.goalDirection} label={(k) => t(`options.goalDirection.${k}`)} onChange={(goalDirection) => patch({ goalDirection })} />
          </Field>
        ) : null}

        {step === "budget" ? (
          <>
            <Field label={t("fields.budget")} hint={PLAN_CONFIG.placeholder ? t("hints.budgetPending") : undefined}>
              <Radio options={BUDGET_BANDS} value={draft.budget} label={(k) => t(`options.budget.${k}`)} onChange={(budget) => patch({ budget })} />
            </Field>
            <Field label={t("fields.oneTimeBudget")}>
              <Radio options={ONE_TIME_BUDGET_BANDS} value={draft.oneTimeBudget} label={(k) => t(`options.oneTimeBudget.${k}`)} onChange={(oneTimeBudget) => patch({ oneTimeBudget })} />
            </Field>
          </>
        ) : null}

        {step === "time" ? (
          <Field label={t("fields.minutesPerDay")}>
            <Radio options={TIME_BANDS.map(String)} value={String(draft.minutesPerDay)} label={(k) => t("options.minutes", { n: Number(k) })} onChange={(v) => patch({ minutesPerDay: Number(v) as QuestionnaireV2["minutesPerDay"] })} />
          </Field>
        ) : null}

        {step === "activity" ? (
          <>
            <Field label={t("fields.sportDays")}>
              <Radio options={SPORT_DAYS} value={draft.activity.sportDays} label={(k) => t(`options.sportDays.${k}`)} onChange={(sportDays) => patch({ activity: { ...draft.activity, sportDays } })} />
            </Field>
            <Field label={t("fields.work")}>
              <Radio options={WORK_TYPES} value={draft.activity.work} label={(k) => t(`options.work.${k}`)} onChange={(work) => patch({ activity: { ...draft.activity, work } })} />
            </Field>
          </>
        ) : null}

        {step === "hairBeard" ? (
          <>
            <div className="mx-auto w-36 text-brand" aria-hidden="false">
              <AvatarPreview hair={draft.hairLengthPref} beard={showBeard ? draft.beardLengthPref : "none"} presentation={p.presentation} label={t("hints.avatar")} className="w-full" />
            </div>
            <Field label={t("fields.hairLengthPref")}>
              <Radio options={HAIR_LENGTH_PREFS} value={draft.hairLengthPref} label={(k) => t(`options.hairLength.${k}`)} onChange={(hairLengthPref: HairLengthPref) => patch({ hairLengthPref })} inline />
            </Field>
            {showBeard ? (
              <Field label={t("fields.beardLengthPref")}>
                <Radio options={BEARD_LENGTH_PREFS} value={draft.beardLengthPref} label={(k) => t(`options.beardLength.${k}`)} onChange={(beardLengthPref: BeardLengthPref) => patch({ beardLengthPref })} inline />
              </Field>
            ) : null}
          </>
        ) : null}

        {step === "skin" ? <Radio options={SKIN_TYPES} value={draft.skinType} label={(k) => tq(`skinType.${k}`)} onChange={(skinType) => patch({ skinType })} /> : null}

        {step === "jaw" ? (
          <Field label={t("fields.jawHealth")} hint={t("hints.jaw")}>
            <CheckList options={JAW_HEALTH_ISSUES} selected={draft.jawHealth} label={(k) => tq(`jawHealth.${k}`)} onChange={(jawHealth) => patch({ jawHealth })} noneLabel={tq("jawHealth.none")} />
          </Field>
        ) : null}

        {step === "photo" ? (
          <>
            <PhotoConfirmRow id="glasses" label={t("fields.glasses")} value={draft.glasses} onChange={(glasses) => patch({ glasses })} />
            <PhotoConfirmRow id="headCovering" label={t("fields.headCovering")} hint={t("hints.headCovering")} value={draft.headCovering} onChange={(headCovering) => patch({ headCovering })} />
          </>
        ) : null}

        {step === "body" ? (
          <>
            <p className="text-sm text-muted-foreground">{p.under18 ? t("hints.bodyUnder18") : t("hints.body")}</p>
            {!draft.bodySkipped && !p.under18 ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">{t("fields.heightCm")}</span>
                  <Input type="number" inputMode="numeric" min={100} max={250} value={draft.bodyDraft.heightCm} onChange={(e) => patch({ bodyDraft: { ...draft.bodyDraft, heightCm: e.target.value } })} />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium">{t("fields.weightKg")}</span>
                  <Input type="number" inputMode="decimal" min={30} max={300} step="0.1" value={draft.bodyDraft.weightKg} onChange={(e) => patch({ bodyDraft: { ...draft.bodyDraft, weightKg: e.target.value } })} />
                </label>
              </div>
            ) : null}
            {!p.under18 ? (
              <Button type="button" variant="ghost" className="w-full" onClick={() => patch({ bodySkipped: !draft.bodySkipped })}>
                {draft.bodySkipped ? t("bodyFill") : t("skip")}
              </Button>
            ) : null}
          </>
        ) : null}
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="eyebrow mb-1">{label}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

function Radio<T extends string>({ options, value, label, onChange, inline }: { options: readonly T[]; value?: T; label: (k: T) => string; onChange: (v: T) => void; inline?: boolean }) {
  return (
    <RadioGroup value={value ?? ""} onValueChange={(v) => onChange(v as T)} className={cn("grid gap-2", inline && "grid-cols-2")}>
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

/** Ç17: fotoğraftan tahmin + onayla/değiştir; tahmin yoksa Evet/Hayır seçimi şart. */
function PhotoConfirmRow({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: PhotoConfirm; onChange: (v: PhotoConfirm) => void }) {
  const t = useTranslations("questionnaire.v2");
  const resolved = value.value ?? value.detected;
  return (
    <div className="space-y-2 rounded-xl border bg-card px-4 py-3 shadow-card">
      <div className="space-y-0.5">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
        <span className="block text-xs text-muted-foreground">
          {value.detected === null ? t("hints.photoUnknown") : `${t(value.detected ? "photoConfirm.detectedYes" : "photoConfirm.detectedNo")} · ${t("hints.photoPrefill")}`}
        </span>
      </div>
      <RadioGroup value={resolved === null ? "" : resolved ? "yes" : "no"} onValueChange={(v) => onChange({ ...value, value: v === "yes" })} className="grid grid-cols-2 gap-2" aria-label={label}>
        <label className={OPTION_TILE}>
          <RadioGroupItem value="yes" id={`${id}-yes`} />
          {t("photoConfirm.yes")}
        </label>
        <label className={OPTION_TILE}>
          <RadioGroupItem value="no" id={`${id}-no`} />
          {t("photoConfirm.no")}
        </label>
      </RadioGroup>
    </div>
  );
}
