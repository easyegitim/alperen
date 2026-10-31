'use client';
// Tasarım sistemi sarmalayıcıları (BLUEPRINT §7 madde 3, ADR-0008).
// `dsReady` sözü lib/ds-loader.tsx bundle.js'i yükleyince çözülür; o ana kadar her sarmalayıcı aria-busy iskelet döner.
// Bundle yüklenemezse (deploy'da public/ds/ yok, 404, CSP) ds-loader failDs() çağırır: sarmalayıcılar sade HTML yedeğine
// geçer — Button/TextField/Notice/Badge çalışır kalır (veli /onay'da "Onaylıyorum"u görebilir), diğerleri uyarı satırı.
// Hiçbir sayfa window.Ogrenmen'i doğrudan çağırmaz; bileşenler buradaki tipli sarmalayıcılarla, Next'in React örneğiyle render edilir.
import * as React from 'react';
import type * as DS from '../../../packages/design-system/components/index';

export type OgrenmenNamespace = Window['Ogrenmen'];

let current: OgrenmenNamespace | null = null;
let failed = false;
let resolveReady: (ns: OgrenmenNamespace) => void = () => undefined;
const listeners = new Set<() => void>();

export const dsReady: Promise<OgrenmenNamespace> = new Promise((resolve) => {
  resolveReady = resolve;
});

/** ds-loader `onload`'da çağırır. İkinci çağrı yok sayılır. */
export function resolveDs(ns: OgrenmenNamespace | undefined): void {
  if (current || !ns) return;
  current = ns;
  resolveReady(ns);
  for (const l of [...listeners]) l();
}

/** ds-loader `error`'da çağırır (bundle.js yüklenemedi). Yüklenmiş bir bundle'ı geri almaz. */
export function failDs(): void {
  if (current || failed) return;
  failed = true;
  for (const l of [...listeners]) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Çözülene kadar null. */
export function useDs(): OgrenmenNamespace | null {
  return React.useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

/** Bundle yüklenemedi mi. */
export function useDsFailed(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    () => failed,
    () => false,
  );
}

export const DS_FAILED_TEXT = 'Arayüz yüklenemedi; sayfayı yenile.';

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

/** Bundle yoksa kullanılan sade HTML karşılıkları (yalnız işlevi korumak için; görünüm temel CSS'ten). */
function fallback(name: string, props: AnyProps): React.ReactElement {
  switch (name) {
    case 'Button': {
      const { variant: _v, size: _s, icon: _i, block: _b, children, ...rest } = props;
      return (
        <button type="button" {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
          {children}
        </button>
      );
    }
    case 'TextField': {
      const { label, hint: _h, error, mono: _m, ...rest } = props;
      const id = (rest.id as string | undefined) ?? `tf-${String(label ?? '').replace(/\s+/g, '-')}`;
      return (
        <div className="field">
          {typeof label === 'string' && <label htmlFor={id}>{label}</label>}
          <input id={id} {...(rest as React.InputHTMLAttributes<HTMLInputElement>)} />
          {typeof error === 'string' && <span role="alert">{error}</span>}
        </div>
      );
    }
    case 'Notice':
      return (
        <div role="status" className="notice-fallback">
          {typeof props.title === 'string' && <strong>{props.title} </strong>}
          {props.children}
          {props.action as React.ReactNode}
        </div>
      );
    case 'Badge':
      return <span className="badge-fallback">{props.children}</span>;
    default:
      return (
        <p role="alert" data-ds-failed={name}>
          {DS_FAILED_TEXT}
        </p>
      );
  }
}

function wrap<K extends keyof OgrenmenNamespace>(name: K, inline = false): OgrenmenNamespace[K] {
  function Wrapped(props: Record<string, unknown>) {
    const ds = useDs();
    const dsFailed = useDsFailed();
    if (!ds && dsFailed) return fallback(String(name), props);
    if (!ds) {
      return inline
        ? <span aria-busy="true" className="ds-skeleton ds-skeleton-inline" data-ds-pending={name} />
        : <div aria-busy="true" className="ds-skeleton" data-ds-pending={name} />;
    }
    const Comp = ds[name] as unknown as React.ComponentType<Record<string, unknown>>;
    return <Comp {...props} />;
  }
  Wrapped.displayName = `Ds(${String(name)})`;
  return Wrapped as unknown as OgrenmenNamespace[K];
}

export const BrandLockup: typeof DS.BrandLockup = wrap('BrandLockup', true);
export const Button: typeof DS.Button = wrap('Button', true);
export const Badge: typeof DS.Badge = wrap('Badge', true);
export const TextField: typeof DS.TextField = wrap('TextField');
export const ProgressBar: typeof DS.ProgressBar = wrap('ProgressBar');
export const ModeToggle: typeof DS.ModeToggle = wrap('ModeToggle');
export const Notice: typeof DS.Notice = wrap('Notice');
export const StatTile: typeof DS.StatTile = wrap('StatTile');
export const MasteryMeter: typeof DS.MasteryMeter = wrap('MasteryMeter');
export const EvidenceQuote: typeof DS.EvidenceQuote = wrap('EvidenceQuote');
export const MisconceptionItem: typeof DS.MisconceptionItem = wrap('MisconceptionItem');
export const LessonCard: typeof DS.LessonCard = wrap('LessonCard');
export const FigureFrame: typeof DS.FigureFrame = wrap('FigureFrame');
export const QuizOption: typeof DS.QuizOption = wrap('QuizOption');
export const TutorMessage: typeof DS.TutorMessage = wrap('TutorMessage');
export const CitationCard: typeof DS.CitationCard = wrap('CitationCard');
export const ExamPriorityRow: typeof DS.ExamPriorityRow = wrap('ExamPriorityRow');
export const AlertRow: typeof DS.AlertRow = wrap('AlertRow');

export type {
  AlertRowProps,
  BadgeProps,
  ButtonProps,
  CitationCardProps,
  EvidenceRef,
  ExamPriorityRowProps,
  FigureFrameProps,
  MasteryMeterProps,
  NoticeProps,
  StatTileProps,
  TutorReview,
} from '../../../packages/design-system/components/index';

/** Yalnız testler: modül durumunu sıfırlamak yerine dosya başına izole çalıştırılır; bu yardımcı mevcut durumu okur. */
export function dsLoadedForTests(): boolean {
  return current !== null;
}
