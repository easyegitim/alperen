/**
 * Canlı (OGRENMEN_LIVE=1 ve ANTHROPIC_API_KEY): müfredat iki adımı. claude-api shared/tool-use-concepts.md'ye göre
 * yapılandırılmış çıktı (output_config.format) Citations ile uyumsuzdur (400) ve web_search/web_fetch sonuçları atıflı
 * döner; bu yüzden `curriculum_research` (araçlı, serbest metin) ve `curriculum_draft` (araçsız, biçimli) ayrıdır.
 * İlk test birleşik isteği doğrudan dener: 400 beklenir. Kabul edilirse rotalar yeniden birleştirilebilir.
 */
import { describe, expect, it } from 'vitest';
import { BadRequestError } from '@anthropic-ai/sdk';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { AnthropicTransport } from '../src/client.js';
import { Gateway } from '../src/gateway.js';
import { InMemoryLedger } from '../src/ledger.js';
import { PRODUCT } from './helpers.js';

const live = process.env.OGRENMEN_LIVE === '1' && !!process.env.ANTHROPIC_API_KEY;
const QUESTION = 'TYT Matematik 2027 için MEB kazanım listesinin "Sayılar" ünitesini araştır; en çok 3 kaynak kullan.';

describe.skipIf(!live)('canlı: müfredat (web_search + yapılandırılmış çıktı)', () => {
  it('birleşik istek (web_search + output_config.format) 400 döner: rota iki adıma bölünmüş kalmalı', async () => {
    const transport = new AnthropicTransport();
    const g = new Gateway({ transport, ledger: new InMemoryLedger() });
    const research = g.buildRequest('curriculum_research', { system: { product: PRODUCT }, user: QUESTION, maxTokens: 8000 });
    const draft = g.buildRequest('curriculum_draft', { system: { product: PRODUCT }, user: QUESTION, maxTokens: 8000 });
    const combined = { ...research, output_config: draft.output_config, tools: research.tools };
    const err = await transport.create(combined, { route: 'curriculum_draft' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, 'birleşik istek kabul edildi: rotalar birleştirilebilir, README güncellenmeli').toBeInstanceOf(BadRequestError);
  });

  it('iki adım: araştırma (serbest metin, atıflı) → taslak (araçsız, curriculum-draft)', async () => {
    const ledger = new InMemoryLedger();
    const g = new Gateway({ transport: new AnthropicTransport(), ledger });
    const research = await g.call('curriculum_research', { system: { product: PRODUCT }, user: QUESTION, maxTokens: 16000 });
    expect(research.text.length).toBeGreaterThan(0);
    const draft = await g.call('curriculum_draft', {
      system: { product: PRODUCT },
      user: [
        { type: 'document', source: { type: 'text', media_type: 'text/plain', data: research.text }, title: 'Araştırma notu' },
        { type: 'text', text: 'Bu araştırma notundan "Sayılar" ünitesi için müfredat taslağını çıkar.' },
      ],
      maxTokens: 16000,
    });
    expect((contractRegistry['curriculum-draft'] as Contract).isValid(draft.data)).toBe(true);
    expect(ledger.rows.map((r) => r.route)).toContain('curriculum_research');
    expect(ledger.rows.at(-1)).toMatchObject({ route: 'curriculum_draft', status: 'ok' });
  });
});
