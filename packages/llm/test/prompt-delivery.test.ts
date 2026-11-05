import { describe, expect, it } from 'vitest';
import { withPromptSchema } from '../src/client.js';
import { validateStructured } from '../src/parse.js';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { ROUTES } from '../src/routes.js';
import { Gateway } from '../src/gateway.js';
import { FakeTransport } from '../src/fake.js';
import { InMemoryLedger } from '../src/ledger.js';
import { PRODUCT } from './helpers.js';

describe('şemayı metin olarak gönderen rotalar (dilbilgisi sınırı)', () => {
  const heavy = ['notes_generation', 'exam_report', 'lesson_analysis', 'report'] as const;
  it('yalnız dilbilgisi sınırını aşan dört rota işaretli', () => {
    const flagged = Object.values(ROUTES).filter((r) => r.schemaDelivery === 'prompt').map((r) => r.name).sort();
    expect(flagged).toEqual([...heavy].sort());
  });
  it('gönderimde output_config.format kalkar, şema son kullanıcı turuna eklenir; giriş nesnesi değişmez', () => {
    const g = new Gateway({ transport: new FakeTransport(), ledger: new InMemoryLedger() });
    for (const name of heavy) {
      const body = g.buildRequest(name, { system: { product: PRODUCT }, user: 'x', maxTokens: 8000 });
      expect((body.output_config as { format?: { delivery?: string } }).format?.delivery).toBe('prompt');
      const wired = withPromptSchema(body);
      expect((wired.output_config as { format?: unknown }).format).toBeUndefined();
      expect((wired.output_config as { effort: string }).effort).toBe(ROUTES[name].effort);
      const last = wired.messages.at(-1)!;
      const text = JSON.stringify(last.content);
      expect(text).toContain('json_schema');
      expect((body.output_config as { format?: unknown }).format).toBeDefined();
      expect(JSON.stringify(wired)).not.toContain('delivery');
    }
  });
  it('kod çitine sarılı JSON da çözülür; bozuk metin yine reddedilir', () => {
    const c = contractRegistry['notification-copy'] as Contract;
    const ok = validateStructured(c, '```json\n{"title":"Merhaba","body":"Deneme tamam."}\n```');
    expect(typeof ok.ok).toBe('boolean');
    expect(validateStructured(c, 'json yok').ok).toBe(false);
  });
});
