'use client';

// Tasarım sistemi giriş noktası (tek yer). @ogrenmen/design-system dosyalarında 'use client' yönergesi yoktur ve
// bazıları (ModeToggle, CameraSheet, Timer, ...) kanca kullanır; bu yüzden paket sunucu bileşeninden doğrudan içe
// aktarılamaz. Bu dosya istemci sınırıdır: sunucu bileşenleri buradan bileşen çizebilir (serileştirilebilir
// özelliklerle), işlev prop'u gereken yerlerde (renderLink, onClick) sarmalayıcı istemci bileşeni yazılır.
// Paket 'use client' yönergelerini kazanınca bu dosya düz `export * from '@ogrenmen/design-system'` olabilir.
// test/ds-barrel.test.ts bu listenin paketin dışa aktarımlarıyla eşleştiğini denetler.

export {
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
  DEFAULT_MIN_EVIDENCE,
  DocumentViewer,
  ERROR_CAUSE_LABELS,
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
  NO_EVIDENCE_TEXT,
  Notice,
  OutcomeHeatmap,
  ProgressBar,
  QuizOption,
  ReportChart,
  StatTile,
  StepLadder,
  TextField,
  Tex,
  Timer,
  Tree,
  TreeNode,
  TUTOR_MODES,
  TutorMessage,
  TUTOR_MODE_CONFIRMATIONS,
  VIZ_SLOTS,
  buttonClasses,
  cn,
  formatClock,
  formatDelta,
  formatDurationWords,
  formatNumber,
  formatPercent,
  heatStep,
  initialsOf,
  masteryDisplay,
  renderMath,
  renderMathML,
  splitMath,
  useCountdown,
  vizColor,
} from '@ogrenmen/design-system';

export type * from '@ogrenmen/design-system';
