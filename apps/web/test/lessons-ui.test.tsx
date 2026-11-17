// Ders ekranları: yükleme formu (öğrenci+ders seçimi, TUS yüklemesi → register), liste (aşama kelimeyle), iddia incelemesi
// (transkript, iddia kartları, Onayla/Düzenle/Reddet, eşik, Dossier'e uygula, Öğrenciye görünür) ve Gelişim › Dersler.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh }), usePathname: () => '/egitmen/dersler' }));
vi.mock('@/lib/live', () => ({ useLive: () => null }));
const tus = vi.fn(async (job: { file: File; onProgress?: (s: number, t: number) => void }) => {
  job.onProgress?.(job.file.size, job.file.size);
});
vi.mock('@/lib/lesson-upload', () => ({ tusUpload: (job: never) => tus(job), UploadAborted: class extends Error {} }));
vi.mock('@/app/ogrenci/yukle/gorsel', () => ({
  newUploadId: (() => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n + 100).padStart(12, '0')}`;
  })(),
}));

import { LessonList } from '@/components/lessons/LessonList';
import { LessonUpload } from '@/components/lessons/LessonUpload';
import { ReviewWorkspace, type WorkspaceActions } from '@/components/lessons/ReviewWorkspace';
import { LessonsFold } from '@/app/ogrenci/gelisim/dersler';
import { parseLessonList, parseStaffView, parseStudentLessons, type LessonStaffView } from '@/server/lessons/shared';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWNER = U(1);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LessonUpload', () => {
  const targets = [
    { enrollmentId: U(20), studentId: U(10), studentName: 'Elif K.', courseTitle: 'TYT Matematik' },
    { enrollmentId: U(21), studentId: U(10), studentName: 'Elif K.', courseTitle: 'AYT Matematik' },
    { enrollmentId: U(22), studentId: U(11), studentName: 'Mert A.', courseTitle: 'TYT Fizik' },
  ];
  const result = { ok: true, message: 'Dersi aldım; yazıya çeviriyorum.', lessonId: U(99) };

  it('öğrenci seçilince dersler gelir; video TUS ile gider, sonra register çağrılır', async () => {
    const user = userEvent.setup();
    const register = vi.fn(async (_input: unknown) => result);
    render(<LessonUpload targets={targets} ownerId={OWNER} register={register} />);
    expect(screen.getByRole('button', { name: 'Dersi yükle' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Öğrenci'), U(10));
    const ders = screen.getByLabelText('Ders');
    expect(within(ders).getAllByRole('option').map((o) => o.textContent)).toEqual(['Ders seç', 'TYT Matematik', 'AYT Matematik']);
    await user.selectOptions(ders, U(21));
    await user.type(screen.getByLabelText('Başlık (isteğe bağlı)'), 'Mutlak değer');
    const file = new File([new Uint8Array(2048)], 'ders12.mp4', { type: 'video/mp4' });
    await user.upload(screen.getByTestId('ders-dosya'), file);
    expect(screen.getByText(/ders12\.mp4/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dersi yükle' }));
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(tus).toHaveBeenCalledTimes(1);
    expect(tus.mock.calls[0]![0]).toMatchObject({ objectName: `${OWNER}/${U(101)}.mp4`, contentType: 'video/mp4' });
    expect(register.mock.calls[0]![0]).toMatchObject({ uploadId: U(101), path: `${OWNER}/${U(101)}.mp4`, mime: 'video/mp4', kind: 'video', enrollmentId: U(21), title: 'Mutlak değer', bytes: 2048, transcript: null });
    expect(await screen.findByText('Dersi aldım; yazıya çeviriyorum.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('tek öğrenci ve tek ders kendiliğinden seçilir; transkript dosyası da kabul edilir', async () => {
    const user = userEvent.setup();
    const register = vi.fn(async (_input: unknown) => result);
    render(<LessonUpload targets={[targets[0]!]} ownerId={OWNER} register={register} />);
    await user.upload(screen.getByTestId('ders-dosya'), new File(['1\n00:00:01,000 --> 00:00:03,000\nMerhaba'], 'ders.srt', { type: '' }));
    await user.click(screen.getByRole('button', { name: 'Dersi yükle' }));
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0]![0]).toMatchObject({ kind: 'transcript', mime: 'application/x-subrip', enrollmentId: U(20) });
  });

  it('video ile birlikte transkript eklenir: iki dosya, ikisi de yüklenir', async () => {
    const user = userEvent.setup();
    const register = vi.fn(async (_input: unknown) => result);
    render(<LessonUpload targets={[targets[0]!]} ownerId={OWNER} register={register} />);
    await user.upload(screen.getByTestId('ders-dosya'), new File(['x'], 'ders.mp4', { type: 'video/mp4' }));
    await user.upload(screen.getByTestId('ders-transkript'), new File(['merhaba'], 'ders.vtt', { type: 'text/vtt' }));
    await user.click(screen.getByRole('button', { name: 'Dersi yükle' }));
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(tus).toHaveBeenCalledTimes(2);
    const sent = register.mock.calls[0]![0] as { uploadId: string; transcript: { uploadId: string; mime: string; path: string } };
    expect(sent.transcript).toMatchObject({ mime: 'text/vtt', path: `${OWNER}/${sent.transcript.uploadId}.vtt` });
    expect(sent.transcript.uploadId).not.toBe(sent.uploadId);
  });

  it('desteklenmeyen dosyayı ve 5 GB üstünü reddeder', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<LessonUpload targets={[targets[0]!]} ownerId={OWNER} register={vi.fn(async (_input: unknown) => result)} />);
    await user.upload(screen.getByTestId('ders-dosya'), new File(['x'], 'sorular.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Bu dosya türünü alamıyorum/);
    expect(screen.getByRole('button', { name: 'Dersi yükle' })).toBeDisabled();
    const huge = new File(['x'], 'dev.mp4', { type: 'video/mp4' });
    Object.defineProperty(huge, 'size', { value: 6 * 1024 ** 3 });
    await user.upload(screen.getByTestId('ders-dosya'), huge);
    expect(await screen.findByRole('alert')).toHaveTextContent(/5 GB/);
  });

  it('yükleme düşerse kaldığı yerden sürdüğünü söyler; register çağrılmaz', async () => {
    const user = userEvent.setup();
    tus.mockRejectedValueOnce(new Error('ağ'));
    const register = vi.fn(async (_input: unknown) => result);
    render(<LessonUpload targets={[targets[0]!]} ownerId={OWNER} register={register} />);
    await user.upload(screen.getByTestId('ders-dosya'), new File(['x'], 'ders.mp4', { type: 'video/mp4' }));
    await user.click(screen.getByRole('button', { name: 'Dersi yükle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/kaldığı yerden sürer/);
    expect(register).not.toHaveBeenCalled();
  });

  it('bağlı öğrenci yoksa açıklama gösterir', () => {
    render(<LessonUpload targets={[]} ownerId={OWNER} register={vi.fn()} />);
    expect(screen.getByText(/bir derse kayıtlı öğrenci gerekir/)).toBeInTheDocument();
  });
});

describe('LessonList', () => {
  const row = (n: number, over: Record<string, unknown> = {}) => ({
    id: U(n), no: n, title: null, held_at: '2026-10-29T14:00:00Z', duration_sec: 2880, status: 'analyzed', stage: 'done', error: null, student_visible: false, enrollment_id: U(2), course_id: U(3), course_title: 'TYT Matematik',
    student: { id: U(4), name: 'Elif K.' }, transcript_ready: true, claims: { total: 6, pending: 3, applied: 3 }, ...over,
  });
  it('işleniyor / onay bekliyor / hazır / işlenemedi durumlarını kelimeyle gösterir', () => {
    const rows = parseLessonList([
      row(1, { status: 'processing', stage: 'stt', claims: null, transcript_ready: false }),
      row(2),
      row(3, { claims: { total: 4, pending: 0, applied: 4 }, student_visible: true }),
      row(4, { status: 'failed', stage: 'failed', error: 'ses çıkarılamadı' }),
    ]);
    render(<LessonList rows={rows} />);
    const items = screen.getAllByTestId('ders-satiri');
    expect(items).toHaveLength(4);
    expect(within(items[0]!).getByText('Yazıya çevriliyor')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('progressbar')).toBeInTheDocument();
    expect(within(items[1]!).getByText('3 onay bekliyor')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Öğrenciye açık')).toBeInTheDocument();
    expect(within(items[3]!).getByText('İşlenemedi')).toBeInTheDocument();
    expect(items[1]).toHaveAttribute('href', `/egitmen/dersler/${U(2)}`);
    expect(within(items[1]!).getByText(/Elif K\. · TYT Matematik · 29 Eki 2026 · 48 dk/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});

function view(over: { claims?: unknown[]; lesson?: Record<string, unknown>; counts?: Record<string, number>; segments?: unknown[] } = {}): LessonStaffView {
  const claim = (n: number, o: Record<string, unknown> = {}) => ({
    id: U(300 + n), kind: 'skill_mastery', skill_id: '3.2.3', skill_name: 'Mutlak değerli eşitsizlikler', misconception_tag: null, value: { mastery_estimate: 0.6, evidence_count: 1 }, edited_value: null, confidence: 0.74, below_threshold: true,
    quote: 'Eksi tarafı hep unutuyorum aslında.', speaker: 'ÖĞRENCİ', t_start_sec: 850, t_end_sec: 856, status: 'pending', auto: false, decided_at: null, applied: false, applied_at: null, mastery: { p: 0.58, evidence_count: 9 }, effect: null, ...o,
  });
  return parseStaffView({
    role: 'staff',
    lesson: { id: U(2), no: 12, title: 'Mutlak değer', held_at: '2026-10-29T14:00:00Z', duration_sec: 2880, status: 'analyzed', stage: 'done', progress: { stage: 'done' }, student_visible: false, auto_apply_threshold: 0.8, retain_until: null, video_deleted_at: null, audio_deleted_at: null, course_title: 'TYT Matematik', student: { id: U(4), name: 'Elif K.' }, instructor: { id: U(5), name: 'Ayşe Demir' }, can_manage: true, ...over.lesson },
    transcript: {
      segments: over.segments ?? [
        { t0: 828, t1: 835, speaker: 'EĞİTMEN', text: 'Peki öbür taraf? Mutlak değer bize neyi söylüyor?' },
        { t0: 850, t1: 856, speaker: 'ÖĞRENCİ', text: 'Eksi tarafı hep unutuyorum aslında.' },
        { t0: 858, t1: 865, speaker: 'EĞİTMEN', text: 'Evet, ikisini birlikte yaz.' },
      ],
      language: 'tr', provider: 'fake', labeled: true, segment_count: 3,
    },
    analysis: { id: U(6), version: 1, status: 'draft' },
    claims: over.claims ?? [
      claim(1),
      claim(2, { kind: 'homework', skill_id: null, skill_name: null, value: { who: 'ÖĞRENCİ', text: 'Sayfa 40 çöz' }, confidence: 1, below_threshold: false, quote: null, mastery: null, status: 'approved', auto: true, applied: true, applied_at: '2026-10-29T15:02:00Z', t_start_sec: 900 }),
      claim(3, { kind: 'followup', skill_name: null, value: { status: 'improved' }, quote: null, mastery: null, confidence: 0.9, below_threshold: false, t_start_sec: 830 }),
    ],
    counts: over.counts ?? { total: 3, pending: 2, applied: 1, rejected: 0 },
  });
}

function actions(over: Partial<WorkspaceActions> = {}): WorkspaceActions {
  const ok = (message: string) => vi.fn(async () => ({ ok: true, message }));
  return { review: ok('Onayladım.'), apply: ok('1 iddiayı dossier’e işledim.'), options: ok('Kaydettim.'), ...over } as WorkspaceActions;
}

describe('ReviewWorkspace', () => {
  it('transkript zaman damgalı ve konuşmacı etiketli; iddialar kelimeyle güven taşır, yüzde yok', () => {
    render(<ReviewWorkspace view={view()} actions={actions()} />);
    const lines = screen.getAllByTestId('transkript-satiri');
    expect(lines).toHaveLength(3);
    expect(within(lines[1]!).getByText('14:10')).toBeInTheDocument();
    expect(within(lines[1]!).getByText('ÖĞRENCİ')).toBeInTheDocument();
    expect(within(lines[1]!).getByText(/İddia 1 kanıtı/)).toBeInTheDocument();
    const claims = screen.getAllByTestId('iddia');
    expect(claims).toHaveLength(3);
    expect(within(claims[0]!).getByText('Güven orta · eşiğin altında')).toBeInTheDocument();
    expect(within(claims[0]!).getByRole('meter')).toBeInTheDocument();
    expect(within(claims[0]!).getByText(/Eksi tarafı hep unutuyorum/)).toBeInTheDocument();
    expect(within(claims[1]!).getByText('Dossier’e uygulandı')).toBeInTheDocument();
    expect(within(claims[1]!).getByText(/otomatik uygulandı/)).toBeInTheDocument();
    expect(screen.getByTestId('uygulama-durumu')).toHaveTextContent('Dossier’e uygulandı 1/3 · 2 onay bekliyor · 0 reddedildi');
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('Onayla ve Reddet sunucu eylemini çağırır, sonra sayfayı tazeler', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<ReviewWorkspace view={view()} actions={a} />);
    const first = screen.getAllByTestId('iddia')[0]!;
    await user.click(within(first).getByRole('button', { name: 'Onayla' }));
    await waitFor(() => expect(a.review).toHaveBeenCalledWith(U(2), U(301), 'approve', undefined));
    expect(await screen.findByText('Onayladım.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    await user.click(within(first).getByRole('button', { name: 'Reddet' }));
    await waitFor(() => expect(a.review).toHaveBeenLastCalledWith(U(2), U(301), 'reject', undefined));
  });

  it('Düzenle ustalığı bantla seçtirir; uygulanmış iddiada Reddet "Geri al" olur', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<ReviewWorkspace view={view()} actions={a} />);
    const [first, second, third] = screen.getAllByTestId('iddia');
    await user.click(within(first!).getByRole('button', { name: 'Düzenle' }));
    await user.click(within(first!).getByRole('button', { name: 'İyi' }));
    await waitFor(() => expect(a.review).toHaveBeenCalledWith(U(2), U(301), 'edit', { mastery_estimate: 0.9 }));
    expect(within(second!).queryByRole('button', { name: 'Düzenle' })).toBeNull(); // ödev düzenlenmez
    expect(within(second!).getByRole('button', { name: 'Geri al' })).toBeInTheDocument();
    expect(within(second!).queryByRole('button', { name: 'Onayla' })).toBeNull();
    await user.click(within(third!).getByRole('button', { name: 'Düzenle' }));
    await user.click(within(third!).getByRole('button', { name: 'Sürüyor' }));
    await waitFor(() => expect(a.review).toHaveBeenLastCalledWith(U(2), U(303), 'edit', { status: 'still_present' }));
  });

  it('iddiaya dokunmak kanıtının satırını işaretler; süzgeç bekleyen/uygulananı ayırır', async () => {
    const user = userEvent.setup();
    render(<ReviewWorkspace view={view()} actions={actions()} />);
    await user.click(screen.getByRole('button', { name: 'İddia 1: kanıtı transkriptte göster' }));
    const lines = screen.getAllByTestId('transkript-satiri');
    expect(lines[1]).toHaveAttribute('data-active', 'true');
    await user.click(screen.getByRole('tab', { name: 'Uygulandı 1' }));
    expect(screen.getAllByTestId('iddia')).toHaveLength(1);
    await user.click(screen.getByRole('tab', { name: 'Onay bekliyor 2' }));
    expect(screen.getAllByTestId('iddia')).toHaveLength(2);
  });

  it('eşik kaydırıcısı 0,80 ile başlar, bırakılınca kaydedilir; Dossier’e uygula ve Öğrenciye görünür', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<ReviewWorkspace view={view()} actions={a} />);
    expect(screen.getByTestId('esik-deger')).toHaveTextContent('0,80');
    const slider = screen.getByLabelText(/Otomatik uygulama eşiği/);
    expect(slider).toHaveAttribute('min', '0.5');
    expect(slider).toHaveAttribute('max', '1');
    fireEvent.change(slider, { target: { value: '0.85' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(screen.getByTestId('esik-deger')).toHaveTextContent('0,85');
    await waitFor(() => expect(a.options).toHaveBeenCalledWith(U(2), { auto_apply_threshold: 0.85 }));
    await waitFor(() => expect(screen.getByTestId('dossiere-uygula')).toBeEnabled());
    await user.click(screen.getByTestId('dossiere-uygula'));
    await waitFor(() => expect(a.apply).toHaveBeenCalledWith(U(2)));
    expect(screen.getByText(/Son uygulama 29 Eki 2026, 18:02 · geri alınabilir/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: 'Öğrenciye görünür' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => expect(sw).toBeEnabled());
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(a.options).toHaveBeenLastCalledWith(U(2), { student_visible: true }));
    expect(screen.getByText(/transkript ve alıntılar gizli kalır/)).toBeInTheDocument();
  });

  it('görünürlük kaydı başarısızsa anahtar geri döner', async () => {
    const user = userEvent.setup();
    const a = actions({ options: vi.fn(async () => ({ ok: false, message: 'Bu işlemi yalnız dersin eğitmeni yapabilir.' })) });
    render(<ReviewWorkspace view={view()} actions={a} />);
    const sw = screen.getByRole('switch', { name: 'Öğrenciye görünür' });
    await user.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/yalnız dersin eğitmeni/);
  });

  it('yönetim yetkisi yoksa düğmeler ve kaydırıcı kapalıdır', () => {
    render(<ReviewWorkspace view={view({ lesson: { can_manage: false } })} actions={actions()} />);
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    expect(screen.queryByTestId('dossiere-uygula')).toBeNull();
    expect(screen.getByLabelText(/Otomatik uygulama eşiği/)).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Öğrenciye görünür' })).toBeDisabled();
  });

  it('uzun transkriptte iddia çevresi gösterilir, geri kalanı gizli satır olarak katlanır ve arama çalışır', async () => {
    const user = userEvent.setup();
    const segments = Array.from({ length: 400 }, (_, i) => ({ t0: i * 10, t1: i * 10 + 9, speaker: i % 2 ? 'ÖĞRENCİ' : 'EĞİTMEN', text: i === 85 ? 'Eksi tarafı hep unutuyorum aslında.' : `Satır ${i}` }));
    render(<ReviewWorkspace view={view({ segments })} actions={actions()} />);
    expect(screen.getAllByTestId('transkript-satiri').length).toBeLessThan(20);
    expect(screen.getAllByRole('button', { name: /satır gizli/ }).length).toBeGreaterThan(0);
    await user.type(screen.getByPlaceholderText('Transkriptte ara'), 'Satır 300');
    expect(screen.getAllByTestId('transkript-satiri')).toHaveLength(1);
    await user.clear(screen.getByPlaceholderText('Transkriptte ara'));
    await user.click(screen.getByRole('button', { name: 'Tüm transkripti göster' }));
    expect(screen.getAllByTestId('transkript-satiri')).toHaveLength(400);
  });

  it('iddia yoksa açıklama gösterir', () => {
    render(<ReviewWorkspace view={view({ claims: [], counts: { total: 0, pending: 0, applied: 0, rejected: 0 } })} actions={actions()} />);
    expect(screen.getByText('Bu dersten henüz iddia çıkarılmadı.')).toBeInTheDocument();
  });
});

describe('Gelişim › Dersler', () => {
  it('tarih + tek cümle; transkript ve güven yok', () => {
    const rows = parseStudentLessons([{ id: U(1), no: 12, title: null, held_at: '2026-10-29T14:00:00Z', duration_sec: 2880, summary_ready: true }]);
    render(<LessonsFold items={[{ row: rows[0]!, sentence: 'Cuma günü iki taraflı yazımı tekrar et.' }]} total={3} />);
    const item = screen.getByTestId('ders-ozeti');
    expect(item).toHaveTextContent('29 Eki 2026');
    expect(item).toHaveTextContent('Cuma günü iki taraflı yazımı tekrar et.');
    expect(screen.getByText('Daha eski 2 ders var.')).toBeInTheDocument();
    expect(screen.queryByText(/güven|transkript/i)).toBeNull();
  });
  it('görünür ders yoksa hiç çizilmez', () => {
    const { container } = render(<LessonsFold items={[]} total={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
