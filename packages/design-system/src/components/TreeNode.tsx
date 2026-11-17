'use client';

import { useId, useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn, FOCUS_RING } from '../lib/cn';
import { masteryDisplay, type MasteryFormat } from './MasteryMeter';

/** Ağaç kabı: <TreeNode> öğelerini iç içe düz ul/li olarak sarar (ARIA tree rolü kullanılmaz; her düğümde iki düğme Tab ile gezilir). */
export function Tree({ className, ...rest }: ComponentPropsWithRef<'ul'>) {
  return <ul {...rest} className={cn('m-0 flex list-none flex-col gap-1 p-0', className)} />;
}

export interface TreeNodeProps extends Omit<ComponentPropsWithRef<'li'>, 'onSelect' | 'children'> {
  label: string;
  /** Ağaçtaki derinlik, 1'den başlar. */
  level?: number;
  /** Kontrollü açık/kapalı; verilmezse düğüm kendi durumunu tutar. */
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  selected?: boolean;
  onSelect?: () => void;
  /** Ustalık p (0–1) ve gözlem sayısı; kanıt eşiğin altındaysa bant/yüzde yazılmaz. */
  p?: number;
  evidence?: number;
  minEvidence?: number;
  /** Ustalık gösterimi: 'band' (varsayılan) ya da 'percent' (eğitmen konsolu). */
  display?: MasteryFormat;
  /** Soru tarzı nokta sayısı (tarz kütüphanesi). */
  styleCount?: number;
  /** Ön koşul ipucu: "Ön koşul: Kesirler". */
  prerequisiteHint?: string;
  /** Alt düğümler (TreeNode). Verilmezse yaprak sayılır. */
  children?: ReactNode;
  /** Yan içerik (rozet, eylem). */
  trailing?: ReactNode;
}

/** Müfredat/konu haritası düğümü. İç içe TreeNode alt düğümleri açılır kapanır. */
export function TreeNode({
  label,
  level = 1,
  expanded,
  defaultExpanded = false,
  onExpandedChange,
  selected,
  onSelect,
  p,
  evidence,
  minEvidence,
  display = 'band',
  styleCount,
  prerequisiteHint,
  children,
  trailing,
  className,
  ...rest
}: TreeNodeProps) {
  const groupId = useId();
  const [inner, setInner] = useState(defaultExpanded);
  const hasChildren = children != null && children !== false;
  const open = expanded ?? inner;
  const toggle = () => {
    const next = !open;
    if (expanded === undefined) setInner(next);
    onExpandedChange?.(next);
  };
  const m = masteryDisplay({ p, evidence, minEvidence, format: display });
  const hasMastery = p !== undefined || evidence !== undefined;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <li
      data-level={level}
      {...rest}
      className={cn('list-none', className)}
    >
      <div
        className={cn(
          'flex min-h-11 items-center gap-1 rounded-md border px-2',
          selected ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-surface-sunken',
        )}
        style={{ marginLeft: `${(level - 1) * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={groupId}
            aria-label={`${label} alt konuları`}
            className={cn('inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-muted', FOCUS_RING)}
          >
            <Chevron aria-hidden="true" size={18} />
          </button>
        ) : (
          <span aria-hidden="true" className="size-11 shrink-0" />
        )}
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
          className={cn('text-label flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center bg-transparent text-left text-ink', FOCUS_RING)}
        >
          <span>{label}</span>
          {prerequisiteHint ? <span className="text-caption font-normal text-ink-muted">{prerequisiteHint}</span> : null}
        </button>
        {typeof styleCount === 'number' && styleCount > 0 ? (
          <span className="text-caption flex items-center gap-1 text-ink-muted" title={`${styleCount} soru tarzı`}>
            <span aria-hidden="true" className="flex gap-0.5">
              {Array.from({ length: Math.min(styleCount, 5) }, (_, i) => (
                <span key={i} className="size-1.5 rounded-full bg-primary" />
              ))}
            </span>
            {styleCount} tarz
          </span>
        ) : null}
        {hasMastery ? (
          <span className={cn('text-small whitespace-nowrap tabular-nums', m.enough ? 'font-semibold text-ink' : 'text-ink-muted')}>
            {m.text}
            {typeof evidence === 'number' && m.enough ? <span className="text-caption font-normal text-ink-muted"> · {evidence} gözlem</span> : null}
          </span>
        ) : null}
        {trailing}
      </div>
      {hasChildren ? (
        <ul id={groupId} hidden={!open} className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
          {children}
        </ul>
      ) : null}
    </li>
  );
}
