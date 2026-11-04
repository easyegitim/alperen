import "server-only";

import type { AuditProvider, AuditResult } from "@/lib/ai/audit";
import { scanTextV2, type SafetyRule, type Violation } from "@/lib/ai/safety";

// Denetim geçişi (PLAN_V2 3f; KB §4.1): (1) ikinci Claude çağrısı takılan cümleleri yeniden yazar, (2) safety.ts her
// cümleyi (yeniden yazılanlar dahil) tarar, (3) hâlâ takılan cümle şablona düşer. Sonuç asla boş metin içermez.
// Saf (sağlayıcı dışarıdan verilir); loglanan yalnız sayılar ve kural adları.

export type AuditText = { path: string; text: string; fallback: string; allowMaybeDiagnosis?: boolean };

export type AuditSummary = {
  audited: boolean;
  reason?: string;
  rewrites: number;
  /** Güvenlik filtresine takılıp şablona düşen cümle sayısı. */
  fallbacks: number;
  flags: SafetyRule[];
  usage: AuditResult["usage"];
  usageByModel: AuditResult["usageByModel"];
  model: string | null;
  estUsd: number;
};

const MAX_REWRITE = 500;

/** Yeniden yazımı uygular (yalnız bilinen yollar, boş olmayan metin), sonra güvenlik taraması; takılan cümle şablon olur. */
export async function auditTexts(texts: readonly AuditText[], scores: Record<string, number>, provider: AuditProvider | null, opts: { signal: AbortSignal; timeoutMs: number }): Promise<{ texts: AuditText[]; summary: AuditSummary }> {
  let result: AuditResult | null = null;
  if (provider && texts.length > 0) {
    result = await provider.audit({ scores, items: texts.map((t) => ({ path: t.path, text: t.text })) }, opts.signal, opts.timeoutMs);
  }
  const rewrites = new Map<string, string>();
  if (result?.out) {
    for (const r of result.out.rewrites) {
      const text = r.text.trim().slice(0, MAX_REWRITE);
      if (text && texts.some((t) => t.path === r.path)) rewrites.set(r.path, text);
    }
  }
  const violations: Violation[] = [];
  let fallbacks = 0;
  const out = texts.map((t) => {
    const candidate = rewrites.get(t.path) ?? t.text;
    // Boş aday güvenlik ihlali değildir: şablon kullanılır ama fallbacks sayılmaz (is_fallback yalnız gerçek filtrelemede).
    if (!candidate.trim()) return { ...t, text: t.fallback };
    const v = scanTextV2(candidate, t.path, { allowMaybeDiagnosis: t.allowMaybeDiagnosis });
    if (v.length === 0) return { ...t, text: candidate };
    violations.push(...v);
    fallbacks++;
    return { ...t, text: t.fallback };
  });
  const flags = [...new Set(violations.map((v) => v.rule))];
  if (flags.length) console.warn(`[audit] safety_fallback n=${fallbacks} rules=${flags.join(",")}`);
  return {
    texts: out,
    summary: {
      audited: Boolean(result?.out),
      ...(result && !result.out ? { reason: result.reason ?? "unknown" } : {}),
      rewrites: rewrites.size,
      fallbacks,
      flags,
      usage: result?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      usageByModel: result?.usageByModel ?? [],
      model: result?.model ?? null,
      estUsd: result?.estUsd ?? 0,
    },
  };
}
