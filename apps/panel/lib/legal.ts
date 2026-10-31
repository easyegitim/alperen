// Veli onay sayfasının sürümlü metni (docs/hukuk/veli-onay-formu.md + aydinlatma-metni.md, M12; salt okunur kaynak).
// docs/hukuk §3 "Web bağlantısı": sayfa formun METNİNİ gösterir. Saklama süreleri elle yazılmaz: `{{RETENTION_*_DAYS}}`
// yer tutucuları placeholders.json'daki `policy_id` / `days_source` ile retention_policies satırlarından doldurulur
// (ilke 5). Canlı modda anon rol retention_policies'i okuyamaz; o zaman derleme anındaki `expected_days` kullanılır ve
// sayfa bunu söyler (README "Açık maddeler": M02'den anon okunabilir `legal_text_public(kind)` RPC'si beklenir).
import formSource from '../../../docs/hukuk/veli-onay-formu.md?raw';
import aydinlatmaSource from '../../../docs/hukuk/aydinlatma-metni.md?raw';
import placeholders from '../../../docs/hukuk/placeholders.json';
import type { GuardianFormText } from './data/types';

interface Placeholder {
  policy_id: string;
  days_source: string;
  expected_days: number;
}

export interface RetentionPolicyRow {
  id: string;
  days: number;
}

export interface LegalDoc {
  doc_version: string;
  legal_texts_kind: string | null;
  /** Ön blok ve inceleme uyarısı çıkarılmış gövde. */
  body: string;
  /** İlk satırdaki "HUKUKİ İNCELEME GEREKLİ" uyarısı (varsa). */
  review_notice: string | null;
}

const PLACEHOLDERS = placeholders as unknown as Record<string, Placeholder>;

/** `doc_version` ve ön bloğu ayıklar (docs/hukuk/README.md "Belge başlığı" biçimi). */
export function parseLegalDoc(source: string): LegalDoc {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let review: string | null = null;
  if (lines[0]?.startsWith('> ')) review = lines.shift()!.slice(2).trim();
  let text = lines.join('\n');
  const fm = /^\s*```yaml\n([\s\S]*?)\n```\n/.exec(text);
  const meta: Record<string, string> = {};
  if (fm) {
    for (const l of fm[1].split('\n')) {
      const m = /^([a-z_]+):\s*(.+)$/.exec(l.trim());
      if (m) meta[m[1]] = m[2].trim();
    }
    text = text.slice(fm.index + fm[0].length);
  }
  if (!meta.doc_version) throw new Error('legal: doc_version yok');
  return { doc_version: meta.doc_version, legal_texts_kind: meta.legal_texts_kind ?? null, body: text.trim(), review_notice: review };
}

/**
 * Yer tutucu → gün. `retention_policies.days` kaynağı verilen satırlardan; `tg_chats.retention_days` kaynağı sütun
 * varsayılanından (chatDefaultDays) gelir. Satırlar verilmezse (anon canlı mod) `expected_days` kullanılır.
 */
export function resolveRetentionDays(policies: RetentionPolicyRow[] | null, chatDefaultDays: number | null): Record<string, number> {
  const out: Record<string, number> = {};
  const byId = new Map((policies ?? []).map((p) => [p.id, p.days]));
  for (const [name, ph] of Object.entries(PLACEHOLDERS)) {
    let days: number | undefined;
    if (policies === null) days = ph.expected_days;
    else if (ph.days_source === 'tg_chats.retention_days') days = chatDefaultDays ?? ph.expected_days;
    else days = byId.get(ph.policy_id);
    // 0 ya da eksik değer metne "0 gün sonra silinir" yazdırır: haritaya girmez, metinde kullanılırsa fillPlaceholders durur
    // (docs/hukuk/placeholders.json RETENTION_MESSAGES_DAYS notu)
    if (typeof days === 'number' && Number.isInteger(days) && days > 0) out[name] = days;
  }
  return out;
}

export function fillPlaceholders(text: string, days: Record<string, number>): string {
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, name: string) => {
    if (!(name in days)) throw new Error(`legal: ${name} için geçerli gün yok`);
    return String(days[name]);
  });
}

export interface Declaration {
  no: number;
  text: string;
  required: boolean;
}

/** Bölüm 5 "Beyan" kutularını okur; web sayfası yalnız zorunluları (1, 2, 4) gösterir, 3 yalnız kâğıt formdadır. */
export function parseDeclarations(formBody: string): Declaration[] {
  const out: Declaration[] = [];
  for (const line of formBody.split('\n')) {
    const m = /^- \[ \] (\d+)\. (.+)$/.exec(line.trim());
    if (!m) continue;
    const full = m[2].trim();
    const cut = full.search(/ \((zorunlu|isteğe bağlı)/);
    out.push({ no: Number(m[1]), text: cut >= 0 ? full.slice(0, cut).trim() : full, required: /\(zorunlu/.test(full) });
  }
  return out;
}

/** Form metninin veliye gösterilen kısmı: bölüm 1–4 (5 beyan kutuları sayfada gerçek kutulardır; 6 bot metinleridir). */
export function formSectionsForWeb(formBody: string): string {
  const idx = formBody.search(/^## 5\. /m);
  return (idx >= 0 ? formBody.slice(0, idx) : formBody).trim();
}

export const GUARDIAN_FORM = parseLegalDoc(formSource);
export const AYDINLATMA = parseLegalDoc(aydinlatmaSource);
export const WEB_DECLARATIONS: Declaration[] = parseDeclarations(GUARDIAN_FORM.body).filter((d) => d.required);

/** Sayfa metni; legalTextId, gösterilen sürümle eşleşen legal_texts satırı biliniyorsa verilir. */
export function guardianFormText(
  policies: RetentionPolicyRow[] | null,
  chatDefaultDays: number | null,
  legalTextId: string | null,
): GuardianFormText {
  const days = resolveRetentionDays(policies, chatDefaultDays);
  return {
    doc_version: GUARDIAN_FORM.doc_version,
    legal_text_id: legalTextId,
    form_md: fillPlaceholders(formSectionsForWeb(GUARDIAN_FORM.body), days),
    aydinlatma_md: fillPlaceholders(AYDINLATMA.body, days),
    aydinlatma_version: AYDINLATMA.doc_version,
    days_source: policies === null ? 'build' : 'retention_policies',
  };
}
