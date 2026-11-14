// @vitest-environment node
// Üretimde bellek koç deposu yasağı: OGRENMEN_CHAT_STORE=memory yalnız üretim dışında kabul edilir.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { chatDeps } from '@/server/chat/deps';

describe('üretimde bellek deposu yasağı', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('NODE_ENV=production ve OGRENMEN_CHAT_STORE=memory → OGR-CHAT-022', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OGRENMEN_CHAT_STORE', 'memory');
    vi.stubEnv('OGRENMEN_LLM', 'fake');
    await expect(chatDeps(null)).rejects.toThrow('OGR-CHAT-022');
  });
});
