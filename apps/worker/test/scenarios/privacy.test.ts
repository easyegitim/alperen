import { describe, expect, it } from 'vitest';
import { nameTokenHashes } from '@ogrenmen/pii';
import { captureConsole, fx, IDS, makeApp, rows } from '../helpers.ts';

describe('scrub-integration', () => {
  it('ad yalnız resolve_telegram\'a gider; prompt\'ta [ÖĞRENCİ]; sağlayıcı ve console çıktısında "Elif"/"Kaya" yok', async () => {
    const w = makeApp({ llm: { pick: 'chat/01-socratic-paydalar.json' } });
    const seen: Array<{ firstName: string | null; lastName: string | null }> = [];
    const orig = w.db.resolveTelegram.bind(w.db);
    // Kimlik çözümü başlıksız kopyada çağrılır: aynı nesneyi sarmak yeterli.
    w.db.resolveTelegram = async (a) => {
      seen.push({ firstName: a.firstName, lastName: a.lastName });
      return orig(a);
    };
    const cap = captureConsole();
    try {
      await w.send(fx('private_text'));
      w.clock.advance(60_000);
      await w.send(w.privateText(IDS.elifChat, 'Elif olarak soruyorum: 2/3 + 1/6 kaç eder?'));
    } finally {
      cap.restore();
    }
    expect(seen[0]).toEqual({ firstName: 'Elif', lastName: 'Kaya' });
    const pii = rows(w, 'secure.student_pii', (p) => p.student_id === IDS.elif)[0];
    expect((pii?.name_token_hashes as string[]).length).toBe(2);
    expect(new Set(pii?.name_token_hashes as string[])).toEqual(new Set(nameTokenHashes('Elif Kaya')));
    expect(w.llm.calls.length).toBe(2);
    for (const c of w.llm.calls) {
      expect(c.promptText).not.toMatch(/Elif|Kaya/);
    }
    expect(w.llm.calls[1]?.promptText).toContain('[ÖĞRENCİ] olarak soruyorum');
    for (const m of rows(w, 'messages', (x) => x.chat_id === IDS.elifChat)) expect(String(m.text_llm ?? '')).not.toMatch(/Elif|Kaya/);
    for (const b of rows(w, 'bot_responses').slice(-2)) expect(JSON.stringify(b)).not.toMatch(/Elif|Kaya/);
    expect(cap.lines.join('\n')).not.toMatch(/Elif|Kaya/);
  });

  it('/start ile yeni öğrenci: ad yalnız secure.student_pii, hash 2 eleman; diğer tablolarda ad yok', async () => {
    const w = makeApp();
    await w.send(fx('private_start'));
    const ti = rows(w, 'secure.telegram_identities', (t) => t.telegram_user_id === IDS.canChat)[0];
    const pii = rows(w, 'secure.student_pii', (p) => p.student_id === ti?.student_id)[0];
    expect(pii?.display_name).toBe('Can Öztürk');
    expect((pii?.name_token_hashes as string[]).length).toBe(2);
    for (const t of ['messages', 'bot_responses', 'students', 'sessions', 'chat_roles', 'tg_chats']) {
      expect(JSON.stringify(rows(w, t))).not.toMatch(/Öztürk/);
    }
  });

  it('grupta eğitmen adı ve kullanıcı adı LLM\'e gitmez (personel hash\'leri birleşik); cevap @kullanıcı adıyla', async () => {
    const w = makeApp({ llm: { pick: 'chat_group/01-group-socratic.json' } });
    const u = fx('group_mention');
    if (u.message) u.message.text = '@ogrenmen_bot Ayşe hoca dün mutlak değeri anlattı, neden iki durum var?';
    await w.send(u);
    const prompt = w.llm.calls[0]?.promptText ?? '';
    expect(prompt).toContain('[AD] hoca dün');
    expect(prompt).not.toContain('Ayşe');
    expect(prompt).not.toContain('elif_k');
    expect(w.telegram.textsTo(IDS.groupA).at(-1)?.startsWith('@elif_k')).toBe(true);
    expect(String(rows(w, 'bot_responses').at(-1)?.response_text)).not.toContain('elif_k');
  });
});
