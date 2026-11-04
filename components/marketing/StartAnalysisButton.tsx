"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { AGE_GATE_PATH } from "@/lib/onboarding/gate";

/** Açılıştan sonra gidilecek ilk ekran (KB §3.1: yaş → cinsiyet → hesap). */
export const ONBOARDING_START_PATH = AGE_GATE_PATH;

type Props = Omit<ComponentProps<typeof Button>, "onClick" | "children"> & { label?: string };

/**
 * "Analizini başlat": v2'de anonim oturum yok (KB P#2). Hesap, yaş ve cinsiyet seçiminden sonra Google/Apple ile açılır;
 * bu düğme yalnız akışın ilk ekranına götürür (Turnstile anonim oturum için gerekiyordu, kalktı).
 */
export function StartAnalysisButton({ label, ...buttonProps }: Props) {
  const t = useTranslations();
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();

  function handleClick() {
    track("landing_cta_clicked");
    startNavigation(() => router.push(ONBOARDING_START_PATH));
  }

  return (
    <Button {...buttonProps} onClick={handleClick} disabled={navigating || buttonProps.disabled}>
      {label ?? t("common.startAnalysis")}
    </Button>
  );
}
