// Deneme sonucu (P2-D): sonuç metinleri, ısı haritası satırları, bekleme satırı, girdi doğrulama, RPC sarmalayıcıları,
// sonuç bileşenleri (OneLineResult büyük net + Detay, ExamResultDetail).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ExamResultDetail, OneLineResult } from '@/components/result';
import { examViewFixture } from './exam-result.fixture';
import { parseExamSubmit, parseHowFarInput } from '@/server/exam-result/input';
import {
  countsLine, examDetailHref, heatRows, howFarError, howFarHref, itemLine, itemLines, keyNote, netText, reportPending, reportReady, resultSentence, screenOf, sectionBars, stageFraction,
  submitExamError, waitingLine,
} from '@/server/exam-result/present';
import { examBlankReason, examHowFar, examSessionView, submitExamUpload } from '@/server/exam-result/rpc';
import { parseExamSessionView } from '@/server/exam-result/types';
import type { RpcClient } from '@/server/practice/rpc';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = U(1);
const view = parseExamSessionView(examViewFixture());

describe('sonuç metinleri', () => {
  it('büyük net Türkçe ondalıkla; tek cümle en zayıf konuyu söyler', () => {
    expect(netText(27.5)).toBe('27,5 net');
    expect(netText(30)).toBe('30 net');
    expect(resultSentence(view)).toBe('Deneme 4: en çok Türkçe paragraf konusunda zorlandın.');
    expect(countsLine(view)).toBe('40 soruda 28 doğru, 8 yanlış, 4 boş.');
  });

  it('zayıf konu yoksa sayıları, hiç hata yoksa "hepsi doğru" der; özet yoksa yalın cümle', () => {
    const s = view.summary!;
    expect(resultSentence({ title: 'D', summary: { ...s, weakest: null } })).toBe('D: 28 doğru, 8 yanlış, 4 boş.');
    expect(resultSentence({ title: 'D', summary: { ...s, weakest: null, wrong: 0, blank: 0, unfinished: 0 } })).toBe('D: hepsi doğru.');
    expect(resultSentence({ title: 'D', summary: null })).toBe('D bitti.');
  });

  it('anahtar güveni: doğrulanamayan anahtar ya da çıkarım tek satır; yayıncı anahtarı sessiz', () => {
    expect(keyNote({ summary: { ...view.summary!, unverified_keys: 3 }, answer_key_source: 'uploaded' })).toBe('3 sorunun cevap anahtarını doğrulayamadım; net bu yüzden değişebilir.');
    expect(keyNote({ summary: { ...view.summary!, unverified_keys: 1 }, answer_key_source: 'uploaded' })).toContain('1 sorunun');
    expect(keyNote({ summary: view.summary, answer_key_source: 'inferred' })).toContain('çözerek çıkardım');
    expect(keyNote({ summary: view.summary, answer_key_source: 'uploaded' })).toBeNull();
    expect(keyNote({ summary: view.summary, answer_key_source: 'instructor' })).toBeNull();
  });

  it('yüzde yok: hiçbir metin % içermez', () => {
    const all = [resultSentence(view), countsLine(view), ...sectionBars(view.sections).flatMap((b) => [b.netText, b.detail]), ...heatRows(view.heatmap).flatMap((r) => [r.ratio, r.word, r.sr])];
    expect(all.join(' ')).not.toContain('%');
  });
});

describe('bölümler ve ısı haritası', () => {
  it('bölüm çubuğu net / toplam oranıdır; negatif net sıfırdır', () => {
    const bars = sectionBars([
      { section: 'tr', title: 'Türkçe', total: 40, correct: 30, wrong: 6, blank: 4, unfinished: 0, net: 28.5 },
      { section: 'mat', title: 'Matematik', total: 40, correct: 2, wrong: 30, blank: 8, unfinished: 0, net: -5.5 },
    ]);
    expect(bars[0]).toMatchObject({ title: 'Türkçe', netText: '28,5 net', detail: '30 doğru · 6 yanlış · 4 boş' });
    expect(bars[0]!.fill).toBeCloseTo(0.7125);
    expect(bars[1]!.fill).toBe(0);
  });

  it('ısı haritası en zayıfı üste alır, "doğru/soru" ve kelime bandı yazar', () => {
    const rows = heatRows(view.heatmap);
    expect(rows.map((r) => r.id)).toEqual(['tyt.tr.paragraf', 'tyt.mat.denklem', 'tyt.mat.sayilar']);
    expect(rows[0]).toMatchObject({ ratio: '2/6', word: 'zayıf', band: 'low' });
    expect(rows[2]).toMatchObject({ ratio: '5/5', word: 'iyi' });
    expect(rows[0]!.sr).toBe('Türkçe paragraf: 6 sorudan 2 doğru, zayıf');
  });
});

describe('yanlış/boş listesi', () => {
  it('her satırda durumuna göre tek eylem', () => {
    const [a, b, c, d] = itemLines(view.items);
    expect(a).toMatchObject({ title: 'Soru 3 · Yanlış', action: 'Nereye kadar geldim?', actionable: true });
    expect(b).toMatchObject({ title: 'Soru 7 · Boş', action: 'Bakıyorum', actionable: true });
    expect(c).toMatchObject({ title: 'Soru 9 · Yetişmedi', action: 'Süre yetmedi', actionable: false });
    expect(d).toMatchObject({ title: 'Soru 12 · Yanlış', action: 'Teşhisi gör', note: 'Çözümünü inceledim: 3. adımda işlem kuralı.' });
  });

  it('adresler', () => {
    expect(howFarHref('S', 'R')).toBe('/ogrenci/deneme/S/soru/R');
    expect(examDetailHref('S')).toBe('/ogrenci/deneme/S?detay=1');
    expect(itemLine({ ...view.items[0]!, state: 'reason_given', blank_reason: 'not_started' }).action).toBe('Hiç başlayamadım');
  });
});

describe('bekleme ve ekran seçimi', () => {
  it('alt satır aşamaya göre; classify "sayfa 3/12"', () => {
    expect(waitingLine({ stage: 'classify', pages_total: 12, pages_done: 3 })).toBe('sayfa 3/12');
    expect(waitingLine({ stage: 'classify', pages_total: 12, pages_done: 20 })).toBe('sayfa 12/12');
    expect(waitingLine({ stage: 'classify' })).toBe('sayfalar alınıyor');
    expect(waitingLine(null)).toBe('sayfalar alınıyor');
    expect(waitingLine({ stage: 'ocr' })).toBe('sorular okunuyor');
    expect(waitingLine({ stage: 'key' })).toBe('cevap anahtarı hazırlanıyor');
    expect(waitingLine({ stage: 'grade' })).toBe('optik form okunuyor');
    expect(waitingLine({ stage: 'analyse' })).toBe('net hesaplanıyor');
    expect(waitingLine({ stage: 'report' })).toBe('rapor hazırlanıyor');
  });

  it('genel ilerleme aşama sırasıyla artar, 0..1 arasındadır', () => {
    const f = ['classify', 'ocr', 'key', 'grade', 'analyse', 'report', 'done'].map((stage) => stageFraction({ stage }));
    expect([...f].sort((x, y) => x - y)).toEqual(f);
    expect(f[0]).toBe(0);
    expect(f.at(-1)).toBe(1);
    expect(stageFraction({ stage: 'classify', pages_total: 10, pages_done: 5 })).toBeGreaterThan(0);
    expect(stageFraction(null)).toBe(0);
  });

  it('ekran: düşmüş > bekleyen > sonuç; rapor hazır/bekliyor', () => {
    expect(screenOf({ status: 'failed', pending: true })).toBe('failed');
    expect(screenOf({ status: 'grading', pending: true })).toBe('waiting');
    expect(screenOf({ status: 'analysing', pending: false })).toBe('result');
    const base = { status: 'analysing', pending: false };
    expect(reportReady({ report: { id: 'r', status: 'rendered', pdf_path: 'a.pdf' } })).toBe(true);
    expect(reportReady({ report: { id: 'r', status: 'generating', pdf_path: null } })).toBe(false);
    expect(reportPending({ ...base, report: null })).toBe(true);
    expect(reportPending({ ...base, report: { id: 'r', status: 'failed', pdf_path: null } })).toBe(false);
    expect(reportPending({ status: 'done', pending: false, report: null })).toBe(false);
    expect(reportPending({ ...base, report: { id: 'r', status: 'rendered', pdf_path: 'a.pdf' } })).toBe(false);
  });

  it('hata kodları tek cümleye çevrilir', () => {
    expect(howFarError('OGR-EXAM-009')).toBe('Bu soru için bilgiyi zaten verdin.');
    expect(howFarError('x')).toContain('Bağlantını');
    expect(submitExamError('OGR-UPL-001')).toContain('40');
    expect(submitExamError('PGRST202')).toContain('şu an alınamıyor');
  });
});

describe('girdi doğrulama (sunucu eylemi)', () => {
  const file = (n: number, mime = 'image/jpeg') => ({ id: U(100 + n), path: `${OWNER}/${U(100 + n)}.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`, mime, bytes: 1000, sha256: null, width: 100, height: 100, pages: null });

  it('deneme: 1–40 sayfa, yol sahibin klasöründe', () => {
    expect(parseExamSubmit({ files: [file(1), file(2, 'application/pdf')] }, OWNER).ok).toBe(true);
    expect(parseExamSubmit({ files: [] }, OWNER).ok).toBe(false);
    expect(parseExamSubmit({ files: Array.from({ length: 41 }, (_, i) => file(i)) }, OWNER).ok).toBe(false);
    expect(parseExamSubmit({ files: Array.from({ length: 40 }, (_, i) => file(i)) }, OWNER).ok).toBe(true);
    expect(parseExamSubmit({ files: [{ ...file(1), path: `${U(9)}/${U(101)}.jpg` }] }, OWNER).ok).toBe(false);
    expect(parseExamSubmit(null, OWNER).ok).toBe(false);
  });

  it('nereye kadar geldim: yazı ve/veya ≤ 4 fotoğraf; PDF kabul edilmez; boş gönderim yok', () => {
    const base = { sessionId: U(2), responseId: U(3) };
    expect(parseHowFarInput({ ...base, text: '  parantezi açtım ', files: [] }, OWNER)).toMatchObject({ ok: true, value: { text: 'parantezi açtım', files: [] } });
    expect(parseHowFarInput({ ...base, text: '', files: [file(1), file(2)] }, OWNER)).toMatchObject({ ok: true });
    expect(parseHowFarInput({ ...base, text: '', files: [] }, OWNER).ok).toBe(false);
    expect(parseHowFarInput({ ...base, files: Array.from({ length: 5 }, (_, i) => file(i)) }, OWNER).ok).toBe(false);
    expect(parseHowFarInput({ ...base, files: [file(1, 'application/pdf')] }, OWNER).ok).toBe(false);
    expect(parseHowFarInput({ ...base, text: 'x'.repeat(2001) }, OWNER).ok).toBe(false);
    expect(parseHowFarInput({ sessionId: 'x', responseId: U(3), text: 'a' }, OWNER).ok).toBe(false);
  });
});

describe('RPC sarmalayıcıları', () => {
  function client(data: unknown, error: { code?: string; message: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { c: { rpc } as unknown as RpcClient, rpc };
  }

  it('exam_session_view yanıtı ayrıştırılır; bozuk yanıt hata olur', async () => {
    const ok = await examSessionView(client(examViewFixture()).c, U(2));
    expect(ok.ok && ok.data.summary?.net).toBe(27.5);
    const bad = await examSessionView(client({ nope: 1 }).c, U(2));
    expect(bad).toMatchObject({ ok: false, code: 'OGR-WEB-001' });
  });

  it('exam_how_far: metin kırpılır, boş metin null, boş kimlik dizisi null', async () => {
    const { c, rpc } = client({});
    await examHowFar(c, U(3), '  merhaba ', []);
    expect(rpc).toHaveBeenCalledWith('exam_how_far', { p_response: U(3), p_text: 'merhaba', p_upload_ids: null });
    await examHowFar(c, U(3), '   ', [U(5)]);
    expect(rpc).toHaveBeenLastCalledWith('exam_how_far', { p_response: U(3), p_text: null, p_upload_ids: [U(5)] });
  });

  it('exam_blank_reason ve submit_exam_upload doğru argümanlarla çağrılır; hata kodu çıkarılır', async () => {
    const a = client({});
    await examBlankReason(a.c, U(3), 'time');
    expect(a.rpc).toHaveBeenCalledWith('exam_blank_reason', { p_response: U(3), p_reason: 'time' });
    const b = client({ exam_id: 'e', session_id: 's', reused: true });
    const r = await submitExamUpload(b.c, [U(1), U(2)]);
    expect(b.rpc).toHaveBeenCalledWith('submit_exam_upload', { p_upload_ids: [U(1), U(2)], p_meta: {} });
    expect(r).toMatchObject({ ok: true, data: { session_id: 's', reused: true } });
    const e = await submitExamUpload(client(null, { code: 'P0001', message: 'OGR-UPL-003 yükleme zaten işlendi' }).c, [U(1)]);
    expect(e).toMatchObject({ ok: false, code: 'OGR-UPL-003' });
  });
});

describe('bileşenler', () => {
  it('OneLineResult: büyük net, tek birincil, katlı Detay; extra Detay\'dan sonra; defaultDetailOpen açık başlar', async () => {
    const user = userEvent.setup();
    render(
      <OneLineResult
        big={{ text: '27,5 net', label: '27,5 net' }}
        sentence="Deneme 4: en çok Türkçe paragraf konusunda zorlandın."
        primary={{ href: '/ogrenci', label: 'Devam et' }}
        detail={<p>ayrıntı</p>}
        extra={<button type="button">Raporu aç (PDF)</button>}
      />,
    );
    expect(screen.getByTestId('buyuk-sayi')).toHaveTextContent('27,5 net');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Deneme 4: en çok Türkçe paragraf konusunda zorlandın.');
    expect(screen.getByRole('link', { name: 'Devam et' })).toHaveAttribute('href', '/ogrenci');
    expect(screen.getByTestId('detay')).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Detay' }));
    expect(screen.getByTestId('detay')).toBeVisible();
    expect(screen.getByRole("button", { name: "Raporu aç (PDF)" })).toBeInTheDocument();
  });

  it('OneLineResult defaultDetailOpen', () => {
    render(<OneLineResult sentence="x" primary={{ href: '/', label: 'Devam et' }} detail={<p>ayrıntı</p>} defaultDetailOpen />);
    expect(screen.getByTestId('detay')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Detay' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('ExamResultDetail: bölüm, ısı haritası (yüzde yok), liste ve satır başına tek bağlantı', () => {
    render(<ExamResultDetail sessionId="S" counts={countsLine(view)} keyNote={keyNote(view)} sections={sectionBars(view.sections)} heat={heatRows(view.heatmap)} items={itemLines(view.items)} />);
    const sections = screen.getByTestId('bolum-netleri');
    expect(within(sections).getByText('Türkçe')).toBeInTheDocument();
    expect(within(sections).getByText('18 net')).toBeInTheDocument();
    const heat = screen.getByTestId('isi-haritasi');
    expect(within(heat).getByText('2/6 · zayıf')).toBeInTheDocument();
    expect(heat.textContent).not.toContain('%');
    const list = screen.getByTestId('yanlis-bos');
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getAllByRole('link')).toHaveLength(3); // "Süre yetmedi" satırı bağlantı değil
    expect(within(list).getByRole('link', { name: /Soru 3 · Yanlış/ })).toHaveAttribute('href', '/ogrenci/deneme/S/soru/00000000-0000-4000-8000-0000000000a1');
    expect(screen.queryByTestId('anahtar-notu')).toBeNull();
  });

  it('ExamResultDetail: anahtar notu tek satır; veli görünümünde liste yok; hatasız denemede boş mesaj', () => {
    const { rerender } = render(<ExamResultDetail sessionId="S" counts={null} keyNote="Not." sections={[]} heat={[]} items={[]} />);
    expect(screen.getByTestId('anahtar-notu')).toHaveTextContent('Not.');
    expect(screen.getByText('Yanlış ya da boş sorun yok.')).toBeInTheDocument();
    rerender(<ExamResultDetail sessionId="S" counts={null} keyNote={null} sections={[]} heat={[]} items={[]} itemsHidden />);
    expect(screen.queryByTestId('yanlis-bos')).toBeNull();
  });
});
