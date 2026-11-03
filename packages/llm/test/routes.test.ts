import { describe, expect, it } from 'vitest';
import { contractRegistry, LLM_OUTPUT_SCHEMA_NAMES } from '@ogrenmen/contracts';
import { FALLBACK_BETA } from '../src/client.js';
import { collectBreakpoints } from '../src/prompt.js';
import { familyOf, MODELS, ROUTE_NAMES, ROUTES, validateRoute, type RouteConfig, type RouteName } from '../src/routes.js';
import { COURSE, DOSSIER, hasKeyDeep, PRODUCT, setup } from './helpers.js';

const all = ROUTE_NAMES.map((n) => ROUTES[n] as RouteConfig);

function body(route: RouteName, opts: { batch?: boolean } = {}) {
  const { gateway } = setup();
  return gateway.buildRequest(
    route,
    {
      system: { product: PRODUCT, course: COURSE, dossier: DOSSIER },
      history: [
        { role: 'user', content: 'Merhaba' },
        { role: 'assistant', content: 'Merhaba, hangi soruya bakalım?' },
      ],
      user: 'Bu soruyu nasıl çözerim?',
      turn: { date: '2026-11-02', mode: 'hint' },
    },
    opts,
  );
}

describe('rota tablosu', () => {
  it('görevdeki 26 rotanın hepsi tanımlı', () => {
    expect(ROUTE_NAMES).toHaveLength(26);
    for (const n of ROUTE_NAMES) expect(ROUTES[n].name).toBe(n);
  });

  it.each(all.map((r) => [r.name, r] as const))('%s kurallara uyar', (_n, r) => {
    expect(validateRoute(r)).toEqual([]);
  });

  it('şemalar contracts kayıt defterinde ve model çıktısı şeması (exam-priority-plan hariç)', () => {
    for (const r of all) {
      if (r.schema === null) continue;
      expect(contractRegistry[r.schema]).toBeDefined();
      if (r.schema !== 'exam-priority-plan') expect(LLM_OUTPUT_SCHEMA_NAMES).toContain(r.schema);
    }
  });

  it('plan §5 model eşlemesi', () => {
    expect(ROUTES.solution_diagnosis.model).toBe(MODELS.opus);
    expect(ROUTES.solution_diagnosis.effort).toBe('high');
    expect(ROUTES.coach_chat.model).toBe(MODELS.sonnet);
    expect(ROUTES.coach_chat.effort).toBe('medium');
    expect(ROUTES.page_class.model).toBe(MODELS.haiku);
    expect(ROUTES.curriculum_draft.tools).toEqual(['web_search', 'web_fetch']);
    expect(ROUTES.inferred_keys.mode).toBe('batch');
    expect(ROUTES.memory_compaction.mode).toBe('batch');
    expect(ROUTES.eval_judge.mode).toBe('batch');
    expect(ROUTES.priority_plan.effort).toBe('medium');
  });

  it('fallbacks yalnız Opus/Sonnet senkron rotalarda', () => {
    for (const r of all) {
      const fam = familyOf(r.model);
      expect(r.fallbacks, r.name).toBe(r.mode === 'sync' && fam !== 'haiku');
    }
  });
});

describe('istek gövdesi', () => {
  it.each(ROUTE_NAMES.filter((n) => ROUTES[n].mode === 'sync'))('%s: örnekleme parametresi ve zorlanmış tool_choice yok', (n) => {
    const b = body(n);
    for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice', 'budget_tokens']) expect(hasKeyDeep(b, k), k).toBe(false);
  });

  it('Opus rotalarında thinking alanı yok; effort output_config içinde', () => {
    for (const r of all.filter((x) => familyOf(x.model) === 'opus')) {
      const b = body(r.name, { batch: r.mode === 'batch' });
      expect(b.thinking, r.name).toBeUndefined();
      expect(b.output_config?.effort, r.name).toBe(r.effort);
    }
  });

  it('Sonnet düşünme kapalı → between_tools (effort ≤ high); adaptive → alan yok', () => {
    for (const r of all.filter((x) => familyOf(x.model) === 'sonnet')) {
      const b = body(r.name, { batch: r.mode === 'batch' });
      if (r.thinking === 'off') {
        expect(b.thinking, r.name).toEqual({ type: 'between_tools' });
        expect(['low', 'medium', 'high']).toContain(b.output_config?.effort);
      } else expect(b.thinking, r.name).toBeUndefined();
    }
    expect(body('exam_page_items').thinking).toEqual({ type: 'between_tools' });
  });

  it('Haiku düşünme kapalı → disabled; fallbacks yok', () => {
    for (const r of all.filter((x) => familyOf(x.model) === 'haiku')) {
      const b = body(r.name);
      expect(b.thinking, r.name).toEqual({ type: 'disabled' });
      expect(b.fallbacks, r.name).toBeUndefined();
      expect(b.betas, r.name).toBeUndefined();
    }
  });

  it('Opus/Sonnet senkron: fallbacks "default" + beta başlığı', () => {
    const b = body('solution_diagnosis');
    expect(b.fallbacks).toBe('default');
    expect(b.betas).toEqual([FALLBACK_BETA]);
    expect(body('coach_chat').fallbacks).toBe('default');
  });

  it('Batch gövdesinde fallbacks ve betas yok', async () => {
    const { gateway, fake } = setup();
    for (const route of ['inferred_keys', 'memory_compaction', 'solution_diagnosis'] as const) {
      await gateway.submitBatch(route, [{ customId: `c_${route}`, input: { system: { product: PRODUCT }, user: 'girdi' } }]);
    }
    const batchBodies = fake.requests.filter((r) => r.kind === 'batch');
    expect(batchBodies).toHaveLength(3);
    for (const r of batchBodies) {
      expect(r.body.fallbacks).toBeUndefined();
      expect(r.body.betas).toBeUndefined();
    }
  });

  it('cache_control ≤ 4, sıra: ürün 1h → ders 1h → dossier 5dk → kuyruk', () => {
    for (const r of all) {
      const b = body(r.name, { batch: r.mode === 'batch' });
      const bps = collectBreakpoints(b);
      expect(bps.length, r.name).toBeLessThanOrEqual(4);
      const firstShort = bps.findIndex((x) => x.ttl === '5m');
      if (firstShort !== -1) expect(bps.slice(firstShort).every((x) => x.ttl === '5m'), r.name).toBe(true);
    }
    const chat = collectBreakpoints(body('coach_chat'));
    expect(chat).toEqual([
      { where: 'system[0]', ttl: '1h' },
      { where: 'system[1]', ttl: '1h' },
      { where: 'system[2]', ttl: '5m' },
      { where: 'top-level', ttl: '5m' },
    ]);
    // Tek seferlik teşhiste kuyruk işareti yok (benzersiz kuyruk yazım primi ödemesin).
    expect(collectBreakpoints(body('solution_diagnosis')).map((x) => x.where)).toEqual(['system[0]', 'system[1]', 'system[2]']);
  });

  it('system blokları sırayla ürün, ders, dossier; değişken bilgi system\'de değil', () => {
    const b = body('coach_chat');
    const sys = b.system as { text: string }[];
    expect(sys.map((s) => s.text)).toEqual([PRODUCT, COURSE, DOSSIER]);
    expect(JSON.stringify(sys)).not.toContain('2026-11-02');
  });

  it('Opus/Sonnet: tur bağlamı sona role:"system" mesajı; Haiku: kullanıcı turunda hatırlatma', () => {
    const b = body('coach_chat');
    const last = b.messages[b.messages.length - 1];
    expect(last).toEqual({ role: 'system', content: 'Bugün 2026-11-02. Mod: ipucu.' });
    expect(b.messages[b.messages.length - 2]?.role).toBe('user');
    const h = body('memory_delta');
    const hl = h.messages[h.messages.length - 1];
    expect(hl?.role).toBe('user');
    expect(JSON.stringify(hl)).toContain('<system-reminder>Bugün 2026-11-02. Mod: ipucu.</system-reminder>');
    expect(h.messages.some((m) => m.role === 'system')).toBe(false);
  });

  it('araçlar ada göre sıralı; akışlı istemci araçlarında eager_input_streaming', () => {
    const b = body('coach_chat');
    const names = (b.tools ?? []).map((t) => (t as { name: string }).name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(['get_mastery', 'get_recent_exams', 'memory', 'record_turn_meta', 'search_evidence']);
    const custom = (b.tools ?? []).filter((t) => (t as { type?: string }).type === 'custom');
    expect(custom.length).toBe(4);
    for (const t of custom) expect((t as { eager_input_streaming?: boolean }).eager_input_streaming).toBe(true);
    const cd = body('curriculum_draft').tools ?? [];
    expect(cd).toEqual([
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
      { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
    ]);
  });

  it('yapılandırılmış rotada output_config.format (enum korunmuş); serbest metinde yok', () => {
    const b = body('solution_diagnosis');
    const fmt = b.output_config?.format as { type: string; schema: Record<string, unknown> };
    expect(fmt.type).toBe('json_schema');
    expect(JSON.stringify(fmt.schema)).toContain('"enum"');
    expect(JSON.stringify(fmt.schema)).not.toContain('minLength');
    expect(body('coach_chat').output_config?.format).toBeUndefined();
    expect(b.max_tokens).toBeGreaterThanOrEqual(4000);
  });
});
