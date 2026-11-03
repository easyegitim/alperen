import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  AlertRow,
  AnswerGrid,
  AppShell,
  Avatar,
  Badge,
  BrandLockup,
  Button,
  CameraSheet,
  CitationCard,
  DocumentViewer,
  EvidenceQuote,
  ExamPlayer,
  ExamPriorityRow,
  FigureFrame,
  LessonCard,
  MasteryMeter,
  MemoryFileCard,
  MisconceptionItem,
  ModeToggle,
  Notice,
  OutcomeHeatmap,
  ProgressBar,
  QuizOption,
  ReportChart,
  StatTile,
  StepLadder,
  TextField,
  Timer,
  Tree,
  TreeNode,
  TutorMessage,
  heatStep,
  initialsOf,
  masteryDisplay,
  useCountdown,
  type TutorMode,
} from '../src';

describe('Button', () => {
  it('gerçek button, varsayılan type=button, ref ve className iletilir', async () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    render(
      <Button ref={ref} variant="primary" className="ekstra" onClick={onClick}>
        Derse başla
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Derse başla' });
    expect(b).toHaveAttribute('type', 'button');
    expect(b).toHaveClass('ekstra', 'bg-primary');
    expect(ref.current).toBe(b);
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('disabled tıklanmaz; ikon erişilebilirlik ağacında yok', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled icon={<svg data-testid="i" />} onClick={onClick}>
        Gönder
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByTestId('i').parentElement).toHaveAttribute('aria-hidden', 'true');
  });
  it('dokunma hedefi en az 44px sınıfları (md)', () => {
    render(<Button>Tamam</Button>);
    expect(screen.getByRole('button')).toHaveClass('min-h-11');
  });
});

describe('TextField', () => {
  it('etiket girdiye bağlı; hata aria-invalid ve describedby ile', () => {
    render(<TextField label="Cevabın" error="Sadeleştirmeyi unuttun." />);
    const input = screen.getByLabelText('Cevabın');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const desc = document.getElementById(input.getAttribute('aria-describedby')!);
    expect(desc).toHaveTextContent('✕ Sadeleştirmeyi unuttun.');
  });
  it('hint gösterilir; ref girdiye gider', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} label="E-posta" hint="Örn. ali@ornek.com" />);
    expect(ref.current).toBe(screen.getByLabelText('E-posta'));
    expect(screen.getByText('Örn. ali@ornek.com')).toBeInTheDocument();
  });
});

describe('Badge, ProgressBar, StatTile, Avatar, BrandLockup', () => {
  it('Badge tonu sınıfı', () => {
    render(<Badge tone="danger">✕ Tekrar dene</Badge>);
    expect(screen.getByText('✕ Tekrar dene')).toHaveClass('bg-danger-soft');
  });
  it('ProgressBar değer aralığına sıkıştırır ve Türkçe yüzde yazar', () => {
    render(<ProgressBar label="Ünite" value={140} />);
    const bar = screen.getByRole('progressbar', { name: 'Ünite' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '%100');
  });
  it('StatTile durum kelimesini yazar', () => {
    render(<StatTile label="Cevapsız soru" value="3" status="danger" statusText="Acil" />);
    expect(screen.getByText('Acil')).toBeInTheDocument();
  });
  it('Avatar baş harfleri Türkçe büyük harfle', () => {
    expect(initialsOf('ışıl öztürk')).toBe('IÖ');
    render(<Avatar name="Elif Kaya" />);
    expect(screen.getByRole('img', { name: 'Elif Kaya' })).toHaveTextContent('EK');
  });
  it('BrandLockup adı doğru yazar; endorsement gizlenebilir', () => {
    const { rerender } = render(<BrandLockup />);
    expect(screen.getByText('Öğrenmen')).toBeInTheDocument();
    expect(screen.getByText('by easy')).toBeInTheDocument();
    rerender(<BrandLockup endorsement={false} />);
    expect(screen.queryByText('by easy')).toBeNull();
  });
});

describe('Notice', () => {
  it('uyarı role=alert; handoff varsayılan başlık; info kapatılabilir', async () => {
    const onDismiss = vi.fn();
    render(
      <>
        <Notice tone="warning" title="Onay bekliyor">
          Rapor onay sonrası işlenir.
        </Notice>
        <Notice tone="handoff">Hocana ilettim.</Notice>
        <Notice tone="info" onDismiss={onDismiss}>
          Mod değişti.
        </Notice>
        <Notice tone="legal" onDismiss={onDismiss}>
          Kayıt bildirimi.
        </Notice>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Onay bekliyor');
    expect(screen.getByText('Hocana yönlendirildi')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Kapat' })).toHaveLength(1);
  });
});

describe('MasteryMeter kanıt eşiği', () => {
  it('eşik altında yüzde yok, dolgu yok, p ne olursa olsun', () => {
    expect(masteryDisplay({ p: 0.95, evidence: 4 })).toEqual({ enough: false, text: 'Henüz yeterli kanıt yok' });
    expect(masteryDisplay({ p: 0.95 }).enough).toBe(false);
    expect(masteryDisplay({ evidence: 20 }).enough).toBe(false);
  });
  it('eşik dahil: 5 gözlemde yüzde yazılır; özel eşik', () => {
    expect(masteryDisplay({ p: 0.724, evidence: 5 })).toEqual({ enough: true, percent: 72, text: '%72' });
    expect(masteryDisplay({ p: 0.5, evidence: 5, minEvidence: 8 }).enough).toBe(false);
    expect(masteryDisplay({ p: 0.5, evidence: 8, minEvidence: 8 }).enough).toBe(true);
  });
  it('düşük kanıtta "Henüz yeterli kanıt yok" yazar, % işareti ve meter rolü yok', () => {
    const { container } = render(<MasteryMeter skill="Üslü ifadeler" p={0.9} evidence={2} delta={0.1} />);
    expect(screen.getByText('Henüz yeterli kanıt yok')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/%/);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByText('2 gözlem')).toBeInTheDocument();
  });
  it('yeterli kanıtta yüzde, meter rolü ve işaretli değişim', () => {
    render(<MasteryMeter skill="Kesirler" p={0.72} evidence={8} delta={-0.03} deltaLabel="bu hafta" period="LGS 2026" />);
    const meter = screen.getByRole('meter', { name: 'Kesirler ustalığı' });
    expect(meter).toHaveAttribute('aria-valuenow', '72');
    expect(screen.getByText('%72')).toBeInTheDocument();
    expect(screen.getByText('−%3')).toBeInTheDocument();
    expect(screen.getByText(/LGS 2026/)).toBeInTheDocument();
  });
});

describe('ModeToggle', () => {
  it('varsayılan İpucu; üç mod; radyo grubu', () => {
    render(<ModeToggle />);
    const group = screen.getByRole('radiogroup', { name: 'Yanıt modu' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.textContent?.split(/(?=[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ [a-zçğıöşü]+$)/)[0])).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /^İpucu/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^Açıkla/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^Çözümü göster/ })).not.toBeChecked();
  });
  it('öğrenci tıklayınca değişir ve onChange çağrılır; sistem kendiliğinden değiştirmez', async () => {
    const onChange = vi.fn();
    render(<ModeToggle onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: /^Çözümü göster/ }));
    expect(onChange).toHaveBeenCalledWith('solve');
    expect(screen.getByRole('radio', { name: /^Çözümü göster/ })).toBeChecked();
  });
  it('kontrollü kullanımda value dışarıdan gelir', async () => {
    function Host() {
      const [m, setM] = useState<TutorMode>('hint');
      return <ModeToggle value={m} onChange={setM} />;
    }
    render(<Host />);
    await userEvent.click(screen.getByRole('radio', { name: /^Açıkla/ }));
    expect(screen.getByRole('radio', { name: /^Açıkla/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^İpucu/ })).not.toBeChecked();
  });
  it('ok tuşları modu değiştirip odağı taşır', async () => {
    const onChange = vi.fn();
    render(<ModeToggle onChange={onChange} />);
    screen.getByRole('radio', { name: /^İpucu/ }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('explain');
    expect(screen.getByRole('radio', { name: /^Açıkla/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('solve');
  });
  it('disabled iken değişmez; compact alt satırları gizler', async () => {
    const onChange = vi.fn();
    render(<ModeToggle disabled compact onChange={onChange} />);
    expect(screen.queryByText('Adım adım yönlendirir')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Açıkla' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('StepLadder vurgusu', () => {
  const student = [
    { no: 1, text: 'Önce yazdım' },
    { no: 2, text: 'Paylar toplandı' },
    { no: 3, text: 'Sonuç' },
  ];
  const expected = [
    { no: 1, text: 'Önce yaz' },
    { no: 2, text: 'Paydaları eşitle' },
    { no: 3, text: 'Sonuç' },
  ];
  it('bozulan adım vurgulanır; önceki doğru, sonrakiler soluk; ✕ ve kelime var', () => {
    render(<StepLadder studentSteps={student} expectedSteps={expected} failingStepNo={2} cause="procedure" />);
    const items = screen.getAllByRole('listitem');
    const states = items.map((li) => li.getAttribute('data-state'));
    expect(states).toEqual(['ok', 'failing', 'after', 'expected', 'expected-here', 'expected']);
    const failing = items[1]!;
    expect(failing).toHaveAttribute('aria-current', 'step');
    expect(failing).toHaveClass('bg-danger-soft');
    expect(failing).toHaveTextContent('✕ Burada bozuldu');
    expect(items[0]).toHaveTextContent('✓ Doğru');
    expect(screen.getByText('✕ 2. adımda bozuldu')).toBeInTheDocument();
    expect(screen.getByText('İşlem hatası')).toBeInTheDocument();
    expect(items[4]).toHaveTextContent('Beklenen');
  });
  it('failingStepNo yoksa vurgu yok, hepsi doğru', () => {
    render(<StepLadder studentSteps={student} expectedSteps={expected} />);
    const states = screen.getAllByRole('listitem').slice(0, 3).map((li) => li.getAttribute('data-state'));
    expect(states).toEqual(['ok', 'ok', 'ok']);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });
  it('adım metnindeki formül KaTeX ile çizilir', () => {
    const { container } = render(<StepLadder studentSteps={[{ no: 1, text: '$\\frac{3}{4}$' }]} expectedSteps={[]} />);
    expect(container.querySelector('.katex')).not.toBeNull();
  });
});

describe('QuizOption, FigureFrame, CitationCard, MisconceptionItem', () => {
  it('doğru/yanlış kilitlenir ve kelimeyle yazılır', () => {
    render(
      <>
        <QuizOption letter="A" state="correct" feedback="Paydalar eşitlendi.">
          7/8
        </QuizOption>
        <QuizOption letter="B" state="incorrect">
          4/12
        </QuizOption>
        <QuizOption letter="C" state="selected">
          1
        </QuizOption>
      </>,
    );
    expect(screen.getByRole('button', { name: /7\/8/ })).toBeDisabled();
    expect(screen.getByText('✓ Doğru')).toBeInTheDocument();
    expect(screen.getByText('✕ Tekrar dene')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^C\s*1/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('FigureFrame alt metni ve durum kelimesi', () => {
    render(<FigureFrame src="/s.svg" alt="ABC üçgeni" caption="Şekil 1" status="pending" />);
    expect(screen.getByRole('img', { name: 'ABC üçgeni' })).toBeInTheDocument();
    expect(screen.getByText('Onay bekliyor')).toBeInTheDocument();
  });
  it('CitationCard: doğrulanmış, doğrulanmamış ve DOI yok', () => {
    const { rerender } = render(<CitationCard title="Makale" doi="10.1/abc" verified authors="Yılmaz" year={2022} />);
    expect(screen.getByText('✓ Crossref doğruladı')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '10.1/abc' })).toHaveAttribute('href', 'https://doi.org/10.1/abc');
    rerender(<CitationCard title="Makale" doi="10.1/abc" verified={false} />);
    expect(screen.getByText(/kaldırılacak/)).toBeInTheDocument();
    rerender(<CitationCard title="Tez" />);
    expect(screen.getByText('DOI yok')).toBeInTheDocument();
  });
  it('MisconceptionItem kanıtsız render edilmez; Açık / Çözüldü', () => {
    const { container, rerender } = render(<MisconceptionItem text="Payları toplar" evidence={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<MisconceptionItem text="Payları toplar" evidence={[{ quote: 'a', source: 'Ders 1' }]} />);
    expect(screen.getByText('Açık')).toBeInTheDocument();
    rerender(<MisconceptionItem text="Payları toplar" resolved evidence={[{ quote: 'a', source: 'Ders 1' }]} />);
    expect(screen.getByText('✓ Çözüldü')).toBeInTheDocument();
  });
  it('EvidenceQuote kaynağı yazar', () => {
    render(
      <EvidenceQuote kind="quiz" source="Deneme 3 · Soru 8" href="#k">
        Atladım
      </EvidenceQuote>,
    );
    expect(screen.getByText('Soru')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Deneme 3 · Soru 8' })).toBeInTheDocument();
  });
});

describe('TutorMessage, LessonCard, ExamPriorityRow, AlertRow', () => {
  it('öğretmen balonu "AI öğretmen" etiketini taşır; yazıyor durumu', () => {
    render(
      <>
        <TutorMessage>Sence kaç?</TutorMessage>
        <TutorMessage typing />
      </>,
    );
    expect(screen.getAllByText('AI öğretmen')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Öğretmen yazıyor');
  });
  it('öğrenci balonu AI etiketi taşımaz; review satırı ve işaretle', async () => {
    const onFlag = vi.fn();
    const { rerender } = render(
      <TutorMessage from="student" review={{ model: 'Sonnet 5.5', cost: '0,002 $', memory: 3, onFlag }}>
        Merhaba
      </TutorMessage>,
    );
    expect(screen.queryByText('AI öğretmen')).toBeNull();
    expect(screen.getByText(/0,002 \$/)).toBeInTheDocument();
    expect(screen.getByText(/Hafıza olgusu: 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'İşaretle' }));
    expect(onFlag).toHaveBeenCalled();
    rerender(
      <TutorMessage from="student" review={{ flagged: true }}>
        Merhaba
      </TutorMessage>,
    );
    expect(screen.getByText('✕ İşaretlendi')).toBeInTheDocument();
  });
  it('LessonCard etiketi duruma göre a / button / article', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<LessonCard title="Ders" href="/d" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/d');
    rerender(<LessonCard title="Ders" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
    rerender(<LessonCard title="Ders" ai status="done" progress={100} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
    expect(screen.getByText('Öğrenmen sana göre hazırladı')).toBeInTheDocument();
    expect(screen.getByText('✓ Tamamlandı')).toBeInTheDocument();
  });
  it('ExamPriorityRow "4/5 yıl" yazar ve "tahmin" kelimesi yok', () => {
    const { container } = render(<ExamPriorityRow rank={1} topic="Üçgende açı" hits={4} years={5} points="≈20 puan" evidence="Kanıt: 4 sınav" />);
    expect(screen.getByText('4/5 yıl')).toBeInTheDocument();
    expect(container.textContent?.toLowerCase()).not.toMatch(/tahmin|çıkacak|kesin/);
  });
  it('AlertRow önem derecesini kelimeyle yazar', () => {
    render(<AlertRow kind="unanswered" severity="danger" student="Elif K." since="14 saattir cevapsız" />);
    expect(screen.getByText('Acil')).toBeInTheDocument();
    expect(screen.getByText('Cevapsız soru')).toBeInTheDocument();
  });
});

describe('CameraSheet', () => {
  const png = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' });

  it('çoklu dosya ekler, önizleme verir, kaldırır ve gönderir', async () => {
    const onSubmit = vi.fn();
    render(<CameraSheet onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: 'Soruyu gönder' })).toBeDisabled();
    await userEvent.upload(screen.getByLabelText('Dosya seçerek ekle'), [png('a.png'), png('b.png')]);
    expect(screen.getByText('2 / 8 sayfa')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Sayfa 2 kaldır' }));
    expect(screen.getByText('1 / 8 sayfa')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sayfa 1 döndür' }));
    await userEvent.click(screen.getByLabelText('Çözümüm de var'));
    await userEvent.click(screen.getByRole('button', { name: 'Soruyu gönder' }));
    const arg = onSubmit.mock.calls[0]![0];
    expect(arg.includesSolution).toBe(true);
    expect(arg.items).toHaveLength(1);
    expect(arg.items[0].rotation).toBe(90);
    expect(arg.items[0].file.name).toBe('a.png');
  });
  it('kamera girişi arka kamerayı ister', () => {
    render(<CameraSheet onSubmit={() => undefined} />);
    const cam = screen.getByLabelText('Kamerayla fotoğraf ekle');
    expect(cam).toHaveAttribute('capture', 'environment');
    expect(cam).toHaveAttribute('multiple');
  });
  it('sayfa ve boyut sınırı uyarı verir', async () => {
    render(<CameraSheet onSubmit={() => undefined} maxFiles={2} maxBytes={100} />);
    await userEvent.upload(screen.getByLabelText('Dosya seçerek ekle'), [png('a.png'), png('b.png'), png('c.png')]);
    expect(screen.getByRole('alert')).toHaveTextContent('En fazla 2 sayfa');
    expect(screen.getByText('2 / 2 sayfa')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Kamerayla fotoğraf ekle'), []);
    expect(screen.getByRole('button', { name: 'Fotoğraf çek' })).toBeDisabled();
  });
  it('büyük dosya reddedilir', async () => {
    render(<CameraSheet onSubmit={() => undefined} maxBytes={5} />);
    await userEvent.upload(screen.getByLabelText('Dosya seçerek ekle'), png('buyuk.png', 50));
    expect(screen.getByRole('alert')).toHaveTextContent('buyuk.png çok büyük');
    expect(screen.getByText('0 / 8 sayfa')).toBeInTheDocument();
  });
});

describe('OutcomeHeatmap', () => {
  it('basamak sınırları ve tablo yapısı; her hücre yüzdeyi yazar', () => {
    expect(heatStep(0)).toBe(0);
    expect(heatStep(0.5)).toBe(3);
    expect(heatStep(1)).toBe(6);
    render(
      <OutcomeHeatmap
        columns={['D1', 'D2']}
        rows={[{ id: 'a', label: 'Kesirler', cells: [{ value: 0.3, n: 5 }, { value: null }] }]}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'D1' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Kesirler' })).toBeInTheDocument();
    expect(screen.getByText('%30')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('Tree / TreeNode', () => {
  it('alt düğümler açılıp kapanır; kanıt eşiği altında yüzde yok', async () => {
    render(
      <Tree aria-label="Konu haritası">
        <TreeNode label="Matematik" p={0.6} evidence={30}>
          <TreeNode label="Kesirler" level={2} p={0.9} evidence={2} />
        </TreeNode>
      </Tree>,
    );
    expect(screen.queryByText('Kesirler')).toBeNull();
    const top = screen.getByRole('treeitem', { name: /Matematik/ });
    expect(top).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Matematik genişlet' }));
    expect(screen.getByText('Kesirler')).toBeInTheDocument();
    expect(screen.getByText('Henüz yeterli kanıt yok')).toBeInTheDocument();
    expect(screen.getByText('%60')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Matematik daralt' }));
    expect(screen.queryByText('Kesirler')).toBeNull();
  });
});

describe('Timer, AnswerGrid, ExamPlayer', () => {
  it('Timer biçimi ve uyarı kelimesi', () => {
    const { rerender } = render(<Timer remainingSec={3725} />);
    expect(screen.getByRole('timer')).toHaveTextContent('1:02:05');
    expect(screen.getByRole('timer')).not.toHaveTextContent('Süre azalıyor');
    rerender(<Timer remainingSec={120} />);
    expect(screen.getByRole('timer')).toHaveTextContent('02:00');
    expect(screen.getByRole('timer')).toHaveTextContent('Süre azalıyor');
    rerender(<Timer remainingSec={0} />);
    expect(screen.getByRole('timer')).toHaveTextContent('Süre doldu');
  });
  it('useCountdown geri sayar ve bitişte bir kez onExpire çağırır', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    function Host() {
      const left = useCountdown(3, { onExpire });
      return <span data-testid="left">{left}</span>;
    }
    render(<Host />);
    expect(screen.getByTestId('left')).toHaveTextContent('3');
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByTestId('left')).toHaveTextContent('2');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByTestId('left')).toHaveTextContent('0');
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  it('AnswerGrid durumu metinle belirtir ve seçimi bildirir', async () => {
    const onSelect = vi.fn();
    render(
      <AnswerGrid
        current={2}
        onSelect={onSelect}
        questions={[
          { no: 1, status: 'answered' },
          { no: 2, status: 'blank' },
          { no: 3, status: 'flagged' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Soru 1, cevaplandı' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soru 2, boş' })).toHaveAttribute('aria-current', 'step');
    await userEvent.click(screen.getByRole('button', { name: 'Soru 3, bayraklı' }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });
  it('ExamPlayer gezinir, bayraklar ve bitirir', async () => {
    const onNavigate = vi.fn();
    const onToggleFlag = vi.fn();
    const onFinish = vi.fn();
    render(
      <ExamPlayer
        title="Deneme 3"
        remainingSec={600}
        current={2}
        onNavigate={onNavigate}
        onToggleFlag={onToggleFlag}
        onFinish={onFinish}
        questions={[
          { no: 1, status: 'answered' },
          { no: 2, status: 'blank' },
          { no: 3, status: 'blank' },
        ]}
      >
        <p>Soru gövdesi</p>
      </ExamPlayer>,
    );
    expect(screen.getByText('Soru gövdesi')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('10:00');
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    expect(onNavigate).toHaveBeenCalledWith(3);
    await userEvent.click(screen.getByRole('button', { name: 'Önceki' }));
    expect(onNavigate).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: 'Bayrakla' }));
    expect(onToggleFlag).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByRole('button', { name: 'Sınavı bitir' }));
    expect(onFinish).toHaveBeenCalled();
  });
  it('ExamPlayer ilk soruda Önceki, sonda Sonraki kapalı', () => {
    render(<ExamPlayer title="D" current={1} onNavigate={() => undefined} questions={[{ no: 1, status: 'blank' }]} />);
    expect(screen.getByRole('button', { name: 'Önceki' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sonraki' })).toBeDisabled();
  });
});

describe('ReportChart', () => {
  const data = [
    { hafta: '1. hf', net: 18.5, hedef: 22 },
    { hafta: '2. hf', net: 21, hedef: 22 },
  ];
  it('tablo her zaman var, görünüm düğmesiyle açılır; çok seride lejant', async () => {
    render(
      <ReportChart
        title="Net ve hedef"
        data={data}
        xKey="hafta"
        series={[
          { key: 'net', name: 'Net' },
          { key: 'hedef', name: 'Hedef' },
        ]}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Tablo görünümü' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const legend = screen.getByRole('list', { name: 'Seriler' });
    expect(within(legend).getByText('Net')).toBeInTheDocument();
    expect(within(legend).getByText('Hedef')).toBeInTheDocument();
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('18,5')).toBeInTheDocument();
    expect(table.parentElement).toHaveClass('sr-only');
    await userEvent.click(toggle);
    expect(table.parentElement).not.toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Grafik görünümü' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('tek seride lejant yok ve 8 seriyi aşan yok sayılır', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ key: `s${i}`, name: `Seri ${i}` }));
    const row = Object.fromEntries(many.map((s) => [s.key, 1]));
    const { rerender } = render(<ReportChart title="T" data={[{ x: 'a', net: 1 }]} xKey="x" series={[{ key: 'net', name: 'Net' }]} />);
    expect(screen.queryByRole('list', { name: 'Seriler' })).toBeNull();
    rerender(<ReportChart title="T" data={[{ x: 'a', ...row }]} xKey="x" series={many} />);
    expect(within(screen.getByRole('list', { name: 'Seriler' })).getAllByRole('listitem')).toHaveLength(8);
  });
});

describe('AppShell', () => {
  const items = [
    { id: 'koc', label: 'Koç', href: '/koc', active: true },
    { id: 'den', label: 'Denemeler', href: '/denemeler' },
    { id: 'prof', label: 'Profil', href: '/profil' },
  ];
  it('iki gezinme düzeni, etkin sayfa aria-current, FAB ve içerik', async () => {
    const onFab = vi.fn();
    render(
      <AppShell items={items} fab={{ label: 'Sor', onClick: onFab }}>
        <p>İçerik</p>
      </AppShell>,
    );
    expect(screen.getAllByRole('navigation', { hidden: true })).toHaveLength(2);
    const current = screen.getAllByRole('link', { name: 'Koç', hidden: true });
    expect(current).toHaveLength(2);
    for (const a of current) expect(a).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toHaveTextContent('İçerik');
    const fabs = screen.getAllByRole('button', { name: 'Sor', hidden: true });
    await userEvent.click(fabs[0]!);
    expect(onFab).toHaveBeenCalled();
  });
  it('renderLink ile özel bağlantı (ör. Next Link) kullanılır', () => {
    render(
      <AppShell
        items={items}
        renderLink={({ href, children, ...p }) => (
          <a data-custom="1" href={href} {...p}>
            {children}
          </a>
        )}
      />,
    );
    expect(document.querySelectorAll('[data-custom="1"]').length).toBe(items.length * 2);
  });
});

describe('DocumentViewer, MemoryFileCard', () => {
  it('html içindeki formülleri KaTeX ile çizer; PDF bağlantısı ve kişiselleştirme notu', () => {
    const { container } = render(
      <DocumentViewer title="Kesirler" html="<p>Toplam $\frac{3}{4}+\frac{1}{8}$ olur.</p>" pdfHref="/k.pdf" personalized />,
    );
    expect(container.querySelector('.og-doc .katex')).not.toBeNull();
    expect(screen.getByRole('link', { name: /PDF indir/ })).toHaveAttribute('href', '/k.pdf');
    expect(screen.getByText('Öğrenmen sana göre hazırladı')).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveAttribute('lang', 'tr');
  });
  it('children kabı ve matematik kapatılabilir', () => {
    const { container } = render(
      <DocumentViewer title="N" html="<p>$x$</p>" autoRenderMath={false} />,
    );
    expect(container.querySelector('.katex')).toBeNull();
  });
  it('MemoryFileCard içerik ve düzeltme isteği', async () => {
    const onRequestCorrection = vi.fn();
    render(<MemoryFileCard path="/memories/a.md" title="Nasıl öğreniyorsun" content="Görsel öğreniyor." bytes={20} onRequestCorrection={onRequestCorrection} />);
    expect(screen.getByText('/memories/a.md')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Düzeltme iste' }));
    expect(onRequestCorrection).toHaveBeenCalled();
  });
});

describe('metin kuralları ve erişilebilirlik', () => {
  it('hiçbir bileşen ünlem ya da emoji üretmez; her düğmenin adı var; her görselin alt metni var', () => {
    const { container } = render(
      <div>
        <Button variant="reward">Rozeti al</Button>
        <ModeToggle />
        <Notice tone="warning" title="Onay bekliyor">
          Rapor onay sonrası işlenir.
        </Notice>
        <Notice tone="handoff">Hocana ilettim.</Notice>
        <TutorMessage typing />
        <MasteryMeter skill="Kesirler" p={0.5} evidence={1} />
        <LessonCard title="Ders" subject="MATEMATİK" ai progress={50} status="in-progress" />
        <QuizOption letter="A" state="incorrect" feedback="Paylar ve paydalar ayrı ayrı toplanmaz.">
          x
        </QuizOption>
        <ExamPriorityRow rank={1} topic="Konu" hits={2} years={5} />
        <CameraSheet onSubmit={() => undefined} onCancel={() => undefined} />
        <FigureFrame src="/s.svg" alt="Şekil" status="verified" />
        <AlertRow kind="silent" severity="warning" student="Mert A." />
        <StatTile label="Sayı" value="3" />
      </div>,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('!');
    expect(text).not.toMatch(/\p{Extended_Pictographic}(?<![★✓✕·])/u);
    for (const b of container.querySelectorAll('button')) {
      expect((b.textContent ?? '').trim() || b.getAttribute('aria-label')).toBeTruthy();
    }
    for (const img of container.querySelectorAll('img')) expect(img).toHaveAttribute('alt');
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg.getAttribute('aria-hidden') === 'true' || svg.closest('[aria-hidden="true"]')).toBeTruthy();
    }
  });
  it('fireEvent ile odak: odaklanabilir denetimler klavyeyle erişilebilir', () => {
    render(<Button>Tamam</Button>);
    const b = screen.getByRole('button');
    fireEvent.focus(b);
    b.focus();
    expect(b).toHaveFocus();
    expect(b.className).toContain('focus-visible:shadow-focus-ring');
  });
});
