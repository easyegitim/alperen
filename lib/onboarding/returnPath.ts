import { z } from "zod";

// Anketten dönüş yolu (UI spec §7, F09). Açık yönlendirme olmaması için yalnız /plan/<uuid> kabul edilir.
const PLAN_PATH = /^\/plan\/([^/?#]+)$/;

export function safeReturnPath(next: unknown): string | null {
  if (typeof next !== "string") return null;
  const m = PLAN_PATH.exec(next);
  if (!m || !z.uuid().safeParse(m[1]).success) return null;
  return next;
}
