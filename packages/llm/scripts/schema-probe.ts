// Her şemalı rotanın isteğini max_tokens=16 ile gönderir: dilbilgisi çok büyükse 400 döner (üretim başlamadan, ücretsiz).
import { ROUTES } from '../src/routes.js';
import { AnthropicTransport } from '../src/client.js';
import { Gateway } from '../src/gateway.js';
import { InMemoryLedger } from '../src/ledger.js';

const g = new Gateway({ transport: new AnthropicTransport(), ledger: new InMemoryLedger() });
const t = new AnthropicTransport();
for (const [name, r] of Object.entries(ROUTES)) {
  if (!r.schema) continue;
  try {
    const req = g.buildRequest(name as never, { system: { product: 'Sen bir test asistanısın. '.repeat(10) }, user: 'Merhaba', maxTokens: 4000 });
    await t.create({ ...req, max_tokens: 16 }, { route: name as never });
    console.log('OK     ', name, r.schema);
  } catch (e) {
    const m = (e as Error).message;
    console.log(/grammar|too large|schema/i.test(m) ? 'SCHEMA ' : 'other  ', name, r.schema, '|', m.slice(0, 140));
  }
}
