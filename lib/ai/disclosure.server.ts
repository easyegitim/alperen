import "server-only";

// Kamuya açık yöntem bilgisi (UI spec S6): /yontem, kamera güven kartı ve ilerleme adımları için.
// Gizli değer okumaz ve döndürmez; yalnız motor adı, kalibrasyon sürümü ve sağlayıcı görünen adları.
import { isFeatureEnabled } from "@/lib/config/flags";
import { WEIGHTS_H1 } from "@/lib/config/engine.server";
import { getScoreEngine, getScoringEnv, type ScoreEngine } from "@/lib/config/scoring";

/** hybrid.v1 yapısal pay (%): harmony + eyes + jawline. Saç hariç satırlarda da aynıdır (yapı 0,40 kalır). */
const HYBRID_STRUCTURAL_SHARE_PCT = Math.round((WEIGHTS_H1.harmony + WEIGHTS_H1.eyes + WEIGHTS_H1.jawline) * 100);

export type PublicEngineInfo = {
  engine: ScoreEngine;
  calibrationVersion: string;
  analysisProvider: string;
  tryonProvider: string;
  /** Yapısal alanların genel skordaki payı (%). hybrid.v1'de motor ağırlıklarından; legacy'de yayımlanmaz (null). */
  structuralSharePct: number | null;
};

/** FEATURE_PROVIDER_NAMES kapalıyken (hukuki onay öncesi) her sağlayıcı adı bu nötr metinle gösterilir. */
export const NEUTRAL_PROVIDER_NAME = "yapay zekâ";

export function getPublicEngineInfo(env: Record<string, string | undefined> = process.env): PublicEngineInfo {
  const engine = getScoreEngine(env);
  const named = isFeatureEnabled("providerNames", env);
  const analysisProvider = engine === "legacy" ? "Google (Gemini)" : "Anthropic (Claude)";
  const tryonProvider = (env.TRYON_PROVIDER || "gemini") === "fal" ? "fal.ai" : "Google (Gemini)";
  return {
    engine,
    calibrationVersion: engine === "hybrid.v1" ? "h1" : engine === "hybrid.v2" ? "h2" : getScoringEnv(env).calibrationVersion,
    analysisProvider: named ? analysisProvider : NEUTRAL_PROVIDER_NAME,
    tryonProvider: named ? tryonProvider : NEUTRAL_PROVIDER_NAME,
    structuralSharePct: engine === "hybrid.v1" ? HYBRID_STRUCTURAL_SHARE_PCT : null,
  };
}
