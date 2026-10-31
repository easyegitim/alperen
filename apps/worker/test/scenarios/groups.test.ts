import { describe, expect, it, vi } from 'vitest';
import getMePrivacyOn from '../../../../fixtures/telegram/api/getMe.privacy_on.json';
import getMePrivacyOff from '../../../../fixtures/telegram/api/getMe.privacy_off.json';
import chatMemberMember from '../../../../fixtures/telegram/api/getChatMember.member.json';
import grupKayitDoc from 'virtual:hukuk/grup-kayit-bildirimi';
import { DbError } from '../../src/data/repo.ts';
import { FakeDb } from '../../src/data/fake.ts';
import { texts } from '../../src/texts.ts';
import { fresh, fx, groupText, IDS, makeApp, rows, type TestWorld } from '../helpers.ts';

const GROUP_B = -1001000000002;
const GROUP_C = -1001000000003;
const ELIF = { id: IDS.elifChat, username: 'elif_k' };
const MERT = { id: IDS.mertChat, username: 'mert_d' };
const nowSec = (w: TestWorld): number => Math.floor(w.clock.now().getTime() / 1000);
const groupTexts = (w: TestWorld, chat = IDS.groupA): string[] => w.telegram.textsTo(chat);
const alerts = (w: TestWorld, detail: string, chat: number) => rows(w, 'instructor_alerts', (a) => a.kind === 'ops' && a.detail === detail && (a.ref as { chat_id?: number } | null)?.chat_id === chat);

describe('group-escalation', () => {
  it('/hoca → branş eğitmeni @ayse_hoca etiketlenir, escalations(open) hedefi o eğitmen', async () => {
    const w = makeApp();
    const before = rows(w, 'escalations').length;
    await w.send(groupText(IDS.groupA, ELIF, '/hoca mutlak değerde iki durumu anlamadım'));
    expect(groupTexts(w).at(-1)).toBe('Bunu hocana bırakıyorum. @ayse_hoca, bu soruya bakabilir misin?');
    const esc = rows(w, 'escalations').slice(before);
    expect(esc.length).toBe(1);
    expect(esc[0]).toMatchObject({ status: 'open', reason: 'human_requested', target_staff_id: IDS.ayse });
    expect(w.llm.calls.length).toBe(0);
  });

  it('not sorusu → eğitmen adına konuşmaz: hocaya devir + grade_attendance_payment, LLM yok', async () => {
    const w = makeApp();
    await w.send(groupText(IDS.groupA, ELIF, '@ogrenmen_bot deneme sınavı puanım kaç oldu?', { entities: [{ type: 'mention', offset: 0, length: 13 }] }));
    expect(w.llm.calls.length).toBe(0);
    expect(groupTexts(w).at(-1)).toBe(texts.handoff);
    expect(rows(w, 'escalations').at(-1)?.reason).toBe('grade_attendance_payment');
  });

  it('@hoca ya da eğitmen tanıtıcısı içeren mesajda bot sessiz; etiketlenmeyen mesaja cevap yok', async () => {
    const w = makeApp();
    await w.send(groupText(IDS.groupA, ELIF, '@ogrenmen_bot @ayse_hoca bu soruya bakar mısınız?'));
    await w.send(groupText(IDS.groupA, ELIF, '@ogrenmen_bot @hoca yardım eder misiniz?'));
    await w.send(fx('group_plain'));
    expect(groupTexts(w).length).toBe(0);
    expect(w.llm.calls.length).toBe(0);
  });

  it('etiketlenince öğrenciye kullanıcı adıyla (adıyla değil) Sokratik cevap; reply_to soruya', async () => {
    const w = makeApp({ llm: { pick: 'chat_group/01-group-socratic.json' } });
    await w.send(fx('group_mention'));
    const last = w.telegram.lastTo(IDS.groupA);
    expect(last?.params.reply_to_message_id).toBe(120);
    const prompt = String(w.llm.calls[0]?.promptText);
    expect(w.llm.calls[0]?.purpose).toBe('chat_group');
    expect(prompt).toContain('Öğrenciye kullanıcı adıyla hitap et');
    expect(prompt).not.toContain('Elif');
    expect(rows(w, 'bot_responses').at(-1)?.purpose).toBe('chat');
  });
});

describe('group-auto-answer-off', () => {
  it('varsayılan kapalı: soru işaretli mesaja cevap yok, cron da cevaplamaz', async () => {
    const w = makeApp();
    await w.send(groupText(IDS.groupA, ELIF, 'Logaritmada taban değişimi nasıl yapılır?', {}, nowSec(w)));
    expect(groupTexts(w).length).toBe(0);
    w.clock.advance(30 * 60_000);
    await w.app.runCron('*/15 * * * *');
    expect(groupTexts(w).length).toBe(0);
    expect(w.llm.calls.length).toBe(0);
  });
});

describe('group-auto-answer-on', () => {
  it('10 dk eşik: anında cevap yok; 11 dk sonra cron öğrencinin başlığıyla cevaplar, ikinci turda tekrar yok', async () => {
    const w = makeApp({
      mutateSeed: (seed) => {
        (seed.tg_chats as Array<Record<string, unknown>>).find((c) => c.chat_id === IDS.groupA)!.group_auto_answer_min = 10;
        // Seed'deki eski grup soruları bu senaryoyu etkilemesin (yalnız yeni soru seçilsin).
        for (const m of seed.messages as Array<Record<string, unknown>>) if (m.chat_id === IDS.groupA && m.answered_at === null) m.answered_at = '2026-10-19T10:00:00Z';
      },
    });
    const q = groupText(IDS.groupA, ELIF, 'Logaritmada taban değişimi nasıl yapılır?', {}, nowSec(w));
    await w.send(q);
    // Eğitmenin reply_to ile yanıtladığı soru seçilmez.
    const q2 = groupText(IDS.groupA, MERT, 'Üslü sayılarda negatif üs ne demek?', {}, nowSec(w));
    await w.send(q2);
    await w.send(groupText(IDS.groupA, { id: 700000101, username: 'ayse_hoca' }, 'Tersini al demek: 2^-1 = 1/2.', { reply_to_message: { message_id: q2.message?.message_id, from: { id: MERT.id, is_bot: false }, chat: { id: IDS.groupA, type: 'supergroup' }, date: nowSec(w) } }, nowSec(w)));
    expect(groupTexts(w).length).toBe(0);
    const quotaBefore = rows(w, 'quota_usage', (u) => u.student_id === IDS.elif && u.kind === 'message' && u.day === '2026-10-20')[0]?.used ?? 0;
    w.clock.advance(11 * 60_000);
    await w.app.runCron('*/15 * * * *');
    expect(w.db.rpcCalls).toContain('cron_group_auto_answer');
    const out = w.telegram.calls('sendMessage').filter((o) => Number(o.params.chat_id) === IDS.groupA);
    expect(out.length).toBe(1);
    expect(out[0]?.params.reply_to_message_id).toBe(q.message?.message_id);
    const msgRow = rows(w, 'messages', (m) => m.chat_id === IDS.groupA && m.telegram_message_id === q.message?.message_id)[0];
    const br = rows(w, 'bot_responses').at(-1) as Record<string, unknown>;
    expect(br.in_message_id).toBe(msgRow?.id);
    expect(br.student_id).toBe(IDS.elif);
    const quotaAfter = rows(w, 'quota_usage', (u) => u.student_id === IDS.elif && u.kind === 'message' && u.day === '2026-10-20')[0]?.used;
    expect(quotaAfter).toBe(Number(quotaBefore) + 1);
    w.clock.advance(15 * 60_000);
    await w.app.runCron('*/15 * * * *');
    expect(w.telegram.calls('sendMessage').filter((o) => Number(o.params.chat_id) === IDS.groupA).length).toBe(1);
  });
});

describe('is-question-heuristic', () => {
  it('"3/4 + 1/8 kaç" ve "... mi?" soru; "teşekkürler" değil; 7 saat cevapsız → unanswered alarmları', async () => {
    const w = makeApp();
    const cases: Array<[string, boolean]> = [
      ['3/4 + 1/8 kaç', true],
      ['Bu yöntem doğru mu?', true],
      ['teşekkürler', false],
    ];
    const ids: number[] = [];
    for (const [text] of cases) {
      const u = groupText(IDS.groupA, ELIF, text, {}, nowSec(w));
      ids.push(u.message?.message_id ?? 0);
      await w.send(u);
    }
    for (let i = 0; i < cases.length; i++) {
      const m = rows(w, 'messages', (x) => x.chat_id === IDS.groupA && x.telegram_message_id === ids[i])[0];
      expect(m?.is_question).toBe(cases[i]?.[1]);
    }
    await w.send(w.privateText(IDS.elifChat, '/hoca türev konusunu anlatır mısınız'));
    const esc = rows(w, 'escalations').at(-1) as Record<string, unknown>;
    w.clock.advance(7 * 3_600_000);
    await w.app.runCron('5 * * * *');
    const q = rows(w, 'messages', (x) => x.chat_id === IDS.groupA && x.telegram_message_id === ids[0])[0];
    const un = rows(w, 'instructor_alerts', (a) => a.kind === 'unanswered');
    expect(un.some((a) => (a.ref as { message_id?: number }).message_id === q?.id)).toBe(true);
    expect(un.some((a) => (a.ref as { escalation_id?: string }).escalation_id === esc.id)).toBe(true);
    const t = rows(w, 'messages', (x) => x.chat_id === IDS.groupA && x.telegram_message_id === ids[2])[0];
    expect(un.some((a) => (a.ref as { message_id?: number }).message_id === t?.id)).toBe(false);
  });
});

describe('privacy-mode-on-alert', () => {
  it('can_read_all_group_messages=false → sütun false + ops alarmı 1 satır; true ile tekrar → sütun true, alarm done', async () => {
    const w = makeApp();
    w.telegram.me = structuredClone(getMePrivacyOn.result);
    await w.send(fx('bot_added'));
    expect(rows(w, 'tg_chats', (c) => c.chat_id === GROUP_B)[0]?.privacy_mode_off_verified).toBe(false);
    expect(alerts(w, texts.ops.privacyOn, GROUP_B).length).toBe(1);
    expect(alerts(w, texts.ops.privacyOn, GROUP_B)[0]?.status).toBe('open');
    await w.send(fresh(fx('bot_added')));
    expect(alerts(w, texts.ops.privacyOn, GROUP_B).length).toBe(1);
    w.telegram.me = structuredClone(getMePrivacyOff.result);
    await w.send(fresh(fx('bot_added')));
    expect(rows(w, 'tg_chats', (c) => c.chat_id === GROUP_B)[0]?.privacy_mode_off_verified).toBe(true);
    expect(alerts(w, texts.ops.privacyOn, GROUP_B).map((a) => a.status)).toEqual(['done']);
  });
});

describe('recording-notice', () => {
  it('gruba eklenince bildirim gönderilir ve sabitlenir; {days} = 90', async () => {
    const w = makeApp();
    await w.send(fx('bot_added'));
    const sent = w.telegram.textsTo(GROUP_B);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('90 gün sonra silinir');
    expect(sent[0]).not.toContain('{days}');
    const pin = w.telegram.calls('pinChatMessage');
    expect(pin.length).toBe(1);
    const chat = rows(w, 'tg_chats', (c) => c.chat_id === GROUP_B)[0];
    expect(pin[0]?.params.message_id).toBe(chat?.recording_notice_msg_id);
    expect(chat).toMatchObject({ bot_is_admin: true, bot_can_pin: true, recording_notice_days: 90 });
    expect(chat?.recording_notice_legal_id).toBe(rows(w, 'legal_texts', (l) => l.kind === 'grup_kayit')[0]?.id);
    // Aynı olay yeniden gelirse ikinci bildirim gönderilmez.
    await w.send(fresh(fx('bot_added')));
    expect(w.telegram.textsTo(GROUP_B).length).toBe(1);
  });
});

describe('recording-notice-resent-on-retention-change', () => {
  it('retention_days 90 → 60: saatlik cron yeni bildirimi {days}=60 ile gönderir, sabitler; ikinci turda gönderim yok', async () => {
    const w = makeApp();
    w.db.table('tg_chats').find((c) => c.chat_id === IDS.groupA)!.retention_days = 60;
    await w.app.runCron('5 * * * *');
    const sent = w.telegram.textsTo(IDS.groupA);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('60 gün sonra silinir');
    expect(w.telegram.calls('pinChatMessage').length).toBe(1);
    expect(w.telegram.calls('unpinChatMessage')[0]?.params.message_id).toBe(2);
    const chat = rows(w, 'tg_chats', (c) => c.chat_id === IDS.groupA)[0];
    expect(chat?.recording_notice_days).toBe(60);
    expect(chat?.recording_notice_msg_id).toBe(w.telegram.lastTo(IDS.groupA)?.message_id);
    w.clock.advance(3_600_000);
    await w.app.runCron('5 * * * *');
    expect(w.telegram.textsTo(IDS.groupA).length).toBe(1);
  });
});

describe('recording-notice-without-admin', () => {
  it('yönetici değil: pinChatMessage çağrılmaz, bildirim gider, ops alarmı; servis mesajıyla yeni üyeye bildirim + chat_roles', async () => {
    const w = makeApp();
    w.telegram.chatMember = structuredClone(chatMemberMember.result);
    await w.send(fx('bot_added_not_admin'));
    const chat = rows(w, 'tg_chats', (c) => c.chat_id === GROUP_C)[0];
    expect(chat?.bot_is_admin).toBe(false);
    expect(w.telegram.calls('pinChatMessage').length).toBe(0);
    expect(w.telegram.textsTo(GROUP_C).length).toBe(1);
    expect(w.telegram.textsTo(GROUP_C)[0]).toContain('90 gün sonra silinir');
    expect(alerts(w, texts.ops.notAdmin, GROUP_C).length).toBe(1);
    await w.send(fx('new_member_service_message'));
    const out = w.telegram.textsTo(GROUP_C);
    expect(out.length).toBe(3);
    expect(out[1]).toContain('90 gün sonra silinir');
    expect(out[2]).toBe(texts.newMemberHint);
    expect(out.join('\n')).not.toContain('kaan_u');
    expect(rows(w, 'chat_roles', (c) => c.chat_id === GROUP_C && c.telegram_user_id === 700000006)[0]?.role).toBe('student');
    expect(rows(w, 'students').length).toBe(3);
    // Aynı üye chat_member yoluyla da gelirse ikincisi sessiz.
    const again = fresh(fx('new_member_service_message'));
    await w.send(again);
    expect(w.telegram.textsTo(GROUP_C).length).toBe(3);
  });

  it('chat_member (yönetici yolu) yeni üyeye bildirim + ipucu', async () => {
    const w = makeApp();
    await w.send(fx('new_member'));
    const out = w.telegram.textsTo(IDS.groupA);
    expect(out.length).toBe(2);
    expect(out[1]).toBe(texts.newMemberHint);
    expect(rows(w, 'chat_roles', (c) => c.chat_id === IDS.groupA && c.telegram_user_id === 700000005).length).toBe(1);
  });
});

describe('instructor-linked-routing', () => {
  it('bağlı eğitmen: messages.sender_role=instructor + staff_id; /hoca doğru tanıtıcı; reply_to → mark_answered', async () => {
    const w = makeApp();
    const before = rows(w, 'escalations').length;
    await w.send(groupText(IDS.groupA, MERT, '/hoca |x - 2| = 5 denkleminde -3 de çözüm mü?', { message_id: 122 }, 1792513200));
    expect(groupTexts(w).at(-1)).toContain('@ayse_hoca');
    const esc = rows(w, 'escalations').slice(before)[0] as Record<string, unknown>;
    expect(esc.target_staff_id).toBe(IDS.ayse);
    await w.send(fx('group_instructor_reply'));
    const m = rows(w, 'messages', (x) => x.chat_id === IDS.groupA && x.telegram_message_id === 123)[0];
    expect(m?.sender_role).toBe('instructor');
    expect(m?.staff_id).toBe(IDS.ayse);
    expect(w.db.rpcCalls).toContain('mark_answered');
    const after = rows(w, 'escalations', (e) => e.id === esc.id)[0];
    expect(after?.answered_by).toBe(IDS.ayse);
    expect(after?.status).toBe('answered');
    expect(groupTexts(w).length).toBe(1);
  });

  it('bağlanmamış eğitmen other kalır; /egitmen KOD sonrası aynı update instructor olur', async () => {
    const w = makeApp({
      mutateSeed: (seed) => {
        seed.chat_roles = (seed.chat_roles as Array<Record<string, unknown>>).filter((c) => c.telegram_user_id !== 700000101);
        seed['secure.telegram_identities'] = (seed['secure.telegram_identities'] as Array<Record<string, unknown>>).filter((t) => t.telegram_user_id !== 700000101);
      },
    });
    await w.send(fx('group_instructor_reply'));
    const m1 = rows(w, 'messages', (x) => x.chat_id === IDS.groupA && x.telegram_message_id === 123)[0];
    expect(m1?.sender_role).not.toBe('instructor');
    expect(m1?.staff_id).toBeNull();
    expect(m1?.text_raw).toBeNull();
    await w.send(w.privateText(700000101, '/egitmen EGT4-K2PZ', { firstName: 'Ayşe', lastName: 'Yılmaz', username: 'ayse_hoca' }));
    expect(w.telegram.textsTo(700000101).at(-1)).toBe(texts.staffLinked('ayse_hoca'));
    expect(rows(w, 'students').length).toBe(3);
    const again = fresh(fx('group_instructor_reply'));
    if (again.message) again.message.message_id = 125;
    await w.send(again);
    const m2 = rows(w, 'messages', (x) => x.chat_id === IDS.groupA && x.telegram_message_id === 125)[0];
    expect(m2?.sender_role).toBe('instructor');
    expect(m2?.staff_id).toBe(IDS.ayse);
    expect(String(m2?.text_llm)).not.toContain('Ayşe');
  });
});

describe('group-unconsented-member-not-stored', () => {
  it('onaysız üye: yalnız meta veri, LLM yok, tek seferlik yönlendirme + deep link; ikinci etikette cevap yok', async () => {
    const w = makeApp();
    await w.send(fx('group_unconsented_mention'));
    const m = rows(w, 'messages', (x) => x.chat_id === IDS.groupA && x.telegram_message_id === 124)[0];
    expect(m?.text_raw).toBeNull();
    expect(m?.text_llm).toBeNull();
    expect(m?.is_question).toBeNull();
    expect(w.llm.calls.length).toBe(0);
    const out = groupTexts(w);
    expect(out.length).toBe(1);
    expect(out[0]).toContain('https://t.me/ogrenmen_bot?start=grup');
    expect(out[0]).toContain('onay vermen gerekiyor');
    const again = fresh(fx('group_unconsented_mention'));
    if (again.message) again.message.message_id = 126;
    await w.send(again);
    expect(groupTexts(w).length).toBe(1);
    const recent = await w.db.recentMessages(IDS.groupA, 50);
    expect(recent.some((r) => r.id === m?.id)).toBe(false);
    expect(JSON.stringify(rows(w, 'bot_responses').slice(-1))).not.toContain('Barış');
  });
});

describe('forbidden-topic-group-accusative', () => {
  it('ekli biçim ("notumu") grupta: LLM yok, grade_attendance_payment yükseltmesi, guards=forbidden_topic', async () => {
    const w = makeApp();
    const before = rows(w, 'escalations').length;
    await w.send(groupText(IDS.groupA, ELIF, '@ogrenmen_bot matematik notumu söyler misin?', { entities: [{ type: 'mention', offset: 0, length: 13 }] }));
    expect(w.llm.calls.length).toBe(0);
    expect(groupTexts(w).at(-1)).toBe(texts.handoff);
    const esc = rows(w, 'escalations').slice(before);
    expect(esc.map((e) => e.reason)).toEqual(['grade_attendance_payment']);
    expect(w.db.botResponsePayloads.at(-1)?.guards).toEqual(['forbidden_topic']);
  });
});

describe('group-pool-candidate-no-username', () => {
  it('grupta havuz adayı: content_pool.body kullanıcı adı ve [KULLANICI] etiketi taşımaz', async () => {
    const w = makeApp({ llm: { pick: 'chat/03-pool-save.json' } });
    const pool = (): Array<Record<string, unknown>> => rows(w, 'content_pool', (c) => c.status === 'pending_review');
    const before = pool().length;
    await w.send(groupText(IDS.groupA, ELIF, '@ogrenmen_bot kesirleri nasıl toplarım?', { entities: [{ type: 'mention', offset: 0, length: 13 }] }));
    expect(groupTexts(w).at(-1)).toContain('@elif_k');
    const added = pool().slice(before);
    expect(added.length).toBe(1);
    const body = String(added[0]?.body);
    expect(body).not.toContain('@');
    expect(body).not.toContain('[KULLANICI]');
    expect(body.startsWith('Kesirleri toplarken')).toBe(true);
  });
});

describe('hoca-unconsented-member', () => {
  it('onaysız üyenin /hoca metni saklanmaz: escalations.question_text null, eğitmen yine etiketlenir', async () => {
    const w = makeApp();
    const before = rows(w, 'escalations').length;
    await w.send(groupText(IDS.groupA, { id: 700000099, username: 'yeni_uye' }, '/hoca not ortalamam ve adım Barış Yılmaz'));
    expect(groupTexts(w).at(-1)).toContain('@ayse_hoca');
    const esc = rows(w, 'escalations').slice(before);
    expect(esc.length).toBe(1);
    expect(esc[0]?.question_text).toBeNull();
    expect(JSON.stringify(rows(w, 'escalations'))).not.toContain('Barış');
    expect(w.llm.calls.length).toBe(0);
  });

  it('onaylı öğrencinin /hoca metni temizlenmiş olarak saklanır', async () => {
    const w = makeApp();
    const before = rows(w, 'escalations').length;
    await w.send(groupText(IDS.groupA, ELIF, '/hoca mutlak değerde iki durumu anlamadım'));
    expect(rows(w, 'escalations').slice(before)[0]?.question_text).toBe('mutlak değerde iki durumu anlamadım');
  });
});

describe('ops-alert-write-failure', () => {
  it('instructor_alerts yazımı yetkiyle düşse de (42501) kayıt bildirimi gruba gider ve tg_chats güncellenir', async () => {
    const w = makeApp();
    w.telegram.me = structuredClone(getMePrivacyOn.result);
    w.telegram.chatMember = structuredClone(chatMemberMember.result);
    const fail = async (): Promise<void> => {
      throw new DbError('42501', 'permission denied for table instructor_alerts', 403);
    };
    // Kapsamlı kopyalar (forStudent) da aynı prototipi kullanır.
    const open = vi.spyOn(FakeDb.prototype, 'openOpsAlert').mockImplementation(fail);
    const close = vi.spyOn(FakeDb.prototype, 'closeOpsAlert').mockImplementation(fail);
    try {
      await w.send(fx('bot_added_not_admin'));
      expect(open).toHaveBeenCalled();
    } finally {
      open.mockRestore();
      close.mockRestore();
    }
    expect(rows(w, 'instructor_alerts', (a) => a.kind === 'ops' && (a.ref as { chat_id?: number } | null)?.chat_id === GROUP_C).length).toBe(0);
    const sent = w.telegram.textsTo(GROUP_C);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain('90 gün sonra silinir');
    const chat = rows(w, 'tg_chats', (c) => c.chat_id === GROUP_C)[0];
    expect(chat?.recording_notice_days).toBe(90);
    expect(chat?.recording_notice_msg_id).toBe(w.telegram.lastTo(GROUP_C)?.message_id);
  });

  it('chatStaff okuması düşerse etiketlenen bot yine cevaplar (mentionsStaff en iyi çaba)', async () => {
    const w = makeApp({ llm: { pick: 'chat_group/01-group-socratic.json' } });
    const spy = vi.spyOn(FakeDb.prototype, 'chatStaff').mockImplementation(async () => {
      throw new DbError('42501', 'permission denied for column active', 403);
    });
    try {
      await w.send(fx('group_mention'));
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(w.llm.okCalls.length).toBe(1);
    expect(w.telegram.lastTo(IDS.groupA)?.params.reply_to_message_id).toBe(120);
  });
});

describe('recording-notice-real-legal-body', () => {
  /** content/…/export-sql.py'nin yüklediği gövde: belgenin tamamı, {{RETENTION_MESSAGES_DAYS}} → 90 çözülmüş. */
  const resolved = grupKayitDoc.replaceAll('{{RETENTION_MESSAGES_DAYS}}', '90');

  it('gruba yalnız kısa blok gider (≤ 4 satır, başlık/uyarı/uzun sürüm yok); 90 → 60 değişince metin 60 der', async () => {
    const w = makeApp({
      mutateSeed: (seed) => {
        (seed.legal_texts as Array<Record<string, unknown>>).find((l) => l.kind === 'grup_kayit')!.body_md = resolved;
      },
    });
    await w.send(fx('bot_added'));
    const first = w.telegram.textsTo(GROUP_B)[0] ?? '';
    expect(first.split('\n').length).toBeLessThanOrEqual(4);
    expect(first).toContain('90 gün sonra silinir');
    expect(first).not.toContain('HUKUKİ İNCELEME');
    expect(first).not.toContain('<!--');
    expect(first).not.toContain('Uzun sürüm');
    expect(first).not.toContain('{{');
    w.db.table('tg_chats').find((c) => c.chat_id === GROUP_B)!.retention_days = 60;
    await w.app.runCron('5 * * * *');
    const again = w.telegram.textsTo(GROUP_B).at(-1) ?? '';
    expect(again).toContain('60 gün sonra silinir');
    expect(again).not.toContain('90');
    expect(rows(w, 'tg_chats', (c) => c.chat_id === GROUP_B)[0]?.recording_notice_days).toBe(60);
  });
});
