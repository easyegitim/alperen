"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { track } from "@/lib/analytics";
import { createClient } from "@/lib/db/browser";

type Props = {
  /** Google bağlantısından dönülecek site içi yol. */
  returnPath?: string;
  onLinked?: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6}$/;

/**
 * Anonim oturumu kalıcı hesaba çevirir (SPEC 2 D17, 15.2 adım 2).
 * E-posta: updateUser({ email }) → kullanıcıya kod gider → verifyOtp({ type: "email_change" }).
 * Google: linkIdentity (Supabase panelinde "manual linking" açık olmalı) → /auth/callback.
 */
export function LinkAccount({ returnPath = "/hesap", onLinked }: Props) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value)) {
      toast.error(t("invalidEmail"));
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ email: value });
      if (error) {
        toast.error(t("linkError", { message: error.message }));
        return;
      }
      setEmail(value);
      setStep("code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    const token = code.trim();
    if (!CODE_RE.test(token)) {
      toast.error(t("invalidCode"));
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({ email, token, type: "email_change" });
      if (error) {
        toast.error(t("linkError", { message: error.message }));
        return;
      }
      track("account_linked", { method: "email" });
      toast.success(t("linked"));
      onLinked?.();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function linkGoogle() {
    setBusy(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnPath)}`;
      const { error } = await supabase.auth.linkIdentity({ provider: "google", options: { redirectTo } });
      if (error) {
        toast.error(t("linkError", { message: error.message }));
        setBusy(false);
      }
      // Başarıda tarayıcı Google'a yönlenir; callback sonrası account_linked olayı /hesap'ta izlenir.
    } catch {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("linkTitle")}</CardTitle>
        <CardDescription>{t("linkDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="email">
          <TabsList className="w-full">
            <TabsTrigger value="email" className="flex-1">
              {t("methodEmail")}
            </TabsTrigger>
            <TabsTrigger value="google" className="flex-1">
              {t("methodGoogle")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="email" className="pt-4">
            {step === "email" ? (
              <form onSubmit={sendCode} className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t("emailLabel")}</span>
                  <Input
                    type="email"
                    name="email"
                    autoComplete="email"
                    inputMode="email"
                    placeholder={t("emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <Button type="submit" className="w-full" disabled={busy}>
                  {t("sendCode")}
                </Button>
              </form>
            ) : (
              <form onSubmit={verifyCode} className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("codeSentTo", { email })}</p>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">{t("codeLabel")}</span>
                  <Input
                    type="text"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder={t("codePlaceholder")}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </label>
                <Button type="submit" className="w-full" disabled={busy}>
                  {t("verify")}
                </Button>
                <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => setStep("email")}>
                  {t("changeEmail")}
                </Button>
              </form>
            )}
          </TabsContent>

          <TabsContent value="google" className="space-y-3 pt-4">
            <p className="text-sm text-muted-foreground">{t("googleHint")}</p>
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={linkGoogle}>
              {t("googleContinue")}
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
