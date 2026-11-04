import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Bellek içi PostgREST taklidi: gerçek supabase-js istemcisi + sahte fetch (Anthropic testlerindeki "gerçek SDK, sahte ağ"
// kalıbı). Desteklenen alt küme: GET (select, eq/in/is süzgeçleri, order, limit, maybeSingle), PATCH (eq süzgeçli update),
// POST (insert, Prefer return=representation), rpc. Tür iddiası yok: istemci gerçektir. Yalnız testlerde.

export type Row = Record<string, unknown>;

export class FakePostgrest {
  tables: Record<string, Row[]> = {};
  log: string[] = [];
  readonly client: SupabaseClient;

  constructor() {
    this.client = createClient("https://fake.supabase.local", "service-role-test-key", { auth: { persistSession: false }, global: { fetch: (input, init) => this.handle(input, init) } });
  }

  private async handle(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const parts = url.pathname.replace(/^\/rest\/v1\//, "").split("/");
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (parts[0] === "rpc") {
      this.log.push(`rpc ${parts[1]} ${String(init?.body ?? "")}`);
      return json(true);
    }
    const table = parts[0]!;
    const rows = (this.tables[table] ??= []);
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    for (const [k, v] of url.searchParams) {
      if (k === "select" || k === "order" || k === "offset") continue;
      if (k === "limit") {
        limit = Number(v);
        continue;
      }
      const m = /^(eq|in|is|neq|gt)\.(.*)$/s.exec(v);
      if (!m) continue;
      const [, op, raw] = m as [string, string, string];
      if (op === "eq") filters.push((r) => String(r[k]) === raw);
      else if (op === "neq") filters.push((r) => String(r[k]) !== raw);
      else if (op === "gt") filters.push((r) => String(r[k]) > raw);
      else if (op === "is") filters.push((r) => (raw === "null" ? r[k] == null : String(r[k]) === raw));
      else if (op === "in") {
        const vals = raw.replace(/^\(|\)$/g, "").split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
        filters.push((r) => vals.includes(String(r[k])));
      }
    }
    const match = rows.filter((r) => filters.every((f) => f(r)));
    if (method === "GET") {
      const out = match.slice(0, limit);
      if (headers.get("Accept")?.includes("vnd.pgrst.object+json")) return out.length === 1 ? json(out[0]) : json({ message: "not single" }, 406);
      return json(out);
    }
    if (method === "PATCH") {
      const patch = JSON.parse(String(init?.body ?? "{}")) as Row;
      for (const r of match) Object.assign(r, patch);
      this.log.push(`update ${table} ${match.length}`);
      return json(match);
    }
    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Row | Row[];
      const inserted = (Array.isArray(body) ? body : [body]).map((b) => ({ id: `${table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...b }));
      rows.push(...inserted);
      this.log.push(`insert ${table}`);
      if (headers.get("Accept")?.includes("vnd.pgrst.object+json")) return json(inserted[0]);
      return json(headers.get("Prefer")?.includes("return=representation") ? inserted : null, 201);
    }
    return json({ message: `unsupported ${method}` }, 405);
  }
}
