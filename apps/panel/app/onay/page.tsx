'use client';
// Veli onay formu (BLUEPRINT §7 onay/page.tsx, docs/hukuk/veli-onay-formu.md "Web bağlantısı"): ?token= — giriş gerektirmez;
// legal ton, tek sayfa; başlıklar title-3, metin body; "Onaylıyorum" (primary) / "Şimdi değil" (quiet); önceden işaretli kutu yok.
// Onay yalnız redeem_guardian_token (anon RPC) ile yazılır; bağlantı 72 saat geçerli ve tek kullanımlıktır. Veliye "siz" diye hitap edilir.
// Sayfa formun KENDİ metnini gösterir (docs/hukuk §3 "Web bağlantısı"): bölüm 1–4 saklama günleri doldurulmuş hâlde, aydınlatma
// metninin tamamı açılır bölümde; beyan kutularının metni formun 5. bölümünden okunur (1, 2, 4 zorunlu; 3 yalnız kâğıt formda).
// Gösterilen sürüm (doc_version, biliniyorsa legal_text_id) onay kanıtına yazılır ve sayfada görünür.
import * as React from 'react';
import { Button, Notice, TextField } from '../../lib/ds';
import { useAction, useAsync, useQueryParam } from '../../lib/hooks';
import { useDataSource } from '../../lib/hooks';
import { WEB_DECLARATIONS } from '../../lib/legal';
import { Markdown } from '../../lib/markdown';

const DECLARATIONS = WEB_DECLARATIONS;

const RELATIONS = ['anne', 'baba', 'vasi'];

type Outcome = 'idle' | 'done' | 'declined' | 'invalid';

export default function Page() {
  const token = useQueryParam('token');
  const ds = useDataSource();
  const text = useAsync(() => ds.guardianFormText(), [ds]);
  const [name, setName] = React.useState('');
  const [relation, setRelation] = React.useState('');
  const [checked, setChecked] = React.useState<Record<number, boolean>>({});
  const [outcome, setOutcome] = React.useState<Outcome>('idle');
  const action = useAction();
  const allChecked = DECLARATIONS.every((d) => checked[d.no] === true);
  const doc = text.data;
  const ready = !!token && !!doc && name.trim().length > 1 && !!relation && allChecked;

  const confirm = async () => {
    if (!token || !ready || !doc) return;
    const r = await action.run(() =>
      ds.redeemGuardianToken(token, {
        guardian_name: name.trim(),
        guardian_relation: relation,
        confirmed_at: new Date().toISOString(),
        declarations: DECLARATIONS.filter((d) => checked[d.no]).map((d) => d.no),
        doc_version: doc.doc_version,
        legal_text_id: doc.legal_text_id,
      }),
    );
    if (r.ok) setOutcome(r.value ? 'done' : 'invalid');
  };

  return (
    <main className="onay-page">
      <div className="legal">
        <h1 className="t-title-3">Veli / vasi açık rıza formu</h1>
        {!token && <Notice tone="warning">Bu sayfa koordinatörün gönderdiği tek kullanımlık bağlantıyla açılır. Bağlantıyı yeniden açın ya da koordinatörden yeni bir bağlantı isteyin.</Notice>}
        {outcome === 'done' && (
          <Notice tone="info" title="Onayınız kaydedildi">
            Teşekkürler. Öğrenci artık Öğrenmen ile çalışabilir. Onayı istediğiniz zaman koordinatöre başvurarak geri alabilirsiniz.
          </Notice>
        )}
        {outcome === 'declined' && (
          <Notice tone="info" title="Onay verilmedi">
            Hiçbir onay kaydı oluşmadı; öğrenciyle sohbet başlamaz. Fikriniz değişirse koordinatörden yeni bir bağlantı isteyebilirsiniz.
          </Notice>
        )}
        {outcome === 'invalid' && (
          <Notice tone="warning" title="Bağlantı geçersiz">
            Bağlantı geçersiz, kullanılmış ya da süresi dolmuş. Koordinatörden yeni bir bağlantı isteyin.
          </Notice>
        )}
        {token && outcome === 'idle' && (
          <>
            <Notice tone="legal">
              Öğrenmen, easy'nin yapay zekâ destekli öğrenme hizmetidir. 18 yaşını doldurmamış öğrenciyle veli onayı gelmeden sohbet başlamaz, mesajların içeriği saklanmaz
              ve yapay zekâya gönderilmez.
            </Notice>
            {text.error && <Notice tone="warning" title="Metin yüklenemedi">{text.error}</Notice>}
            {!doc && !text.error && <div aria-busy="true" className="ds-skeleton" />}
            {doc && (
              <section className="stack" aria-label="Form metni">
                <span className="hint" data-doc-version={doc.doc_version}>
                  Metin sürümü {doc.doc_version}. Bu sürüm onay kaydınıza yazılır.
                  {doc.days_source === 'build' ? ' Saklama süreleri bu sürümün yayımlandığı saklama tablosu değerleridir.' : ''}
                </span>
                <Markdown source={doc.form_md} className="legal-text" />
                <details className="legal-details">
                  <summary className="t-label">Aydınlatma metninin tamamı (sürüm {doc.aydinlatma_version})</summary>
                  <Markdown source={doc.aydinlatma_md} className="legal-text" />
                </details>
              </section>
            )}
            <section className="form" aria-labelledby="form-h">
              <h2 id="form-h" className="t-title-3">
                Bilgileriniz
              </h2>
              <TextField label="Veli / vasi adı soyadı" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
              <div className="field">
                <label htmlFor="relation">Öğrenciyle ilişkiniz</label>
                <select id="relation" value={relation} onChange={(e) => setRelation(e.target.value)} required>
                  <option value="">Seçin</option>
                  {RELATIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="stack">
                <legend className="t-title-3">Beyan</legend>
                {DECLARATIONS.map((d) => (
                  <label key={d.no} className="check">
                    <input
                      type="checkbox"
                      name={`beyan-${d.no}`}
                      checked={checked[d.no] === true}
                      onChange={(e) => setChecked((c) => ({ ...c, [d.no]: e.target.checked }))}
                    />
                    <span className="t-body">{d.text}</span>
                  </label>
                ))}
                <span className="hint">
                  Üç beyanın hepsi zorunludur. Beyanın 3. maddesi (ders kaydı analizi) bu sayfadan verilmez; kâğıt formla ya da koordinatör aracılığıyla alınır.
                </span>
              </fieldset>
              <div className="row">
                <Button variant="primary" disabled={!ready || action.busy} onClick={() => void confirm()}>
                  Onaylıyorum
                </Button>
                <Button variant="quiet" disabled={action.busy} onClick={() => setOutcome('declined')}>
                  Şimdi değil
                </Button>
              </div>
              {action.error && <Notice tone="warning">{action.error}</Notice>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
