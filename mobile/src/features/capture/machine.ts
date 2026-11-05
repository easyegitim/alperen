// Canlı kalite döngüsünün saf durum makinesi (SPEC 7.2: 600 ms kararlı → 3-2-1 → çekim). Birim testli.
import { QUALITY_CONFIG } from "@/lib/face/quality";

export type LiveState = { stage: "live" | "countdown"; stableSince: number | null; countdownEnd: number | null };

export const initialLive: LiveState = { stage: "live", stableSince: null, countdownEnd: null };

export type LiveStep = { state: LiveState; countdown: number; capture: boolean };

/** Her değerlendirilen karede çağrılır. passed: kalite raporu geçti mi. */
export function stepLive(prev: LiveState, passed: boolean, now: number, cfg = QUALITY_CONFIG): LiveStep {
  if (!passed) return { state: initialLive, countdown: 0, capture: false };
  const stableSince = prev.stableSince ?? now;
  if (prev.stage === "live") {
    if (now - stableSince >= cfg.stableMs) {
      const countdownEnd = now + cfg.countdownSeconds * 1000;
      return { state: { stage: "countdown", stableSince, countdownEnd }, countdown: cfg.countdownSeconds, capture: false };
    }
    return { state: { stage: "live", stableSince, countdownEnd: null }, countdown: 0, capture: false };
  }
  const end = prev.countdownEnd ?? now;
  const remaining = Math.max(0, Math.ceil((end - now) / 1000));
  if (now >= end) return { state: initialLive, countdown: 0, capture: true };
  return { state: { stage: "countdown", stableSince, countdownEnd: end }, countdown: remaining, capture: false };
}

/** Canlı döngüde en fazla maxFps kare işlenir. */
export function shouldProcess(lastRun: number, now: number, cfg = QUALITY_CONFIG): boolean {
  return now - lastRun >= 1000 / cfg.maxFps;
}
