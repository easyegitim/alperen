import { describe, expect, it } from 'vitest';
import { START_SENTENCE, texts } from '../../src/texts.ts';
import { plainText as plain } from '../../src/telegram/format.ts';
import { fresh, fx, IDS, lastKeyboard, makeApp, rows } from '../helpers.ts';

describe('start-consent', () => {
  it('onaysız → LLM çağrısı 0, messages.text_llm=null; onaydan sonra sohbet açılır', async () => {
    const w = makeApp();
    const studentsBefore = rows(w, 'students').length;
    await w.send(fx('private_start'));
    expect(rows(w, 'students').length).toBe(studentsBefore + 1);
    const out = w.telegram.textsTo(IDS.canChat);
    expect(out[0]?.split('\n')[0]).toBe(START_SENTENCE);
    expect(lastKeyboard(w, IDS.canChat)).toEqual(['age:adult', 'age:minor']);

    // Onaydan önce serbest metin: yalnız onay mesajı; içerik saklanmaz.
    await w.send(w.privateText(IDS.canChat, 'Kesirleri anlatır mısın?', { firstName: 'Can', lastName: 'Öztürk', username: 'can_o' }));
    expect(w.telegram.textsTo(IDS.canChat).at(-1)).toBe(texts.consentRequired);
    expect(w.db.botResponsePayloads.at(-1)?.guards).toEqual(['consent_missing']);
    const can = rows(w, 'secure.telegram_identities', (r) => r.telegram_user_id === IDS.canChat)[0];
    const canMsgs = rows(w, 'messages', (m) => m.chat_id === IDS.canChat);
    expect(canMsgs.length).toBeGreaterThan(0);
    for (const m of canMsgs) {
      expect(m.text_llm).toBeNull();
      expect(m.text_raw).toBeNull();
    }
    expect(w.llm.calls.length).toBe(0);

    await w.send(w.callback(IDS.canChat, 'age:adult'));
    expect(lastKeyboard(w, IDS.canChat)).toEqual(['consent:kvkk_aydinlatma:read', 'consent:kvkk_aydinlatma:yes', 'consent:kvkk_aydinlatma:no']);
    await w.send(w.callback(IDS.canChat, 'consent:kvkk_aydinlatma:yes'));
    const consent = rows(w, 'consents', (c) => c.student_id === can?.student_id && c.kind === 'kvkk_aydinlatma');
    expect(consent.length).toBe(1);
    expect(consent[0]?.method).toBe('telegram_button');
    expect(w.telegram.textsTo(IDS.canChat).at(-1)).toContain(texts.diagOffer);
    expect(w.llm.calls.length).toBe(0);

    w.clock.advance(60_000);
    await w.send(w.privateText(IDS.canChat, 'Kesirleri anlatır mısın?', { firstName: 'Can', lastName: 'Öztürk', username: 'can_o' }));
    expect(w.llm.calls.length).toBe(1);
    const br = rows(w, 'bot_responses', (b) => b.chat_id === IDS.canChat);
    expect(br.filter((b) => b.purpose === 'consent').every((b) => b.provider === null)).toBe(true);
  });

  it('/start ilk cümlesi kısaltılmaz; onaylı öğrenciye teşhis teklifi', async () => {
    const w = makeApp();
    await w.send(w.privateText(IDS.elifChat, '/start'));
    const first = w.telegram.textsTo(IDS.elifChat)[0] ?? '';
    expect(first.startsWith(START_SENTENCE)).toBe(true);
  });
});

describe('consent-summary-from-legal-texts', () => {
  it("aydınlatma gövdesinde onay-ozeti işareti varsa /start özeti oradan gelir; gün sohbetin saklama süresi", async () => {
    const block = [
      '<!-- ogrenmen:onay-ozeti:start -->',
      'Öğrenmen bir yapay zekâ öğretmenidir; sohbetlerini kaydeder ve 90 gün sonra siler.',
      'Adın, okulun ve Telegram kimliğin yapay zekâya giden metinlere eklenmez.',
      'Hocaların sohbetlerini ve öğrenme profilini görür.',
      'İstediğin zaman /sil yazarak verilerinin silinmesini isteyebilirsin.',
      '<!-- ogrenmen:onay-ozeti:end -->',
    ].join('\n');
    const w = makeApp({
      mutateSeed: (seed) => {
        const legal = (seed.legal_texts as Array<Record<string, unknown>>).find((l) => l.kind === 'kvkk_aydinlatma')!;
        legal.body_md = `# Aydınlatma metni\n\n${block}\n\n${String(legal.body_md)}`;
      },
    });
    await w.send(fx('private_start'));
    w.db.table('tg_chats').find((c) => c.chat_id === IDS.canChat)!.retention_days = 60;
    await w.send(w.callback(IDS.canChat, 'age:adult'));
    const summary = w.telegram.textsTo(IDS.canChat).at(-1) ?? '';
    expect(summary.split('\n').length).toBe(4);
    expect(summary).toContain('60 gün sonra siler');
    expect(summary).not.toContain('<!--');
    expect(summary).not.toContain('Aydınlatma özeti');
  });

  it('işaret yoksa texts.consentSummary yedeği', async () => {
    const w = makeApp();
    await w.send(fx('private_start'));
    await w.send(w.callback(IDS.canChat, 'age:adult'));
    expect(w.telegram.textsTo(IDS.canChat).at(-1)).toBe(plain(texts.consentSummary(90)));
  });
});

describe('minor-guardian-gate', () => {
  it('onaysız reşit olmayanın 5 mesajı: LLM 0, provider null; /veli kodu doğru / yanlış / tekrar', async () => {
    const w = makeApp();
    const seeded = rows(w, 'bot_responses').length;
    for (let i = 0; i < 5; i++) {
      w.clock.advance(10_000);
      await w.send(w.privateText(IDS.zeynepChat, `Soru ${i}: 2+2 kaç?`, { firstName: 'Zeynep', lastName: 'Çelik', username: 'zeynep_c' }));
    }
    expect(w.llm.calls.length).toBe(0);
    const br = rows(w, 'bot_responses').slice(seeded);
    expect(br.length).toBe(5);
    expect(br.every((b) => b.chat_id === IDS.zeynepChat)).toBe(true);
    expect(br.every((b) => b.provider === null && b.purpose === 'consent')).toBe(true);
    expect(w.telegram.textsTo(IDS.zeynepChat).every((t) => t === plain(texts.guardianNeeded))).toBe(true);
    expect(rows(w, 'messages', (m) => m.chat_id === IDS.zeynepChat && m.sender_role === 'student').every((m) => m.text_llm === null && m.text_raw === null)).toBe(true);

    const guardian = 700000401;
    const veli = (text: string) => ({ ...w.privateText(guardian, text, { firstName: 'Hakan', lastName: 'Çelik', username: 'hakan_c' }) });
    await w.send(veli('/veli YANLIS-KOD1'));
    expect(w.telegram.textsTo(guardian).at(-1)).toBe(texts.guardianInvalid);
    await w.send(veli('/veli K7F3-2QX9'));
    expect(w.telegram.textsTo(guardian).at(-1)).toBe(texts.guardianRecorded);
    await w.send(veli('/veli K7F3-2QX9'));
    expect(w.telegram.textsTo(guardian).at(-1)).toBe(texts.guardianInvalid);
    expect(rows(w, 'consents', (c) => c.student_id === IDS.zeynep && c.kind === 'veli_onayi').length).toBe(1);

    w.clock.advance(60_000);
    await w.send(w.privateText(IDS.zeynepChat, 'Kesirlerde payda nedir?', { firstName: 'Zeynep', lastName: 'Çelik', username: 'zeynep_c' }));
    const out = w.telegram.textsTo(IDS.zeynepChat);
    expect(out).toContain(texts.guardianApprovedStudent);
    expect(w.llm.calls.length).toBe(1);
  });
});

describe('guardian-not-a-student', () => {
  it('bilinmeyen kullanıcı yalnız /veli KOD gönderir: öğrenci yaratılmaz, kod kullanılır, öğrenciye "Velin onayladı" gider', async () => {
    const w = makeApp();
    const counts = () => [rows(w, 'students').length, rows(w, 'secure.student_pii').length, rows(w, 'enrollments').length, rows(w, 'secure.telegram_identities').length];
    const before = counts();
    const guardian = 700000402;
    await w.send(w.privateText(guardian, '/veli K7F3-2QX9', { firstName: 'Hakan', lastName: 'Çelik', username: 'hakan_c' }));
    expect(counts()).toEqual(before);
    expect(w.telegram.textsTo(guardian)).toEqual([texts.guardianRecorded]);
    const code = rows(w, 'secure.guardian_codes', (g) => g.student_id === IDS.zeynep)[0];
    expect(code?.used_by_telegram_user_id).toBe(guardian);
    expect(w.db.rpcCalls).toContain('redeem_guardian_code');
    await w.send(w.privateText(IDS.zeynepChat, 'Merhaba', { firstName: 'Zeynep', lastName: 'Çelik', username: 'zeynep_c' }));
    expect(w.telegram.textsTo(IDS.zeynepChat)[0]).toBe(texts.guardianApprovedStudent);
  });
});

describe('dedup', () => {
  it('aynı update_id ikinci kez işlenmez', async () => {
    const w = makeApp();
    const u = fx('private_text');
    await w.send(u);
    const n = w.telegram.outbox.length;
    await w.send(u);
    expect(w.telegram.outbox.length).toBe(n);
    expect(rows(w, 'tg_updates', (r) => r.update_id === u.update_id).length).toBe(1);
    await w.send(fresh(u));
    expect(w.telegram.outbox.length).toBeGreaterThan(n);
  });
});
