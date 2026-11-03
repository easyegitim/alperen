import { z } from 'zod';

/** Gevşek UUID (sürüm/varyant denetimi yok: fikstürlerde 0000…0001 gibi kimlikler de geçer). */
export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'uuid bekleniyor');

/**
 * SQL/RPC iş sözleşmesi snake_case'tir. Eski camelCase anahtarlar da kabul edilir (alias → snake_case);
 * şema yalnız snake_case alanları bilir.
 */
export function acceptCamelAliases<S extends z.ZodTypeAny>(aliases: Record<string, string>, schema: S): z.ZodType<z.output<S>, unknown> {
  return z.preprocess((raw) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const out: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    for (const [camel, snake] of Object.entries(aliases)) {
      if (camel in out) {
        if (!(snake in out)) out[snake] = out[camel];
        delete out[camel];
      }
    }
    return out;
  }, schema) as z.ZodType<z.output<S>, unknown>;
}
