import { isSchemaName } from '@ogrenmen/contracts';
import { isRouteName, MODELS, ROUTES } from '@ogrenmen/llm';
import { describe, expect, it } from 'vitest';
import { allPrompts, PROMPT_MODELS } from '../src/index.js';
import { PROMPT_DEFAULTS } from '../src/bundle.gen.js';

describe('prompt meta ↔ geçit rota tablosu', () => {
  it('model listesi geçidinkiyle aynı', () => {
    expect([...PROMPT_MODELS].sort()).toEqual(Object.values(MODELS).sort());
  });

  it('geçitte olan her rota için model, effort, şema ve araçlar birebir aynı', () => {
    for (const p of allPrompts()) {
      if (!isRouteName(p.meta.route)) continue;
      const r = ROUTES[p.meta.route];
      const id = `${p.meta.route}@${p.meta.version}`;
      expect(p.meta.model, id).toBe(r.model);
      expect(p.meta.effort, id).toBe(r.effort);
      expect(p.meta.schema, id).toBe(r.schema);
      // Varsayılan sürümün araçları rotayla birebir; eski sürümler rotanın araç kümesinin alt kümesidir (yeni araç yeni sürümle gelir).
      if (PROMPT_DEFAULTS[p.meta.route] === p.meta.version) expect(p.meta.tools, id).toEqual([...r.tools].sort());
      else for (const t of p.meta.tools) expect(r.tools as readonly string[], id).toContain(t);
    }
  });

  it('her prompt rotası geçitte tanımlıdır ve şemaları kayıtlıdır', () => {
    const missing = [...new Set(allPrompts().map((p) => p.meta.route).filter((r) => !isRouteName(r)))].sort();
    expect(missing).toEqual([]);
    for (const p of allPrompts()) if (p.meta.schema !== null) expect(isSchemaName(p.meta.schema)).toBe(true);
  });

  it('yapılandırılmış rotalarda web araçları yok (Citations uyumsuz); araçlı yapılandırılmış rotalar yalnız kod ya da okuma araçları', () => {
    const allowed = new Set(['code_execution', 'get_mastery', 'get_recent_exams']);
    for (const p of allPrompts()) {
      if (p.meta.schema === null) continue;
      for (const t of p.meta.tools) expect(allowed.has(t), `${p.meta.route}: ${t}`).toBe(true);
    }
  });
});
