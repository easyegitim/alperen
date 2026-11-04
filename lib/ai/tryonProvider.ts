import "server-only";

import { fal } from "@fal-ai/client";
import { GoogleGenAI } from "@google/genai";
import type { Preset } from "@/content/types";
import { ApiError } from "@/lib/api/errors";
import { getTryonConfig } from "@/lib/config/tryon";
import type { TryonMode, TryonPresets } from "@/lib/tryon/types";
import { aiErrorSummary, withTransientRetry } from "./retry";

// SPEC 10.7 / 14.3: Gemini görsel varsayılan; TRYON_PROVIDER=fal ile maskeli inpainting (aynı arayüz).
// Model: getTryonConfig().imageModel (TRYON_IMAGE_MODEL > GEMINI_IMAGE_MODEL > varsayılan; KB §11.6 sağlayıcı AÇIK, yarış yok).
// Görsel yalnız çağrı süresince bellekte; loglanmaz, yazılmaz.

export type TryonRequest = {
  imageBase64: string;
  maskBase64?: string;
  prompt: string;
  /** v1 tek stil (scripts/compare-tryon.ts, eski çağrı). */
  preset?: Preset;
  /** v2: mod ve parçalar (yalnız bilgi; istem prompt alanında hazır gelir). */
  mode?: TryonMode;
  presets?: TryonPresets;
};
export type TryonResult = { imageBase64: string; mimeType: string };

export interface TryonProvider {
  readonly model: string;
  generateTryOn(req: TryonRequest): Promise<TryonResult>;
}

const TIMEOUT_MS = 50_000;

export class GeminiTryonProvider implements TryonProvider {
  readonly model = getTryonConfig().imageModel;

  async generateTryOn(req: TryonRequest): Promise<TryonResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ApiError("AI_FAILED", "Deneme servisi yapılandırılmamış.");
    const ai = new GoogleGenAI({ apiKey });
    try {
      // 503 yoğunlukta bir tekrar; kota (429 "limit: 0" = görsel modeli faturasız projede kapalı) tekrar edilmez, loglanır.
      const res = await withTransientRetry(
        () =>
          ai.models.generateContent({
            model: this.model,
            contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: req.imageBase64 } }, { text: req.prompt }] }],
            config: { responseModalities: ["IMAGE"], httpOptions: { timeout: TIMEOUT_MS } },
          }),
        { retries: 1, baseDelayMs: 2_000, onRetry: (attempt, e) => console.warn(`[ai] deneme ${this.model} geçici hata, tekrar ${attempt}: ${aiErrorSummary(e)}`) },
      );
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p) => p.inlineData?.data);
      if (!img?.inlineData?.data) throw new ApiError("AI_SAFETY_BLOCKED", "Model görsel üretmedi.");
      return { imageBase64: img.inlineData.data, mimeType: img.inlineData.mimeType || "image/png" };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if (e instanceof Error && /abort|timeout/i.test(e.message)) throw new ApiError("AI_TIMEOUT", "Deneme zaman aşımına uğradı.");
      const summary = aiErrorSummary(e);
      console.warn(`[ai] deneme ${this.model} hata: ${summary}`);
      if (/free_tier|limit: 0/.test(e instanceof Error ? e.message : "")) {
        throw new ApiError("AI_FAILED", "Görsel modeli bu Gemini projesinde kapalı (ücretsiz katman); Google Cloud'da faturalandırmayı aç.");
      }
      throw new ApiError("AI_FAILED", "Deneme servisi yanıt vermedi.");
    }
  }
}

/**
 * fal.ai maskeli inpainting (FLUX fill). Giriş alanları (image_url, mask_url, prompt) fal'ın fill uç noktaları için
 * yaygın biçimdir; Faz 10 karşılaştırmasında (scripts/compare-tryon.ts) teyit edilir (AÇIK). Maske istemcide
 * segmenter saç sınıfından genişletilerek üretilir (SPEC 10.7); gelmezse Gemini yoluna düşülür.
 */
export class FalTryonProvider implements TryonProvider {
  readonly model = process.env.FAL_TRYON_MODEL || "fal-ai/flux-pro/v1/fill";

  async generateTryOn(req: TryonRequest): Promise<TryonResult> {
    const key = process.env.FAL_KEY;
    if (!key) throw new ApiError("AI_FAILED", "fal.ai yapılandırılmamış.");
    if (!req.maskBase64) return new GeminiTryonProvider().generateTryOn(req);
    fal.config({ credentials: key });
    try {
      const result = await fal.subscribe(this.model, {
        input: {
          image_url: `data:image/jpeg;base64,${req.imageBase64}`,
          mask_url: `data:image/png;base64,${req.maskBase64}`,
          prompt: req.prompt,
        },
        logs: false,
      });
      const data = result.data as { images?: Array<{ url?: string; content_type?: string }> };
      const url = data.images?.[0]?.url;
      if (!url) throw new ApiError("AI_FAILED", "fal.ai görsel döndürmedi.");
      if (url.startsWith("data:")) {
        const [head, b64] = url.split(",", 2);
        return { imageBase64: b64, mimeType: head.slice(5, head.indexOf(";")) || "image/png" };
      }
      const r = await fetch(url);
      if (!r.ok) throw new ApiError("AI_FAILED", "fal.ai görseli indirilemedi.");
      const buf = Buffer.from(await r.arrayBuffer());
      return { imageBase64: buf.toString("base64"), mimeType: r.headers.get("content-type") || data.images?.[0]?.content_type || "image/png" };
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError("AI_FAILED", "fal.ai yanıt vermedi.");
    }
  }
}

export function getTryonProvider(): TryonProvider {
  return (process.env.TRYON_PROVIDER || "gemini") === "fal" ? new FalTryonProvider() : new GeminiTryonProvider();
}
