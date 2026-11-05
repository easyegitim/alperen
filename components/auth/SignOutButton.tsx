"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/db/browser";

export function SignOutButton() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      toast.success(t("signedOut"));
      router.push("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" className="w-full" disabled={busy} onClick={signOut}>
      {t("signOut")}
    </Button>
  );
}
