import type * as React from 'react';

/** easy işareti + "Öğrenmen" kelime markası. markSrc: açık zeminde mor işaret, koyu zeminde beyaz işaret. */
export interface BrandLockupProps { markSrc?: string; size?: 'sm' | 'md' | 'lg'; endorsement?: boolean; className?: string }
export declare function BrandLockup(props: BrandLockupProps): React.ReactElement;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'reward';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  block?: boolean;
}
export declare function Button(props: ButtonProps): React.ReactElement;

export interface BadgeProps { tone?: 'neutral' | 'primary' | 'gold' | 'success' | 'warning' | 'danger' | 'ai' | 'brand'; children?: React.ReactNode; className?: string }
export declare function Badge(props: BadgeProps): React.ReactElement;

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; hint?: string; error?: string; mono?: boolean }
export declare function TextField(props: TextFieldProps): React.ReactElement;

export interface ProgressBarProps { value: number; max?: number; label?: string; valueText?: string; showValue?: boolean; tone?: 'primary' | 'gold'; className?: string }
export declare function ProgressBar(props: ProgressBarProps): React.ReactElement;

/** Yanıt modu: Sokratik (varsayılan, ipucuyla) ya da doğrudan cevap. */
export interface ModeToggleProps { value?: 'socratic' | 'direct'; onChange?: (mode: 'socratic' | 'direct') => void; compact?: boolean; disabled?: boolean; label?: string; className?: string }
export declare function ModeToggle(props: ModeToggleProps): React.ReactElement;

/** info: bilgi · warning: dikkat · legal: KVKK / kayıt bildirimi · handoff: soru insana (hocaya) yönlendirildi. */
export interface NoticeProps { tone?: 'info' | 'warning' | 'legal' | 'handoff'; title?: string; action?: React.ReactNode; children?: React.ReactNode; className?: string }
export declare function Notice(props: NoticeProps): React.ReactElement;

/** Eğitmen panelinde tek bir sayı. statusText verilirse durum kelimeyle yazılır; renk tek başına anlam taşımaz. */
export interface StatTileProps { label: string; value: React.ReactNode; unit?: string; hint?: string; status?: 'neutral' | 'success' | 'warning' | 'danger'; statusText?: string; className?: string }
export declare function StatTile(props: StatTileProps): React.ReactElement;

/** Kazanım başına ustalık olasılığı p (0–1). evidence < minEvidence ise yüzde gösterilmez: "Henüz yeterli kanıt yok". */
export interface MasteryMeterProps { skill: string; p?: number; evidence?: number; minEvidence?: number; delta?: number; deltaLabel?: string; period?: string; className?: string }
export declare function MasteryMeter(props: MasteryMeterProps): React.ReactElement;

/** Alıntı + kaynak (ders kaydı zaman damgası, soru numarası, sohbet mesajı). */
export interface EvidenceQuoteProps { kind?: 'lesson' | 'quiz' | 'chat' | 'instructor'; source?: string; href?: string; children?: React.ReactNode; className?: string }
export declare function EvidenceQuote(props: EvidenceQuoteProps): React.ReactElement;

export interface EvidenceRef { quote: React.ReactNode; kind?: EvidenceQuoteProps['kind']; source?: string; href?: string }
/** Kavram yanılgısı: çözülene kadar "Açık"; en az bir kanıt taşır. */
export interface MisconceptionItemProps { text: string; skill?: string; evidence?: EvidenceRef[]; firstSeen?: string; resolved?: boolean; resolvedAt?: string; children?: React.ReactNode; className?: string }
export declare function MisconceptionItem(props: MisconceptionItemProps): React.ReactElement;

export interface LessonCardProps {
  title: string; subject?: string; meta?: string; progress?: number;
  status?: 'not-started' | 'in-progress' | 'done'; ai?: boolean;
  href?: string; onClick?: () => void; className?: string;
}
export declare function LessonCard(props: LessonCardProps): React.ReactElement;

/** Koddan üretilmiş şekil (PNG/SVG). alt zorunlu say; status denetim durumunu kelimeyle gösterir. */
export interface FigureFrameProps { src: string; alt: string; caption?: string; source?: string; status?: 'verified' | 'pending' | 'failed'; width?: number | string; imgWidth?: number; imgHeight?: number; className?: string }
export declare function FigureFrame(props: FigureFrameProps): React.ReactElement;

export interface QuizOptionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { letter?: string; state?: 'idle' | 'selected' | 'correct' | 'incorrect'; feedback?: React.ReactNode }
export declare function QuizOption(props: QuizOptionProps): React.ReactElement;

/** Eğitmen denetim satırı: her bot cevabı model, maliyet ve kullandığı hafıza olgusu sayısıyla kaydedilir. */
export interface TutorReview { model?: string; cost?: string; memory?: number; flagged?: boolean; onFlag?: () => void }
export interface TutorMessageProps { from?: 'tutor' | 'student'; name?: string; avatarSrc?: string; typing?: boolean; actions?: React.ReactNode; review?: TutorReview; children?: React.ReactNode; className?: string }
export declare function TutorMessage(props: TutorMessageProps): React.ReactElement;

/** verified=false: DOI Crossref'te çözümlenmedi; öğrenciye gösterilmez, incelemede "kaldırılacak" diye işaretlenir. */
export interface CitationCardProps { title: string; authors?: string; venue?: string; year?: string | number; doi?: string; verified?: boolean; tldr?: string; pdfUrl?: string; actions?: React.ReactNode; className?: string }
export declare function CitationCard(props: CitationCardProps): React.ReactElement;

/** Sıklık analizine göre öncelik satırı: kaç yılın kaçında çıktı, tahmini puan, kanıt. "Tahmin" denmez. */
export interface ExamPriorityRowProps { rank: number | string; topic: string; kind?: string; hits: number; years?: number; points?: string; evidence?: string; href?: string; className?: string }
export declare function ExamPriorityRow(props: ExamPriorityRowProps): React.ReactElement;

/** Eğitmen takip paneli satırı. severity kelimeyle yazılır: Acil / Dikkat / Bilgi. */
export interface AlertRowProps { kind: 'unanswered' | 'silent' | 'morale' | 'deadline' | 'response' | string; severity?: 'danger' | 'warning' | 'neutral'; student: string; detail?: string; since?: string; action?: React.ReactNode; className?: string }
export declare function AlertRow(props: AlertRowProps): React.ReactElement;

declare global {
  interface Window {
    Ogrenmen: {
      BrandLockup: typeof BrandLockup; Button: typeof Button; Badge: typeof Badge; TextField: typeof TextField; ProgressBar: typeof ProgressBar;
      ModeToggle: typeof ModeToggle; Notice: typeof Notice; StatTile: typeof StatTile; MasteryMeter: typeof MasteryMeter; EvidenceQuote: typeof EvidenceQuote;
      MisconceptionItem: typeof MisconceptionItem; LessonCard: typeof LessonCard; FigureFrame: typeof FigureFrame; QuizOption: typeof QuizOption;
      TutorMessage: typeof TutorMessage; CitationCard: typeof CitationCard; ExamPriorityRow: typeof ExamPriorityRow; AlertRow: typeof AlertRow;
    };
  }
}
