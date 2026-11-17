/**
 * Supabase uyumlu yerel köprü (YALNIZ YEREL: sınama yığını `stack.ts` ve kurucunun yerel denemesi `scripts/dev-local/up.ts`).
 * Gerçek Postgres üzerinde:
 *   - Auth: e-posta kodu (sabit `otp`; e-posta gönderilmez), oturum/yenileme jetonları, /auth/v1/user.
 *   - PostgREST alt kümesi: tablo okuma/yazma (süzgeç, sıralama, sınır, upsert) ve RPC (/rest/v1/rpc/<ad>).
 *   - Storage: nesne yükleme/okuma, imzalı adres, `figures` kovası için 1×1 PNG, TUS (resumable) yükleme.
 * Her istek kendi işleminde `request.jwt.claims` + `set local role authenticated|anon|service_role` ile koşar: RLS, RPC'ler
 * ve Storage politikaları (storage.objects) gerçektir; yalnız HTTP katmanı taklittir. Realtime yok (ekranlar yoklamaya düşer).
 * Yalnız 127.0.0.1'de dinler; imza anahtarı sır değildir. Üretimde kullanılmaz.
 */
import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type pg from 'pg';

// ------------------------------------------------------------------------------------------------ JWT

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');
export const nowSec = () => Math.floor(Date.now() / 1000);

export interface Jwt {
  sign(payload: Record<string, unknown>): string;
  verify(token: string): Record<string, unknown> | null;
  mac(value: string): string;
}

/** HS256 imzalayıcı/doğrulayıcı (köprünün ve istemcilerin paylaştığı yerel anahtar). */
export function createJwt(secret: string): Jwt {
  const mac = (value: string) => createHmac('sha256', secret).update(value).digest('base64url');
  return {
    mac,
    sign(payload) {
      const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const body = b64url(JSON.stringify(payload));
      return `${head}.${body}.${mac(`${head}.${body}`)}`;
    },
    verify(token) {
      const [h, b, s] = token.split('.');
      if (!h || !b || !s) return null;
      if (mac(`${h}.${b}`) !== s) return null;
      try {
        const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as Record<string, unknown>;
        if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null;
        return p;
      } catch {
        return null;
      }
    },
  };
}

/** anon ve service_role anahtarları (köprü bunları doğrular; web anon'u, worker ve ders servisi service_role'ü kullanır). */
export function apiKeys(jwt: Jwt, ttlSec = 86_400, issuedAt?: number): { anonKey: string; serviceKey: string } {
  const iat = issuedAt ?? nowSec();
  return {
    anonKey: jwt.sign({ role: 'anon', iss: 'journey', iat, exp: iat + ttlSec }),
    serviceKey: jwt.sign({ role: 'service_role', iss: 'journey', iat, exp: iat + ttlSec }),
  };
}

interface AuthUser {
  id: string;
  email: string;
}
function userObject(u: AuthUser) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
}
function session(jwt: Jwt, u: AuthUser) {
  const exp = nowSec() + 3600;
  return {
    access_token: jwt.sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: nowSec(), exp }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh.${b64url(u.id)}.${jwt.mac(u.id)}`,
    user: userObject(u),
  };
}

// ------------------------------------------------------------------------------------------------ HTTP yardımcıları

function readRaw(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const raw = (await readRaw(req)).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
// access-control-allow-origin istek başına sunucuda yazılır (allowedOrigins; yoksa '*').
const CORS = { 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
function send(res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  if (body === undefined) {
    res.writeHead(status, { ...CORS, ...headers });
    return res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers });
  res.end(JSON.stringify(body));
}

/** Adres 5 sn içinde 2xx dönüyor mu (hazırlık denetimleri). */
export async function httpOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return r.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------------ bağlam

interface TusUpload {
  bucket: string;
  name: string;
  type: string;
  length: number;
  file: string;
  claims: Record<string, unknown>;
}

interface Ctx {
  pool: pg.Pool;
  jwt: Jwt;
  otp: string;
  url: string;
  storeDir: string;
  log: (msg: string) => void;
  tusUploads: Map<string, TusUpload>;
}

/** İstekteki JWT'nin iddiaları: kullanıcı jetonu yoksa apikey (anon / service_role). */
function claimsOf(ctx: Ctx, req: http.IncomingMessage): Record<string, unknown> | null {
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const apikey = String(req.headers.apikey ?? '');
  return ctx.jwt.verify(bearer) ?? ctx.jwt.verify(apikey);
}

// ------------------------------------------------------------------------------------------------ Postgres

class BridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new BridgeError(400, 'PGRST100', `geçersiz ad: ${s}`);
  return `"${s}"`;
};

/** İddialarla tek işlem: RLS ve auth.uid() gerçek Supabase'deki gibi. */
async function asClaims<T>(ctx: Ctx, claims: Record<string, unknown>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const role = claims.role === 'service_role' ? 'service_role' : claims.role === 'authenticated' ? 'authenticated' : 'anon';
  const c = await ctx.pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify(claims), String(claims.sub ?? '')]);
    await c.query(`set local role ${role}`);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (err) {
    await c.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

function pgError(ctx: Ctx, res: http.ServerResponse, err: unknown) {
  if (err instanceof BridgeError) return send(res, err.status, { code: err.code, message: err.message, details: null, hint: null });
  const e = err as { code?: string; message?: string; detail?: string; hint?: string };
  const code = e.code ?? 'XX000';
  const status = code === '42501' ? 403 : code === '23505' || code === '23503' ? 409 : code === '42883' || code === '42P01' ? 404 : code.startsWith('08') ? 503 : 400;
  if (status >= 500 || !/^(P0001|23|42501|22)/.test(code)) ctx.log(`pg hatası ${code}: ${e.message}`);
  return send(res, status, { code, message: e.message ?? 'hata', details: e.detail ?? null, hint: e.hint ?? null });
}

/** PostgREST sütun ifadesi: ad, ad->'k', ad->>'k'. */
function columnExpr(key: string, qual = ''): string {
  const m = /^([a-z_][a-z0-9_]*)((?:->>?[a-z0-9_]+)*)$/.exec(key);
  if (!m) throw new BridgeError(400, 'PGRST100', `desteklenmeyen süzgeç sütunu: ${key}`);
  const [, col, rest] = m;
  const parts = [...rest!.matchAll(/(->>?)([a-z0-9_]+)/g)].map(([, op, k]) => `${op}'${k}'`);
  return `${qual}${ident(col!)}${parts.join('')}`;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict']);

/** Süzgeçler → WHERE; değerler türsüz parametre (Postgres sütun türünden çıkarır). */
function whereClause(params: URLSearchParams, values: unknown[], qual = ''): string {
  const parts: string[] = [];
  for (const [key, raw] of params) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and') throw new BridgeError(400, 'PGRST100', 'or/and süzgeci köprüde yok');
    let value = raw;
    let negate = false;
    if (value.startsWith('not.')) {
      negate = true;
      value = value.slice(4);
    }
    const m = /^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov)\.(.*)$/s.exec(value);
    if (!m) throw new BridgeError(400, 'PGRST100', `desteklenmeyen süzgeç: ${key}=${raw}`);
    const [, op, arg] = m as unknown as [string, string, string];
    const col = columnExpr(key, qual);
    const p = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };
    let expr: string;
    switch (op) {
      case 'eq': expr = `${col} = ${p(arg)}`; break;
      case 'neq': expr = `${col} <> ${p(arg)}`; break;
      case 'gt': expr = `${col} > ${p(arg)}`; break;
      case 'gte': expr = `${col} >= ${p(arg)}`; break;
      case 'lt': expr = `${col} < ${p(arg)}`; break;
      case 'lte': expr = `${col} <= ${p(arg)}`; break;
      case 'like': expr = `${col} like ${p(arg.replace(/\*/g, '%'))}`; break;
      case 'ilike': expr = `${col} ilike ${p(arg.replace(/\*/g, '%'))}`; break;
      case 'is': {
        const v = arg.toLowerCase();
        if (!['null', 'true', 'false', 'unknown'].includes(v)) throw new BridgeError(400, 'PGRST100', `is.${arg}`);
        expr = `${col} is ${v}`;
        break;
      }
      case 'in': {
        const items = arg.replace(/^\(|\)$/g, '').split(',').filter((s) => s !== '').map((s) => s.replace(/^"|"$/g, ''));
        expr = items.length === 0 ? 'false' : `${col} = any(${p(items)})`;
        break;
      }
      case 'cs': expr = `${col} @> ${p(arg)}`; break;
      case 'cd': expr = `${col} <@ ${p(arg)}`; break;
      case 'ov': expr = `${col} && ${p(arg)}`; break;
      default: throw new BridgeError(400, 'PGRST100', op);
    }
    parts.push(negate ? `not (${expr})` : expr);
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}

function selectList(select: string | null): string {
  if (!select || select === '*') return '*';
  return select
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      if (c === '*') return '*';
      if (c.includes('(')) throw new BridgeError(400, 'PGRST100', `gömülü kaynak köprüde yok: ${c}`);
      const alias = /^([a-z_][a-z0-9_]*):(.+)$/.exec(c);
      return alias ? `${columnExpr(alias[2]!)} as ${ident(alias[1]!)}` : columnExpr(c);
    })
    .join(', ');
}

function orderLimit(params: URLSearchParams, values: unknown[]): string {
  let sql = '';
  const order = params.get('order');
  if (order) {
    sql += ' order by ' + order.split(',').map((o) => {
      const [col, ...mods] = o.split('.');
      const dir = mods.includes('desc') ? 'desc' : 'asc';
      const nulls = mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : '';
      return `${columnExpr(col!)} ${dir}${nulls}`;
    }).join(', ');
  }
  const limit = params.get('limit');
  if (limit) {
    values.push(Number(limit));
    sql += ` limit $${values.length}`;
  }
  const offset = params.get('offset');
  if (offset) {
    values.push(Number(offset));
    sql += ` offset $${values.length}`;
  }
  return sql;
}

async function tableExists(ctx: Ctx, table: string): Promise<boolean> {
  const r = await ctx.pool.query(`select to_regclass($1) is not null as ok`, [`public.${table}`]);
  return Boolean(r.rows[0]?.ok);
}

async function handleRest(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, table: string, url: URL) {
  const claims = claimsOf(ctx, req);
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT geçersiz', details: null, hint: null });
  if (!(await tableExists(ctx, table))) return send(res, 404, { code: '42P01', message: `public.${table} yok`, details: null, hint: null });
  const t = `public.${ident(table)}`;
  const params = url.searchParams;
  const prefer = String(req.headers.prefer ?? '');
  const wantRows = /return=representation/.test(prefer);
  const single = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
  const finish = (rows: unknown[]) => {
    if (single) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
      return send(res, 200, rows[0]);
    }
    return send(res, 200, rows);
  };
  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const values: unknown[] = [];
      const where = whereClause(params, values);
      const tail = orderLimit(params, values);
      const rows = await asClaims(ctx, claims, async (c) => {
        const r = await c.query(`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as rows from (select ${selectList(params.get('select'))} from ${t} ${where}${tail}) x`, values);
        return r.rows[0].rows as unknown[];
      });
      if (req.method === 'HEAD') return send(res, 200, undefined, { 'content-range': `0-${rows.length - 1}/${rows.length}` });
      return finish(rows);
    }
    if (req.method === 'POST') {
      const body = (await readJson(req)) as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(body) ? body : [body];
      const cols = params.get('columns')?.split(',').map((s) => s.replace(/"/g, '')) ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const list = cols.map(ident).join(', ');
      const conflict = params.get('on_conflict');
      let onConflict = '';
      if (/resolution=merge-duplicates/.test(prefer) && conflict) {
        onConflict = ` on conflict (${conflict.split(',').map(ident).join(', ')}) do update set ${cols.map((c) => `${ident(c)} = excluded.${ident(c)}`).join(', ')}`;
      } else if (/resolution=ignore-duplicates/.test(prefer)) {
        onConflict = conflict ? ` on conflict (${conflict.split(',').map(ident).join(', ')}) do nothing` : ' on conflict do nothing';
      }
      const out = await asClaims(ctx, claims, async (c) => {
        const r = await c.query(
          // return=minimal (varsayılan) RETURNING kullanmaz: PostgREST gibi, SELECT politikası olmayan eklemeler de geçer
          wantRows
            ? `with ins as (insert into ${t} (${list}) select ${list} from jsonb_populate_recordset(null::${t}, $1::jsonb)${onConflict} returning *)
               select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) as rows from ins`
            : `insert into ${t} (${list}) select ${list} from jsonb_populate_recordset(null::${t}, $1::jsonb)${onConflict}`,
          [JSON.stringify(rows)],
        );
        return (r.rows[0]?.rows ?? []) as unknown[];
      });
      return wantRows ? (single ? finish(out) : send(res, 201, out)) : send(res, 201, undefined);
    }
    if (req.method === 'PATCH') {
      const body = (await readJson(req)) as Record<string, unknown>;
      const cols = Object.keys(body);
      const values: unknown[] = [JSON.stringify(body)];
      const where = whereClause(params, values, `${t}.`);
      const out = await asClaims(ctx, claims, async (c) => {
        const r = await c.query(
          `${wantRows ? 'with up as (' : ''}update ${t} set ${cols.map((k) => `${ident(k)} = src.${ident(k)}`).join(', ')}
             from jsonb_populate_record(null::${t}, $1::jsonb) src ${where}
           ${wantRows ? `returning ${t}.*) select coalesce(jsonb_agg(to_jsonb(up)), '[]'::jsonb) as rows from up` : ''}`,
          values,
        );
        return (r.rows[0]?.rows ?? []) as unknown[];
      });
      return wantRows ? finish(out) : send(res, 204);
    }
    if (req.method === 'DELETE') {
      const values: unknown[] = [];
      const where = whereClause(params, values);
      const sql = wantRows ? `with d as (delete from ${t} ${where} returning *) select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) as rows from d` : `delete from ${t} ${where}`;
      const out = await asClaims(ctx, claims, async (c) => ((await c.query(sql, values)).rows[0]?.rows ?? []) as unknown[]);
      return wantRows ? finish(out) : send(res, 204);
    }
    return send(res, 405, { code: 'PGRST', message: 'yöntem yok', details: null, hint: null });
  } catch (err) {
    return pgError(ctx, res, err);
  }
}

interface FnSig {
  argNames: string[];
  argTypes: string[];
  nArgs: number;
  nDefaults: number;
  retset: boolean;
  rettype: string;
  composite: boolean;
}

async function functionSigs(ctx: Ctx, name: string): Promise<FnSig[]> {
  const r = await ctx.pool.query(
    `select coalesce(p.proargnames[1:p.pronargs], '{}') as names,
            array(select format_type(t, null) from unnest(p.proargtypes) as t) as types,
            p.pronargs as n, p.pronargdefaults as nd, p.proretset as retset, format_type(p.prorettype, null) as rettype,
            ty.typtype = 'c' as composite
       from pg_proc p join pg_type ty on ty.oid = p.prorettype
      where p.pronamespace = 'public'::regnamespace and p.proname = $1`,
    [name],
  );
  return r.rows.map((x) => ({ argNames: x.names, argTypes: x.types, nArgs: x.n, nDefaults: x.nd, retset: x.retset, rettype: x.rettype, composite: x.composite }));
}

function argValue(v: unknown, type: string): unknown {
  if (v === null || v === undefined) return null;
  if (type === 'json' || type === 'jsonb') return JSON.stringify(v);
  if (type.endsWith('[]')) return Array.isArray(v) ? v : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function handleRpc(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, fn: string) {
  const claims = claimsOf(ctx, req);
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT geçersiz', details: null, hint: null });
  try {
    const args = ((await readJson(req)) ?? {}) as Record<string, unknown>;
    const keys = Object.keys(args);
    const sigs = (await functionSigs(ctx, ident(fn).slice(1, -1))).filter(
      (s) => keys.every((k) => s.argNames.includes(k)) && s.argNames.slice(0, s.nArgs - s.nDefaults).every((n) => keys.includes(n)),
    );
    const sig = sigs[0];
    if (!sig) return send(res, 404, { code: 'PGRST202', message: `public.${fn}(${keys.join(', ')}) bulunamadı`, details: null, hint: null });
    const values: unknown[] = [];
    const call = `public.${ident(fn)}(${keys
      .map((k) => {
        const type = sig.argTypes[sig.argNames.indexOf(k)]!;
        values.push(argValue(args[k], type));
        return `${ident(k)} => $${values.length}::${type}`;
      })
      .join(', ')})`;
    const out = await asClaims(ctx, claims, async (c) => {
      if (sig.rettype === 'void') {
        await c.query(`select ${call}`, values);
        return null;
      }
      if (sig.retset || sig.composite) {
        const r = await c.query(`select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) as v from ${call} r`, values);
        const rows = r.rows[0].v as unknown[];
        return sig.retset ? rows : (rows[0] ?? null);
      }
      return (await c.query(`select to_jsonb(${call}) as v`, values)).rows[0].v as unknown;
    });
    if (out === null && sig.rettype === 'void') return send(res, 204);
    return send(res, 200, out);
  } catch (err) {
    return pgError(ctx, res, err);
  }
}

// ------------------------------------------------------------------------------------------------ Storage

const objectFile = (ctx: Ctx, bucket: string, name: string) => {
  const p = path.join(ctx.storeDir, bucket, name);
  if (!p.startsWith(path.join(ctx.storeDir, bucket) + path.sep)) throw new BridgeError(400, 'InvalidKey', 'geçersiz yol');
  return p;
};
const signToken = (ctx: Ctx, bucket: string, name: string, exp: number) => ctx.jwt.mac(`${bucket}/${name}:${exp}`);
// 1×1 şeffaf PNG (figures kovası yerelde boş; şekil adresleri kırık görünmesin)
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function storageError(res: http.ServerResponse, status: number, error: string, message: string) {
  return send(res, status, { statusCode: String(status), error, message });
}

/**
 * multipart/form-data içinden dosya parçası (storage-js Blob'u adsız alanla gönderir: name="", filename=""; Bun'ın
 * formData() ayrıştırıcısı bu alanı düşürür). Content-Type başlığı taşıyan ilk parça dosyadır.
 */
function multipartFile(raw: Buffer, contentType: string): { bytes: Buffer; type: string } | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const b = boundary?.[1] ?? boundary?.[2];
  if (!b) return null;
  const delim = Buffer.from(`--${b}`);
  let at = raw.indexOf(delim);
  while (at >= 0) {
    const start = at + delim.length;
    const next = raw.indexOf(delim, start);
    if (next < 0) break;
    const part = raw.subarray(start, next);
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd >= 0) {
      const head = part.subarray(0, headEnd).toString('utf8');
      const ct = /content-type:\s*([^\r\n]+)/i.exec(head);
      if (ct) {
        let body = part.subarray(headEnd + 4);
        if (body.subarray(-2).toString() === '\r\n') body = body.subarray(0, -2);
        return { bytes: Buffer.from(body), type: ct[1]!.trim() };
      }
    }
    at = next;
  }
  return null;
}

async function canRead(ctx: Ctx, claims: Record<string, unknown>, bucket: string, name: string): Promise<boolean> {
  return asClaims(ctx, claims, async (c) => (await c.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rowCount === 1);
}

function serveFile(ctx: Ctx, res: http.ServerResponse, bucket: string, name: string) {
  const file = objectFile(ctx, bucket, name);
  if (!fs.existsSync(file)) return storageError(res, 404, 'not_found', 'Object not found');
  const meta = fs.existsSync(`${file}.__type`) ? fs.readFileSync(`${file}.__type`, 'utf8') : 'application/octet-stream';
  res.writeHead(200, { ...CORS, 'content-type': meta });
  return res.end(fs.readFileSync(file));
}

// --- TUS (Supabase Storage resumable; ders dosyaları): oluştur (POST) → parça parça ekle (PATCH) → bitince storage.objects
// satırı (RLS: ilk klasör = yükleyen) ve dosya yazılır. HEAD kaldığı yeri söyler. Yükleme durumu süreç belleğindedir.
const TUS_HEADERS = { 'tus-resumable': '1.0.0' };

function tusMeta(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [k, v] = pair.trim().split(' ');
    if (k) out[k] = v ? Buffer.from(v, 'base64').toString('utf8') : '';
  }
  return out;
}

async function handleTus(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, id: string | null, claims: Record<string, unknown>) {
  const owner = typeof claims.sub === 'string' ? claims.sub : null;
  if (!id && req.method === 'POST') {
    const meta = tusMeta(String(req.headers['upload-metadata'] ?? ''));
    const length = Number(req.headers['upload-length']);
    const bucket = meta.bucketName ?? '';
    const name = meta.objectName ?? '';
    if (!/^[a-z0-9_-]+$/.test(bucket) || !name || !Number.isFinite(length) || length < 0) return storageError(res, 400, 'invalid', 'TUS üst verisi geçersiz');
    try {
      // izin denemesi: ekleme RLS'ten geçmezse oluşturma 403 olur (gerçek Storage gibi); satır geri alınır
      await asClaims(ctx, claims, async (c) => {
        await c.query('savepoint tus_check');
        await c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, '{}'::jsonb)`, [bucket, name, owner]);
        await c.query('rollback to savepoint tus_check');
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === '23505') return storageError(res, 409, 'Duplicate', 'The resource already exists');
      if (e.code === '42501') return storageError(res, 403, 'Unauthorized', 'new row violates row-level security policy');
      throw err;
    }
    const uid = randomUUID();
    const file = path.join(ctx.storeDir, '__tus', uid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(0));
    ctx.tusUploads.set(uid, { bucket, name, type: meta.contentType || 'application/octet-stream', length, file, claims });
    return send(res, 201, undefined, { ...TUS_HEADERS, location: `${ctx.url}/storage/v1/upload/resumable/${uid}`, 'upload-offset': '0' });
  }
  const up = id ? ctx.tusUploads.get(id) : undefined;
  if (!up) return storageError(res, 404, 'not_found', 'yükleme yok');
  const offset = fs.statSync(up.file).size;
  if (req.method === 'HEAD') return send(res, 200, undefined, { ...TUS_HEADERS, 'upload-offset': String(offset), 'upload-length': String(up.length), 'cache-control': 'no-store' });
  if (req.method === 'PATCH') {
    if (Number(req.headers['upload-offset']) !== offset) return storageError(res, 409, 'conflict', 'Upload-Offset uyuşmuyor');
    const chunk = await readRaw(req);
    fs.appendFileSync(up.file, chunk);
    const now_ = offset + chunk.length;
    if (now_ >= up.length) {
      try {
        await asClaims(ctx, up.claims, async (c) => {
          await c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)`, [up.bucket, up.name, typeof up.claims.sub === 'string' ? up.claims.sub : null, JSON.stringify({ size: up.length, mimetype: up.type })]);
        });
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === '23505') return storageError(res, 409, 'Duplicate', 'The resource already exists');
        if (e.code === '42501') return storageError(res, 403, 'Unauthorized', 'new row violates row-level security policy');
        throw err;
      }
      const dest = objectFile(ctx, up.bucket, up.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(up.file, dest);
      fs.writeFileSync(`${dest}.__type`, up.type);
      ctx.tusUploads.delete(id!);
    }
    return send(res, 204, undefined, { ...TUS_HEADERS, 'upload-offset': String(now_) });
  }
  if (req.method === 'DELETE') {
    fs.rmSync(up.file, { force: true });
    ctx.tusUploads.delete(id!);
    return send(res, 204, undefined, TUS_HEADERS);
  }
  return storageError(res, 405, 'method', 'yöntem yok');
}

async function handleStorage(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, rest: string, url: URL) {
  try {
    const pub = /^object\/public\/([a-z0-9_-]+)\/(.+)$/.exec(rest);
    if (pub && req.method === 'GET') {
      if (pub[1] === 'figures') {
        res.writeHead(200, { ...CORS, 'content-type': 'image/png' });
        return res.end(PIXEL);
      }
      return storageError(res, 400, 'not_public', 'Bucket is not public');
    }
    const signed = /^object\/sign\/([a-z0-9_-]+)\/(.+)$/.exec(rest);
    if (signed && req.method === 'GET') {
      const [, bucket, name] = signed as unknown as [string, string, string];
      const exp = Number(url.searchParams.get('exp'));
      if (!exp || exp < nowSec() || url.searchParams.get('token') !== signToken(ctx, bucket, decodeURIComponent(name), exp)) return storageError(res, 400, 'InvalidSignature', 'invalid signature');
      return serveFile(ctx, res, bucket, decodeURIComponent(name));
    }
    const claims = claimsOf(ctx, req);
    if (!claims) return storageError(res, 401, 'Unauthorized', 'jwt geçersiz');
    const tus = /^upload\/resumable(?:\/([0-9a-f-]{36}))?$/.exec(rest);
    if (tus) return handleTus(ctx, req, res, tus[1] ?? null, claims);
    if (signed && req.method === 'POST') {
      const [, bucket, raw] = signed as unknown as [string, string, string];
      const name = decodeURIComponent(raw);
      if (!(await canRead(ctx, claims, bucket, name))) return storageError(res, 400, 'not_found', 'Object not found');
      const body = (await readJson(req)) as { expiresIn?: number };
      const exp = nowSec() + Number(body.expiresIn ?? 60);
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${raw}?token=${signToken(ctx, bucket, name, exp)}&exp=${exp}` });
    }
    const obj = /^object\/(?:authenticated\/)?([a-z0-9_-]+)\/(.+)$/.exec(rest);
    if (!obj) return storageError(res, 404, 'not_found', `köprüde yok: ${rest}`);
    const [, bucket, raw] = obj as unknown as [string, string, string];
    const name = decodeURIComponent(raw);
    if (req.method === 'GET') {
      if (!(await canRead(ctx, claims, bucket, name))) return storageError(res, 400, 'not_found', 'Object not found');
      return serveFile(ctx, res, bucket, name);
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await readRaw(req);
      let bytes = raw;
      let type = String(req.headers['content-type'] ?? 'application/octet-stream');
      if (type.startsWith('multipart/form-data')) {
        const file = multipartFile(raw, type);
        if (!file) return storageError(res, 400, 'invalid', 'dosya yok');
        bytes = file.bytes;
        type = file.type;
      }
      const upsert = String(req.headers['x-upsert'] ?? 'false') === 'true' || req.method === 'PUT';
      const owner = typeof claims.sub === 'string' ? claims.sub : null;
      try {
        await asClaims(ctx, claims, async (c) => {
          await c.query(
            `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4::jsonb)
             ${upsert ? 'on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()' : ''}`,
            [bucket, name, owner, JSON.stringify({ size: bytes.length, mimetype: type })],
          );
        });
      } catch (err) {
        const e = err as { code?: string; message?: string };
        if (e.code === '23505') return storageError(res, 409, 'Duplicate', 'The resource already exists');
        if (e.code === '42501') return storageError(res, 403, 'Unauthorized', 'new row violates row-level security policy');
        throw err;
      }
      const file = objectFile(ctx, bucket, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      fs.writeFileSync(`${file}.__type`, type);
      return send(res, 200, { Key: `${bucket}/${name}`, Id: randomUUID() });
    }
    return storageError(res, 405, 'method', 'yöntem yok');
  } catch (err) {
    if (err instanceof BridgeError) return storageError(res, err.status, err.code, err.message);
    ctx.log(`storage hatası: ${(err as Error).message}`);
    return storageError(res, 500, 'internal', (err as Error).message);
  }
}

// ------------------------------------------------------------------------------------------------ Auth

async function userByEmail(ctx: Ctx, email: string, create: boolean): Promise<AuthUser | null> {
  const r = await ctx.pool.query(`select id::text, email from auth.users where lower(email) = lower($1)`, [email]);
  if (r.rows[0]) return r.rows[0] as AuthUser;
  if (!create) return null;
  const ins = await ctx.pool.query(`insert into auth.users (email) values (lower($1)) returning id::text, email`, [email]);
  return ins.rows[0] as AuthUser;
}
async function userById(ctx: Ctx, id: string): Promise<AuthUser | null> {
  const r = await ctx.pool.query(`select id::text, email from auth.users where id = $1::uuid`, [id]);
  return (r.rows[0] as AuthUser | undefined) ?? null;
}

async function handleAuth(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, route: string) {
  if (route === 'user' && (req.method === 'GET' || req.method === 'PUT')) {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const c = ctx.jwt.verify(token);
    const u = c?.sub ? await userById(ctx, String(c.sub)) : null;
    return u ? send(res, 200, userObject(u)) : send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'JWT geçersiz' });
  }
  if (route === 'otp' && req.method === 'POST') {
    const body = (await readJson(req)) as { email?: string };
    if (!body.email) return send(res, 422, { code: 422, error_code: 'validation_failed', msg: 'email gerekli' });
    return send(res, 200, {});
  }
  if (route === 'verify' && req.method === 'POST') {
    const body = (await readJson(req)) as { email?: string; token?: string };
    if (!body.email || body.token !== ctx.otp) return send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    return send(res, 200, session(ctx.jwt, (await userByEmail(ctx, body.email, true))!));
  }
  if (route === 'token' && req.method === 'POST') {
    const body = (await readJson(req)) as { refresh_token?: string };
    const [, id64, mac] = String(body.refresh_token ?? '').split('.');
    const id = id64 ? Buffer.from(id64, 'base64url').toString('utf8') : '';
    const u = id && mac === ctx.jwt.mac(id) ? await userById(ctx, id) : null;
    return u ? send(res, 200, session(ctx.jwt, u)) : send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
  }
  if (route === 'logout') return send(res, 204);
  return send(res, 404, { code: 404, msg: `köprüde yok: auth/${route}` });
}

// ------------------------------------------------------------------------------------------------ sunucu

export interface BridgeOptions {
  /** Veritabanı havuzu (süper kullanıcı ya da migration sahibi; her istek rolünü kendisi düşürür). */
  db: { pool: pg.Pool };
  port: number;
  /** Dinlenen adres (varsayılan 127.0.0.1; Docker kapsayıcısında 0.0.0.0, host tarafında yine yalnız 127.0.0.1'e yayınlanır). */
  host?: string;
  /** E-posta kodu: her adres için bu sabit kod kabul edilir (e-posta gönderilmez). */
  otp: string;
  jwtSecret: string;
  log: (msg: string) => void;
  /** Storage nesnelerinin yazıldığı dizin (yoksa açılır). */
  storageDir: string;
  /** anon / service_role anahtarlarının ömrü (sn; varsayılan 1 gün). */
  keyTtlSec?: number;
  /** Anahtarların `iat` değeri (sabit verilirse anahtarlar her açılışta aynıdır; varsayılan şimdi). */
  keyIssuedAt?: number;
  /** /__ready: hazır mı (verilmezse her zaman 200). */
  ready?: () => Promise<boolean>;
  /** /__info gövdesi. */
  info?: () => Record<string, unknown>;
  /**
   * Tarayıcı kökeni izin listesi. Verilirse yalnız eşleşen Origin yansıtılır (`Vary: Origin`), eşleşmeyen Origin'li
   * istek 403 alır; Origin başlığı olmayan (sunucu/worker) istekler serbesttir. Verilmezse her köken kabul edilir ('*').
   */
  allowedOrigins?: string[];
}

/** Origin denetimi: izinliyse true (gerekli CORS başlığını yazar), reddedildiyse false. */
export function applyOrigin(res: http.ServerResponse, origin: string | undefined, allowed: string[] | undefined): boolean {
  if (!allowed) {
    res.setHeader('access-control-allow-origin', '*');
    return true;
  }
  res.setHeader('vary', 'Origin');
  if (origin === undefined) return true;
  if (!allowed.includes(origin)) return false;
  res.setHeader('access-control-allow-origin', origin);
  return true;
}

export interface Bridge {
  url: string;
  anonKey: string;
  serviceKey: string;
  jwt: Jwt;
  server: http.Server;
  close(): Promise<void>;
}

/** Köprüyü 127.0.0.1:<port>'ta açar; port doluysa hata (EADDRINUSE) ile reddedilir. */
export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
  const url = `http://127.0.0.1:${opts.port}`;
  const jwt = createJwt(opts.jwtSecret);
  const { anonKey, serviceKey } = apiKeys(jwt, opts.keyTtlSec, opts.keyIssuedAt);
  fs.mkdirSync(opts.storageDir, { recursive: true });
  const ctx: Ctx = { pool: opts.db.pool, jwt, otp: opts.otp, url, storeDir: opts.storageDir, log: opts.log, tusUploads: new Map() };

  const server = http.createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '/', url);
      const p = u.pathname;
      if (!applyOrigin(res, req.headers.origin, opts.allowedOrigins)) {
        opts.log(`izin verilmeyen köken reddedildi: ${req.headers.origin} ${req.method} ${p}`);
        return send(res, 403, { message: 'Bu köprüye yalnız yerel uygulama (http://localhost:3000) erişebilir.' });
      }
      if (req.method === 'OPTIONS') return send(res, 204);
      if (p === '/__info') return send(res, 200, opts.info?.() ?? {});
      if (p === '/__ready') {
        const ready = opts.ready ? await opts.ready() : true;
        return send(res, ready ? 200 : 503, { ready });
      }
      const auth = /^\/auth\/v1\/(\w+)$/.exec(p);
      if (auth) return handleAuth(ctx, req, res, auth[1]!);
      const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p);
      if (rpc && req.method === 'POST') return handleRpc(ctx, req, res, rpc[1]!);
      const rest = /^\/rest\/v1\/(\w+)$/.exec(p);
      if (rest) return handleRest(ctx, req, res, rest[1]!, u);
      const st = /^\/storage\/v1\/(.+)$/.exec(p);
      if (st) return handleStorage(ctx, req, res, st[1]!, u);
      return send(res, 404, { message: `köprüde yok: ${req.method} ${p}` });
    })().catch((err: unknown) => {
      opts.log(`istek hatası: ${(err as Error).stack ?? err}`);
      if (!res.headersSent) send(res, 500, { message: 'köprü hatası' });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    url,
    anonKey,
    serviceKey,
    jwt,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
