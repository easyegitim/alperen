"use client";

import { ArrowDown, FileText, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, type UIEvent } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/legal/Markdown";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { track } from "@/lib/analytics";
import { ApiClientError, postJson } from "@/lib/api/client";
import { GENDER_PATH } from "@/lib/onboarding/gate";
import { cn } from "@/lib/utils";
import { OPTIONAL_ONBOARDING_CONSENTS, REQUIRED_ANALYSIS_CONSENTS, type ConsentState, type ConsentType } from "@/lib/consent";

type Props = {
  notice: { title: string; version: string; updatedAt: string; body: string };
  consentVersion: string;
  initial: ConsentState;
  noticeAcked: boolean;
  nextPath: string;
  /** Çekim ekranı sıradaysa MediaPipe modeli arka planda yüklenir (SPEC 7.1). */
  prefetchModel?: boolean;
};

type Toggles = Record<(typeof REQUIRED_ANALYSIS_CONSENTS)[number] | (typeof OPTIONAL_ONBOARDING_CONSENTS)[number], boolean>;

/** SPEC 4.1 adım 4 / 16.2: aydınlatma (kaydırmalı, "Okudum") → zorunlu üç rıza + pazarlama (isteğe bağlı). */
export function ConsentFlow({ notice, consentVersion, initial, noticeAcked, nextPath, prefetchModel = false }: Props) {
  const t = useTranslations("onboarding.consents");
  const router = useRouter();
  const [step, setStep] = useState<"notice" | "consents">(noticeAcked ? "consents" : "notice");
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [toggles, setToggles] = useState<Toggles>(() => {
    const init = {} as Toggles;
    for (const k of [...REQUIRED_ANALYSIS_CONSENTS, ...OPTIONAL_ONBOARDING_CONSENTS]) {
      const c = initial[k];
      init[k] = Boolean(c?.granted && c.textVersion === consentVersion);
    }
    return init;
  });

  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setScrolledToEnd(true);
  }
  function onBoxMount(el: HTMLDivElement | null) {
    boxRef.current = el;
    if (el && el.scrollHeight <= el.clientHeight + 24) setScrolledToEnd(true);
  }

  async function post(type: ConsentType, granted: boolean, textVersion: string) {
    await postJson("/api/consents", { type, granted, textVersion });
    track("consent_updated", { type, granted });
  }

  async function ackNotice() {
    setBusy(true);
    try {
      await post("kvkk_notice_ack", true, notice.version);
      setStep("consents");
    } catch {
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  const allRequired = REQUIRED_ANALYSIS_CONSENTS.every((k) => toggles[k]);

  async function saveConsents() {
    setBusy(true);
    try {
      for (const k of [...REQUIRED_ANALYSIS_CONSENTS, ...OPTIONAL_ONBOARDING_CONSENTS]) {
        const prev = initial[k];
        const unchanged = prev && prev.granted === toggles[k] && prev.textVersion === consentVersion;
        if (!unchanged && (toggles[k] || prev)) await post(k, toggles[k], consentVersion);
      }
      // v2: anket ödeme sonrasına taşındı; onboarding burada biter (sunucu 18+, rızalar ve cinsiyeti yeniden doğrular).
      await postJson("/api/onboarding/complete", {});
      track("onboarding_step_completed", { step: "consents" });
      router.push(nextPath);
    } catch (e) {
      if (e instanceof ApiClientError && e.message === "presentation_missing") {
        router.push(GENDER_PATH);
        return;
      }
      toast.error(t("error"));
    } finally {
      setBusy(false);
    }
  }

  if (step === "notice") {
    return (
      <div className="space-y-5">
        <StepHeading icon={<FileText className="size-6" />} title={notice.title} body={t("noticeMeta", { version: notice.version, date: notice.updatedAt })} />
        <div
          ref={onBoxMount}
          onScroll={onScroll}
          className="max-h-[50dvh] overflow-y-auto rounded-2xl border bg-card p-4 shadow-card"
          tabIndex={0}
        >
          <Markdown>{notice.body}</Markdown>
        </div>
        {!scrolledToEnd ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowDown className="size-3.5 text-brand motion-safe:animate-bounce" aria-hidden="true" />
            {t("scrollHint")}
          </p>
        ) : null}
        <Button className="w-full" size="lg" disabled={!scrolledToEnd || busy} onClick={ackNotice}>
          {t("read")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {prefetchModel ? (
        <>
          <link rel="prefetch" href="/mediapipe/face_landmarker.task" as="fetch" crossOrigin="anonymous" />
          <link rel="prefetch" href="/mediapipe/wasm/vision_wasm_module_internal.wasm" as="fetch" crossOrigin="anonymous" />
        </>
      ) : null}
      <StepHeading icon={<ShieldCheck className="size-6" />} title={t("title")} body={t("description")} />
      <ul className="space-y-2">
        {[...REQUIRED_ANALYSIS_CONSENTS, ...OPTIONAL_ONBOARDING_CONSENTS].map((k) => {
          const required = (REQUIRED_ANALYSIS_CONSENTS as readonly string[]).includes(k);
          return (
            <li
              key={k}
              className={cn(
                "flex items-start justify-between gap-3 rounded-2xl border bg-card p-4 shadow-card transition-colors",
                toggles[k] && "border-brand/40",
              )}
            >
              <label htmlFor={`consent-${k}`} className="space-y-1.5">
                <span className="block text-[15px] font-semibold">{t(`items.${k}.title`)}</span>
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold",
                    required ? "bg-brand-soft text-brand" : "bg-muted text-muted-foreground",
                  )}
                >
                  {required ? t("required") : t("optional")}
                </span>
                <span className="block text-[13px] leading-relaxed text-muted-foreground">{t(`items.${k}.body`)}</span>
              </label>
              <Switch id={`consent-${k}`} className="mt-0.5" checked={toggles[k]} onCheckedChange={(v) => setToggles((s) => ({ ...s, [k]: v }))} />
            </li>
          );
        })}
      </ul>
      {!allRequired ? (
        <p role="status" className="rounded-2xl border border-dashed p-4 text-xs leading-relaxed text-muted-foreground">
          {t("missingRequired")}
        </p>
      ) : null}
      <Button className="w-full" size="lg" disabled={!allRequired || busy} onClick={saveConsents}>
        {t("continue")}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("revokeNote")}</p>
    </div>
  );
}

function StepHeading({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="space-y-4">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand" aria-hidden="true">
        {icon}
      </span>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
