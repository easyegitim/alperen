import type { ComponentPropsWithRef } from 'react';
import { FileText, Pencil } from 'lucide-react';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import { Button } from './Button';

export interface MemoryFileCardProps extends Omit<ComponentPropsWithRef<'article'>, 'title'> {
  /** memory_files.path, ör. "/memories/profil.md". */
  path: string;
  /** Okunur ad ("Nasıl öğreniyorsun"). */
  title: string;
  /** Dosya içeriği (düz metin). */
  content: string;
  /** Biçimlenmiş son güncelleme ("19 Eki 14:32"). */
  updatedAt?: string;
  bytes?: number;
  /** "Düzeltme iste" düğmesi; verilmezse gizlenir. */
  onRequestCorrection?: () => void;
}

/** Profil -> Hafıza: öğretmenin senin hakkında tuttuğu bir dosya. Öğrenci içeriği görür ve düzeltme ister. */
export function MemoryFileCard({ path, title, content, updatedAt, bytes, onRequestCorrection, className, ...rest }: MemoryFileCardProps) {
  return (
    <article {...rest} className={cn('box-border flex max-w-140 flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-title-3 m-0 flex items-center gap-2 text-ink">
            <FileText aria-hidden="true" size={20} className="shrink-0 text-ink-muted" />
            {title}
          </h3>
          <code className="font-mono text-caption break-all text-ink-muted">{path}</code>
        </div>
        <Badge tone="ai">ai</Badge>
      </div>
      <p className="text-small m-0 whitespace-pre-wrap text-ink">{content}</p>
      <div className="text-caption flex flex-wrap items-center justify-between gap-2 text-ink-muted">
        <span>
          {updatedAt ? `Güncellendi: ${updatedAt}` : ''}
          {updatedAt && typeof bytes === 'number' ? ' · ' : ''}
          {typeof bytes === 'number' ? `${bytes} bayt` : ''}
        </span>
        {onRequestCorrection ? (
          <Button variant="secondary" size="sm" icon={<Pencil size={16} />} onClick={onRequestCorrection}>
            Düzeltme iste
          </Button>
        ) : null}
      </div>
    </article>
  );
}
