import { View } from "react-native";
import { SUB_KIND_HYBRID } from "@/lib/config/scoring";
import type { SubKey } from "@/lib/config/teaser";
import type { ExplanationV2 } from "@/lib/score/contract";
import { Card } from "@/mobile/src/components/ui/Card";
import { Text } from "@/mobile/src/components/ui/Text";
import { fmt1, formatRange } from "@/mobile/src/features/analysis/format";
import type { SubRowV2 } from "@/mobile/src/features/analysis/subs";
import { scoped } from "@/mobile/src/lib/i18n";
import { radius, spacing, useTheme } from "@/mobile/src/theme";

const t = scoped("analysis");
const tr = scoped("analysis.result");
const te = scoped("analysis.explain5");

function Line({ label, items }: { label: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</Text>
      {items.map((s, i) => (
        <Text key={i} style={{ fontSize: 13, lineHeight: 19 }}>• {s}</Text>
      ))}
    </View>
  );
}

/** KB §4.9 beş satır: neye baktık · ne tuttu · ne aşağı çekti · ne yapılırsa artar · güven notu; varsayılan açık, rozet yok. */
function Explanation({ k, e }: { k: SubKey; e: ExplanationV2 }) {
  const { colors } = useTheme();
  const structural = SUB_KIND_HYBRID[k] === "structural";
  return (
    <View style={{ gap: spacing.sm, backgroundColor: colors.muted, borderRadius: radius.lg, padding: spacing.sm, marginTop: spacing.xs }}>
      <Line label={te("lookedAt")} items={e.lookedAt} />
      <Line label={te("held")} items={e.held} />
      <Line label={te("lowered")} items={e.lowered} />
      {e.raise.length ? (
        <View style={{ gap: 4 }}>
          <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{te("raise")}</Text>
          {e.raise.map((r, i) => (
            <View key={i} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: "500" }}>{r.step}</Text>
              <Text variant="small">{r.effect}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {structural ? <Text variant="small">{tr("structuralNote")}</Text> : null}
      <View>
        <Text variant="small" style={{ fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.6 }}>{te("confidenceNote")}</Text>
        <Text variant="small">{e.confidenceNote}</Text>
      </View>
    </View>
  );
}

function Row({ row, explanationsReady }: { row: SubRowV2; explanationsReady: boolean }) {
  const { colors } = useTheme();
  const name = t(`sub.${row.k}`);
  const range = row.score ? formatRange(row.score.range) : null;
  return (
    <View style={{ gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm }}>
        <Text style={{ fontWeight: "600", flex: 1 }}>{name}</Text>
        {row.notAssessed ? (
          <Text variant="small">{t("notAssessed.value")}</Text>
        ) : row.score && range ? (
          <View style={{ alignItems: "flex-end" }} accessible accessibilityLabel={tr("subscoreAria", { name, value: fmt1(row.score.value), lo: range.lo, hi: range.hi })}>
            <Text style={{ fontWeight: "700", fontSize: 18 }}>{fmt1(row.score.value)}</Text>
            <Text variant="small">{tr("subscoreRange", { lo: range.lo, hi: range.hi })}</Text>
          </View>
        ) : (
          <Text variant="small">{tr("notReady")}</Text>
        )}
      </View>
      {row.notAssessed ? (
        <Text variant="small">{t(`notAssessed.${row.notAssessed}`)}</Text>
      ) : (
        <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.track }} accessible={false}>
          {row.score ? <View style={{ width: `${row.score.value * 10}%`, height: 8, borderRadius: 4, backgroundColor: colors.brand }} /> : null}
        </View>
      )}
      {!row.notAssessed && row.score ? row.explanation ? <Explanation k={row.k} e={row.explanation} /> : <Text variant="small">{explanationsReady ? tr("missing") : tr("notReady")}</Text> : null}
    </View>
  );
}

/** 7 alt skor (Kaşlar dahil), rozetsiz; her satırın altında 5 satırlık açıklama varsayılan açık (KB §4.9, P#10). */
export function SubscoresCard({ rows, explanationsReady, viewsUsed }: { rows: SubRowV2[]; explanationsReady: boolean; viewsUsed: number }) {
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text variant="heading" accessibilityRole="header">{t("subscoresTitle")}</Text>
        {viewsUsed > 0 ? <Text variant="small">{tr("viewsUsed", { n: viewsUsed })}</Text> : null}
      </View>
      <View>
        {rows.map((row) => (
          <Row key={row.k} row={row} explanationsReady={explanationsReady} />
        ))}
      </View>
    </Card>
  );
}
