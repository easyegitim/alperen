// Ödeme öncesi akışta hesap açılmadan ÖNCE seçilen yaş bandı ve cinsiyet (KB §3.1: yaş → cinsiyet → hesap).
// Web karşılığı lib/onboarding/draft.ts (sessionStorage); mobilde AsyncStorage + bellek. Girişten sonra
// /api/onboarding/{age,profile} ile sunucuya yazılır ve silinir. Fotoğraf, skor veya kişisel kimlik taşımaz.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AgeBand } from "@/lib/onboarding/age";
import { ONBOARDING_DRAFT_KEY, parseDraft, type OnboardingDraft, type Presentation } from "@/lib/onboarding/draft";

export type { OnboardingDraft, Presentation };

let cached: OnboardingDraft | null = null;

export async function readOnboardingDraft(): Promise<OnboardingDraft> {
  if (cached) return cached;
  cached = parseDraft(await AsyncStorage.getItem(ONBOARDING_DRAFT_KEY).catch(() => null));
  return cached;
}

export async function writeOnboardingDraft(patch: OnboardingDraft): Promise<OnboardingDraft> {
  const next = { ...(await readOnboardingDraft()), ...patch };
  cached = next;
  await AsyncStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(next)).catch(() => undefined);
  return next;
}

export async function clearOnboardingDraft(): Promise<void> {
  cached = {};
  await AsyncStorage.removeItem(ONBOARDING_DRAFT_KEY).catch(() => undefined);
}

/** Sunucudaki profil satırının giriş sonrası karar için gereken kısmı (profiles RLS ile okunur). */
export type ServerChoices = { hasAgeBand: boolean; hasPresentation: boolean };

export type FlushPlan = { kind: "missing" } | { kind: "calls"; ageBand: AgeBand | null; presentation: Presentation | null };

/**
 * Giriş sonrası taslak → sunucu planı (web SignIn.flush ile aynı kural): bir seçim ne taslakta ne sunucuda varsa
 * "missing" (başa dön); aksi hâlde yalnız sunucuda olmayanlar yazılır. Saf; birim testli.
 */
export function planFlush(draft: OnboardingDraft, server: ServerChoices): FlushPlan {
  const ageBand = draft.ageBand ?? null;
  const presentation = draft.presentation ?? null;
  if ((!ageBand && !server.hasAgeBand) || (!presentation && !server.hasPresentation)) return { kind: "missing" };
  return { kind: "calls", ageBand: server.hasAgeBand ? null : ageBand, presentation: server.hasPresentation ? null : presentation };
}

/** Taslağı sunucuya yazar (yalnız eksik olanlar); başarıda taslak silinir. Çağıran hata yakalar. */
export async function flushOnboardingDraft(
  api: { age: (b: AgeBand) => Promise<unknown>; profile: (p: Presentation) => Promise<unknown> },
  draft: OnboardingDraft,
  server: ServerChoices,
): Promise<FlushPlan> {
  const plan = planFlush(draft, server);
  if (plan.kind === "missing") return plan;
  if (plan.ageBand) await api.age(plan.ageBand);
  if (plan.presentation) await api.profile(plan.presentation);
  await clearOnboardingDraft();
  return plan;
}

/** Yaş bandı kararı (web AgeGate ile aynı): under_18 bayrak kapalıyken "yakında"; sunucu isAdult=false dönerse de "yakında". */
export function ageBandOutcome(band: AgeBand, under18Enabled: boolean, serverIsAdult?: boolean | null): "soon" | "continue" {
  if (band === "under_18" && !under18Enabled) return "soon";
  if (serverIsAdult === false) return "soon";
  return "continue";
}
