import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { titleKey: "analysis" | "plan" | "tryon" | "routine" | "progress" | "onboarding" | "capture"; phase: number; feature: string };

/** Sonraki fazlarda dolacak ekranlar için iskelet içerik. */
export async function PhasePlaceholder({ titleKey, phase, feature }: Props) {
  const t = await getTranslations("placeholders");
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>{t(`${titleKey}.title`)}</CardTitle>
          <CardDescription>{t(`${titleKey}.body`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("comingSoon", { phase, feature })}</p>
        </CardContent>
      </Card>
    </div>
  );
}
