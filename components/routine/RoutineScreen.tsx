"use client";

import { ArrowDown, ArrowUp, CalendarDays, Check, ListChecks, Moon, Plus, Sun, Clock3, Trash2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { EXERCISES, EXERCISE_SAFETY_TEXT } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { SKIN_STEPS } from "@/content/skin-steps";
import { ExerciseTimer } from "@/components/routine/ExerciseTimer";
import { StateCard } from "@/components/routine/StateCard";
import { StreakCard } from "@/components/routine/StreakCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { track } from "@/lib/analytics";
import { getRoutineForgiving, ROUTINE_FORGIVING } from "@/lib/config/routine";
import { createClient } from "@/lib/db/browser";
import { freezeStoreError, recentDays } from "@/lib/routine/calendar";
import { canUseFreeze, computeForgivingStreak, restDaysLeftThisWeek, type FreezeRecord } from "@/lib/routine/forgiving";
import { completionRatio, istanbulDate, type DayLog } from "@/lib/routine/streak";
import { cn } from "@/lib/utils";

type Item = { id: string; kind: "step" | "exercise" | "habit"; ref_id: string | null; slot: "morning" | "evening" | "daily" | "weekly"; title: string; position: number };
const SLOTS = ["morning", "daily", "evening", "weekly"] as const;
const SLOT_ICON: Record<(typeof SLOTS)[number], LucideIcon> = { morning: Sun, daily: Clock3, evening: Moon, weekly: CalendarDays };

/** Faz 6 affedici seri sayıları (ÖNERİ; env ile değişir): NEXT_PUBLIC_ olmadığından istemcide varsayılan + placeholder notu. */
const FORGIVING = { ...getRoutineForgiving(), placeholder: ROUTINE_FORGIVING.placeholder };

/**
 * /rutin (F12): bugünün listesi, routine_logs upsert (iyimser), affedici seri (Faz 6: dinlenme günü + dondurma; eski
 * computeStreak kayıt biçimi aynen), zamanlayıcılar, düzenleme. RLS: kendi satırları. routine_freezes (0015) yoksa
 * dondurma bölümü gizlenir; seri yine hesaplanır.
 */
export function RoutineScreen({ userId, exerciseEligible }: { userId: string; exerciseEligible: boolean }) {
  const t = useTranslations("routine");
  const tv = useTranslations("routine.v2");
  const today = istanbulDate();
  const [items, setItems] = useState<Item[] | null>(null);
  const [logs, setLogs] = useState<DayLog[]>([]);
  const [freezes, setFreezes] = useState<FreezeRecord[]>([]);
  const [freezeAvailable, setFreezeAvailable] = useState(true);
  const [freezeBusy, setFreezeBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const [i, l, f] = await Promise.all([
      supabase.from("routine_items").select("id, kind, ref_id, slot, title, position").eq("active", true).order("position"),
      supabase.from("routine_logs").select("log_date, item_id, done").gte("log_date", since),
      supabase.from("routine_freezes").select("freeze_date").gte("freeze_date", since),
    ]);
    setItems((i.data ?? []) as Item[]);
    setLogs((l.data ?? []) as DayLog[]);
    if (f.error) setFreezeAvailable(freezeStoreError(f.error) !== "unavailable");
    setFreezes(((f.data ?? []) as { freeze_date: string }[]).map((r) => ({ date: String(r.freeze_date) })));
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const dailyIds = useMemo(() => (items ?? []).filter((i) => i.slot !== "weekly").map((i) => i.id), [items]);
  const forgiving = useMemo(() => computeForgivingStreak({ logs, activeItemCount: dailyIds.length, today, freezes, config: FORGIVING }), [logs, dailyIds.length, today, freezes]);
  const restLeft = useMemo(() => restDaysLeftThisWeek({ logs, activeItemCount: dailyIds.length, today, freezes, config: FORGIVING }), [logs, dailyIds.length, today, freezes]);
  const week = useMemo(() => recentDays({ logs, activeItemCount: dailyIds.length, today, freezes, config: FORGIVING, days: 7 }), [logs, dailyIds.length, today, freezes]);
  const freezeCheck = useMemo(() => canUseFreeze(freezes, today, today, FORGIVING), [freezes, today]);

  // routine_rest_day: dinlenme günü köprü olarak gösterildiğinde, günde bir (yüksüz; sayı gitmez).
  useEffect(() => {
    if (!week.some((d) => d.status === "rest")) return;
    const key = `aura.routine.restDay.${today}`;
    try {
      if (window.sessionStorage.getItem(key) === "1") return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // depolama kapalıysa oturumda bir kez
    }
    track("routine_rest_day");
  }, [week, today]);

  async function freezeToday() {
    if (!freezeCheck.ok) {
      toast.error(tv(`errors.${freezeCheck.reason}`));
      return;
    }
    setFreezeBusy(true);
    const { error } = await createClient().from("routine_freezes").insert({ user_id: userId, freeze_date: today });
    setFreezeBusy(false);
    if (error) {
      const reason = freezeStoreError(error);
      if (reason === "unavailable") setFreezeAvailable(false);
      toast.error(reason === "limit_reached" || reason === "already_frozen" || reason === "future_date" ? tv(`errors.${reason}`) : t("saveError"));
      return;
    }
    setFreezes((prev) => [...prev, { date: today }]);
    track("routine_freeze_used");
    toast.success(tv("freezeDone"));
  }
  const ratio = useMemo(() => completionRatio(logs, dailyIds, today), [logs, dailyIds, today]);
  const doneToday = (id: string) => logs.some((l) => l.log_date === today && l.item_id === id && l.done);

  async function toggle(item: Item) {
    const next = !doneToday(item.id);
    // iyimser güncelleme
    setLogs((prev) => [...prev.filter((l) => !(l.log_date === today && l.item_id === item.id)), { log_date: today, item_id: item.id, done: next }]);
    const { error } = await createClient().from("routine_logs").upsert({ user_id: userId, item_id: item.id, log_date: today, done: next }, { onConflict: "user_id,item_id,log_date" });
    if (error) {
      toast.error(t("saveError"));
      void load();
      return;
    }
    if (next) track("routine_checked", { kind: item.kind });
  }

  async function remove(item: Item) {
    setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
    await createClient().from("routine_items").update({ active: false }).eq("id", item.id);
  }

  async function move(item: Item, dir: -1 | 1) {
    if (!items) return;
    const idx = items.findIndex((i) => i.id === item.id);
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[idx], next[j]] = [next[j], next[idx]];
    const renumbered = next.map((i, k) => ({ ...i, position: k }));
    setItems(renumbered);
    const supabase = createClient();
    await Promise.all(renumbered.map((i) => supabase.from("routine_items").update({ position: i.position }).eq("id", i.id)));
  }

  async function add(kind: Item["kind"], refId: string, slot: Item["slot"], title: string) {
    const position = items?.length ?? 0;
    const { data, error } = await createClient().from("routine_items").insert({ user_id: userId, kind, ref_id: refId, slot, title, position }).select("id, kind, ref_id, slot, title, position").single();
    if (error || !data) {
      toast.error(t("saveError"));
      return;
    }
    setItems((prev) => [...(prev ?? []), data as Item]);
    setAdding(false);
  }

  if (items === null) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  if (items.length === 0 && !adding) {
    return (
      <StateCard icon={<ListChecks className="size-6" />} title={t("emptyTitle")} body={t("emptyBody")}>
        <Button asChild>
          <Link href="/plan">{t("fromPlan")}</Link>
        </Button>
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" /> {t("addManual")}
        </Button>
      </StateCard>
    );
  }

  const pct = Math.round(ratio * 100);
  const doneCount = dailyIds.filter((id) => doneToday(id)).length;

  return (
    <div className="space-y-3">
      <StreakCard
        dateLabel={new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}
        pct={pct}
        doneCount={doneCount}
        total={dailyIds.length}
        streak={forgiving}
        restLeft={restLeft}
        config={FORGIVING}
        days={week}
        freeze={{ available: freezeAvailable, check: freezeCheck, busy: freezeBusy, onFreeze: () => void freezeToday() }}
      />

      {SLOTS.map((slot) => {
        const list = items.filter((i) => i.slot === slot);
        if (!list.length) return null;
        const SlotIcon = SLOT_ICON[slot];
        const slotDone = list.filter((i) => doneToday(i.id)).length;
        return (
          <Card key={slot}>
            <CardHeader>
              <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand" aria-hidden="true">
                  <SlotIcon className="size-4" />
                </span>
                <span className="flex-1">{t(`slots.${slot}`)}</span>
                <span className="num text-sm font-semibold text-muted-foreground">
                  {slotDone}/{list.length}
                </span>
              </h2>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {list.map((item) => {
                  const ex = item.kind === "exercise" ? EXERCISES.find((e) => e.id === item.ref_id) : undefined;
                  const done = doneToday(item.id);
                  return (
                    <li key={item.id} className={cn("rounded-xl border px-3 py-1 transition-colors", done ? "border-transparent bg-brand-soft" : "bg-muted/40")}>
                      <div className="flex min-h-12 items-center gap-3">
                        <Checkbox
                          id={`ri-${item.id}`}
                          checked={done}
                          onCheckedChange={() => toggle(item)}
                          className="size-6 rounded-full data-[state=checked]:border-transparent data-[state=checked]:bg-cta-gradient"
                        />
                        <label htmlFor={`ri-${item.id}`} className={cn("flex-1 cursor-pointer py-2 text-[15px] font-medium", done && "text-muted-foreground line-through")}>
                          {item.title}
                          {ex ? <span className="block text-xs font-normal text-muted-foreground no-underline">{ex.doseTr}</span> : null}
                        </label>
                        {editing ? (
                          <span className="flex">
                            <Button size="icon" variant="ghost" aria-label={t("moveUp")} onClick={() => move(item, -1)}><ArrowUp /></Button>
                            <Button size="icon" variant="ghost" aria-label={t("moveDown")} onClick={() => move(item, 1)}><ArrowDown /></Button>
                            <Button size="icon" variant="ghost" aria-label={t("remove")} onClick={() => remove(item)}><Trash2 /></Button>
                          </span>
                        ) : null}
                      </div>
                      {ex && !done ? (
                        <div className="space-y-1 pb-2 pl-9">
                          <ExerciseTimer exercise={ex} onComplete={() => void toggle(item)} />
                          <p className="text-[11px] text-muted-foreground">{EXERCISE_SAFETY_TEXT}</p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="flex-1" onClick={() => setEditing((e) => !e)}>
          {editing ? <Check aria-hidden="true" /> : null}
          {editing ? t("done") : t("edit")}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> {t("addManual")}</Button>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[85dvh] space-y-1 overflow-y-auto">
          <DialogHeader><DialogTitle>{t("addTitle")}</DialogTitle></DialogHeader>
          <AddList title={t("slots.morning")} entries={SKIN_STEPS.filter((s) => s.slot === "morning").map((s) => ({ key: s.id, label: s.nameTr, onAdd: () => add("step", s.id, "morning", s.nameTr) }))} />
          <AddList title={t("slots.evening")} entries={SKIN_STEPS.filter((s) => s.slot === "evening").map((s) => ({ key: s.id, label: s.nameTr, onAdd: () => add("step", s.id, "evening", s.nameTr) }))} />
          <AddList title={t("slots.weekly")} entries={SKIN_STEPS.filter((s) => s.slot === "weekly").map((s) => ({ key: s.id, label: s.nameTr, onAdd: () => add("step", s.id, "weekly", s.nameTr) }))} />
          <AddList title={t("habits")} entries={HABITS.map((h) => ({ key: h.id, label: `${h.nameTr}: ${h.defaultTargetTr}`, onAdd: () => add("habit", h.id, h.slot, `${h.nameTr}: ${h.defaultTargetTr}`) }))} />
          {exerciseEligible ? (
            <AddList title={t("exercises")} entries={EXERCISES.map((e) => ({ key: e.id, label: `${e.nameTr} (${e.doseTr})`, onAdd: () => add("exercise", e.id, e.slot, e.nameTr) }))} />
          ) : (
            <p className="text-xs text-muted-foreground">{t("exercisesNotEligible")}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddList({ title, entries }: { title: string; entries: { key: string; label: string; onAdd: () => void }[] }) {
  return (
    <div className="space-y-2 pt-2">
      <h3 className="eyebrow">{title}</h3>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.key}>
            <button type="button" onClick={e.onAdd} className="flex min-h-11 w-full items-center gap-3 rounded-xl border bg-muted/40 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent">
              <Plus className="size-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="flex-1">{e.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
