import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export type AvatarVariant = 'mascot' | 'photo';

const SIZES: Record<AvatarSize, string> = { sm: 'size-8 text-caption', md: 'size-10 text-small', lg: 'size-14 text-title-3', xl: 'size-20 text-title-2' };

export interface AvatarProps extends ComponentPropsWithRef<'span'> {
  /** mascot: Maskot görselini yüze kırpar (yüz ve kulaklık kesilmez). photo: kullanıcı fotoğrafı. */
  src?: string;
  /** Erişilebilir ad ve görsel yoksa baş harfler için. */
  name: string;
  size?: AvatarSize;
  variant?: AvatarVariant;
  /** Yapay zekâ işareti: hologram halkası. */
  ai?: boolean;
}

/** "Ayşe Yılmaz" -> "AY" (Türkçe büyük harf kuralıyla). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toLocaleUpperCase('tr-TR');
}

/** Yuvarlak avatar: maskot yüz kırpımı, fotoğraf ya da baş harfler. */
export function Avatar({ src, name, size = 'md', variant = 'mascot', ai = false, className, style, ...rest }: AvatarProps) {
  const mascot = !!src && variant === 'mascot';
  return (
    <span
      role="img"
      aria-label={name}
      {...rest}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft bg-no-repeat font-bold text-primary',
        SIZES[size],
        ai && 'ring-2 ring-ai-glow ring-offset-2 ring-offset-surface',
        className,
      )}
      style={
        mascot
          ? { ...style, backgroundImage: `url("${src}")`, backgroundSize: '280% auto', backgroundPosition: '55% 4%' }
          : src
            ? { ...style, backgroundImage: `url("${src}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : style
      }
    >
      {src ? null : <span aria-hidden="true">{initialsOf(name)}</span>}
    </span>
  );
}
