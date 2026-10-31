#!/usr/bin/env bun
/**
 * mint-jwt.ts — bot_runtime / batch_worker için PostgREST JWT'si basar (BLUEPRINT §3.0, ADR-0002).
 *
 * JWT Worker'da ya da GitHub'da İMZALANMAZ: kurucunun makinesinde proje JWT secret'ıyla üretilir ve
 * `wrangler secret put SUPABASE_BOT_JWT` / GitHub Environment `prod` → `SUPABASE_BATCH_JWT` olarak verilir (90 gün).
 * Böylece hiçbir uygulama ortamında service_role üretebilecek bir imzalama gizi bulunmaz; bu araç service_role,
 * anon ya da authenticated jetonu BASMAZ.
 *
 * Kullanım:
 *   bun run supabase/scripts/mint-jwt.ts --role bot_runtime --exp 90d [--secret <s> | SUPABASE_JWT_SECRET ortamı]
 *                                       [--iss supabase] [--ref <proje-ref>] [--now <unix-saniye>]
 * Çıktı: yalnız jeton (stdout); bilgi satırı stderr'e (bitiş tarihi). Süre biçimi: 90d, 12h, 30m, 3600s ya da saniye.
 */
import { createHmac } from 'node:crypto';

export const ALLOWED_ROLES = ['bot_runtime', 'batch_worker'] as const;
export type AppRole = (typeof ALLOWED_ROLES)[number];

export class MintError extends Error {}

export function parseDuration(text: string): number {
  const m = /^(\d+)\s*([dhms]?)$/.exec(text.trim());
  if (!m) throw new MintError(`süre biçimi geçersiz: ${text} (örnek: 90d, 12h, 30m, 3600s)`);
  const n = Number(m[1]);
  const unit = m[2] || 's';
  const seconds = n * ({ d: 86400, h: 3600, m: 60, s: 1 } as Record<string, number>)[unit];
  if (seconds <= 0) throw new MintError('süre sıfırdan büyük olmalı');
  if (seconds > 400 * 86400) throw new MintError('süre en çok 400 gün (rotasyon takvimi 90 gün)');
  return seconds;
}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export interface MintOptions {
  role: string;
  secret: string;
  expSeconds: number;
  now?: number;
  iss?: string;
  ref?: string;
}

export function mint(opts: MintOptions): { token: string; payload: Record<string, unknown> } {
  if (!(ALLOWED_ROLES as readonly string[]).includes(opts.role)) {
    throw new MintError(`rol ${opts.role} basılamaz; yalnız ${ALLOWED_ROLES.join(', ')} (service_role uygulama kodunda yoktur)`);
  }
  if (!opts.secret || opts.secret.length < 8) throw new MintError('JWT secret eksik ya da çok kısa (--secret ya da SUPABASE_JWT_SECRET)');
  const iat = Math.floor(opts.now ?? Date.now() / 1000);
  const payload: Record<string, unknown> = { role: opts.role, iss: opts.iss ?? 'supabase', iat, exp: iat + opts.expSeconds };
  if (opts.ref) payload.ref = opts.ref;
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = base64url(createHmac('sha256', opts.secret).update(signingInput).digest());
  return { token: `${signingInput}.${signature}`, payload };
}

export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new MintError(`beklenmeyen argüman: ${a}`);
    const eq = a.indexOf('=');
    if (eq > 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new MintError(`${a} için değer yok`);
      out[a.slice(2)] = v;
      i++;
    }
  }
  return out;
}

function main(argv: string[]): number {
  try {
    const args = parseArgs(argv);
    const known = new Set(['role', 'secret', 'exp', 'iss', 'ref', 'now']);
    for (const k of Object.keys(args)) if (!known.has(k)) throw new MintError(`bilinmeyen seçenek --${k}`);
    if (!args.role) throw new MintError('--role gerekli (bot_runtime | batch_worker)');
    const secret = args.secret ?? process.env.SUPABASE_JWT_SECRET ?? '';
    const { token, payload } = mint({
      role: args.role,
      secret,
      expSeconds: parseDuration(args.exp ?? '90d'),
      now: args.now !== undefined ? Number(args.now) : undefined,
      iss: args.iss,
      ref: args.ref,
    });
    process.stdout.write(`${token}\n`);
    process.stderr.write(`${payload.role} jetonu ${new Date(Number(payload.exp) * 1000).toISOString()} tarihine kadar geçerli\n`);
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`HATA: ${msg}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
