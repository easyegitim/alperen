/**
 * Yapılandırılmış çıktı: Gemini `responseSchema` (packages/contracts/schemas/gemini/tutor-reply.json,
 * önceden düzleştirilmiş) ve OpenAI uyumlu `response_format: json_schema`. Dönen JSON
 * `@ogrenmen/contracts/validators` ile doğrulanır — ÖNCEDEN DERLENMİŞ doğrulayıcı; Worker'da Ajv
 * derlenmez (ücretsiz planda istek başına 10 ms CPU). Geçmezse aynı sağlayıcıda 1 onarım.
 */
import { errors as contractErrors } from '@ogrenmen/contracts/validators';
import type { TutorReply } from '@ogrenmen/contracts/types';
import geminiTutorReply from '@ogrenmen/contracts/schemas/gemini/tutor-reply.json';

export type { TutorReply };

export const TUTOR_REPLY_GEMINI_SCHEMA: Record<string, unknown> = geminiTutorReply as Record<string, unknown>;

/** Gemini düzleştirmesini (nullable, propertyOrdering) standart JSON Schema'ya çevirir. */
export function geminiToJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiToJsonSchema);
  if (typeof node !== 'object' || node === null) return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'nullable' || k === 'propertyOrdering') continue;
    out[k] = geminiToJsonSchema(v);
  }
  if (src.nullable === true) {
    if (Array.isArray(out.enum)) out.enum = [...(out.enum as unknown[]), null];
    if (typeof out.type === 'string') out.type = [out.type, 'null'];
  }
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

export const TUTOR_REPLY_JSON_SCHEMA = geminiToJsonSchema(TUTOR_REPLY_GEMINI_SCHEMA) as Record<string, unknown>;

export type ParseResult = { ok: true; value: TutorReply } | { ok: false; errors: string[] };

/** Model metninden JSON çıkarır (```json çitleri atılır) ve tutor-reply sözleşmesine karşı doğrular. */
export function parseTutorReply(text: string): ParseResult {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return { ok: false, errors: ['JSON ayrıştırılamadı'] };
  }
  return validateTutorReply(data);
}

export function validateTutorReply(data: unknown): ParseResult {
  const issues = contractErrors('tutor-reply', data);
  if (issues.length === 0) return { ok: true, value: data as TutorReply };
  return { ok: false, errors: issues.map((i) => `${i.path || '/'} ${i.keyword}: ${i.message}`) };
}

/** Onarım isteği (aynı sağlayıcıda tek deneme). */
export function repairInstruction(errs: readonly string[]): string {
  return `Yalnızca şemaya uygun JSON döndür; hatalar: ${errs.slice(0, 6).join('; ')}`;
}
