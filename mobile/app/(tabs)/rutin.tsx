import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { EXERCISES, EXERCISE_SAFETY_TEXT } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { SKIN_STEPS } from "@/content/skin-steps";
import { track } from "@/lib/analytics";
import { exerciseEligible } from "@/lib/coach/eligibility";
import { QuestionnaireSchema } from "@/lib/questionnaire";
import { getRoutineForgiving, ROUTINE_FORGIVING } from "@/lib/config/routine";
import { canUseFreeze, computeForgivingStreak, restDaysLeftThisWeek, type FreezeRecord } from "@/lib/routine/forgiving";
import { completionRatio, istanbulDate, type DayLog } from "@/lib/routine/streak";
import { ExerciseTimer } from "@/mobile/src/components/routine/ExerciseTimer";
import { StreakCard } from "@/mobile/src/components/routine/StreakCard";
import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { Screen } from "@/mobile/src/components/ui/Screen";
import { Text } from "@/mobile/src/components/ui/Text";
import { FREEZE_TABLE, freezeStoreError, freezesFromRows, recentDays } from "@/mobile/src/features/routine/forgivingView";
import { useSession } from "@/mobile/src/features/session/SessionProvider";
import { scoped } from "@/mobile/src/lib/i18n";
import { getSupabase } from "@/mobile/src/lib/supabase";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("routine");
const tv = scoped("routine.v2");
/** Affedici seri sayıları (ÖNERİ; env ile değişir, placeholder notu görünür). */
const FORGIVING = { ...getRoutineForgiving(process.env), placeholder: ROUTINE_FORGIVING.placeholder };
/** Dinlenme köprüsü olayı günde bir kez (yüksüz). */
const restTracked = new Set<string>();
type Item = { id: string; kind: "step" | "exercise" | "habit"; ref_id: string | null; slot: "morning" | "evening" | "daily" | "weekly"; title: string; position: number };
const SLOTS = ["morning", "daily", "evening", "weekly"] as const;
type Status = { premium: boolean };

/**
 * /rutin (F12 mobil → Faz 6 affedici seri, CONTRACTS_V2 S3.3.2/S3.6): premium; bugünün listesi, routine_logs upsert (iyimser),
 * affedici seri (dinlenme günü köprüsü + aylık dondurma; routine_freezes RLS, tablo yoksa dondurma gizli), zamanlayıcı, düzenleme.
 */
export default function RoutineTab() {
  const { colors } = useTheme();
  const { api, user } = useSession();
  const today = istanbulDate();
  const [premium, setPremium] = useState<boolean | null>(null);
  const [eligible, setEligible] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [logs, setLogs] = useState<DayLog[]>([]);
  const [freezes, setFreezes] = useState<{ available: boolean; records: FreezeRecord[] }>({ available: true, records: [] });
  const [freezing, setFreezing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const [st, prof, i, l, f] = await Promise.all([
      api.get<Status>("/api/billing/status").catch(() => null),
      user ? supabase.from("profiles").select("questionnaire").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("routine_items").select("id, kind, ref_id, slot, title, position").eq("active", true).order("position"),
      supabase.from("routine_logs").select("log_date, item_id, done").gte("log_date", since),
      supabase.from(FREEZE_TABLE).select("freeze_date").gte("freeze_date", since),
    ]);
    // Dondurma tablosu yoksa (migration 0015 uygulanmamış) bölüm gizlenir; seri yine affedici hesaplanır.
    setFreezes(f.error ? { available: freezeStoreError(f.error) !== "unavailable", records: [] } : { available: true, records: freezesFromRows(f.data) });
    setPremium(Boolean(st?.premium));
    const q = QuestionnaireSchema.safeParse(prof.data?.questionnaire);
    setEligible(q.success ? exerciseEligible(q.data) : false);
    setItems((i.data ?? []) as Item[]);
    setLogs((l.data ?? []) as DayLog[]);
  }, [api, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const dailyIds = useMemo(() => (items ?? []).filter((i) => i.slot !== "weekly").map((i) => i.id), [items]);
  const forgiving = useMemo(() => ({ logs, activeItemCount: dailyIds.length, today, freezes: freezes.records, config: FORGIVING }), [logs, dailyIds.length, today, freezes.records]);
  const streak = useMemo(() => computeForgivingStreak(forgiving), [forgiving]);
  const restLeft = useMemo(() => restDaysLeftThisWeek(forgiving), [forgiving]);
  const days = useMemo(() => recentDays({ ...forgiving, days: 7 }), [forgiving]);
  const freezeCheck = useMemo(() => canUseFreeze(freezes.records, today, today, FORGIVING), [freezes.records, today]);
  const ratio = useMemo(() => completionRatio(logs, dailyIds, today), [logs, dailyIds, today]);
  useEffect(() => {
    if (streak.restDaysBridged > 0 && !restTracked.has(today)) {
      restTracked.add(today);
      track("routine_rest_day");
    }
  }, [streak.restDaysBridged, today]);
  const doneToday = (id: string) => logs.some((l) => l.log_date === today && l.item_id === id && l.done);

  async function toggle(item: Item) {
    if (!user) return;
    const next = !doneToday(item.id);
    setLogs((prev) => [...prev.filter((l) => !(l.log_date === today && l.item_id === item.id)), { log_date: today, item_id: item.id, done: next }]);
    const { error } = await getSupabase().from("routine_logs").upsert({ user_id: user.id, item_id: item.id, log_date: today, done: next }, { onConflict: "user_id,item_id,log_date" });
    if (error) {
      Alert.alert(t("saveError"));
      void load();
      return;
    }
    if (next) track("routine_checked", { kind: item.kind });
  }
  async function freezeToday() {
    if (!user || !freezeCheck.ok) return;
    setFreezing(true);
    const { error } = await getSupabase().from(FREEZE_TABLE).insert({ user_id: user.id, freeze_date: today });
    setFreezing(false);
    if (error) {
      const reason = freezeStoreError(error);
      if (reason === "unavailable") setFreezes((f) => ({ ...f, available: false }));
      else Alert.alert(reason === "unknown" ? t("saveError") : tv(`errors.${reason}`));
      return;
    }
    track("routine_freeze_used");
    setFreezes((f) => ({ ...f, records: [...f.records, { date: today }] }));
  }
  async function remove(item: Item) {
    setItems((prev) => (prev ?? []).filter((i) => i.id !== item.id));
    await getSupabase().from("routine_items").update({ active: false }).eq("id", item.id);
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
    const supabase = getSupabase();
    await Promise.all(renumbered.map((i) => supabase.from("routine_items").update({ position: i.position }).eq("id", i.id)));
  }
  async function add(kind: Item["kind"], refId: string, slot: Item["slot"], title: string) {
    if (!user) return;
    const position = items?.length ?? 0;
    const { data, error } = await getSupabase().from("routine_items").insert({ user_id: user.id, kind, ref_id: refId, slot, title, position }).select("id, kind, ref_id, slot, title, position").single();
    if (error || !data) {
      Alert.alert(t("saveError"));
      return;
    }
    setItems((prev) => [...(prev ?? []), data as Item]);
    setAdding(false);
  }

  if (premium === null || items === null) return <Screen><Text variant="muted">{t("loading")}</Text></Screen>;
  if (!premium) {
    return (
      <Screen>
        <Card title={t("lockedTitle")} description={t("lockedBody")}>
          <Button title={t("goPremium")} onPress={() => router.push("/premium")} />
        </Card>
      </Screen>
    );
  }

  const addList = (title: string, entries: { key: string; label: string; onAdd: () => void }[]) => (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ fontWeight: "600" }}>{title}</Text>
      {entries.map((e) => (
        <Pressable key={e.key} accessibilityRole="button" onPress={e.onAdd} style={{ padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
          <Text>{e.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Screen>
      {items.length === 0 ? (
        <Card title={t("emptyTitle")} description={t("emptyBody")}>
          <Button title={t("fromPlan")} onPress={() => router.push("/(tabs)/plan")} />
          <Button title={t("addManual")} variant="outline" onPress={() => setAdding(true)} />
        </Card>
      ) : (
        <>
          <StreakCard
            dateLabel={new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long" })}
            pct={Math.round(ratio * 100)}
            doneCount={dailyIds.filter((id) => doneToday(id)).length}
            total={dailyIds.length}
            streak={streak}
            restLeft={restLeft}
            config={FORGIVING}
            days={days}
            freeze={{ available: freezes.available, check: freezeCheck, busy: freezing, onFreeze: () => void freezeToday() }}
          />
          {SLOTS.map((slot) => {
            const list = items.filter((i) => i.slot === slot);
            if (!list.length) return null;
            return (
              <Card key={slot} title={t(`slots.${slot}`)}>
                {list.map((item) => {
                  const ex = item.kind === "exercise" ? EXERCISES.find((e) => e.id === item.ref_id) : undefined;
                  const done = doneToday(item.id);
                  return (
                    <View key={item.id} style={{ gap: spacing.xs, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={item.title} onPress={() => void toggle(item)} hitSlop={8}>
                          <Ionicons name={done ? "checkbox" : "square-outline"} size={24} color={colors.foreground} />
                        </Pressable>
                        <View style={{ flex: 1 }}>
                          <Text style={done ? { textDecorationLine: "line-through", color: colors.mutedForeground } : undefined}>{item.title}</Text>
                          {ex ? <Text variant="small">{ex.doseTr}</Text> : null}
                        </View>
                        {editing ? (
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            <Pressable accessibilityRole="button" accessibilityLabel={t("moveUp")} onPress={() => void move(item, -1)} hitSlop={6}><Ionicons name="arrow-up" size={20} color={colors.foreground} /></Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t("moveDown")} onPress={() => void move(item, 1)} hitSlop={6}><Ionicons name="arrow-down" size={20} color={colors.foreground} /></Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel={t("remove")} onPress={() => void remove(item)} hitSlop={6}><Ionicons name="trash-outline" size={20} color={colors.destructive} /></Pressable>
                          </View>
                        ) : null}
                      </View>
                      {ex && !done ? (
                        <View style={{ gap: spacing.xs, paddingLeft: 32 }}>
                          <ExerciseTimer exercise={ex} onComplete={() => void toggle(item)} />
                          <Text variant="small">{EXERCISE_SAFETY_TEXT}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            );
          })}
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button title={editing ? t("done") : t("edit")} variant="outline" style={{ flex: 1 }} onPress={() => setEditing((e) => !e)} />
            <Button title={t("addManual")} variant="outline" style={{ flex: 1 }} onPress={() => setAdding(true)} />
          </View>
        </>
      )}

      <Modal visible={adding} animationType="slide" onRequestClose={() => setAdding(false)}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.md, backgroundColor: colors.background, flexGrow: 1 }}>
          <Text variant="heading" accessibilityRole="header">{t("addTitle")}</Text>
          {addList(t("slots.morning"), SKIN_STEPS.filter((s) => s.slot === "morning").map((s) => ({ key: s.id, label: s.nameTr, onAdd: () => void add("step", s.id, "morning", s.nameTr) })))}
          {addList(t("slots.evening"), SKIN_STEPS.filter((s) => s.slot === "evening").map((s) => ({ key: s.id, label: s.nameTr, onAdd: () => void add("step", s.id, "evening", s.nameTr) })))}
          {addList(t("slots.weekly"), SKIN_STEPS.filter((s) => s.slot === "weekly").map((s) => ({ key: s.id, label: s.nameTr, onAdd: () => void add("step", s.id, "weekly", s.nameTr) })))}
          {addList(t("habits"), HABITS.map((h) => ({ key: h.id, label: `${h.nameTr}: ${h.defaultTargetTr}`, onAdd: () => void add("habit", h.id, h.slot, `${h.nameTr}: ${h.defaultTargetTr}`) })))}
          {eligible ? addList(t("exercises"), EXERCISES.map((e) => ({ key: e.id, label: `${e.nameTr} (${e.doseTr})`, onAdd: () => void add("exercise", e.id, e.slot, e.nameTr) }))) : <Text variant="small">{t("exercisesNotEligible")}</Text>}
          <Button title={t("done")} variant="outline" onPress={() => setAdding(false)} />
        </ScrollView>
      </Modal>
    </Screen>
  );
}
