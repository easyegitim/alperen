import { describe, expect, it } from 'vitest';
import { contractRegistry, LLM_OUTPUT_SCHEMA_NAMES } from '@ogrenmen/contracts';
import { FALLBACK_BETA } from '../src/client.js';
import { collectBreakpoints, PROGRESS_NOTE } from '../src/prompt.js';
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
  it('görevdeki 26 rota + curriculum_research (müfredat iki adım) tanımlı', () => {
    expect(ROUTE_NAMES).toHaveLength(27);
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
    // Biçimli çıktı Citations ile uyumsuz: web araçları araştırma rotasında, taslak araçsız ve biçimli.
    expect(ROUTES.curriculum_research.tools).toEqual(['web_search', 'web_fetch']);
    expect(ROUTES.curriculum_research.schema).toBeNull();
    expect(ROUTES.curriculum_draft.tools).toEqual([]);
    expect(ROUTES.curriculum_draft.schema).toBe('curriculum-draft');
    expect(ROUTES.inferred_keys.mode).toBe('batch');
    expect(ROUTES.memory_compaction.mode).toBe('batch');
    expect(ROUTES.eval_judge.mode).toBe('batch');
    expect(ROUTES.priority_plan.effort).toBe('medium');
  });

  it('validateRoute: biçimli rota + web_search/web_fetch reddedilir (Citations uyumsuz)', () => {
    const bad = { ...(ROUTES.curriculum_draft as RouteConfig), tools: ['web_search', 'web_fetch'] as const };
    expect(validateRoute(bad).join(' ')).toMatch(/Citations/);
    for (const r of all) {
      if (r.schema !== null) expect(r.tools.some((t) => t === 'web_search' || t === 'web_fetch'), r.name).toBe(false);
    }
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
    // Koç rotası akışlı + araçlı + serbest metin: ürün bloğunun sonunda sabit ilerleme notu.
    expect(sys.map((s) => s.text)).toEqual([`${PRODUCT}\n\n${PROGRESS_NOTE}`, COURSE, DOSSIER]);
    const diag = body('solution_diagnosis').system as { text: string }[];
    expect(diag.map((s) => s.text)).toEqual([PRODUCT, COURSE, DOSSIER]);
    expect(JSON.stringify(sys)).not.toContain('2026-11-02');
  });

  it('Opus/Sonnet/Haiku: tur bağlamı sona role:"system" mesajı; yedek: kullanıcı turunda hatırlatma', () => {
    const b = body('coach_chat');
    const last = b.messages[b.messages.length - 1];
    expect(last).toEqual({ role: 'system', content: 'Bugün 2026-11-02. Mod: ipucu.' });
    expect(b.messages[b.messages.length - 2]?.role).toBe('user');
    const h = body('memory_delta');
    expect(h.messages[h.messages.length - 1]).toEqual({ role: 'system', content: 'Bugün 2026-11-02. Mod: ipucu.' });
    expect(JSON.stringify(h)).not.toContain('<system-reminder>');
    const { gateway } = setup();
    const fb = gateway.buildRequest(
      'memory_delta',
      { system: { product: PRODUCT }, user: 'x', turn: { date: '2026-11-02', mode: 'hint' } },
      { turnFallback: true },
    );
    const fl = fb.messages[fb.messages.length - 1];
    expect(fl?.role).toBe('user');
    expect(JSON.stringify(fl)).toContain('<system-reminder>Bugün 2026-11-02. Mod: ipucu.</system-reminder>');
    expect(fb.messages.some((m) => (m.role as string) === 'system')).toBe(false);
  });

  it('araçlar ada göre sıralı; akışlı istemci araçlarında eager_input_streaming', () => {
    const b = body('coach_chat');
    const names = (b.tools ?? []).map((t) => (t as { name: string }).name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(['get_mastery', 'get_recent_exams', 'memory', 'record_turn_meta', 'search_evidence']);
    const custom = (b.tools ?? []).filter((t) => (t as { type?: string }).type === 'custom');
    expect(custom.length).toBe(4);
    for (const t of custom) expect((t as { eager_input_streaming?: boolean }).eager_input_streaming).toBe(true);
    const cd = body('curriculum_research').tools ?? [];
    expect(cd).toEqual([
      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
      { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
    ]);
    expect(body('curriculum_research').output_config?.format).toBeUndefined();
    expect(body('curriculum_draft').tools).toBeUndefined();
    expect(body('curriculum_draft').output_config?.format).toBeDefined();
  });

  it('veli ajanı: 6 strict salt okunur araç (PLAN §10), eager akış yok, strict şema alt kümesi', () => {
    const b = body('parent_chat');
    const tools = (b.tools ?? []) as unknown as {
      name: string;
      type: string;
      strict?: boolean;
      eager_input_streaming?: boolean;
      input_schema: Record<string, unknown>;
    }[];
    expect(tools.map((t) => t.name)).toEqual([
      'get_child_summary',
      'get_exam_sessions',
      'get_mastery_overview',
      'get_recent_activity',
      'get_reports',
      'request_report',
    ]);
    for (const t of tools) {
      expect(t.type, t.name).toBe('custom');
      expect(t.strict, t.name).toBe(true);
      expect(t.eager_input_streaming, t.name).toBeUndefined();
      expect(t.input_schema.additionalProperties, t.name).toBe(false);
      const json = JSON.stringify(t.input_schema);
      for (const k of ['"$schema"', '"minimum"', '"maximum"', '"$ref"']) expect(json, `${t.name} ${k}`).not.toContain(k);
    }
    const activity = tools.find((t) => t.name === 'get_recent_activity')?.input_schema as { properties: Record<string, { type: string; description: string }> };
    expect(activity.properties.days?.type).toBe('integer');
    expect(activity.properties.days?.description).toContain('(minimum: 1, maximum: 30)');
    // enum korunur (SDK transformJSONSchema'nın aksine açıklamaya taşınmaz)
    const summary = tools.find((t) => t.name === 'get_child_summary')?.input_schema as { properties: Record<string, { enum?: string[] }>; required?: string[] };
    expect(summary.properties.period?.enum).toEqual(['week', 'month']);
    expect(summary.required).toEqual(['period']);
    // Koç araçları strict değil (akışta eager_input_streaming).
    const coach = (body('coach_chat').tools ?? []) as unknown as { name: string; strict?: boolean }[];
    expect(coach.some((t) => t.strict)).toBe(false);
  });

  it('biçimli rotada document citations.enabled reddedilir (yapılandırılmış çıktı + Citations = 400)', () => {
    const { gateway } = setup();
    const doc = (enabled: boolean) => ({
      system: { product: PRODUCT },
      user: [
        { type: 'document' as const, source: { type: 'text' as const, media_type: 'text/plain' as const, data: 'MEB kazanım listesi' }, citations: { enabled } },
        { type: 'text' as const, text: 'taslak çıkar' },
      ],
    });
    expect(() => gateway.buildRequest('curriculum_draft', doc(true))).toThrow(/citations/);
    const ok = gateway.buildRequest('curriculum_draft', doc(false));
    expect(JSON.stringify(ok)).not.toMatch(/"citations":\{"enabled":true\}/);
    // serbest metin araştırma rotasında atıf açık olabilir
    expect(() => gateway.buildRequest('curriculum_research', doc(true))).not.toThrow();
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

describe('denetim düzeltmeleri (rotalar)', () => {
  it('proposal_review → proposal-review, style_question_gen → style-question-generation (PLAN-v2 §5)', () => {
    expect(ROUTES.proposal_review.schema).toBe('proposal-review');
    expect(ROUTES.style_question_gen.schema).toBe('style-question-generation');
    expect(validateRoute(ROUTES.proposal_review)).toEqual([]);
    expect(validateRoute(ROUTES.style_question_gen)).toEqual([]);
  });

  it('ilerleme notu yalnız akışlı, araçlı, serbest metin, sunucu araçsız rotalarda', () => {
    const withNote = ROUTE_NAMES.filter((n) => (ROUTES[n] as RouteConfig).progressNote);
    expect(withNote).toEqual(['coach_chat', 'coach_deep', 'parent_chat']);
    const { gateway } = setup();
    const b = gateway.buildRequest('coach_deep', { system: { product: PRODUCT }, user: 'x' });
    expect((b.system as { text: string }[])[0]?.text.endsWith(PROGRESS_NOTE)).toBe(true);
    // Opus'ta thinking yine gönderilmez.
    expect(b).not.toHaveProperty('thinking');
  });
});
