'use client';
// Gruplar (BLUEPRINT §7 gruplar/page.tsx; koordinatör): tg_chats listesi (bot yönetici değilse Notice warning),
// gizlilik modu doğrulaması, otomatik yanıt dakikası ve saklama günü düzenleme (update tg_chats, audit), chat_roles üyeleri;
// "Eğitmen Telegram bağla" → link_staff_telegram; "Bağlama kodu üret" → mint_staff_code (bir kez gösterilir, 72 saat).
import * as React from 'react';
import { Badge, Button, Notice, TextField } from '../../lib/ds';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, Loadable, ROLE_TEXT, StaffPage, type StaffContext } from '../../lib/shell';
import { AUTO_ANSWER_MIN_MAX, RETENTION_DAYS_MAX, RETENTION_DAYS_MIN, chatFieldsProblem, formatCode, parseWholeNumber } from '../../lib/validation';
import type { ChatRow, StaffRole } from '../../lib/data';

const MEMBER_ROLE: Record<string, string> = { student: 'Öğrenci', bot: 'Bot', other: 'Diğer', ...ROLE_TEXT };

function ChatCard({ ctx, chat, onChanged }: { ctx: StaffContext; chat: ChatRow; onChanged: () => void }) {
  const [auto, setAuto] = React.useState(String(chat.group_auto_answer_min));
  const [days, setDays] = React.useState(String(chat.retention_days));
  const action = useAction();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // boş sayı alanı tarayıcı denetiminden geçer ve Number('') = 0 olur: 0 gün saklama geçmişi siler → istek gitmez
    const retention = parseWholeNumber(days);
    const autoMin = parseWholeNumber(auto);
    if (retention === null || autoMin === null) {
      action.setError(retention === null ? `Saklama günü ${RETENTION_DAYS_MIN}–${RETENTION_DAYS_MAX} arasında olmalı.` : `Otomatik cevap süresi 0–${AUTO_ANSWER_MIN_MAX} dakika arasında olmalı.`);
      return;
    }
    const fields = { group_auto_answer_min: autoMin, retention_days: retention };
    const problem = chatFieldsProblem(fields);
    if (problem) {
      action.setError(problem);
      return;
    }
    const r = await action.run(
      () => ctx.ds.updateChat(chat.chat_id, fields),
      'Kaydedildi. Saklama günü değiştiyse bot kayıt bildirimini yeni süreyle yeniden gönderir.',
    );
    if (r.ok) onChanged();
  };
  return (
    <article className="card" aria-label={chat.title ?? String(chat.chat_id)}>
      <div className="card-head">
        <span className="t-title-3">{chat.title ?? 'Adsız grup'}</span>
        <div className="row">
          <Badge tone={chat.bot_is_admin ? 'success' : 'warning'}>{chat.bot_is_admin ? '✓ Bot yönetici' : 'Bot yönetici değil'}</Badge>
          <Badge tone={chat.privacy_mode_off_verified ? 'success' : 'warning'}>{chat.privacy_mode_off_verified ? '✓ Gizlilik modu kapalı' : 'Gizlilik modu doğrulanmadı'}</Badge>
        </div>
      </div>
      {!chat.bot_is_admin && (
        <Notice tone="warning" title="Bot yönetici değil">
          Kayıt bildirimi sabitlenemez ve yeni üyeler bildirilmez. Botu grupta yönetici yap ve sabitleme izni ver.
        </Notice>
      )}
      <form className="form-row" onSubmit={(e) => void save(e)} aria-label="Grup ayarları">
        <div className="field">
          <label htmlFor={`auto-${chat.chat_id}`}>Otomatik yanıt (dk; 0 = kapalı)</label>
          <input id={`auto-${chat.chat_id}`} type="number" required min={0} max={AUTO_ANSWER_MIN_MAX} step={1} value={auto} onChange={(e) => setAuto(e.target.value)} disabled={!ctx.canEdit} />
        </div>
        <div className="field">
          <label htmlFor={`days-${chat.chat_id}`}>Mesaj saklama (gün)</label>
          <input id={`days-${chat.chat_id}`} type="number" required min={RETENTION_DAYS_MIN} max={RETENTION_DAYS_MAX} step={1} value={days} onChange={(e) => setDays(e.target.value)} disabled={!ctx.canEdit} />
        </div>
        <div className="field">
          <span className="field-label">&nbsp;</span>
          <Button variant="secondary" type="submit" disabled={!ctx.canEdit || action.busy}>
            Ayarları kaydet
          </Button>
        </div>
      </form>
      <span className="hint">
        Son kayıt bildirimindeki süre: {chat.recording_notice_days ?? '—'} gün. Otomatik yanıt açıkken de yalnız onay vermiş öğrencinin sorusu, kendi kotasıyla cevaplanır.
      </span>
      <ActionResult error={action.error} message={action.message} />
      {chat.members.length > 0 && (
        <table className="table" aria-label="Üyeler">
          <thead>
            <tr>
              <th>Üye</th>
              <th>Rol</th>
              <th>Etiket</th>
            </tr>
          </thead>
          <tbody>
            {chat.members.map((m) => (
              <tr key={m.telegram_user_id}>
                <td>{m.label ?? 'Onaysız üye'}</td>
                <td>{MEMBER_ROLE[m.role] ?? m.role}</td>
                <td className="mono">{m.mention_handle ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}

function LinkStaff({ ctx, onChanged }: { ctx: StaffContext; onChanged: () => void }) {
  const staff = useAsync(() => ctx.ds.staff(), [ctx.ds]);
  const [staffId, setStaffId] = React.useState('');
  const [tgId, setTgId] = React.useState('');
  const [username, setUsername] = React.useState('');
  const [code, setCode] = React.useState<string | null>(null);
  const link = useAction();
  const mint = useAction();
  const editors = (staff.data ?? []).filter((s) => s.active && (s.role as StaffRole) !== 'observer');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const handle = username.trim().replace(/^@?/, '@');
    const r = await link.run(() => ctx.ds.linkStaffTelegram(staffId, Number(tgId), username.trim().replace(/^@/, ''), handle), 'Eğitmen bağlandı; gruplardaki rolü güncellendi.');
    if (r.ok) onChanged();
  };
  const mintCode = async () => {
    const r = await mint.run(() => ctx.ds.mintStaffCode(staffId));
    if (r.ok && r.value) setCode(formatCode(r.value));
  };
  return (
    <section className="section" aria-labelledby="link-h">
      <h2 id="link-h" className="t-title-2">
        Eğitmen Telegram bağla
      </h2>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="link-staff">Personel</label>
          <select id="link-staff" value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!ctx.canEdit} required>
            <option value="">Seç</option>
            {editors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} · {ROLE_TEXT[s.role]}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <TextField label="Telegram kullanıcı kimliği" inputMode="numeric" pattern="\d+" value={tgId} onChange={(e) => setTgId(e.target.value)} disabled={!ctx.canEdit} />
          <TextField label="@kullanıcı" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!ctx.canEdit} />
        </div>
        <div className="row">
          <Button variant="secondary" type="submit" disabled={!ctx.canEdit || link.busy || !staffId || !/^\d+$/.test(tgId) || !username.trim()}>
            Bağla
          </Button>
          <Button variant="secondary" type="button" disabled={!ctx.canEdit || mint.busy || !staffId} onClick={() => void mintCode()}>
            Bağlama kodu üret
          </Button>
        </div>
        <ActionResult error={link.error ?? mint.error} message={link.message} />
        {code && (
          <Notice tone="info" title={`Bağlama kodu: ${code}`}>
            Kod yalnız şimdi gösterilir ve 72 saat geçerlidir. Eğitmen bota özelden /egitmen {code} yazar.
          </Notice>
        )}
      </form>
    </section>
  );
}

function Groups(ctx: StaffContext) {
  const chats = useAsync(() => ctx.ds.chats(), [ctx.ds]);
  return (
    <>
      <Loadable state={chats}>
        {(rows) => (
          <section className="stack" aria-label="Gruplar">
            {rows.length === 0 && <Notice tone="info">Bot henüz bir gruba eklenmedi.</Notice>}
            {rows.map((c) => (
              <ChatCard key={c.chat_id} ctx={ctx} chat={c} onChanged={chats.reload} />
            ))}
          </section>
        )}
      </Loadable>
      <LinkStaff ctx={ctx} onChanged={chats.reload} />
    </>
  );
}

export default function Page() {
  return (
    <StaffPage title="Gruplar" roles={['coordinator']}>
      {(ctx) => <Groups {...ctx} />}
    </StaffPage>
  );
}
