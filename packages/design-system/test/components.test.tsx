import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  AlertRow,
  AnswerGrid,
  AppShell,
  Avatar,
  BigStart,
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
  OneLineResult,
  OutcomeHeatmap,
  ProgressBar,
  ProgressStrip,
  QuizOption,
  ReportChart,
  StatTile,
  StepLadder,
  SUGGESTION_KIND_LABELS,
  SuggestionCard,
  TextField,
  Timer,
  Tree,
  TreeNode,
  TutorMessage,
  UploadSheet,
  buttonClasses,
  cn,
  heatStep,
  initialsOf,
  MASTERY_BAND_THRESHOLDS,
  masteryBand,
  masteryDisplay,
  useCountdown,
  type SuggestionKind,
  type TutorMode,
  type UploadSheetResult,
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
  it('uyarı varsayılan role=note, live ile alert; handoff varsayılan başlık; info kapatılabilir', async () => {
    const onDismiss = vi.fn();
    render(
      <>
        <Notice tone="warning" live title="Onay bekliyor">
          Rapor onay sonrası işlenir.
        </Notice>
        <Notice tone="warning" title="Statik uyarı">
          Sayfa açılırken vardı.
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
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByRole('note').some((n) => n.textContent?.includes('Statik uyarı'))).toBe(true);
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
    expect(masteryDisplay({ p: 0.724, evidence: 5, format: 'percent' })).toEqual({ enough: true, percent: 72, band: 'Orta', text: '%72' });
    expect(masteryDisplay({ p: 0.724, evidence: 5 })).toEqual({ enough: true, percent: 72, band: 'Orta', text: 'Orta' });
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
  it('masteryBand eşikleri: <0,5 Zayıf, <0,8 Orta, >=0,8 İyi', () => {
    expect(MASTERY_BAND_THRESHOLDS).toEqual({ weak: 0.5, good: 0.8 });
    expect([0, 0.49, 0.5, 0.79, 0.8, 1].map(masteryBand)).toEqual(['Zayıf', 'Zayıf', 'Orta', 'Orta', 'İyi', 'İyi']);
  });
  it('bant kipinde (varsayılan) hiçbir yerde % karakteri geçmez; kanıt eşiği aynı kalır', () => {
    const { container } = render(
      <>
        <MasteryMeter skill="Kesirler" p={0.72} evidence={8} delta={-0.03} deltaLabel="bu hafta" />
        <MasteryMeter skill="Oran" p={0.9} evidence={2} />
        <Tree>
          <TreeNode label="Geometri" p={0.3} evidence={9} />
        </Tree>
      </>,
    );
    expect(container.textContent).not.toMatch(/%/);
    expect(screen.getByText('Orta')).toBeInTheDocument();
    expect(screen.getByText('Zayıf')).toBeInTheDocument();
    expect(screen.getByText('↓ Düşüyor')).toBeInTheDocument();
    expect(screen.getByText('Henüz yeterli kanıt yok')).toBeInTheDocument();
  });
  it('yeterli kanıtta yüzde kipi, meter rolü ve işaretli değişim', () => {
    render(<MasteryMeter skill="Kesirler" p={0.72} evidence={8} delta={-0.03} deltaLabel="bu hafta" period="LGS 2026" display="percent" />);
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
    render(<StepLadder studentSteps={student} expectedSteps={expected} failingStepNo={2} cause="procedure" collapsible={false} />);
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
    render(<StepLadder studentSteps={student} expectedSteps={expected} collapsible={false} />);
    const states = screen.getAllByRole('listitem').slice(0, 3).map((li) => li.getAttribute('data-state'));
    expect(states).toEqual(['ok', 'ok', 'ok']);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });
  it('adım metnindeki formül KaTeX ile çizilir', () => {
    const { container } = render(<StepLadder studentSteps={[{ no: 1, text: '$\\frac{3}{4}$' }]} expectedSteps={[]} collapsible={false} />);
    expect(container.querySelector('.katex')).not.toBeNull();
  });
});

describe('StepLadder katlanır', () => {
  const student = [
    { no: 1, text: 'Önce yazdım' },
    { no: 2, text: 'Paylar toplandı' },
  ];
  const expected = [
    { no: 1, text: 'Önce yaz' },
    { no: 2, text: 'Paydaları eşitle' },
  ];
  it('varsayılan kapalı: yalnız özet cümlesi ve bozulan adım; kazanımlar ve merdiven gizli', async () => {
    render(
      <StepLadder
        summary="Paydaları eşitlemeden payları topladın."
        studentSteps={student}
        expectedSteps={expected}
        failingStepNo={2}
        cause="procedure"
        skills={['Kesirler']}
      />,
    );
    expect(screen.getByText('Paydaları eşitlemeden payları topladın.')).toBeInTheDocument();
    expect(screen.getByTestId('failing-step')).toHaveTextContent('✕ 2. adımda bozuldu');
    expect(screen.queryByRole('list', { name: 'Kazanımlar' })).toBeNull();
    expect(screen.queryByText('İşlem hatası')).not.toBeVisible();
    const btn = screen.getByRole('button', { name: 'Detay' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn.getAttribute('aria-controls')).toBeTruthy();
    await userEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Kazanımlar' })).toBeVisible();
    expect(screen.getByText('İşlem hatası')).toBeVisible();
    expect(screen.getAllByRole('listitem').some((li) => li.getAttribute('data-state') === 'failing')).toBe(true);
  });
  it('collapsible=false ise Detay düğmesi yok, her şey açık', () => {
    render(<StepLadder studentSteps={student} expectedSteps={expected} collapsible={false} skills={['Kesirler']} />);
    expect(screen.queryByRole('button', { name: 'Detay' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Kazanımlar' })).toBeVisible();
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
    expect(screen.getByRole('button', { name: /7\/8/ })).toHaveAttribute('aria-disabled', 'true');
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
    const live = screen.getAllByRole('status');
    expect(live).toHaveLength(2);
    expect(live[0]).toBeEmptyDOMElement();
    expect(live[1]).toHaveTextContent('Öğretmen yazıyor');
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
        <TreeNode label="Matematik" p={0.6} evidence={30} display="percent">
          <TreeNode label="Kesirler" level={2} p={0.9} evidence={2} />
        </TreeNode>
      </Tree>,
    );
    expect(screen.queryByText('Kesirler')).not.toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Matematik alt konuları' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Kesirler')).toBeInTheDocument();
    expect(screen.getByText('Henüz yeterli kanıt yok')).toBeInTheDocument();
    expect(screen.getByText('%60')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Matematik alt konuları' }));
    expect(screen.getByText('Kesirler')).not.toBeVisible();
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
        mode="exam"
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
    render(<ExamPlayer mode="exam" title="D" current={1} onNavigate={() => undefined} questions={[{ no: 1, status: 'blank' }]} />);
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
    expect(toggle).not.toHaveAttribute('aria-pressed');
    const legend = screen.getByRole('list', { name: 'Seriler' });
    expect(within(legend).getByText('Net')).toBeInTheDocument();
    expect(within(legend).getByText('Hedef')).toBeInTheDocument();
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('18,5')).toBeInTheDocument();
    expect(table.parentElement).toHaveClass('sr-only');
    await userEvent.click(toggle);
    expect(table.parentElement).not.toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Grafik görünümü' })).not.toHaveAttribute('aria-pressed');
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
      <AppShell items={items} fab={{ label: 'Yükle', onClick: onFab }}>
        <p>İçerik</p>
      </AppShell>,
    );
    expect(screen.getAllByRole('navigation', { hidden: true })).toHaveLength(2);
    const current = screen.getAllByRole('link', { name: 'Koç', hidden: true });
    expect(current).toHaveLength(2);
    for (const a of current) expect(a).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toHaveTextContent('İçerik');
    const fabs = screen.getAllByRole('button', { name: 'Yükle', hidden: true });
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

describe('Denetim turu 1', () => {
  it('EvidenceQuote kaynaksızsa çizilmez; MisconceptionItem kaynaksız kanıtı saymaz', () => {
    const { container } = render(<EvidenceQuote>alıntı</EvidenceQuote>);
    expect(container).toBeEmptyDOMElement();
    const r = render(<MisconceptionItem text="Payları toplar" evidence={[{ quote: 'a' }]} />);
    expect(r.container).toBeEmptyDOMElement();
  });

  it('QuizOption idle aria-pressed=false; kilitli şık aria-disabled ve tıklanmaz', async () => {
    const onClick = vi.fn();
    render(
      <>
        <QuizOption letter="A">bir</QuizOption>
        <QuizOption letter="B" state="correct" onClick={onClick} feedback="Doğru çünkü">
          iki
        </QuizOption>
      </>,
    );
    expect(screen.getByRole('button', { name: /^A/ })).toHaveAttribute('aria-pressed', 'false');
    const locked = screen.getByRole('button', { name: /^B/ });
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(locked);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('ExamPlayer içinde main landmark yok; başlık düzeyi ayarlanır', () => {
    render(<ExamPlayer title="Deneme" questions={[{ no: 1, status: 'blank' }]} current={1} onNavigate={() => {}} />);
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Deneme' })).toBeInTheDocument();
  });

  it('AppShell: içeriğe geç bağlantısı ve FAB renderLink kullanır', () => {
    const rl = vi.fn(({ children, ...p }: { children?: React.ReactNode; href: string }) => (
      <a data-rl="1" {...p}>
        {children}
      </a>
    ));
    render(
      <AppShell items={[{ id: 'a', label: 'Koç', href: '/koc' }]} fab={{ label: 'Yükle', href: '/sor' }} renderLink={rl}>
        x
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'İçeriğe geç' })).toHaveAttribute('href', '#icerik');
    expect(rl.mock.calls.some(([p]) => p.href === '/sor')).toBe(true);
  });

  it('StepLadder kazanım çiplerini ve eylemleri çizer', () => {
    render(
      <StepLadder studentSteps={[{ no: 1, text: 'a' }]} expectedSteps={[{ no: 1, text: 'a' }]} skills={['Kesirler']} collapsible={false} actions={<button>Benzer soru</button>} />,
    );
    expect(screen.getByText('Kesirler')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Benzer soru' })).toBeInTheDocument();
  });

  it('hook ya da olay işleyicisi kullanan bileşen dosyaları use client ile başlar', () => {
    const dir = join(__dirname, '../src/components');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (/\buse(State|Effect|Ref|Id|Memo|Callback|Reducer)\(|from 'recharts'/.test(src)) {
        expect(src.startsWith("'use client';"), f).toBe(true);
      }
    }
  });
});

describe('Plan §13 bileşenleri', () => {
  it('SuggestionCard her tür için etiket ve eylem taşır; onStart ve href', async () => {
    const onStart = vi.fn();
    const kinds = Object.keys(SUGGESTION_KIND_LABELS) as SuggestionKind[];
    expect(kinds).toEqual(['practice', 'weekly_homework', 'lesson_review', 'gap_analysis', 'mini_exam', 'document_ready', 'upload_result']);
    const { rerender } = render(<SuggestionCard kind="weekly_homework" title="Hocanın ödevi hazır" subtitle="Rasyonel sayılar" durationText="12 dk" onStart={onStart} />);
    expect(screen.getByText('Haftalık ödev')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Hocanın ödevi hazır' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Başla: Hocanın ödevi hazır' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    rerender(<SuggestionCard kind="document_ready" title="Rasyonel sayılar notun hazır" href="/belge/1" />);
    const link = screen.getByRole('link', { name: 'Aç: Rasyonel sayılar notun hazır' });
    expect(link).toHaveAttribute('href', '/belge/1');
    expect(link).toHaveClass('bg-surface-raised', 'hover:bg-primary-soft');
  });
  it('BigStart tek birincil Başla düğmesi taşır', async () => {
    const onStart = vi.fn();
    render(<BigStart title="Rasyonel sayılar" meta="8 soru · 12 dk" onStart={onStart} />);
    expect(screen.getByText('Bugün sana önerim')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rasyonel sayılar' })).toBeInTheDocument();
    const b = screen.getByRole('button', { name: 'Başla' });
    expect(b).toHaveClass('bg-primary');
    await userEvent.click(b);
    expect(onStart).toHaveBeenCalled();
  });
  it('OneLineResult: önce tek cümle; Detay çağrılır ya da içeriği açar', async () => {
    const onDetail = vi.fn();
    const { rerender } = render(<OneLineResult sentence="8 soruda 6 doğru." learned="Eksi dağıtırken işaret değişir." onDetail={onDetail} />);
    expect(screen.getByText('8 soruda 6 doğru.')).toBeInTheDocument();
    expect(screen.getByText(/Eksi dağıtırken/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Detay' }));
    expect(onDetail).toHaveBeenCalled();
    rerender(
      <OneLineResult sentence="8 soruda 6 doğru.">
        <p>Merdiven</p>
      </OneLineResult>,
    );
    expect(screen.getByText('Merdiven')).not.toBeVisible();
    const btn = screen.getByRole('button', { name: 'Detay' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    expect(screen.getByText('Merdiven')).toBeVisible();
    rerender(<OneLineResult sentence="Bitti." />);
    expect(screen.queryByRole('button', { name: 'Detay' })).toBeNull();
  });
  it('ProgressStrip noktalar gizli, sayılar kelimeyle', () => {
    const { container } = render(<ProgressStrip total={4} current={2} statuses={['answered', 'todo', 'flagged', 'todo']} />);
    expect(screen.getByText('Soru 2 / 4 · 1 soru cevaplandı')).toBeInTheDocument();
    const dots = container.querySelectorAll('[data-status]');
    expect(Array.from(dots).map((d) => d.getAttribute('data-status'))).toEqual(['answered', 'current', 'flagged', 'todo']);
    expect(dots[0]?.parentElement).toHaveAttribute('aria-hidden', 'true');
  });
  it('ExamPlayer sade akışta yalnız soru, noktalar ve Sonraki; deneme kipinde ızgara, Önceki, Bayrakla, Timer', async () => {
    const onNavigate = vi.fn();
    const qs = [
      { no: 1, status: 'answered' as const },
      { no: 2, status: 'blank' as const },
    ];
    const { rerender } = render(
      <ExamPlayer title="Alıştırma" remainingSec={600} current={1} onNavigate={onNavigate} onToggleFlag={() => undefined} questions={qs}>
        <p>Gövde</p>
      </ExamPlayer>,
    );
    expect(screen.getByText('Soru 1 / 2 · 1 soru cevaplandı')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Önceki' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bayrakla' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Sorular' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    expect(onNavigate).toHaveBeenCalledWith(2);
    const onFinish = vi.fn();
    rerender(
      <ExamPlayer title="Alıştırma" current={2} onNavigate={onNavigate} onFinish={onFinish} questions={qs}>
        <p>Gövde</p>
      </ExamPlayer>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Bitir' }));
    expect(onFinish).toHaveBeenCalled();
    rerender(
      <ExamPlayer mode="exam" title="Deneme" remainingSec={90} current={1} onNavigate={onNavigate} onToggleFlag={() => undefined} questions={qs} />,
    );
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bayrakla' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Sorular' })).toBeInTheDocument();
  });
  it('UploadSheet iki seçenek sunar; seçmeden CameraSheet gövdesi yok; Gönder kind ile döner', async () => {
    const onSubmit = vi.fn();
    render(<UploadSheet onSubmit={onSubmit} />);
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual(['own_work', 'school_exam']);
    expect(screen.queryByRole('button', { name: 'Gönder' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: /Okul denemesi/ }));
    expect(screen.queryByLabelText('Çözümüm de var')).toBeNull();
    const send = screen.getByRole('button', { name: 'Gönder' });
    expect(send).toBeDisabled();
    const file = new File(['x'], 'sayfa.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Dosya seçerek ekle'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Gönder' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]![0] as UploadSheetResult;
    expect(arg.kind).toBe('school_exam');
    expect(arg.items).toHaveLength(1);
    expect(arg.items[0]!.file).toBe(file);
  });
  it('ModeToggle varsayılanı sade (alt satır yok, title ile açıklama); compact=false alt satırı açar', () => {
    const { rerender } = render(<ModeToggle />);
    const r = screen.getByRole('radio', { name: 'İpucu' });
    expect(r).toHaveAttribute('title', 'Adım adım yönlendirir');
    expect(screen.queryByText('Adım adım yönlendirir')).toBeNull();
    rerender(<ModeToggle compact={false} />);
    expect(screen.getByText('Adım adım yönlendirir')).toBeInTheDocument();
  });
  it('Button bağlantıya uygulanınca hover sınıfı :enabled ister etmez', () => {
    render(
      <a href="/x" className={buttonClasses({ variant: 'primary' })}>
        Git
      </a>,
    );
    const cls = screen.getByRole('link', { name: 'Git' }).className;
    expect(cls).toContain('hover:bg-primary-strong');
    expect(cls).not.toContain('enabled:hover');
  });
  it('cn çakışan Tailwind sınıflarında çağıranı kazandırır; özel sınıf grupları karışmaz', () => {
    expect(cn('max-w-70', 'max-w-none')).toBe('max-w-none');
    expect(cn('max-w-160', 'max-w-full')).toBe('max-w-full');
    expect(cn('text-title-1 text-ink', 'text-primary')).toBe('text-title-1 text-primary');
    expect(cn('text-title-1', 'text-small')).toBe('text-small');
    expect(cn('shadow-ai', 'shadow-lg')).toBe('shadow-lg');
    expect(cn('focus-visible:shadow-focus-ring', 'shadow-sm')).toBe('focus-visible:shadow-focus-ring shadow-sm');
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
  it('LessonCard çağıranın genişliği varsayılanı ezer', () => {
    render(<LessonCard title="Ders" className="max-w-none" />);
    expect(screen.getByText('Ders').closest('article, a, button')?.className).not.toMatch(/max-w-70/);
  });
});

describe('PdfViewer', () => {
  const fakePage = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  it('pdf.js ile sayfa sayfa tuval çizer; tek İndir / Paylaş bağlantısı', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist', () => ({
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: async () => fakePage, destroy: () => undefined }) }),
    }));
    const { PdfViewer: Viewer } = await import('../src/components/PdfViewer');
    HTMLCanvasElement.prototype.getContext = (() => ({})) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    render(<Viewer src="/belge.pdf" title="Rasyonel sayılar notu" />);
    expect(screen.getByRole('status')).toHaveTextContent('Belge açılıyor');
    const pages = await screen.findAllByRole('img');
    expect(pages).toHaveLength(3);
    expect(pages[1]).toHaveAttribute('aria-label', 'Rasyonel sayılar notu, sayfa 2 / 3');
    const share = screen.getByRole('link', { name: 'İndir / Paylaş' });
    expect(share).toHaveAttribute('href', '/belge.pdf');
    expect(screen.getAllByText('İndir / Paylaş')).toHaveLength(1);
    vi.doUnmock('pdfjs-dist');
  });
  it('onShare verilirse tek düğme onu çağırır; yükleme hatasında alert ve indirme yine var', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist', () => ({
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.reject(new Error('bozuk')) }),
    }));
    const { PdfViewer: Viewer } = await import('../src/components/PdfViewer');
    const onShare = vi.fn();
    render(<Viewer src="/x.pdf" title="Rapor" onShare={onShare} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Belge açılamadı');
    await userEvent.click(screen.getByRole('button', { name: 'İndir / Paylaş' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    vi.doUnmock('pdfjs-dist');
  });
});
