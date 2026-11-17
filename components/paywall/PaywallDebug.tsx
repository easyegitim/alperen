"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PaywallProvider, usePaywall } from "./PaywallSheet";
import type { Presentation } from "./IllustrativeBeforeAfter";

function Opener({ step }: { step: "benefits" | "products" }) {
  const { open } = usePaywall();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    open("score_main");
    if (step === "products") {
      const id = window.setTimeout(() => (document.querySelector<HTMLButtonElement>("[data-paywall-see-products]")?.click()), 300);
      return () => clearTimeout(id);
    }
  }, [open, step]);
  return (
    <Button type="button" onClick={() => open("score_main")}>
      Kilidi aç
    </Button>
  );
}

/** Geliştirme önizlemesi: sheet otomatik açılır; ikinci sayfa için ilk sayfanın düğmesine basılır. */
export function PaywallDebug({ step, presentation }: { step: "benefits" | "products"; presentation: Presentation }) {
  return (
    <PaywallProvider teaserMode="shape_plus_one" analysisId="00000000-0000-4000-8000-00000000f1x1" presentation={presentation} ageBand="25_34">
      <Opener step={step} />
    </PaywallProvider>
  );
}
