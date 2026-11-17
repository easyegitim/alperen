import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";
import type { AnalysisStage, SectionKey } from "@/lib/score/contract";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { REVEAL_STAGGER_MS, effectiveReady, nextReveals } from "@/mobile/src/features/analysis/reveal";
import { scoped } from "@/mobile/src/lib/i18n";
import { motion, radius, spacing, useTheme } from "@/mobile/src/theme";

const tr = scoped("analysis.result");
export type RevealCard = { key: SectionKey; node: ReactNode };

/** Açılmamış kart: gerçek değer içermeyen iskelet (değer bellekte/ekranda yoktur; bulanıklık yalnız süstür). */
function PlaceholderCard({ label }: { label: string }) {
  const { colors } = useTheme();
  const bar = (w: `${number}%`) => <View style={{ height: 12, width: w, borderRadius: 6, backgroundColor: colors.track }} />;
  return (
    <Card style={{ opacity: 0.7 }}>
      <View accessible accessibilityLabel={`${label}: ${tr("notReady")}`} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="heading" style={{ color: colors.mutedForeground }}>{label}</Text>
        <Text variant="small">{tr("notReady")}</Text>
      </View>
      <View style={{ gap: spacing.sm }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {bar("66%")}
        {bar("50%")}
        <View style={{ height: 8, borderRadius: radius.full, backgroundColor: colors.track }} />
        {bar("83%")}
      </View>
    </Card>
  );
}

function FadeIn({ children, instant }: { children: ReactNode; instant: boolean }) {
  const [opacity] = useState(() => new Animated.Value(instant ? 1 : 0));
  useEffect(() => {
    if (instant) return;
    Animated.timing(opacity, { toValue: 1, duration: motion.base, useNativeDriver: true }).start();
  }, [opacity, instant]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/**
 * Kart kart açılış (KB P#23, Ç16): sunucunun sectionsReady listesi büyüdükçe kartlar REVEAL_ORDER sırasıyla açılır;
 * gerçek değerler yalnız açılan kartta çizilir. `instant`: daha önce açılmış sonuç — sıra beklenmez. Azaltılmış harekette
 * gecikme ve geçiş yok. Her açılış ekran okuyucuya duyurulur.
 */
export function RevealSequence({ stage, sectionsReady, cards, instant = false }: { stage: AnalysisStage; sectionsReady: readonly SectionKey[]; cards: RevealCard[]; instant?: boolean }) {
  const ready = effectiveReady(stage, sectionsReady);
  const readyKey = ready.join(",");
  const [revealed, setRevealed] = useState<SectionKey[]>(() => (instant ? ready : []));
  const [reduceMotion, setReduceMotion] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => active && setReduceMotion(v))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const pending = nextReveals(ready, revealed);
    if (pending.length === 0) return;
    const stagger = instant || reduceMotion ? 0 : REVEAL_STAGGER_MS;
    pending.forEach((key, i) => {
      const id = setTimeout(() => {
        setRevealed((prev) => (prev.includes(key) ? prev : [...prev, key]));
        AccessibilityInfo.announceForAccessibility(`${tr(`section.${key}`)} ${tr("announceSuffix")}`);
      }, stagger * (i + 1));
      timers.current.push(id);
    });
    return () => {
      timers.current.forEach((id) => clearTimeout(id));
      timers.current = [];
    };
    // ready listesi (string) değişince yeni kartlar sıraya girer; revealed güncellemesi zamanlayıcıdan gelir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey, instant, reduceMotion]);

  return (
    <View style={{ gap: spacing.md }}>
      {cards.map((c) => {
        const isOpen = revealed.includes(c.key);
        return (
          <View key={c.key} testID={`section-${c.key}`} accessibilityState={{ busy: !isOpen }}>
            {isOpen ? <FadeIn instant={instant || reduceMotion}>{c.node}</FadeIn> : <PlaceholderCard label={tr(`section.${c.key}`)} />}
          </View>
        );
      })}
    </View>
  );
}
