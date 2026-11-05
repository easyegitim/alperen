"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import type { MethodFrom } from "@/lib/config/method";

/** /yontem görüntülenmesi (method_viewed). Yalnız kaynak sayfa kodu gönderilir; kullanıcı verisi yok. */
export function MethodViewTracker({ from }: { from: MethodFrom }) {
  useEffect(() => {
    track("method_viewed", { from });
  }, [from]);
  return null;
}
