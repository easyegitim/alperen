import { Button } from "@/mobile/src/components/ui/Button";
import { Card } from "@/mobile/src/components/ui/Card";
import { scoped } from "@/mobile/src/lib/i18n";

const t = scoped("tryon.v2.qc");

/** Kalite kontrolü geçmedi (KB §7.3 R2-C10/3, Ç10): görsel gösterilmez, hak düşmedi (metin bunu söyler). */
export function QcFailedCard({ onBack }: { onBack: () => void }) {
  return (
    <Card title={t("failedTitle")} description={t("failedBody")}>
      <Button title={t("failedRetry")} size="lg" onPress={onBack} />
    </Card>
  );
}
