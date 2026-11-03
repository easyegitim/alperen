// @ogrenmen/design-system: kaynak olarak paylaşılır (apps/web transpilePackages kullanır).
// Stiller ayrı içe aktarılır: "@ogrenmen/design-system/styles/tokens.css", theme.css, base.css (+ matematik için katex.css).

export { cn } from './lib/cn';
export { formatClock, formatDelta, formatDurationWords, formatNumber, formatPercent } from './lib/format';
export { ERROR_CAUSE_LABELS, TUTOR_MODES, TUTOR_MODE_CONFIRMATIONS } from './lib/labels';
export type { ErrorCause, TutorMode } from './lib/labels';

export { MathText, Tex, renderMath, renderMathML, splitMath } from './math';
export type { MathSegment, MathTextProps, RenderMathOptions, TexProps } from './math';

export { AlertRow } from './components/AlertRow';
export type { AlertKind, AlertRowProps, AlertSeverity } from './components/AlertRow';
export { AnswerGrid } from './components/AnswerGrid';
export type { AnswerGridItem, AnswerGridProps, AnswerStatus } from './components/AnswerGrid';
export { AppShell } from './components/AppShell';
export type { AppNavItem, AppShellFab, AppShellProps, NavLinkProps } from './components/AppShell';
export { BigStart } from './components/BigStart';
export type { BigStartProps } from './components/BigStart';
export { OneLineResult } from './components/OneLineResult';
export type { OneLineResultProps } from './components/OneLineResult';
export { PdfViewer } from './components/PdfViewer';
export type { PdfViewerProps } from './components/PdfViewer';
export { ProgressStrip } from './components/ProgressStrip';
export type { ProgressStripProps, StripStatus } from './components/ProgressStrip';
export { SUGGESTION_ACTION_LABELS, SUGGESTION_KIND_LABELS, SuggestionCard } from './components/SuggestionCard';
export type { SuggestionCardProps, SuggestionKind } from './components/SuggestionCard';
export { UPLOAD_OPTIONS, UploadSheet } from './components/UploadSheet';
export type { UploadKind, UploadSheetProps, UploadSheetResult } from './components/UploadSheet';
export { Avatar, initialsOf } from './components/Avatar';
export type { AvatarProps, AvatarSize, AvatarVariant } from './components/Avatar';
export { Badge } from './components/Badge';
export type { BadgeProps, BadgeTone } from './components/Badge';
export { BrandLockup } from './components/BrandLockup';
export type { BrandLockupProps, BrandLockupSize } from './components/BrandLockup';
export { Button, buttonClasses } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonStyleOptions, ButtonVariant } from './components/Button';
export { CameraSheet } from './components/CameraSheet';
export type { CameraSheetProps, CameraSheetResult, CapturedItem, Rotation } from './components/CameraSheet';
export { CitationCard } from './components/CitationCard';
export type { CitationCardProps } from './components/CitationCard';
export { Cover } from './components/Cover';
export type { CoverProps } from './components/Cover';
export { DocumentViewer } from './components/DocumentViewer';
export type { DocumentViewerProps } from './components/DocumentViewer';
export { EvidenceQuote } from './components/EvidenceQuote';
export type { EvidenceKind, EvidenceQuoteProps } from './components/EvidenceQuote';
export { ExamPlayer } from './components/ExamPlayer';
export type { ExamPlayerProps } from './components/ExamPlayer';
export { ExamPriorityList, ExamPriorityRow } from './components/ExamPriorityRow';
export type { ExamPriorityListProps, ExamPriorityRowProps } from './components/ExamPriorityRow';
export { FigureFrame } from './components/FigureFrame';
export type { FigureFrameProps, FigureStatus } from './components/FigureFrame';
export { LessonCard } from './components/LessonCard';
export type { LessonCardProps, LessonStatus } from './components/LessonCard';
export {
  DEFAULT_MIN_EVIDENCE,
  MASTERY_BAND_THRESHOLDS,
  MasteryMeter,
  NO_EVIDENCE_TEXT,
  masteryBand,
  masteryDisplay,
} from './components/MasteryMeter';
export type { MasteryBand, MasteryDisplay, MasteryFormat, MasteryMeterProps } from './components/MasteryMeter';
export { MemoryFileCard } from './components/MemoryFileCard';
export type { MemoryFileCardProps } from './components/MemoryFileCard';
export { MisconceptionItem } from './components/MisconceptionItem';
export type { EvidenceRef, MisconceptionItemProps } from './components/MisconceptionItem';
export { ModeToggle } from './components/ModeToggle';
export type { ModeToggleProps } from './components/ModeToggle';
export { Notice } from './components/Notice';
export type { NoticeProps, NoticeTone } from './components/Notice';
export { OutcomeHeatmap, heatStep } from './components/OutcomeHeatmap';
export type { HeatmapCell, HeatmapRow, OutcomeHeatmapProps } from './components/OutcomeHeatmap';
export { ProgressBar } from './components/ProgressBar';
export type { ProgressBarProps } from './components/ProgressBar';
export { QuizOption } from './components/QuizOption';
export type { QuizOptionProps, QuizOptionState } from './components/QuizOption';
export { ReportChart, VIZ_SLOTS, vizColor } from './components/ReportChart';
export type { ReportChartProps, ReportDatum, ReportSeries } from './components/ReportChart';
export { StatTile } from './components/StatTile';
export type { StatStatus, StatTileProps } from './components/StatTile';
export { StepLadder } from './components/StepLadder';
export type { LadderStep, StepLadderProps } from './components/StepLadder';
export { TextField } from './components/TextField';
export type { TextFieldProps } from './components/TextField';
export { Timer, useCountdown } from './components/Timer';
export type { TimerProps, UseCountdownOptions } from './components/Timer';
export { Tree, TreeNode } from './components/TreeNode';
export type { TreeNodeProps } from './components/TreeNode';
export { TutorMessage } from './components/TutorMessage';
export type { TutorMessageProps, TutorReview } from './components/TutorMessage';
