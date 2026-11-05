import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { Exercise } from "@/content/exercises";
import { Button } from "@/mobile/src/components/ui/Button";
import { Text } from "@/mobile/src/components/ui/Text";
import { scoped } from "@/mobile/src/lib/i18n";
import { spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("routine.timer");

/** SPEC 9.5 / 11.1: egzersiz zamanlayıcısı veya tekrar sayacı (mobil). */
export function ExerciseTimer({ exercise, onComplete }: { exercise: Exercise; onComplete?: () => void }) {
  const { colors } = useTheme();
  const timer = exercise.timer;
  const isTimed = "seconds" in timer;
  const sets = timer.sets ?? 1;
  const [set, setSet] = useState(1);
  const [left, setLeft] = useState(isTimed ? timer.seconds : 0);
  const [reps, setReps] = useState(0);
  const [running, setRunning] = useState(false);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!running || !isTimed) return;
    ref.current = setInterval(() => {
      setLeft((v) => {
        if (v > 1) return v - 1;
        if (ref.current) clearInterval(ref.current);
        setRunning(false);
        setSet((cur) => {
          if (cur < sets) {
            setLeft(timer.seconds);
            return cur + 1;
          }
          onComplete?.();
          return cur;
        });
        return 0;
      });
    }, 1000);
    return () => {
      if (ref.current) clearInterval(ref.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- timer sabitleri bileşen ömründe değişmez
  }, [running, isTimed]);

  function reset() {
    setRunning(false);
    setSet(1);
    setReps(0);
    setLeft(isTimed ? timer.seconds : 0);
  }

  const iconBtn = (name: "play" | "pause" | "refresh", label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={{ padding: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}>
      <Ionicons name={name} size={18} color={colors.foreground} />
    </Pressable>
  );

  if (isTimed) {
    const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Text variant="heading">{mm}:{ss}</Text>
        {sets > 1 ? <Text variant="small">{t("set", { n: set, total: sets })}</Text> : null}
        {iconBtn(running ? "pause" : "play", running ? t("pause") : t("start"), () => setRunning((r) => !r))}
        {iconBtn("refresh", t("reset"), reset)}
      </View>
    );
  }
  const target = timer.reps;
  const hold = "holdSeconds" in timer ? timer.holdSeconds : undefined;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
      <Text variant="heading">{reps}/{target}</Text>
      {sets > 1 ? <Text variant="small">{t("set", { n: set, total: sets })}</Text> : null}
      {hold ? <Text variant="small">{t("hold", { s: hold })}</Text> : null}
      <Button
        title={t("rep")}
        variant="outline"
        onPress={() => {
          const next = reps + 1;
          if (next >= target) {
            if (set < sets) {
              setSet(set + 1);
              setReps(0);
            } else {
              setReps(target);
              onComplete?.();
            }
          } else setReps(next);
        }}
      />
      {iconBtn("refresh", t("reset"), reset)}
    </View>
  );
}
