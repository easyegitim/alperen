import { describe, expect, it } from 'vitest';
import { mapStreamEvent } from '../src/stream.js';
import { PRODUCT, setup } from './helpers.js';

describe('akış', () => {
  it('ham olay eşlemesi: metin, boş thinking yayımlanmaz, araç girdisi kimlikle', () => {
    const ids = new Map<number, string>();
    expect(mapStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } }, ids)).toEqual({ type: 'text', text: 'a' });
    expect(mapStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '', estimated_tokens: null } }, ids)).toBeNull();
    expect(mapStreamEvent({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't9', name: 'get_mastery', input: {} } }, ids)).toEqual({
      type: 'tool_use',
      id: 't9',
      name: 'get_mastery',
      server: false,
    });
    expect(mapStreamEvent({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"a"' } }, ids)).toEqual({
      type: 'tool_input',
      id: 't9',
      partial: '{"a"',
    });
  });

  it('max_tokens yeniden denemesinde restart olayı', async () => {
    const { gateway, fake } = setup();
    fake.enqueue('coach_chat', { text: 'yarım', stopReason: 'max_tokens' }, { text: 'tam yanıt' });
    const kinds: string[] = [];
    const res = await gateway.call('coach_chat', { system: { product: PRODUCT }, user: 'x', onEvent: (e) => kinds.push(e.type) });
    expect(res.text).toBe('tam yanıt');
    expect(kinds).toContain('restart');
    expect(fake.requests.map((r) => r.body.max_tokens)).toEqual([8000, 16000]);
  });
});
