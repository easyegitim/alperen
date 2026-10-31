// Tarayıcı içi Supabase istemcisi: GoTrue REST (e-posta + şifre; magic link PKCE ile) ve PostgREST (RLS altında).
// BLUEPRINT §7: panel yalnız anon anahtarı ve kullanıcı oturumu taşır; service rolü ve LLM çağrısı yoktur.
// Bağımlılık yok: `fetch` ile; sahte fetch verilerek test edilir (test/live.test.ts).
import { PanelError, codeOf } from './errors';

export interface SessionData {
  access_token: string;
  refresh_token: string;
  /** epoch saniye */
  expires_at: number;
  user: { id: string; email: string | null };
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SupabaseOptions {
  url: string;
  anonKey: string;
  fetch?: typeof fetch;
  storage?: KV | null;
  now?: () => number;
}

const SESSION_KEY = 'ogrenmen.panel.session';
const VERIFIER_KEY = 'ogrenmen.panel.pkce';

function encodeValue(v: unknown): string {
  if (v === null) return 'null';
  const s = String(v);
  return /[,()"\s]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class SupabaseClient {
  readonly url: string;
  readonly anonKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly kv: KV | null;
  private readonly now: () => number;
  private session: SessionData | null = null;

  constructor(opts: SupabaseOptions) {
    if (!opts.url || !opts.anonKey) throw new PanelError('PANEL-NET', 'Supabase adresi ya da anon anahtarı tanımlı değil');
    this.url = opts.url.replace(/\/+$/, '');
    this.anonKey = opts.anonKey;
    this.fetchImpl = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.kv = opts.storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : opts.storage;
    this.now = opts.now ?? (() => Date.now());
    const raw = this.kv?.getItem(SESSION_KEY);
    if (raw) {
      try {
        this.session = JSON.parse(raw) as SessionData;
      } catch {
        this.session = null;
      }
    }
  }

  // ------------------------------------------------------------------ auth (GoTrue REST)
  readonly auth = {
    signInWithPassword: async (email: string, password: string): Promise<SessionData> => {
      const res = await this.authRequest('/auth/v1/token?grant_type=password', { email, password });
      return this.storeSession(res);
    },
    /** Magic link (ikincil): PKCE doğrulayıcı yerelde saklanır; dönüşte exchangeCode çağrılır. */
    signInWithOtp: async (email: string, redirectTo: string): Promise<void> => {
      const verifierBytes = new Uint8Array(48);
      crypto.getRandomValues(verifierBytes);
      const verifier = base64url(verifierBytes);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      this.kv?.setItem(VERIFIER_KEY, verifier);
      await this.authRequest(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        email,
        create_user: false,
        code_challenge: base64url(digest),
        code_challenge_method: 's256',
      });
    },
    exchangeCode: async (authCode: string): Promise<SessionData> => {
      const verifier = this.kv?.getItem(VERIFIER_KEY);
      if (!verifier) throw new PanelError('PANEL-AUTH', 'PKCE doğrulayıcısı yok');
      const res = await this.authRequest('/auth/v1/token?grant_type=pkce', { auth_code: authCode, code_verifier: verifier });
      this.kv?.removeItem(VERIFIER_KEY);
      return this.storeSession(res);
    },
    signOut: async (): Promise<void> => {
      const s = this.session;
      this.session = null;
      this.kv?.removeItem(SESSION_KEY);
      if (s) {
        await this.fetchImpl(`${this.url}/auth/v1/logout`, {
          method: 'POST',
          headers: { apikey: this.anonKey, Authorization: `Bearer ${s.access_token}` },
        }).catch(() => undefined);
      }
    },
    getSession: async (): Promise<SessionData | null> => {
      const s = this.session;
      if (!s) return null;
      if (s.expires_at - 60 > this.now() / 1000) return s;
      try {
        const res = await this.authRequest('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
        return this.storeSession(res);
      } catch {
        this.session = null;
        this.kv?.removeItem(SESSION_KEY);
        return null;
      }
    },
  };

  private async authRequest(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}${path}`, {
        method: 'POST',
        headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new PanelError('PANEL-NET');
    }
    const text = await res.text();
    // GoTrue hata gövdesi JSON olmayabilir (ör. vekil sunucudan HTML 502); ham SyntaxError kullanıcıya sızmaz.
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
      } catch {
        json = {};
      }
    }
    if (!res.ok) throw new PanelError(res.status >= 500 ? 'PANEL-NET' : 'PANEL-AUTH', String(json.error_description ?? json.msg ?? res.status));
    return json;
  }

  private storeSession(res: Record<string, unknown>): SessionData {
    const user = (res.user ?? {}) as { id?: string; email?: string };
    if (typeof res.access_token !== 'string' || !user.id) throw new PanelError('PANEL-AUTH', 'oturum yanıtı eksik');
    const expiresIn = typeof res.expires_in === 'number' ? res.expires_in : 3600;
    const session: SessionData = {
      access_token: res.access_token,
      refresh_token: String(res.refresh_token ?? ''),
      expires_at: typeof res.expires_at === 'number' ? res.expires_at : Math.floor(this.now() / 1000) + expiresIn,
      user: { id: user.id, email: user.email ?? null },
    };
    this.session = session;
    this.kv?.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  /** Oturum varsa kullanıcı belirteci, yoksa anon anahtarı (yalnız anon'a açık RPC'ler için). */
  async bearer(): Promise<string> {
    const s = await this.auth.getSession();
    return s ? s.access_token : this.anonKey;
  }

  // ------------------------------------------------------------------ PostgREST
  from<T = Record<string, unknown>>(table: string): Query<T> {
    return new Query<T>(this, table);
  }

  /**
   * `anon: true`: oturum olsa bile anon anahtarıyla çağırır. Yalnız anon'a açık RPC'ler (redeem_guardian_token, §3.9)
   * için gerekir: personel /onay bağlantısını kendi tarayıcısında açarsa çağrı `authenticated` olarak reddedilmez.
   */
  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}, opts: { anon?: boolean } = {}): Promise<T> {
    return this.request<T>('POST', `/rest/v1/rpc/${fn}`, { body: args, anon: opts.anon });
  }

  async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; prefer?: string; raw?: BodyInit; contentType?: string; anon?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      apikey: this.anonKey,
      Authorization: `Bearer ${opts.anon ? this.anonKey : await this.bearer()}`,
    };
    if (opts.raw === undefined) headers['Content-Type'] = 'application/json';
    else if (opts.contentType) headers['Content-Type'] = opts.contentType;
    if (opts.prefer) headers.Prefer = opts.prefer;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.url}${path}`, {
        method,
        headers,
        body: opts.raw !== undefined ? opts.raw : opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch {
      throw new PanelError('PANEL-NET');
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) {
      const msg = typeof json === 'object' && json !== null ? String((json as { message?: unknown }).message ?? '') : String(json ?? '');
      throw new PanelError(codeOf(msg) ?? (res.status === 401 || res.status === 403 ? 'OGR-AUTH-002' : 'PANEL-NET'), msg);
    }
    return json as T;
  }

  /** Storage yüklemesi (exams/<uuid>.pdf; authenticated insert politikası, §3.6 0017). */
  async uploadObject(bucket: string, path: string, body: Blob, contentType: string): Promise<void> {
    await this.request('POST', `/storage/v1/object/${bucket}/${path}`, { raw: body, contentType });
  }

  /** Storage nesnesini siler (kayıt yazılamazsa yetim dosya bırakmamak için). */
  async removeObject(bucket: string, path: string): Promise<void> {
    await this.request('DELETE', `/storage/v1/object/${bucket}/${path}`);
  }

  /** Herkese açık kova (figures) için URL. */
  publicObjectUrl(bucket: string, path: string): string {
    return `${this.url}/storage/v1/object/public/${bucket}/${path}`;
  }
}

type Filter = [string, string];

export class Query<T> implements PromiseLike<T[]> {
  private cols = '*';
  private filters: Filter[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET';
  private body: unknown = undefined;

  constructor(
    private readonly client: SupabaseClient,
    readonly table: string,
  ) {}

  select(cols: string): this {
    this.cols = cols.replace(/\s+/g, '');
    return this;
  }
  eq(col: string, v: unknown): this {
    this.filters.push([col, `eq.${encodeValue(v)}`]);
    return this;
  }
  neq(col: string, v: unknown): this {
    this.filters.push([col, `neq.${encodeValue(v)}`]);
    return this;
  }
  in(col: string, vs: readonly unknown[]): this {
    this.filters.push([col, `in.(${vs.map(encodeValue).join(',')})`]);
    return this;
  }
  is(col: string, v: null | boolean): this {
    this.filters.push([col, `is.${v === null ? 'null' : String(v)}`]);
    return this;
  }
  gte(col: string, v: unknown): this {
    this.filters.push([col, `gte.${encodeValue(v)}`]);
    return this;
  }
  lte(col: string, v: unknown): this {
    this.filters.push([col, `lte.${encodeValue(v)}`]);
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orders.push(`${col}.${opts.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.method = 'POST';
    this.body = rows;
    return this;
  }
  update(fields: Record<string, unknown>): this {
    this.method = 'PATCH';
    this.body = fields;
    return this;
  }
  delete(): this {
    this.method = 'DELETE';
    return this;
  }

  /** Oluşan PostgREST yolu (test ve hata ayıklama için). */
  path(): string {
    const q = new URLSearchParams();
    if (this.method === 'GET' || this.method === 'POST' || this.method === 'PATCH') q.set('select', this.cols);
    for (const [c, f] of this.filters) q.append(c, f);
    if (this.orders.length) q.set('order', this.orders.join(','));
    if (this.lim !== null) q.set('limit', String(this.lim));
    return `/rest/v1/${this.table}?${q.toString()}`;
  }

  async execute(): Promise<T[]> {
    const prefer = this.method === 'GET' ? undefined : 'return=representation';
    const res = await this.client.request<T[] | null>(this.method, this.path(), { body: this.body, prefer });
    return Array.isArray(res) ? res : [];
  }

  async maybeSingle(): Promise<T | null> {
    const rows = await this.execute();
    return rows.length > 0 ? rows[0] : null;
  }

  then<R1 = T[], R2 = never>(
    onfulfilled?: ((value: T[]) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}
