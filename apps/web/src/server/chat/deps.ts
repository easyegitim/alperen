/**
 * Koç sohbeti bağımlılıkları (sunucuya özel). Seçim ortamdan:
 *   - `OGRENMEN_CHAT_STORE=memory`  → süreç içi depo; yalnız `OGRENMEN_LLM=fake` ile açılır (E2E, yerel geliştirme).
 *   - `OGRENMEN_WEB_COACH_DATABASE_URL` → `PgChatStore` (güvenilir sunucu bağlantısı; bkz. pg-store.ts başlığı).
 *     Kapalı başarısızlık (`checkDbRole`): rol RLS'i aşıyorsa (süper kullanıcı, postgres, service_role, BYPASSRLS)
 *     üretimde koç kapanır (503); yerelde yalnız `OGRENMEN_WEB_COACH_TRUSTED_DEV=1` ile açılır. Depo genelindeki
 *     `OGRENMEN_DATABASE_URL` okunmaz. Bağlantı oturum kipinde olmalı (tur kilidi oturum düzeyinde danışma kilidi).
 *   - ikisi de yoksa koç kapalıdır (503, arayüz sade bir hata gösterir).
 * LLM taşıması `OGRENMEN_LLM` (fake | anthropic; anthropic için ANTHROPIC_API_KEY ortamdan okunur, kod değişmez).
 */
import 'server-only';
import pg from 'pg';
import { createGateway, type Gateway } from '@ogrenmen/llm';
import { loadPrompt } from '@ogrenmen/prompts';
import { createPromptResolver } from '@ogrenmen/prompts/db';
import { MemoryChatStore } from './memory-store';
import { PgChatStore, type UserStorageClient } from './pg-store';
import type { ChatStore } from './types';
import { COACH_DB_ENV, COACH_TRUSTED_DEV_ENV, storeKindFor } from './store-kind';
import { ChatError, type CoachRoute, type ProductPrompt, type TurnDeps } from './turn';

type Env = Record<string, string | undefined>;

const G = Symbol.for('ogrenmen.chat.deps');
interface Shared {
  pool?: pg.Pool;
  /** Tur kilitleri (her süren tur bir bağlantı tutar; sorgu havuzunu tüketmesin diye ayrı havuz). */
  locks?: pg.Pool;
  roleCheck?: Promise<void>;
  gateways: Map<string, Promise<Gateway>>;
  products: Map<CoachRoute, ProductPrompt>;
  /** pg kipinde sürüm sabitleme/geri alma için (runtime_flags + prompt_versions, kısa önbellek). */
  resolver?: ReturnType<typeof createPromptResolver>;
}
function shared(): Shared {
  const g = globalThis as typeof globalThis & { [G]?: Shared };
  g[G] ??= { gateways: new Map(), products: new Map() };
  return g[G];
}

function pools(env: Env): { db: pg.Pool; locks: pg.Pool } {
  const s = shared();
  s.pool ??= new pg.Pool({ connectionString: env[COACH_DB_ENV], max: Number(env.OGRENMEN_CHAT_POOL_MAX ?? 5), idleTimeoutMillis: 30_000 });
  s.locks ??= new pg.Pool({
    connectionString: env[COACH_DB_ENV],
    max: Number(env.OGRENMEN_CHAT_LOCK_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return { db: s.pool, locks: s.locks };
}

/**
 * Bağlantı rolü denetimi (süreçte bir kez; kapalı başarısızlık). PgChatStore bugün okumaları da bu bağlantıyla yapar
 * ve öğrenci yalıtımı yalnız sorgulardaki süzgece dayanır (PLAN-v2-detail §2.4'ten bilinen sapma; bkz. pg-store.ts).
 * Bu yüzden RLS'i aşan rol (süper kullanıcı ya da BYPASSRLS: postgres, service_role):
 *   - üretimde her zaman reddedilir (503) — bayrak da açamaz;
 *   - yerelde yalnız `OGRENMEN_WEB_COACH_TRUSTED_DEV=1` ile kabul edilir (uyarıyla), yoksa reddedilir.
 * RLS'e tabi rol geçer (hedef: yalnız EXECUTE yetkili `ogrenmen_web_coach` + SECURITY DEFINER koç RPC'leri + JWT'li
 * okumalar); o yol gelene dek böyle bir rol satır göremez, koç tur başında sade hatayla kapanır.
 */
export async function checkDbRole(db: Pick<pg.Pool, 'query'>, env: Env): Promise<void> {
  const r = await db.query('select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user');
  const row = r.rows[0] as { name: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
  if (!row) throw new ChatError('misconfigured', 503, 'Koç şu an kullanılamıyor.');
  if (!row.rolsuper && !row.rolbypassrls) return;
  if (env.NODE_ENV === 'production') {
    console.error(`OGR-CHAT-011 ${COACH_DB_ENV} rolü (${row.name}) RLS'i aşıyor; üretimde koç kapalı. RLS'e tabi, en az yetkili rol kullan.`);
    throw new ChatError('misconfigured', 503, 'Koç şu an kullanılamıyor.');
  }
  if (env[COACH_TRUSTED_DEV_ENV] !== '1') {
    console.error(`OGR-CHAT-014 ${COACH_DB_ENV} rolü (${row.name}) RLS'i aşıyor; yerelde yalnız ${COACH_TRUSTED_DEV_ENV}=1 ile açılır.`);
    throw new ChatError('misconfigured', 503, 'Koç şu an kullanılamıyor.');
  }
  console.warn(`OGR-CHAT-012 ${COACH_DB_ENV} rolü (${row.name}) RLS'i aşıyor (${COACH_TRUSTED_DEV_ENV}=1, yalnız yerel); tek koruma sorgulardaki öğrenci süzgeci.`);
}

export function coachProduct(route: CoachRoute): ProductPrompt {
  const s = shared();
  let p = s.products.get(route);
  if (!p) {
    const loaded = loadPrompt(route);
    p = { text: loaded.text, version: loaded.meta.version };
    s.products.set(route, p);
  }
  return p;
}

/** İstek başına bağımlılıklar. `user` kullanıcının JWT'li Supabase istemcisidir (Storage ve uploads için). */
export async function chatDeps(user: UserStorageClient | null, env: Env = process.env): Promise<TurnDeps> {
  const kind = storeKindFor(env);
  if (!kind) throw new ChatError('not_configured', 503, 'Koç şu an kullanılamıyor.');
  const s = shared();
  let store: ChatStore;
  if (kind === 'memory') store = new MemoryChatStore();
  else {
    const { db, locks } = pools(env);
    s.roleCheck ??= checkDbRole(db, env).catch((err: unknown) => {
      s.roleCheck = undefined; // geçici bağlantı hatası kalıcı olmasın
      throw err;
    });
    await s.roleCheck;
    store = new PgChatStore(db, user, locks);
  }
  let gw = s.gateways.get(kind);
  if (!gw) {
    // Defter deposu süreç boyunca aynıdır (bellek: süreç içi; pg: aynı havuz).
    gw = createGateway({ ledger: store.ledger(), env });
    s.gateways.set(kind, gw);
  }
  if (kind !== 'pg') return { store, gateway: await gw, product: coachProduct };
  // pg kipi: sürüm sabitlemesi ve geri alma (PLAN §6) koç rotalarına da ulaşır; her turda çözülür (60 sn önbellek).
  const resolver = (s.resolver ??= createPromptResolver(pools(env).db, {
    ttlMs: 60_000,
    onError: (err) => console.warn('OGR-CHAT-013 prompt sürüm kaynakları okunamadı; kilit varsayılanı kullanılıyor.', err),
  }));
  const product = async (route: CoachRoute): Promise<ProductPrompt> => {
    const loaded = await resolver.load(route);
    return { text: loaded.text, version: loaded.meta.version };
  };
  return { store, gateway: await gw, product };
}
