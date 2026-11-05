// Ödeme öncesi akışta hesap açılmadan ÖNCE seçilen yaş bandı ve cinsiyet (KB §3.1: yaş → cinsiyet → hesap).
// Oturum yokken profil satırı da yoktur; seçimler yalnız bu sekmenin sessionStorage'ında durur ve girişten sonra
// /api/onboarding/{age,profile} ile sunucuya yazılıp silinir. Fotoğraf, skor veya kişisel kimlik taşımaz.
import { isAgeBand, type AgeBand } from "./age";
import { PRESENTATIONS } from "@/lib/questionnaire";

export type Presentation = (typeof PRESENTATIONS)[number];
export type OnboardingDraft = { ageBand?: AgeBand; presentation?: Presentation };

export const ONBOARDING_DRAFT_KEY = "aura.onboarding.draft.v2";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // depolama kapalı (gizli sekme kısıtı vb.)
  }
}

/** Bilinmeyen veya bozuk değerler atılır; asla fırlatmaz. */
export function parseDraft(raw: string | null | undefined): OnboardingDraft {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return {};
    const o = v as Record<string, unknown>;
    const out: OnboardingDraft = {};
    if (isAgeBand(o.ageBand)) out.ageBand = o.ageBand;
    if (typeof o.presentation === "string" && (PRESENTATIONS as readonly string[]).includes(o.presentation)) out.presentation = o.presentation as Presentation;
    return out;
  } catch {
    return {};
  }
}

export function readDraft(s: StorageLike | null = storage()): OnboardingDraft {
  return parseDraft(s?.getItem(ONBOARDING_DRAFT_KEY));
}

export function writeDraft(patch: OnboardingDraft, s: StorageLike | null = storage()): OnboardingDraft {
  const next = { ...readDraft(s), ...patch };
  try {
    s?.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(next));
  } catch {
    // depolama dolu/kapalı: akış yine sürer, sunucuya giriş sonrası yazılamazsa sayfa yeniden sorar
  }
  return next;
}

export function clearDraft(s: StorageLike | null = storage()): void {
  try {
    s?.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    // yok say
  }
}
