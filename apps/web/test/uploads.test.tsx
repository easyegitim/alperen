import fs from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/server/uploads/actions', () => ({ submitUploads: vi.fn(async () => ({ ok: true, href: '/ogrenci/sonuc?yukleme=x', uploadIds: [], kind: 'own_work' })) }));

import { AdimMerdiveni } from '@/app/ogrenci/teshis/[id]/adim-merdiveni';
import { pollDelay } from '@/app/ogrenci/sonuc/bekleme';
import { YukleAkisi } from '@/app/ogrenci/yukle/yukle-akisi';
import { bandWord, coachHref, isLowEvidence, ladderRows, primarySkill, readAnalysis, summarySentence } from '@/server/diagnosis/present';
import { getDiagnosis } from '@/server/diagnosis/read';
import type { UploadClient } from '@/server/uploads/client';
import { fitWithin, parseSubmitInput, resultHref, uploadPath, UPLOAD_LIMITS } from '@/server/uploads/shared';
import { getUploadState } from '@/server/uploads/status';
import { submitErrorMessage, submitUploadsWith } from '@/server/uploads/submit';

const OWNER = '00000000-0000-4000-8000-0000000000e1';
const STUDENT = '10000000-0000-4000-8000-000000000001';
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const SA = 'bbbbbbbb-0000-4000-8000-000000000001';

function file(id: string, mime: 'image/jpeg' | 'application/pdf' = 'image/jpeg') {
  return { id, path: uploadPath(OWNER, id, mime), mime, bytes: 123_456, sha256: 'a'.repeat(64), width: mime === 'image/jpeg' ? 2576 : null, height: mime === 'image/jpeg' ? 1932 : null, pages: null };
}

describe('yükleme kuralları (shared)', () => {
  it('uzun kenar 2576 px: oran korunur, büyütme yok', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2576, height: 1932, scaled: true });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1932, height: 2576, scaled: true });
    expect(fitWithin(1200, 900)).toEqual({ width: 1200, height: 900, scaled: false });
    expect(fitWithin(0, 10).width).toBe(0);
  });

  it('yol: ilk klasör yükleyenin auth.uid()si (Storage politikası + uploads_path_owner)', () => {
    expect(uploadPath(OWNER, U1, 'image/jpeg')).toBe(`${OWNER}/${U1}.jpg`);
    expect(uploadPath(OWNER, U1, 'application/pdf')).toBe(`${OWNER}/${U1}.pdf`);
    expect(() => uploadPath('../x', U1, 'image/jpeg')).toThrow();
  });

  it('gönderim doğrulaması: tür, sayfa sayısı, yol, mime, boyut', () => {
    expect(parseSubmitInput({ kind: 'own_work', files: [file(U1), file(U2, 'application/pdf')] }, OWNER)).toMatchObject({ ok: true, value: { kind: 'own_work' } });
    expect(parseSubmitInput({ kind: 'kitap', files: [file(U1)] }, OWNER)).toMatchObject({ ok: false });
    expect(parseSubmitInput({ kind: 'own_work', files: [] }, OWNER)).toEqual({ ok: false, error: 'En az bir sayfa ekle.' });
    const many = Array.from({ length: UPLOAD_LIMITS.maxFiles.own_work + 1 }, (_, i) => file(`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`));
    expect(parseSubmitInput({ kind: 'own_work', files: many }, OWNER)).toMatchObject({ ok: false, error: expect.stringContaining('En çok 4') });
    expect(parseSubmitInput({ kind: 'school_exam', files: many }, OWNER)).toMatchObject({ ok: true });
    // başka birinin klasörü
    expect(parseSubmitInput({ kind: 'own_work', files: [{ ...file(U1), path: `10000000-0000-4000-8000-000000000009/${U1}.jpg` }] }, OWNER)).toEqual({ ok: false, error: 'Sayfa yolu geçersiz.' });
    expect(parseSubmitInput({ kind: 'own_work', files: [{ ...file(U1), mime: 'image/heic' }] }, OWNER)).toMatchObject({ ok: false });
    expect(parseSubmitInput({ kind: 'own_work', files: [{ ...file(U1), bytes: UPLOAD_LIMITS.maxStoredBytes + 1 }] }, OWNER)).toEqual({ ok: false, error: 'Dosya çok büyük.' });
    expect(parseSubmitInput({ kind: 'own_work', files: [file(U1), file(U1)] }, OWNER)).toMatchObject({ ok: false });
  });

  it('sonuç adresi (okul denemesi işaretli)', () => {
    expect(resultHref(U1, 'own_work')).toBe(`/ogrenci/sonuc?yukleme=${U1}`);
    expect(resultHref(U1, 'school_exam')).toBe(`/ogrenci/sonuc?yukleme=${U1}&tur=deneme`);
  });
});

/** PostgREST zincirinin küçük sahtesi: tablo → satırlar; filtreleri kaydeder. */
function fakeClient(tables: Record<string, Record<string, unknown>[]>, opts: { insertError?: { code: string; message: string } | null; rpcError?: { code?: string; message: string } | null } = {}) {
  const log: { table: string; op: string; args: unknown[] }[] = [];
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const b = {
      select: () => b,
      eq: (col: string, v: unknown) => {
        // PostgREST json yolu ('payload->>upload_id') da desteklenir
        const [c, key] = col.split('->>') as [string, string | undefined];
        rows = rows.filter((r) => (key === undefined ? r[c] : (r[c] as Record<string, unknown> | null)?.[key]) === v);
        log.push({ table, op: 'eq', args: [col, v] });
        return b;
      },
      contains: (col: string, v: unknown[]) => {
        rows = rows.filter((r) => v.every((x) => (r[col] as unknown[]).includes(x)));
        log.push({ table, op: 'contains', args: [col, v] });
        return b;
      },
      order: () => b,
      limit: (n: number) => Promise.resolve({ data: rows.slice(0, n), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      insert: (r: unknown) => {
        log.push({ table, op: 'insert', args: [r] });
        return Promise.resolve({ data: null, error: opts.insertError ?? null });
      },
    };
    return b;
  };
  const client = {
    from: (t: string) => builder(t),
    rpc: (name: string, args: unknown) => {
      log.push({ table: 'rpc', op: name, args: [args] });
      return Promise.resolve({ data: opts.rpcError ? null : { kind: 'own_work' }, error: opts.rpcError ?? null });
    },
  };
  return { client: client as unknown as UploadClient, log };
}

describe('submitUploadsWith (kullanıcı JWT\'si: uploads satırları + submit_upload)', () => {
  it('satırları RLS sütun kümesiyle yazar, RPC\'yi çağırır, sonuç adresini döner', async () => {
    const { client, log } = fakeClient({ students: [{ id: STUDENT, profile_id: OWNER }] });
    const res = await submitUploadsWith(client, { id: OWNER }, { kind: 'own_work', files: [file(U1), file(U2, 'application/pdf')] });
    expect(res).toEqual({ ok: true, href: `/ogrenci/sonuc?yukleme=${U1}`, uploadIds: [U1, U2], kind: 'own_work' });
    const ins = log.find((l) => l.op === 'insert')!.args[0] as Record<string, unknown>[];
    expect(ins.map((r) => [r.kind, r.storage_path, r.owner_id, r.student_id])).toEqual([
      ['photo', `${OWNER}/${U1}.jpg`, OWNER, STUDENT],
      ['pdf', `${OWNER}/${U2}.pdf`, OWNER, STUDENT],
    ]);
    // 0018: authenticated yalnız bu sütunları ekleyebilir
    for (const r of ins) expect(Object.keys(r).sort()).toEqual(['bytes', 'height', 'id', 'kind', 'mime', 'owner_id', 'pages', 'sha256', 'storage_path', 'student_id', 'width']);
    expect(log.find((l) => l.table === 'rpc')).toEqual({ table: 'rpc', op: 'submit_upload', args: [{ p_upload_ids: [U1, U2], p_kind: 'own_work' }] });
  });

  it('yeniden deneme (23505) satır hatası sayılmaz; RPC hataları tek cümleye çevrilir', async () => {
    const dup = fakeClient({ students: [{ id: STUDENT, profile_id: OWNER }] }, { insertError: { code: '23505', message: 'duplicate' } });
    expect(await submitUploadsWith(dup.client, { id: OWNER }, { kind: 'school_exam', files: [file(U1)] })).toMatchObject({ ok: true, href: `/ogrenci/sonuc?yukleme=${U1}&tur=deneme` });
    const noRpc = fakeClient({ students: [{ id: STUDENT, profile_id: OWNER }] }, { rpcError: { code: 'PGRST202', message: 'not found' } });
    expect(await submitUploadsWith(noRpc.client, { id: OWNER }, { kind: 'own_work', files: [file(U1)] })).toEqual({ ok: false, error: 'Yükleme şu an alınamıyor. Biraz sonra yeniden dene.' });
    expect(submitErrorMessage({ code: 'P0001', message: 'OGR-UPL-004 etkin ders kaydı yok' })).toMatch(/ders seç/);
    // sayfaların bir kısmı önceki gönderimde (alt küme, tür değişimi): "bulunamadı" denmez, istemci yeni anahtar alır
    const stale = fakeClient({ students: [{ id: STUDENT, profile_id: OWNER }] }, { rpcError: { code: 'P0001', message: 'OGR-UPL-003 sayfaların bir kısmı başka bir gönderimde işleniyor' } });
    const st = await submitUploadsWith(stale.client, { id: OWNER }, { kind: 'own_work', files: [file(U1)] });
    expect(st).toMatchObject({ ok: false, stale: true });
    expect(st.ok ? '' : st.error).toMatch(/önceki gönderim/);
    expect(st.ok ? '' : st.error).not.toMatch(/bulunamadı|[!%]/);
    const noStudent = fakeClient({ students: [] });
    expect(await submitUploadsWith(noStudent.client, { id: OWNER }, { kind: 'own_work', files: [file(U1)] })).toEqual({ ok: false, error: 'Öğrenci kaydın bulunamadı.' });
    for (const m of [submitErrorMessage(null), submitErrorMessage({ code: '42501', message: 'x' })]) expect(m).not.toMatch(/[!%]/);
  });
});

describe('getUploadState (bekleme yoklaması)', () => {
  it('teşhis varsa ready; yoksa uploads.status: processing → waiting, ready → received, failed → failed', async () => {
    const tables = (status: string, withSa: boolean) => ({
      uploads: [{ id: U1, status }],
      solution_analyses: withSa ? [{ id: SA, verdict: 'wrong', upload_ids: [U1, U2], created_at: '2026-11-03' }] : [],
    });
    expect(await getUploadState(fakeClient(tables('ready', true)).client, U1)).toEqual({ state: 'ready', analysisId: SA, verdict: 'wrong' });
    expect(await getUploadState(fakeClient(tables('processing', false)).client, U1)).toEqual({ state: 'waiting' });
    expect(await getUploadState(fakeClient(tables('ready', false)).client, U1)).toEqual({ state: 'received' });
    // kart yoksa nötr "işleyemedim" (öğrenciye boşuna yeniden fotoğraf çektirilmez)
    expect(await getUploadState(fakeClient(tables('failed', false)).client, U1)).toEqual({ state: 'failed', reason: 'processing' });
    const reading = { kind: 'upload_result', payload: { upload_id: U1, failed: true, failure: 'reading' }, created_at: '2026-11-03' };
    expect(await getUploadState(fakeClient({ ...tables('failed', false), suggestions: [reading] }).client, U1)).toEqual({ state: 'failed', reason: 'reading' });
    // worker son denemede de düştü: Bugün kartı payload.failure = 'processing' → "işleyemedim" (fotoğrafın suçu değil)
    const card = { kind: 'upload_result', payload: { upload_id: U1, failed: true, failure: 'processing' }, created_at: '2026-11-03' };
    expect(await getUploadState(fakeClient({ ...tables('failed', false), suggestions: [card] }).client, U1)).toEqual({ state: 'failed', reason: 'processing' });
    expect(await getUploadState(fakeClient({ uploads: [] }).client, U1)).toEqual({ state: 'missing' });
    expect(await getUploadState(fakeClient(tables('ready', true)).client, 'olmayan')).toEqual({ state: 'missing' });
  });

  it('yoklama aralığı: önce sık, sonra seyrek, 4 dakikada durur', () => {
    expect(pollDelay(0)).toBe(2_000);
    expect(pollDelay(60_000)).toBe(5_000);
    expect(pollDelay(300_000)).toBeNull();
  });
});

const ANALYSIS = {
  why_tr: '3. adımda $-3(x-2)$ ifadesini $-3x-6$ yazdın; doğrusu $-3x+6$.',
  one_line: 'Çözümünü inceledim: 3. adımda işlem kuralı.',
  steps: [
    { no: 2, text: '$2x+2 - 3(x-2) = 4$', status: 'ok' },
    { no: 1, text: '$2(x+1) = 2x+2$', status: 'ok' },
    { no: 3, text: '$-3(x-2) = -3x-6$', status: 'error' },
    { no: 4, text: '$-x - 4 = 4$', status: 'ok' },
    { no: 5, text: 'x = -8', status: 'error' },
    { bozuk: true },
  ],
  reference_steps: ['$2(x+1) = 2x+2$', '$2x+2 - 3(x-2) = 4$', '$-3(x-2) = -3x+6$', '$-x + 8 = 4$'],
};

describe('teşhis sunumu (present)', () => {
  it('analysis jsonb güvenle okunur (sıralı, bozuk adım atılır)', () => {
    const a = readAnalysis(ANALYSIS);
    expect(a.steps.map((s) => s.no)).toEqual([1, 2, 3, 4, 5]);
    expect(readAnalysis(null)).toEqual({ why_tr: null, one_line: null, steps: [], reference_steps: [], skill_order: [] });
  });

  it('merdiven: önce doğru, bozulan adım, sonra "bundan etkilendi" ya da ayrıca hata; beklenen yoksa boş', () => {
    const a = readAnalysis(ANALYSIS);
    const rows = ladderRows(a.steps, a.reference_steps, 3);
    expect(rows.map((r) => [r.no, r.state, r.label])).toEqual([
      [1, 'ok', '✓ Doğru'],
      [2, 'ok', '✓ Doğru'],
      [3, 'failing', '✕ Burada bozuldu'],
      [4, 'affected', 'Bundan etkilendi'],
      [5, 'error', '✕ Ayrıca hata'],
    ]);
    expect(rows[2]!.expected).toBe('$-3(x-2) = -3x+6$');
    expect(rows[4]!.expected).toBeNull();
    expect(ladderRows(a.steps.slice(0, 2), a.reference_steps, null).every((r) => r.state === 'ok')).toBe(true);
  });

  it('tek cümle, kelime bandı (yüzde yok), koç bağlantısı', () => {
    const a = readAnalysis(ANALYSIS);
    expect(summarySentence({ verdict: 'wrong', failing_step_no: 3, error_cause: 'procedure', analysis: a })).toBe('Çözümünü inceledim: 3. adımda işlem kuralı.');
    expect(summarySentence({ verdict: 'wrong', failing_step_no: 2, error_cause: 'careless', analysis: { ...a, one_line: null } })).toBe('Çözümünü inceledim: 2. adımda küçük bir hesap kayması.');
    expect([bandWord(0.3, 6), bandWord(0.6, 6), bandWord(0.9, 6), bandWord(0.9, 1)]).toEqual(['zayıf', 'orta', 'iyi', 'henüz az kanıt']);
    // ilk teşhisten sonra (evidence_count = 1) bant söylenmez: sayfa "şu an" demez
    expect([isLowEvidence(0.62, 1), isLowEvidence(null, 9), isLowEvidence(0.62, 5)]).toEqual([true, true, false]);
    expect(coachHref(SA)).toBe(`/ogrenci/koc?seed=${SA}`);
  });

  it('getDiagnosis: kazanım adı, bant, yanılgının öğrenci metni', async () => {
    const { client } = fakeClient({
      solution_analyses: [{ id: SA, enrollment_id: 'e1', upload_ids: [U1], question_text: 'Soru', analysis: ANALYSIS, verdict: 'wrong', failing_step_no: 3, error_cause: 'procedure', skill_ids: ['tyt.mat.temel.sayilar'], misconception_tags: ['sayilar.parantez-eksi-dagitma'] }],
      enrollments: [{ id: 'e1', curriculum_id: 'c1' }],
      skills: [{ curriculum_id: 'c1', id: 'tyt.mat.temel.sayilar', name: 'Sayılar ve işaret kuralları' }],
      mastery: [{ enrollment_id: 'e1', skill_id: 'tyt.mat.temel.sayilar', p: '0.62', evidence_count: 7 }],
      misconception_tags: [{ tag: 'sayilar.parantez-eksi-dagitma', text_student: 'Eksi işareti parantezdeki her terime dağılır.' }],
    });
    const d = await getDiagnosis(client, SA);
    expect(d).toMatchObject({
      sentence: 'Çözümünü inceledim: 3. adımda işlem kuralı.',
      learned: 'Eksi işareti parantezdeki her terime dağılır.',
      skill: { id: 'tyt.mat.temel.sayilar', name: 'Sayılar ve işaret kuralları', band: 'orta' },
      firstUploadId: U1,
    });
    expect(await getDiagnosis(client, 'yok')).toBeNull();
  });

  it('getDiagnosis yeni öğrencide (tek kanıt): bant yerine "henüz az kanıt", lowEvidence', async () => {
    const { client } = fakeClient({
      solution_analyses: [{ id: SA, enrollment_id: 'e1', upload_ids: [U1], question_text: 'Soru', analysis: ANALYSIS, verdict: 'wrong', failing_step_no: 3, error_cause: 'procedure', skill_ids: ['tyt.mat.temel.sayilar'], misconception_tags: [] }],
      enrollments: [{ id: 'e1', curriculum_id: 'c1' }],
      skills: [{ curriculum_id: 'c1', id: 'tyt.mat.temel.sayilar', name: 'Sayılar ve işaret kuralları' }],
      mastery: [{ enrollment_id: 'e1', skill_id: 'tyt.mat.temel.sayilar', p: '0.4', evidence_count: 1 }],
      misconception_tags: [],
    });
    expect((await getDiagnosis(client, SA))?.skill).toEqual({ id: 'tyt.mat.temel.sayilar', name: 'Sayılar ve işaret kuralları', band: 'henüz az kanıt', lowEvidence: true });
  });

  it('birincil kazanım: yanılgının kazanımı teşhisteyse o, değilse modelin sırası, o da yoksa ilk', () => {
    const ids = ['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar'];
    expect(primarySkill(ids, [], 'tyt.mat.temel.sayilar')).toBe('tyt.mat.temel.sayilar');
    expect(primarySkill(ids, ['tyt.mat.temel.sayilar', 'tyt.mat.cebir.denklem'], null)).toBe('tyt.mat.temel.sayilar');
    expect(primarySkill(ids, [], 'baska.kazanim')).toBe('tyt.mat.cebir.denklem');
    expect(primarySkill([], [], null)).toBeNull();
  });

  it('getDiagnosis iki kazanımla: "Bu kazanım" yanılgının kazanımıdır (alfabetik ilk değil)', async () => {
    const { client } = fakeClient({
      solution_analyses: [{ id: SA, enrollment_id: 'e1', upload_ids: [U1], question_text: 'Soru', analysis: ANALYSIS, verdict: 'wrong', failing_step_no: 3, error_cause: 'procedure', skill_ids: ['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar'], misconception_tags: ['sayilar.parantez-eksi-dagitma'] }],
      enrollments: [{ id: 'e1', curriculum_id: 'c1' }],
      skills: [
        { curriculum_id: 'c1', id: 'tyt.mat.cebir.denklem', name: 'Birinci dereceden denklemler' },
        { curriculum_id: 'c1', id: 'tyt.mat.temel.sayilar', name: 'Sayılar ve işaret kuralları' },
      ],
      mastery: [
        { enrollment_id: 'e1', skill_id: 'tyt.mat.cebir.denklem', p: '0.9', evidence_count: 9 },
        { enrollment_id: 'e1', skill_id: 'tyt.mat.temel.sayilar', p: '0.3', evidence_count: 7 },
      ],
      misconception_tags: [{ tag: 'sayilar.parantez-eksi-dagitma', skill_id: 'tyt.mat.temel.sayilar', text_student: 'Eksi işareti parantezdeki her terime dağılır.' }],
    });
    const d = await getDiagnosis(client, SA);
    expect(d).toMatchObject({
      learned: 'Eksi işareti parantezdeki her terime dağılır.',
      skill: { id: 'tyt.mat.temel.sayilar', name: 'Sayılar ve işaret kuralları', band: 'zayıf' },
    });
  });
});

describe('ekranlar', () => {
  it('Yükle (S07): iki seçenek, kamera girişi capture, tek birincil düğme; sayfa eklenince Gönder', () => {
    render(<YukleAkisi ownerId={OWNER} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ne yüklüyorsun?');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByLabelText(/Kendi çalışmam/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/Okul denemesi/));
    expect(screen.getByLabelText(/Okul denemesi/)).toBeChecked();
    const cam = screen.getByTestId('kamera-girisi');
    expect(cam).toHaveAttribute('capture', 'environment');
    expect(cam).toHaveAttribute('accept', 'image/*');
    expect(screen.getByTestId('dosya-girisi')).toHaveAttribute('accept', 'image/*,application/pdf');
    expect(screen.queryByRole('button', { name: 'Gönder' })).toBeNull();
    // görünür seçenekler gerçek düğme (klavye odağı ve halkası onlarda); gizli girdi sekme sırasında yok
    const clicked = vi.spyOn(cam, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: /Fotoğraf çek/ }));
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Dosya\/PDF seç/ })).toBeInTheDocument();
    expect(cam).toHaveAttribute('tabindex', '-1');
    fireEvent.change(cam, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'soru.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getByText('1 sayfa hazır')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gönder' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '1. sayfayı çıkar' }));
    expect(screen.queryByRole('button', { name: 'Gönder' })).toBeNull();
  });

  it('Adımları göster (S06): varsayılan kapalı, bozulan adım işaretli', () => {
    const a = readAnalysis(ANALYSIS);
    render(<AdimMerdiveni rows={ladderRows(a.steps, a.reference_steps, 3)} />);
    const det = screen.getByTestId('adim-merdiveni');
    expect(det).not.toHaveAttribute('open');
    expect(within(det).getByText('Adımları göster')).toBeInTheDocument();
    const failing = det.querySelector('[aria-current="step"]')!;
    expect(failing).toHaveTextContent('3. adım');
    expect(failing).toHaveTextContent('✕ Burada bozuldu');
  });
});

describe('db-types sütunları göç dosyalarında', () => {
  it('UploadRow / SolutionAnalysisRow alanları gerçek sütunlar', () => {
    const root = path.resolve(__dirname, '../../..');
    const sql = fs
      .readdirSync(path.join(root, 'supabase/migrations'))
      .sort()
      .map((f) => fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8'))
      .join('\n');
    const src = fs.readFileSync(path.resolve(__dirname, '../src/server/uploads/db-types.ts'), 'utf8');
    const tableOf: Record<string, string> = { Upload: 'uploads', SolutionAnalysis: 'solution_analyses', DiagnosisEnrollment: 'enrollments', DiagnosisSkill: 'skills', DiagnosisMastery: 'mastery', DiagnosisTag: 'misconception_tags', DiagnosisStudent: 'students', UploadCard: 'suggestions' };
    for (const m of src.matchAll(/export type (\w+)Row = \{([\s\S]*?)\};/g)) {
      const table = tableOf[m[1]!]!;
      const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1] ?? '';
      const fields = [...m[2]!.matchAll(/(\w+):/g)].map((x) => x[1]!);
      for (const f of fields) expect(body, `${table}.${f}`).toMatch(new RegExp(`\\n\\s{2}${f}\\s`));
    }
  });
});
