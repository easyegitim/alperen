'use client';
// Onaylar (BLUEPRINT §7 onaylar/page.tsx): consents, veli kodu/bağlantısı (mint_guardian_code), "Kâğıt onay gir" (record_staff_consent),
// is_minor düzeltme, onay iptali, silme talepleri, legal_texts sürümleri (Notice legal; gövde DB'den, `{{` içermez),
// öğrenci kimlik formu (student_full_name audit'li okuma + update_student_pii; audit yalnız alan adlarını yazar).
import * as React from 'react';
import { Badge, Button, Notice, TextField } from '../../lib/ds';
import { dateTime, fullDate } from '../../lib/format';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import { formatCode } from '../../lib/validation';
import type { ConsentKind, ConsentSummary, PiiFields } from '../../lib/data';

const KIND_TEXT: Record<string, string> = {
  kvkk_aydinlatma: 'Aydınlatma ve açık rıza',
  veli_onayi: 'Veli onayı',
  grup_kayit: 'Grup kayıt bildirimi',
  ders_kaydi: 'Ders kaydı analizi',
  kullanim_kosullari: 'Kullanım koşulları',
};
const METHOD_TEXT: Record<string, string> = {
  telegram_button: 'Telegram düğmesi',
  guardian_code: 'Veli kodu',
  web_token: 'Web bağlantısı',
  paper: 'Kâğıt form',
  panel: 'Panel beyanı',
};
const CONSENT_KINDS: ConsentKind[] = ['kvkk_aydinlatma', 'veli_onayi', 'grup_kayit', 'ders_kaydi'];

function ConsentTable({ ctx, rows, onChanged }: { ctx: StaffContext; rows: ConsentSummary[]; onChanged: () => void }) {
  const action = useAction();
  const coordinator = ctx.viewer.role === 'coordinator';
  const revoke = async (id: string) => {
    const r = await action.run(() => ctx.ds.revokeConsent(id), 'Onay iptal edildi; öğrenciyle sohbet durur.');
    if (r.ok) onChanged();
  };
  const toggleMinor = async (s: ConsentSummary) => {
    const r = await action.run(() => ctx.ds.setMinor(s.public_ref, !s.is_minor), 'Yaş grubu güncellendi.');
    if (r.ok) onChanged();
  };
  return (
    <section className="section" aria-labelledby="consent-h">
      <h2 id="consent-h" className="t-title-2">
        Onay durumu
      </h2>
      <ActionResult error={action.error} message={action.message} />
      {rows.map((s) => (
        <article key={s.student_id} className="card">
          <div className="card-head">
            <span className="t-title-3">{s.label}</span>
            <div className="row">
              {s.consent_ok ? <Badge tone="success">✓ Onaylar tamam</Badge> : <Badge tone="warning">Eksik: {s.missing.map((m) => KIND_TEXT[m]).join(', ')}</Badge>}
              <Badge tone="neutral">{s.is_minor ? '18 yaş altı' : '18 yaş ve üstü'}</Badge>
              {s.guardian_code_open && <Badge tone="primary">Açık veli kodu var</Badge>}
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Tür</th>
                <th>Yol</th>
                <th>Tarih</th>
                <th>Durum</th>
                {coordinator && <th />}
              </tr>
            </thead>
            <tbody>
              {s.consents.map((c) => (
                <tr key={c.id}>
                  <td>{KIND_TEXT[c.kind] ?? c.kind}</td>
                  <td>{METHOD_TEXT[c.method] ?? c.method}</td>
                  <td>{dateTime(c.given_at)}</td>
                  <td>{c.status === 'given' ? <Badge tone="success">✓ Verildi</Badge> : <Badge tone="danger">✕ İptal</Badge>}</td>
                  {coordinator && (
                    <td>
                      {c.status === 'given' && (
                        <Button variant="quiet" size="sm" disabled={action.busy} onClick={() => void revoke(c.id)}>
                          İptal et
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {coordinator && (
            <div className="row">
              <Button variant="quiet" size="sm" disabled={action.busy} onClick={() => void toggleMinor(s)}>
                {s.is_minor ? '18 yaş ve üstü olarak düzelt' : '18 yaş altı olarak düzelt'}
              </Button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function GuardianCode({ ctx, rows }: { ctx: StaffContext; rows: ConsentSummary[] }) {
  const [ref, setRef] = React.useState('');
  const [channel, setChannel] = React.useState<'telegram' | 'web'>('telegram');
  const [code, setCode] = React.useState<{ code: string; channel: 'telegram' | 'web' } | null>(null);
  const action = useAction();
  const minors = rows.filter((r) => r.is_minor);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => ctx.ds.mintGuardianCode(ref, channel));
    // RPC 8 karakter döner (§3.9); gösterim ve bağlantı 'K7F3-2QX9' biçiminde (redeem '-' işaretini atar)
    if (r.ok && r.value) setCode({ code: formatCode(r.value), channel });
  };
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-labelledby="gcode-h">
      <h2 id="gcode-h" className="t-title-2">
        Veli kodu ya da bağlantısı üret
      </h2>
      <div className="form-row">
        <div className="field">
          <label htmlFor="gcode-student">Öğrenci</label>
          <select id="gcode-student" value={ref} onChange={(e) => setRef(e.target.value)} disabled={!ctx.canEdit} required>
            <option value="">Seç</option>
            {minors.map((s) => (
              <option key={s.public_ref} value={s.public_ref}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="gcode-channel">Kanal</label>
          <select id="gcode-channel" value={channel} onChange={(e) => setChannel(e.target.value as 'telegram' | 'web')} disabled={!ctx.canEdit}>
            <option value="telegram">Telegram kodu (/veli KOD)</option>
            <option value="web">Web bağlantısı</option>
          </select>
        </div>
      </div>
      <div className="row">
        <Button variant="secondary" type="submit" disabled={!ctx.canEdit || action.busy || !ref}>
          Kod üret
        </Button>
      </div>
      <ActionResult error={action.error} message={null} />
      {code && (
        <Notice tone="info" title={`Kod: ${code.code}`}>
          {code.channel === 'telegram'
            ? `Kod yalnız şimdi gösterilir ve 72 saat geçerlidir. Veli kendi Telegram hesabından botla özel sohbette /veli ${code.code} yazar.`
            : `Bağlantı yalnız şimdi gösterilir ve 72 saat geçerlidir: ${origin}/onay?token=${encodeURIComponent(code.code)}`}
        </Notice>
      )}
    </form>
  );
}

function PaperConsent({ ctx, rows, onDone }: { ctx: StaffContext; rows: ConsentSummary[]; onDone: () => void }) {
  const [ref, setRef] = React.useState('');
  const [kind, setKind] = React.useState<ConsentKind | ''>('');
  const [method, setMethod] = React.useState<'paper' | 'panel'>('paper');
  const [formNo, setFormNo] = React.useState('');
  const [boxesChecked, setBoxesChecked] = React.useState(false);
  const action = useAction();
  const needsBoxes = kind === 'veli_onayi' && method === 'paper';
  const ready = ctx.canEdit && ref && kind && (method === 'panel' || formNo.trim()) && (!needsBoxes || boxesChecked);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    const evidence = method === 'paper' ? { form_no: formNo.trim(), ...(needsBoxes ? { boxes_checked: [1, 2, 4] } : {}) } : { note: formNo.trim() || null };
    const r = await action.run(() => ctx.ds.recordStaffConsent(ref, kind, method, evidence), 'Onay kaydedildi.');
    if (r.ok) {
      setFormNo('');
      setBoxesChecked(false);
      onDone();
    }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-labelledby="paper-h">
      <h2 id="paper-h" className="t-title-2">
        Kâğıt onay gir
      </h2>
      <div className="form-row">
        <div className="field">
          <label htmlFor="paper-student">Öğrenci</label>
          <select id="paper-student" value={ref} onChange={(e) => setRef(e.target.value)} disabled={!ctx.canEdit} required>
            <option value="">Seç</option>
            {rows.map((s) => (
              <option key={s.public_ref} value={s.public_ref}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="paper-kind">Onay türü</label>
          <select id="paper-kind" value={kind} onChange={(e) => setKind(e.target.value as ConsentKind)} disabled={!ctx.canEdit} required>
            <option value="">Seç</option>
            {CONSENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_TEXT[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="paper-method">Yol</label>
          <select id="paper-method" value={method} onChange={(e) => setMethod(e.target.value as 'paper' | 'panel')} disabled={!ctx.canEdit}>
            <option value="paper">Kâğıt form</option>
            <option value="panel">Panel beyanı</option>
          </select>
        </div>
      </div>
      <TextField label={method === 'paper' ? 'Form numarası' : 'Açıklama (isteğe bağlı)'} value={formNo} onChange={(e) => setFormNo(e.target.value)} disabled={!ctx.canEdit} />
      {needsBoxes && (
        <label className="check">
          <input type="checkbox" checked={boxesChecked} onChange={(e) => setBoxesChecked(e.target.checked)} />
          <span>Formdaki 1, 2 ve 4. zorunlu kutuların veli tarafından işaretlendiğini denetledim</span>
        </label>
      )}
      <div className="row">
        <Button variant="primary" type="submit" disabled={!ready || action.busy}>
          Onayı kaydet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </form>
  );
}

function IdentityForm({ ctx, rows }: { ctx: StaffContext; rows: ConsentSummary[] }) {
  const [ref, setRef] = React.useState('');
  const [fullName, setFullName] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<Required<PiiFields>>({ display_name: '', school: '', grade: '', guardian_name: '', guardian_relation: '', guardian_contact: '' });
  const action = useAction();
  const reveal = useAction();
  const set = (k: keyof PiiFields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const changed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.trim() !== '')) as PiiFields;
    const r = await action.run(() => ctx.ds.updateStudentPii(ref, changed), 'Kaydedildi; denetim kaydına yalnız alan adları yazıldı.');
    if (r.ok) setFields({ display_name: '', school: '', grade: '', guardian_name: '', guardian_relation: '', guardian_contact: '' });
  };
  const showName = async () => {
    const r = await reveal.run(() => ctx.ds.studentFullName(ref));
    if (r.ok) setFullName(r.value ?? '—');
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-labelledby="pii-h">
      <h2 id="pii-h" className="t-title-2">
        Öğrenci kimlik bilgileri
      </h2>
      <p className="hint">Bu bilgiler kilitli alanda (secure) tutulur ve yapay zekâya hiç gitmez. Boş bırakılan alan değişmez.</p>
      <div className="field">
        <label htmlFor="pii-student">Öğrenci</label>
        <select
          id="pii-student"
          value={ref}
          onChange={(e) => {
            setRef(e.target.value);
            setFullName(null);
          }}
          disabled={!ctx.canEdit}
        >
          <option value="">Seç</option>
          {rows.map((s) => (
            <option key={s.public_ref} value={s.public_ref}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {ctx.viewer.role === 'coordinator' && ref && (
        <div className="row">
          <Button variant="secondary" type="button" disabled={reveal.busy} onClick={() => void showName()}>
            Tam adı göster
          </Button>
          <span className="hint">Görüntüleme denetim kaydına yazılır.</span>
          {fullName && <span className="t-label">{fullName}</span>}
        </div>
      )}
      <ActionResult error={reveal.error} message={null} />
      <div className="form-row">
        <TextField label="Görünen ad" value={fields.display_name} onChange={set('display_name')} disabled={!ctx.canEdit || !ref} />
        <TextField label="Okul" value={fields.school} onChange={set('school')} disabled={!ctx.canEdit || !ref} />
        <TextField label="Sınıf" value={fields.grade} onChange={set('grade')} disabled={!ctx.canEdit || !ref} />
      </div>
      <div className="form-row">
        <TextField label="Veli adı" value={fields.guardian_name} onChange={set('guardian_name')} disabled={!ctx.canEdit || !ref} />
        <TextField label="Yakınlık" value={fields.guardian_relation} onChange={set('guardian_relation')} disabled={!ctx.canEdit || !ref} />
        <TextField label="Veli iletişimi" hint="Veli kodu ya da bağlantısı buraya gönderilir." value={fields.guardian_contact} onChange={set('guardian_contact')} disabled={!ctx.canEdit || !ref} />
      </div>
      <div className="row">
        <Button variant="secondary" type="submit" disabled={!ctx.canEdit || !ref || action.busy}>
          Kimlik bilgilerini kaydet
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </form>
  );
}

function LegalTexts({ ctx }: { ctx: StaffContext }) {
  const texts = useAsync(() => ctx.ds.legalTexts(), [ctx.ds]);
  return (
    <section className="section" aria-labelledby="legal-h">
      <h2 id="legal-h" className="t-title-2">
        Yasal metin sürümleri
      </h2>
      <Loadable state={texts}>
        {(rows) => (
          <div className="stack">
            {rows.map((t) => (
              <Notice key={t.id} tone="legal" title={`${KIND_TEXT[t.kind] ?? t.kind} · ${t.version} · yürürlük ${fullDate(`${t.effective_from}T12:00:00Z`)}`}>
                {t.body_md.includes('{{') ? (
                  'Bu metinde çözülmemiş yer tutucu var; yayımlanmaz. Seed üreticisini (export-sql.py) yeniden çalıştır.'
                ) : (
                  <details>
                    <summary>Metni aç</summary>
                    <div className="legal-body">{t.body_md}</div>
                  </details>
                )}
              </Notice>
            ))}
          </div>
        )}
      </Loadable>
    </section>
  );
}

function Deletions({ ctx }: { ctx: StaffContext }) {
  const rows = useAsync(() => ctx.ds.deletionRequests(), [ctx.ds]);
  return (
    <section className="section" aria-labelledby="del-h">
      <h2 id="del-h" className="t-title-2">
        Silme talepleri
      </h2>
      <Loadable state={rows}>
        {(list) =>
          list.length === 0 ? (
            <Notice tone="info">Açık silme talebi yok.</Notice>
          ) : (
            <table className="table">
              <tbody>
                {list.map((d) => (
                  <tr key={d.id}>
                    <td>{d.student_label ?? 'Öğrenci'}</td>
                    <td>{dateTime(d.created_at)}</td>
                    <td>{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loadable>
    </section>
  );
}

function Audit({ ctx }: { ctx: StaffContext }) {
  const events = useAsync(() => ctx.ds.auditRecent(20), [ctx.ds]);
  return (
    <section className="section" aria-labelledby="audit-h">
      <h2 id="audit-h" className="t-title-2">
        Son denetim kayıtları
      </h2>
      <Loadable state={events}>
        {(list) =>
          list.length === 0 ? (
            <Notice tone="info">Bu oturumda kayıt yok.</Notice>
          ) : (
            <table className="table">
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.at)}</td>
                    <td className="mono">{e.action}</td>
                    <td>{e.table_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Loadable>
    </section>
  );
}

function Consents(ctx: StaffContext) {
  const consents = useAsync(() => ctx.ds.consents(null), [ctx.ds]);
  return (
    <Loadable state={consents}>
      {(rows) => (
        <>
          <ConsentTable ctx={ctx} rows={rows} onChanged={consents.reload} />
          <GuardianCode ctx={ctx} rows={rows} />
          <PaperConsent ctx={ctx} rows={rows} onDone={consents.reload} />
          <IdentityForm ctx={ctx} rows={rows} />
          {ctx.viewer.role === 'coordinator' && <Deletions ctx={ctx} />}
          <LegalTexts ctx={ctx} />
          {ctx.viewer.role === 'coordinator' && <Audit ctx={ctx} />}
        </>
      )}
    </Loadable>
  );
}

export default function Page() {
  return (
    <StaffPage title="Onaylar" roles={['coordinator', 'instructor']}>
      {(ctx) => <Consents {...ctx} />}
    </StaffPage>
  );
}
