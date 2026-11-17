/**
 * Prompt meta şeması (front-matter alanları). `prompt_versions` satırı ve geçit çağrısı buradan beslenir:
 *   route, version, model, effort, schema, tools  → PLAN-v2 §6 sürümleme; geçidin rota tablosuyla birebir (test/routes.test.ts)
 *   role, layers                                  → katman birleştirme (ürün + rol + rota)
 *   extends                                       → başka bir rota gövdesini bu gövdenin önüne ekler (ör. coach_deep ← coach_chat)
 */
import { isSchemaName } from '@ogrenmen/contracts';
import { z } from 'zod';
import { PromptError } from './errors.js';
import type { FrontValue } from './frontmatter.js';

export const PROMPT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export const PROMPT_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
/** Rol katmanları (src/layers/roles/<rol>.vN.md). */
export const PROMPT_ROLES = ['coach', 'parent_agent', 'analyst', 'generator', 'curriculum_author'] as const;

export type PromptModel = (typeof PROMPT_MODELS)[number];
export type PromptEffort = (typeof PROMPT_EFFORTS)[number];
export type PromptRole = (typeof PROMPT_ROLES)[number];

export const ROUTE_NAME = /^[a-z][a-z0-9_]*$/;
export const VERSION = /^v[1-9][0-9]*$/;
/** Katman anahtarı: `product.v1` ya da `roles/coach.v1` (src/layers altında, .md'siz). */
export const LAYER_KEY = /^(product|roles\/[a-z_]+)\.v[1-9][0-9]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;

const metaSchema = z.strictObject({
  route: z.string().regex(ROUTE_NAME),
  version: z.string().regex(VERSION),
  model: z.enum(PROMPT_MODELS),
  effort: z.enum(PROMPT_EFFORTS),
  schema: z
    .string()
    .nullable()
    .refine((s) => s === null || isSchemaName(s), { message: 'packages/contracts kayıt defterinde olmayan şema' }),
  tools: z
    .array(z.string().regex(TOOL_NAME))
    .refine((t) => new Set(t).size === t.length, { message: 'yinelenen araç' })
    .refine((t) => t.every((x, i) => i === 0 || (t[i - 1] as string) < x), { message: 'araçlar ada göre sıralı olmalı (önbellek öneki)' }),
  role: z.enum(PROMPT_ROLES),
  layers: z.array(z.string().regex(LAYER_KEY)).min(2),
  extends: z.string().regex(/^[a-z][a-z0-9_]*\/v[1-9][0-9]*$/).optional(),
  description: z.string().min(1).optional(),
});

export type PromptMeta = z.output<typeof metaSchema>;

/** Front-matter verisini doğrular; dosya yolu ile rota/sürüm adının eşleşmesini de denetler. */
export function parseMeta(data: Record<string, FrontValue>, expect: { route: string; version: string }, file: string): PromptMeta {
  const res = metaSchema.safeParse(data);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`).join('; ');
    throw new PromptError('OGR-PRM-002', `${file}: ${issues}`);
  }
  const meta = res.data;
  if (meta.route !== expect.route) throw new PromptError('OGR-PRM-002', `${file}: route '${meta.route}' dizin adıyla ('${expect.route}') aynı olmalı`);
  if (meta.version !== expect.version) throw new PromptError('OGR-PRM-002', `${file}: version '${meta.version}' dosya adıyla ('${expect.version}') aynı olmalı`);
  const [first, ...rest] = meta.layers;
  if (!first?.startsWith('product.')) throw new PromptError('OGR-PRM-002', `${file}: ilk katman ürün katmanı (product.vN) olmalı`);
  if (!rest.some((l) => l.startsWith(`roles/${meta.role}.`))) {
    throw new PromptError('OGR-PRM-002', `${file}: katmanlarda rolün katmanı (roles/${meta.role}.vN) olmalı`);
  }
  if (new Set(meta.layers).size !== meta.layers.length) throw new PromptError('OGR-PRM-002', `${file}: yinelenen katman`);
  return meta;
}

/** `v3` → 3. */
export function versionNumber(v: string): number {
  if (!VERSION.test(v)) throw new PromptError('OGR-PRM-002', `geçersiz sürüm: ${v}`);
  return Number(v.slice(1));
}

export function compareVersions(a: string, b: string): number {
  return versionNumber(a) - versionNumber(b);
}
