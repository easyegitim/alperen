import { useState } from 'react';
import type { ReactNode } from 'react';
import { BookOpen, Brain, Camera, ClipboardList, House, MessageCircle, Network, User } from 'lucide-react';
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
  Cover,
  DocumentViewer,
  EvidenceQuote,
  ExamPlayer,
  ExamPriorityList,
  ExamPriorityRow,
  FigureFrame,
  LessonCard,
  MasteryMeter,
  MathText,
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
  type AnswerGridItem,
  type QuizOptionState,
  type TutorMode,
} from '../src';
import mascot from '../assets/Maskot/ogrenmen-maskot.webp';
import markPurple from '../assets/Logolar/easy-isaret-mor.png';
import markWhite from '../assets/Logolar/easy-isaret-beyaz.png';

const FIGURE = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140"><polygon points="20,120 220,120 120,20" fill="none" stroke="#051c60" stroke-width="3"/><text x="112" y="14" font-family="Lexend, sans-serif" font-size="14" fill="#0030a2">A</text><text x="6" y="134" font-family="Lexend, sans-serif" font-size="14" fill="#051c60">B</text><text x="222" y="134" font-family="Lexend, sans-serif" font-size="14" fill="#051c60">C</text></svg>',
)}`;

const HTML_DOC = `<h2>Kesirlerde toplama</h2><p>Paydaları eşitle: $\\frac{3}{4}+\\frac{1}{8}=\\frac{6}{8}+\\frac{1}{8}=\\frac{7}{8}$.</p><p>Ayrı satırda:</p><p>$$\\frac{a}{b}+\\frac{c}{d}=\\frac{ad+bc}{bd}$$</p>`;

const trend = [
  { hafta: '1. hf', net: 18.5, hedef: 22 },
  { hafta: '2. hf', net: 21, hedef: 22 },
  { hafta: '3. hf', net: 19.75, hedef: 22 },
  { hafta: '4. hf', net: 25.5, hedef: 22 },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-4">
      <h2 className="text-title-2 m-0 border-b border-line pb-2">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [mode, setMode] = useState<TutorMode>('hint');
  const [opt, setOpt] = useState<QuizOptionState[]>(['idle', 'selected', 'correct', 'incorrect']);
  const [current, setCurrent] = useState(3);
  const [questions, setQuestions] = useState<AnswerGridItem[]>(
    Array.from({ length: 20 }, (_, i) => ({ no: i + 1, status: i < 2 ? 'answered' : i === 4 ? 'flagged' : 'blank' })),
  );

  return (
    <div data-theme={theme} className="min-h-screen bg-surface text-ink">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-raised px-6 py-3">
        <BrandLockup size="sm" endorsement={false} markSrc={theme === 'dark' ? markWhite : markPurple} />
        <nav aria-label="Bölümler" className="text-small flex flex-wrap gap-3">
          {['temel', 'ogrenci', 'profil', 'yeni', 'egitmen', 'kabuk'].map((id) => (
            <a key={id} href={`#${id}`} className="text-primary">
              {id}
            </a>
          ))}
        </nav>
        <Button variant="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? 'Açık tema' : 'Koyu tema'}
        </Button>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-8">
        <Cover />

        <Section id="temel" title="Temel">
          <Button variant="primary">Derse başla</Button>
          <Button>İpucu al</Button>
          <Button variant="quiet">Atla</Button>
          <Button variant="reward">Rozeti al</Button>
          <Button variant="primary" disabled>
            Gönder
          </Button>
          <Badge>12 dk · 8 soru</Badge>
          <Badge tone="primary">Matematik</Badge>
          <Badge tone="gold">★ 7 gün seri</Badge>
          <Badge tone="success">✓ Doğru</Badge>
          <Badge tone="warning">Onay bekliyor</Badge>
          <Badge tone="danger">✕ Tekrar dene</Badge>
          <Badge tone="ai">ai</Badge>
          <Badge tone="brand">by easy</Badge>
          <TextField label="Cevabın" hint="Örn. 7/8" mono placeholder="7/8" />
          <TextField label="Cevabın" error="Sadeleştirmeyi unuttun." mono defaultValue="6/8" />
          <ProgressBar label="Ünite 3" value={62} />
          <ProgressBar label="Haftalık hedef" value={5} max={5} valueText="5/5 ders" tone="gold" />
          <Notice tone="info" title="Mod değişti" onDismiss={() => undefined}>
            Bu soruda çözümü doğrudan göstereceğim.
          </Notice>
          <Notice tone="warning" title="Onay bekliyor">
            Rapor eğitmen onayından sonra profiline işlenir.
          </Notice>
          <Notice tone="legal" title="Kayıt bildirimi">
            Bu gruptaki mesajlar kaydedilir ve 90 gün sonra silinir.
          </Notice>
          <Notice tone="handoff">Notlar hakkında konuşamam; sorunu Elif hocana ilettim.</Notice>
          <Avatar name="AI öğretmen" src={mascot} size="lg" ai />
          <Avatar name="Elif Kaya" size="lg" />
        </Section>

        <Section id="ogrenci" title="Öğrenci">
          <div className="flex w-full max-w-xl flex-col gap-3">
            <ModeToggle value={mode} onChange={setMode} />
            <TutorMessage avatarSrc={mascot}>
              Paydaları eşitlemek için 4 ile 8'in ortak katına ihtiyacın var. Sence en küçük ortak kat kaç?
            </TutorMessage>
            <TutorMessage from="student">
              <MathText>{'$\\frac{3}{4}+\\frac{1}{8}$ için 8 olabilir mi?'}</MathText>
            </TutorMessage>
            <TutorMessage avatarSrc={mascot} typing />
            <TutorMessage avatarSrc={mascot} review={{ model: 'Sonnet 5.5', cost: '0,002 $', memory: 3, onFlag: () => undefined }}>
              Evet, 8 olur. Şimdi payları ne yapacaksın?
            </TutorMessage>
          </div>
          <LessonCard title="Payda eşitleme" subject="MATEMATİK" meta="12 dk · 8 soru" progress={40} status="in-progress" href="#ogrenci" />
          <LessonCard title="Oran ve orantı" subject="MATEMATİK" meta="9 dk · 6 soru" progress={100} status="done" ai />
          <div className="flex w-full max-w-lg flex-col gap-3">
            <h3 className="text-title-3 m-0">Hangisi 3/4 + 1/8 toplamına eşittir?</h3>
            {(['5/8', '7/8', '4/12', '1'] as const).map((t, i) => (
              <QuizOption
                key={t}
                letter={'ABCD'[i]}
                state={opt[i]}
                feedback={opt[i] === 'correct' ? 'Paydaları 8 yapınca 6/8 + 1/8 = 7/8.' : opt[i] === 'incorrect' ? 'Paylar ve paydalar ayrı ayrı toplanmaz.' : undefined}
                onClick={() => setOpt(opt.map((_, j) => (j === i ? 'selected' : 'idle')))}
              >
                {t}
              </QuizOption>
            ))}
          </div>
          <FigureFrame src={FIGURE} alt="ABC üçgeni: A tepede, B sol altta, C sağ altta" caption="Şekil 1" status="verified" imgWidth={240} imgHeight={140} />
          <FigureFrame src={FIGURE} alt="ABC üçgeni" caption="Şekil 2" source="Matplotlib" status="pending" imgWidth={240} imgHeight={140} />
          <ExamPriorityList className="w-full max-w-2xl">
            <ExamPriorityRow rank={1} topic="Üçgende açı" kind="hesap" hits={4} years={5} points="≈20 puan" evidence="Kanıt: 4 sınav" href="#" />
            <ExamPriorityRow rank={2} topic="Çarpanlara ayırma" kind="çoktan seçmeli" hits={3} years={5} points="≈12 puan" evidence="Kanıt: 3 sınav" />
          </ExamPriorityList>
          <StepLadder
            className="w-full"
            cause="procedure"
            failingStepNo={2}
            studentSteps={[
              { no: 1, text: '$\\frac{3}{4}+\\frac{1}{8}$ ifadesini yazdım' },
              { no: 2, text: '$\\frac{3+1}{4+8}=\\frac{4}{12}$', note: 'Paylar ve paydalar ayrı toplandı' },
              { no: 3, text: '$\\frac{1}{3}$' },
            ]}
            expectedSteps={[
              { no: 1, text: '$\\frac{3}{4}+\\frac{1}{8}$' },
              { no: 2, text: '$\\frac{6}{8}+\\frac{1}{8}$' },
              { no: 3, text: '$\\frac{7}{8}$' },
            ]}
          />
          <CameraSheet onSubmit={() => undefined} onCancel={() => undefined} />
        </Section>

        <Section id="profil" title="Profil">
          <div className="flex w-full max-w-md flex-col gap-4">
            <MasteryMeter skill="Kesirlerde toplama" p={0.72} evidence={8} delta={0.08} deltaLabel="bu hafta" period="LGS 2026" />
            <MasteryMeter skill="Üslü ifadeler" p={0.9} evidence={2} />
            <MasteryMeter skill="Oran ve orantı" />
          </div>
          <MisconceptionItem
            text="Paylar ve paydalar ayrı ayrı toplanıyor."
            skill="KESİRLER"
            firstSeen="12 Eki"
            evidence={[{ quote: '"3 artı 1 dört, 4 artı 8 on iki."', kind: 'lesson', source: 'Ders 12 · 14:32' }]}
          />
          <EvidenceQuote kind="quiz" source="Deneme 3 · Soru 8">
            "Paydaları eşitlemeyi atladım."
          </EvidenceQuote>
          <CitationCard
            title="Mastery learning and worked examples"
            authors="Yılmaz, A.; Demir, B."
            venue="Eğitim Bilimleri Dergisi"
            year={2022}
            doi="10.1000/xyz123"
            verified
            tldr="Çözülmüş örnekler yeni konuda başarıyı artırır."
          />
          <OutcomeHeatmap
            className="w-full max-w-2xl"
            columns={['Deneme 1', 'Deneme 2', 'Deneme 3']}
            rows={[
              { id: 'a', label: 'Kesirler', cells: [{ value: 0.3, n: 5 }, { value: 0.55, n: 6 }, { value: 0.8, n: 5 }] },
              { id: 'b', label: 'Üslü ifadeler', cells: [{ value: 0.9, n: 4 }, { value: null }, { value: 0.65, n: 4 }] },
              { id: 'c', label: 'Üçgenler', cells: [{ value: 0.1, n: 6 }, { value: 0.2, n: 6 }, { value: 0.45, n: 5 }] },
            ]}
          />
          <div className="w-full max-w-xl">
            <Tree aria-label="Konu haritası">
              <TreeNode label="Matematik" defaultExpanded p={0.6} evidence={30}>
                <TreeNode label="Sayılar" level={2} defaultExpanded p={0.72} evidence={12} styleCount={3}>
                  <TreeNode label="Kesirler" level={3} p={0.4} evidence={3} prerequisiteHint="Ön koşul: Bölme" />
                </TreeNode>
                <TreeNode label="Geometri" level={2} p={0.5} evidence={8} />
              </TreeNode>
            </Tree>
          </div>
          <MemoryFileCard
            path="/memories/ogrenme-tarzi.md"
            title="Nasıl öğreniyorsun"
            content={'Görsel örneklerle daha hızlı kavrıyor.\nİşlem hatalarını acele edince yapıyor.'}
            updatedAt="19 Eki 14:32"
            bytes={96}
            onRequestCorrection={() => undefined}
          />
        </Section>

        <Section id="yeni" title="Belge, sınav, grafik">
          <div className="w-full">
            <DocumentViewer title="Kesirlerde toplama" html={HTML_DOC} personalized pdfHref="#" actions={<Button variant="primary">Çöz</Button>} />
          </div>
          <div className="w-full">
            <ExamPlayer
              title="Deneme 3"
              remainingSec={4 * 60 + 12}
              questions={questions}
              current={current}
              onNavigate={setCurrent}
              onToggleFlag={(no) =>
                setQuestions(questions.map((q) => (q.no === no ? { ...q, status: q.status === 'flagged' ? 'blank' : 'flagged' } : q)))
              }
              onFinish={() => undefined}
            >
              <h3 className="text-title-3 m-0">Soru {current}</h3>
              <p className="m-0">
                <MathText>{'$x^2-5x+6=0$ denkleminin kökler toplamı kaçtır?'}</MathText>
              </p>
            </ExamPlayer>
          </div>
          <Timer remainingSec={900} />
          <AnswerGrid questions={questions} current={current} onSelect={setCurrent} className="w-80" />
          <ReportChart
            className="w-full max-w-2xl"
            title="Haftalık net"
            data={trend}
            xKey="hafta"
            series={[{ key: 'net', name: 'Net' }]}
            caption="Son dört deneme."
          />
          <ReportChart
            className="w-full max-w-2xl"
            kind="bar"
            title="Net ve hedef"
            data={trend}
            xKey="hafta"
            series={[
              { key: 'net', name: 'Net' },
              { key: 'hedef', name: 'Hedef' },
            ]}
          />
        </Section>

        <Section id="egitmen" title="Eğitmen">
          <StatTile label="Cevapsız soru" value="3" status="danger" statusText="Acil" hint="en eskisi 14 saat" />
          <StatTile label="Ortalama yanıt süresi" value="1,4" unit="saat" status="success" statusText="Hedefte" hint="hedef 2 saat" />
          <StatTile label="Yaklaşan teslim" value="5" />
          <div className="flex w-full max-w-2xl flex-col gap-3">
            <AlertRow kind="unanswered" severity="danger" student="Elif K." detail={'"Payda eşitlemeyi anlamadım"'} since="14 saattir cevapsız" action={<Button size="sm">Cevapla</Button>} />
            <AlertRow kind="silent" severity="warning" student="Mert A." since="4 gündür sessiz" action={<Button size="sm">Mesaj gönder</Button>} />
            <AlertRow kind="deadline" student="Zeynep T." detail="Deneme 4 teslimi yarın" />
          </div>
        </Section>

        <Section id="kabuk" title="Kabuk (mobilde alt gezinme, masaüstünde kenar çubuğu)">
          <div className="h-[560px] w-full overflow-auto rounded-lg border border-line">
            <AppShell
              className="min-h-0"
              brand={<BrandLockup size="sm" endorsement={false} markSrc={theme === 'dark' ? markWhite : markPurple} />}
              items={[
                { id: 'kos', label: 'Koç', href: '#kabul', icon: <MessageCircle size={20} />, active: true },
                { id: 'den', label: 'Denemeler', href: '#kabul', icon: <ClipboardList size={20} /> },
                { id: 'not', label: 'Notlarım', href: '#kabul', icon: <BookOpen size={20} /> },
                { id: 'har', label: 'Konu haritası', href: '#kabul', icon: <Network size={20} /> },
                { id: 'ana', label: 'Ana sayfa', href: '#kabul', icon: <House size={20} /> },
                { id: 'pro', label: 'Profil', href: '#kabul', icon: <User size={20} /> },
              ]}
              fab={{ label: 'Sor', icon: <Camera size={22} />, onClick: () => undefined }}
              footer={<span className="text-small text-ink-muted"><Brain aria-hidden="true" size={16} className="mr-1 inline" />AI öğretmen</span>}
            >
              <p className="m-0">Sayfa içeriği burada durur.</p>
            </AppShell>
          </div>
        </Section>
      </main>
    </div>
  );
}
