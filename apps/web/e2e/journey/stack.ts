/**
 * P1 yolculuk yığını (YALNIZ SINAMA; `bun e2e/journey/stack.ts`, playwright.journey.config.ts webServer'ı açar):
 *
 *   1. Geçici v2 veritabanı (packages/llm testing: stub + göçler + seed + TYT müfredatı) + TYT cevap anahtarları
 *      (content/tyt-matematik/scripts/seed-keys.py --schema v2). Bağlanılan 'ogrenmen' veritabanına dokunmaz.
 *   2. Gerçek Postgres üzerinde Supabase uyumlu yerel köprü (bu dosya): Auth (e-posta kodu, sabit JOURNEY_OTP),
 *      PostgREST alt kümesi (tablo okuma/yazma, RPC) ve Storage (uploads/documents/figures). Her istek kendi işleminde
 *      `request.jwt.claims` + `set local role authenticated|anon|service_role` ile koşar: RLS, RPC'ler ve Storage
 *      politikaları (storage.objects) gerçektir; yalnız HTTP katmanı taklittir. Realtime yok (ekranlar yoklamaya düşer).
 *   3. apps/worker (gerçek pg-boss, OGRENMEN_LLM=fake, Storage = bu köprü, service_role JWT'si).
 *   4. apps/web `next dev` (.next-journey; OGRENMEN_LLM=fake; koç: SupabaseChatStore — yalnız kullanıcının JWT'si ile bu
 *      köprünün RPC yolu (0028 koç RPC'leri) + sunucu anahtarı OGRENMEN_WEB_COACH_KEY (göçün ürettiği secure.server_keys
 *      'web_coach' değeri); web'e veritabanı adresi verilmez).
 *
 * Uçlar: /__ready (hepsi hazırsa 200), /__info ({dbUrl}); SIGTERM/SIGINT'te çocuklar durur, veritabanı silinir.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createTempDatabase, REPO_ROOT, type TempDatabase } from '@ogrenmen/llm/testing';
import { BRIDGE_PORT, BRIDGE_URL, JOURNEY_JWT_SECRET, JOURNEY_OTP, JOURNEY_WEB_PORT, JOURNEY_WEB_URL, WORKER_HEALTH_PORT } from './config.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WORKER_DIR = path.join(REPO_ROOT, 'apps', 'worker');
const LOG_DIR = path.join(WEB_DIR, 'test-results', 'journey');
fs.mkdirSync(LOG_DIR, { recursive: true });
const log = (msg: string) => process.stdout.write(`[journey] ${msg}\n`);

// ------------------------------------------------------------------------------------------------ JWT

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');
function sign(payload: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', JOURNEY_JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token: string): Record<string, unknown> | null {
  const [h, b, s] = token.split('.');
  if (!h || !b || !s) return null;
  const want = createHmac('sha256', JOURNEY_JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  if (want !== s) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}
const now = () => Math.floor(Date.now() / 1000);
export const ANON_KEY = sign({ role: 'anon', iss: 'journey', iat: now(), exp: now() + 86_400 });
const SERVICE_KEY = sign({ role: 'service_role', iss: 'journey', iat: now(), exp: now() + 86_400 });

interface AuthUser {
  id: string;
  email: string;
}
function userObject(u: AuthUser) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
}
function session(u: AuthUser) {
  const exp = now() + 3600;
  return {
    access_token: sign({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', iat: now(), exp }),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `refresh.${b64url(u.id)}.${createHmac('sha256', JOURNEY_JWT_SECRET).update(u.id).digest('base64url')}`,
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
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
function send(res: http.ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  if (body === undefined) {
    res.writeHead(status, { ...CORS, ...headers });
    return res.end();
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers });
  res.end(JSON.stringify(body));
}

/** İstekteki JWT'nin iddiaları: kullanıcı jetonu yoksa apikey (anon / service_role). */
function claimsOf(req: http.IncomingMessage): Record<string, unknown> | null {
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const apikey = String(req.headers.apikey ?? '');
  return verify(bearer) ?? verify(apikey);
}

// ------------------------------------------------------------------------------------------------ Postgres

let db: TempDatabase;
const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new BridgeError(400, 'PGRST100', `geçersiz ad: ${s}`);
  return `"${s}"`;
};
class BridgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** İddialarla tek işlem: RLS ve auth.uid() gerçek Supabase'deki gibi. */
async function asClaims<T>(claims: Record<string, unknown>, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const role = claims.role === 'service_role' ? 'service_role' : claims.role === 'authenticated' ? 'authenticated' : 'anon';
  const c = await db.pool.connect();
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

function pgError(res: http.ServerResponse, err: unknown) {
  if (err instanceof BridgeError) return send(res, err.status, { code: err.code, message: err.message, details: null, hint: null });
  const e = err as { code?: string; message?: string; detail?: string; hint?: string };
  const code = e.code ?? 'XX000';
  const status = code === '42501' ? 403 : code === '23505' || code === '23503' ? 409 : code === '42883' || code === '42P01' ? 404 : code.startsWith('08') ? 503 : 400;
  if (status >= 500 || !/^(P0001|23|42501|22)/.test(code)) log(`pg hatası ${code}: ${e.message}`);
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

async function tableExists(table: string): Promise<boolean> {
  const r = await db.pool.query(`select to_regclass($1) is not null as ok`, [`public.${table}`]);
  return Boolean(r.rows[0]?.ok);
}

async function handleRest(req: http.IncomingMessage, res: http.ServerResponse, table: string, url: URL) {
  const claims = claimsOf(req);
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT geçersiz', details: null, hint: null });
  if (!(await tableExists(table))) return send(res, 404, { code: '42P01', message: `public.${table} yok`, details: null, hint: null });
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
      const rows = await asClaims(claims, async (c) => {
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
      const out = await asClaims(claims, async (c) => {
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
      const out = await asClaims(claims, async (c) => {
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
      const out = await asClaims(claims, async (c) => ((await c.query(sql, values)).rows[0]?.rows ?? []) as unknown[]);
      return wantRows ? finish(out) : send(res, 204);
    }
    return send(res, 405, { code: 'PGRST', message: 'yöntem yok', details: null, hint: null });
  } catch (err) {
    return pgError(res, err);
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

async function functionSigs(name: string): Promise<FnSig[]> {
  const r = await db.pool.query(
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

async function handleRpc(req: http.IncomingMessage, res: http.ServerResponse, fn: string) {
  const claims = claimsOf(req);
  if (!claims) return send(res, 401, { code: 'PGRST301', message: 'JWT geçersiz', details: null, hint: null });
  try {
    const args = ((await readJson(req)) ?? {}) as Record<string, unknown>;
    const keys = Object.keys(args);
    const sigs = (await functionSigs(ident(fn).slice(1, -1))).filter(
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
    const out = await asClaims(claims, async (c) => {
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
    return pgError(res, err);
  }
}

// ------------------------------------------------------------------------------------------------ Storage

const STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ogrenmen-journey-storage-'));
const objectFile = (bucket: string, name: string) => {
  const p = path.join(STORE_DIR, bucket, name);
  if (!p.startsWith(path.join(STORE_DIR, bucket) + path.sep)) throw new BridgeError(400, 'InvalidKey', 'geçersiz yol');
  return p;
};
const signToken = (bucket: string, name: string, exp: number) => createHmac('sha256', JOURNEY_JWT_SECRET).update(`${bucket}/${name}:${exp}`).digest('base64url');
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

async function canRead(claims: Record<string, unknown>, bucket: string, name: string): Promise<boolean> {
  return asClaims(claims, async (c) => (await c.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, name])).rowCount === 1);
}

function serveFile(res: http.ServerResponse, bucket: string, name: string) {
  const file = objectFile(bucket, name);
  if (!fs.existsSync(file)) return storageError(res, 404, 'not_found', 'Object not found');
  const meta = fs.existsSync(`${file}.__type`) ? fs.readFileSync(`${file}.__type`, 'utf8') : 'application/octet-stream';
  res.writeHead(200, { ...CORS, 'content-type': meta });
  return res.end(fs.readFileSync(file));
}

async function handleStorage(req: http.IncomingMessage, res: http.ServerResponse, rest: string, url: URL) {
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
      if (!exp || exp < now() || url.searchParams.get('token') !== signToken(bucket, decodeURIComponent(name), exp)) return storageError(res, 400, 'InvalidSignature', 'invalid signature');
      return serveFile(res, bucket, decodeURIComponent(name));
    }
    const claims = claimsOf(req);
    if (!claims) return storageError(res, 401, 'Unauthorized', 'jwt geçersiz');
    if (signed && req.method === 'POST') {
      const [, bucket, raw] = signed as unknown as [string, string, string];
      const name = decodeURIComponent(raw);
      if (!(await canRead(claims, bucket, name))) return storageError(res, 400, 'not_found', 'Object not found');
      const body = (await readJson(req)) as { expiresIn?: number };
      const exp = now() + Number(body.expiresIn ?? 60);
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${raw}?token=${signToken(bucket, name, exp)}&exp=${exp}` });
    }
    const obj = /^object\/(?:authenticated\/)?([a-z0-9_-]+)\/(.+)$/.exec(rest);
    if (!obj) return storageError(res, 404, 'not_found', `köprüde yok: ${rest}`);
    const [, bucket, raw] = obj as unknown as [string, string, string];
    const name = decodeURIComponent(raw);
    if (req.method === 'GET') {
      if (!(await canRead(claims, bucket, name))) return storageError(res, 400, 'not_found', 'Object not found');
      return serveFile(res, bucket, name);
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
        await asClaims(claims, async (c) => {
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
      const file = objectFile(bucket, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      fs.writeFileSync(`${file}.__type`, type);
      return send(res, 200, { Key: `${bucket}/${name}`, Id: randomUUID() });
    }
    return storageError(res, 405, 'method', 'yöntem yok');
  } catch (err) {
    if (err instanceof BridgeError) return storageError(res, err.status, err.code, err.message);
    log(`storage hatası: ${(err as Error).message}`);
    return storageError(res, 500, 'internal', (err as Error).message);
  }
}

// ------------------------------------------------------------------------------------------------ Auth

async function userByEmail(email: string, create: boolean): Promise<AuthUser | null> {
  const r = await db.pool.query(`select id::text, email from auth.users where lower(email) = lower($1)`, [email]);
  if (r.rows[0]) return r.rows[0] as AuthUser;
  if (!create) return null;
  const ins = await db.pool.query(`insert into auth.users (email) values (lower($1)) returning id::text, email`, [email]);
  return ins.rows[0] as AuthUser;
}
async function userById(id: string): Promise<AuthUser | null> {
  const r = await db.pool.query(`select id::text, email from auth.users where id = $1::uuid`, [id]);
  return (r.rows[0] as AuthUser | undefined) ?? null;
}

async function handleAuth(req: http.IncomingMessage, res: http.ServerResponse, route: string, url: URL) {
  if (route === 'user' && (req.method === 'GET' || req.method === 'PUT')) {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const c = verify(token);
    const u = c?.sub ? await userById(String(c.sub)) : null;
    return u ? send(res, 200, userObject(u)) : send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'JWT geçersiz' });
  }
  if (route === 'otp' && req.method === 'POST') {
    const body = (await readJson(req)) as { email?: string };
    if (!body.email) return send(res, 422, { code: 422, error_code: 'validation_failed', msg: 'email gerekli' });
    return send(res, 200, {});
  }
  if (route === 'verify' && req.method === 'POST') {
    const body = (await readJson(req)) as { email?: string; token?: string };
    if (!body.email || body.token !== JOURNEY_OTP) return send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    return send(res, 200, session((await userByEmail(body.email, true))!));
  }
  if (route === 'token' && req.method === 'POST') {
    const body = (await readJson(req)) as { refresh_token?: string };
    const [, id64, mac] = String(body.refresh_token ?? '').split('.');
    const id = id64 ? Buffer.from(id64, 'base64url').toString('utf8') : '';
    const u = id && mac === createHmac('sha256', JOURNEY_JWT_SECRET).update(id).digest('base64url') ? await userById(id) : null;
    void url;
    return u ? send(res, 200, session(u)) : send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
  }
  if (route === 'logout') return send(res, 204);
  return send(res, 404, { code: 404, msg: `köprüde yok: auth/${route}` });
}

// ------------------------------------------------------------------------------------------------ süreçler

const children: ChildProcess[] = [];
function startChild(name: string, cmd: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'w');
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out] });
  child.on('exit', (code, signal) => {
    if (!stopping) log(`${name} çıktı (kod ${code}, sinyal ${signal}); günlük: test-results/journey/${name}.log`);
  });
  children.push(child);
  return child;
}

async function ok(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return r.ok;
  } catch {
    return false;
  }
}

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1_500));
  for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
  await db?.drop().catch((e: unknown) => log(`veritabanı silinemedi: ${(e as Error).message}`));
  fs.rmSync(STORE_DIR, { recursive: true, force: true });
  log('durdu; geçici veritabanı silindi');
  process.exit(code);
}
process.on('SIGTERM', () => void stop(0));
process.on('SIGINT', () => void stop(0));

async function main() {
  log('geçici veritabanı kuruluyor (göçler + seed + TYT müfredatı)');
  db = await createTempDatabase();
  execFileSync('python3', [path.join(REPO_ROOT, 'content/tyt-matematik/scripts/seed-keys.py'), '--schema', 'v2', '--database-url', db.url], {
    stdio: 'pipe',
    env: { ...process.env, PGOPTIONS: '-c role=ogrenmen_owner' },
  });
  log(`veritabanı hazır: ${db.name}`);
  const coachKey = String((await db.pool.query(`select secret from secure.server_keys where name = 'web_coach'`)).rows[0]?.secret ?? '');

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', BRIDGE_URL);
      const p = url.pathname;
      if (req.method === 'OPTIONS') return send(res, 204);
      if (p === '/__info') return send(res, 200, { dbUrl: db.url, dbName: db.name, web: JOURNEY_WEB_URL });
      if (p === '/__ready') {
        const ready = (await ok(`http://127.0.0.1:${WORKER_HEALTH_PORT}/healthz`)) && (await ok(`${JOURNEY_WEB_URL}/api/health`));
        return send(res, ready ? 200 : 503, { ready });
      }
      const auth = /^\/auth\/v1\/(\w+)$/.exec(p);
      if (auth) return handleAuth(req, res, auth[1]!, url);
      const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(p);
      if (rpc && req.method === 'POST') return handleRpc(req, res, rpc[1]!);
      const rest = /^\/rest\/v1\/(\w+)$/.exec(p);
      if (rest) return handleRest(req, res, rest[1]!, url);
      const st = /^\/storage\/v1\/(.+)$/.exec(p);
      if (st) return handleStorage(req, res, st[1]!, url);
      return send(res, 404, { message: `köprüde yok: ${req.method} ${p}` });
    })().catch((err: unknown) => {
      log(`istek hatası: ${(err as Error).stack ?? err}`);
      if (!res.headersSent) send(res, 500, { message: 'köprü hatası' });
    });
  });
  await new Promise<void>((resolve) => server.listen(BRIDGE_PORT, '127.0.0.1', resolve));
  log(`köprü ${BRIDGE_URL}`);

  // Worker, Supabase'deki gibi migration sahibinin rolüyle bağlanır (yerel eşleniği ogrenmen_owner; supabase/README.md
  // "pgboss şemasını worker kurar"): pgboss şeması bu role ait olur, SECURITY DEFINER enqueue_job pgboss.job'a yazabilir.
  startChild('worker', 'node', ['--import', 'tsx', 'src/index.ts'], WORKER_DIR, {
    DATABASE_URL: db.url,
    PGOPTIONS: '-c role=ogrenmen_owner',
    WORKER_PROCESS: 'worker',
    WORKER_SCHEDULES: 'off',
    HEALTH_HOST: '127.0.0.1',
    HEALTH_PORT: String(WORKER_HEALTH_PORT),
    SUPABASE_URL: BRIDGE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    OGRENMEN_LLM: 'fake',
    LOG_LEVEL: 'info',
  });
  startChild('web', 'node', [path.join(WEB_DIR, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '-p', String(JOURNEY_WEB_PORT), '-H', '127.0.0.1'], WEB_DIR, {
    NEXT_DIST_DIR: '.next-journey',
    NEXT_PUBLIC_SUPABASE_URL: BRIDGE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    NEXT_PUBLIC_SITE_URL: JOURNEY_WEB_URL,
    NEXT_TELEMETRY_DISABLED: '1',
    OGRENMEN_LLM: 'fake',
    // Kurucunun üretimde yaptığı gibi: göçün ürettiği anahtar web sunucusunun ortamına kopyalanır (tarayıcıya gitmez).
    OGRENMEN_WEB_COACH_KEY: coachKey,
  });
}

main().catch((err: unknown) => {
  log(`açılış hatası: ${(err as Error).stack ?? err}`);
  void stop(1);
});
