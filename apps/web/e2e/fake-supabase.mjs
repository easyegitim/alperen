// E2E için sahte Supabase: yalnız web'in konuştuğu uçlar (Auth + PostgREST alt kümesi). Gerçek Supabase'in yerini
// tutmaz; amaç, web uygulamasının oturum/rol/yönlendirme davranışını ağ olmadan sınamaktır. RLS taklit edilmez
// (sorgular zaten kimliğe göre süzer); gerçek RLS supabase/tests altında sınanır.
import http from 'node:http';
import { FAKE_PORT, OTP_CODE, USERS, seedTables } from './fixtures.mjs';
import { makeSession, userObject } from './jwt.mjs';

const tables = seedTables();
const requests = [];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers });
  res.end(payload);
}

function userFromAuth(req) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Object.values(USERS).find((u) => u.id === payload.sub) ?? null;
  } catch {
    return null;
  }
}

function applyFilters(rows, searchParams) {
  let out = rows;
  for (const [key, value] of searchParams) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(key)) continue;
    const m = /^(eq|in|neq|is)\.(.*)$/.exec(value);
    if (!m) continue;
    const [, op, arg] = m;
    if (op === 'eq') out = out.filter((r) => String(r[key]) === arg);
    else if (op === 'neq') out = out.filter((r) => String(r[key]) !== arg);
    else if (op === 'is') out = out.filter((r) => (arg === 'null' ? r[key] == null : r[key] != null));
    else if (op === 'in') {
      const set = new Set(arg.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')));
      out = out.filter((r) => set.has(String(r[key])));
    }
  }
  const order = searchParams.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  const limit = Number(searchParams.get('limit'));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function project(rows, select) {
  if (!select || select === '*') return rows;
  const cols = select.split(',').map((c) => c.trim());
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${FAKE_PORT}`);
  const path = url.pathname;
  requests.push(`${req.method} ${path}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
    return res.end();
  }

  // Sınama kancaları
  if (path === '/__health') return send(res, 200, { ok: true });
  if (path === '/__requests') return send(res, 200, requests);
  if (path === '/__reset') {
    requests.length = 0;
    return send(res, 200, { ok: true });
  }

  // --- Auth ---
  if (path === '/auth/v1/user' && req.method === 'GET') {
    const user = userFromAuth(req);
    return user ? send(res, 200, userObject(user)) : send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'JWT geçersiz' });
  }
  if (path === '/auth/v1/user' && req.method === 'PUT') {
    const user = userFromAuth(req);
    return user ? send(res, 200, userObject(user)) : send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'JWT geçersiz' });
  }
  if (path === '/auth/v1/otp' && req.method === 'POST') {
    const body = await readBody(req);
    if (!body.email) return send(res, 422, { code: 422, error_code: 'validation_failed', msg: 'email gerekli' });
    return send(res, 200, {});
  }
  if (path === '/auth/v1/verify' && req.method === 'POST') {
    const body = await readBody(req);
    const user = Object.values(USERS).find((u) => u.email === body.email);
    if (!user || body.token !== OTP_CODE) return send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    return send(res, 200, makeSession(user));
  }
  if (path === '/auth/v1/token' && req.method === 'POST') {
    const body = await readBody(req);
    const user = Object.values(USERS).find((u) => `refresh-${u.id}` === body.refresh_token);
    return user ? send(res, 200, makeSession(user)) : send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
  }
  if (path === '/auth/v1/logout') {
    res.writeHead(204, { 'access-control-allow-origin': '*' });
    return res.end();
  }

  // --- PostgREST ---
  const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(path);
  if (rpc && req.method === 'POST') {
    const body = await readBody(req);
    if (rpc[1] === 'accept_guardian_invite') {
      if (String(body.p_token).startsWith('gi_gecersiz')) return send(res, 400, { code: 'P0001', message: 'OGR-INV-001 davet bulunamadı ya da kullanılmış', details: null, hint: null });
      return send(res, 200, { link_id: 'l1', student_id: 's1' });
    }
    return send(res, 404, { message: 'rpc yok' });
  }
  const rest = /^\/rest\/v1\/(\w+)$/.exec(path);
  if (rest) {
    const table = tables[rest[1]];
    if (!table) return send(res, 404, { code: '42P01', message: `${rest[1]} yok` });
    if (req.method === 'GET') {
      const rows = project(applyFilters(table, url.searchParams), url.searchParams.get('select'));
      if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
        return rows.length === 1
          ? send(res, 200, rows[0])
          : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
      }
      return send(res, 200, rows);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      table.push(...(Array.isArray(body) ? body : [body]));
      return send(res, 201, undefined);
    }
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      for (const row of applyFilters(table, url.searchParams)) Object.assign(row, body);
      return send(res, 204, undefined);
    }
    if (req.method === 'DELETE') return send(res, 204, undefined);
  }
  return send(res, 404, { message: `Sahte sunucuda yok: ${req.method} ${path}` });
});

server.listen(FAKE_PORT, '127.0.0.1', () => {
  console.log(`sahte supabase http://127.0.0.1:${FAKE_PORT}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
