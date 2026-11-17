import { extendTailwindMerge } from 'tailwind-merge';

export type ClassValue = string | false | null | undefined;

const TEXT_SIZES = ['display', 'title-1', 'title-2', 'title-3', 'body-lg', 'body', 'label', 'small', 'caption', 'code'];
const COLORS = [
  'surface', 'surface-raised', 'surface-sunken', 'paper', 'line', 'line-strong', 'ink', 'ink-muted', 'primary', 'primary-strong',
  'primary-soft', 'on-primary', 'navy', 'on-navy', 'gold', 'gold-deep', 'gold-ink', 'on-gold', 'ai-glow', 'ai-soft', 'easy-purple',
  'success', 'success-soft', 'warning', 'warning-soft', 'danger', 'danger-soft', 'focus', 'link',
];

// Tasarım sisteminin özel yardımcı sınıfları tailwind-merge'e tanıtılır; böylece text-title-1 gibi boyut sınıfları
// metin rengiyle, shadow-ai / shadow-focus-ring gölge sınıflarıyla karışmaz.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { color: COLORS, text: TEXT_SIZES, shadow: ['sm', 'lg', 'ai', 'focus-ring'] },
    classGroups: {
      'font-size': [{ text: TEXT_SIZES }],
      shadow: [{ shadow: ['sm', 'lg', 'ai', 'focus-ring'] }],
    },
  },
});

/**
 * Sınıf adlarını birleştirir; yanlış değerleri atar. Çakışan Tailwind yardımcılarında (max-w-70 / max-w-none)
 * sınıf sırası belirleyicidir: çağıranın className'i sona geldiği için kazanır (tailwind-merge ile çözülür).
 */
export function cn(...values: ClassValue[]): string {
  return twMerge(values.filter(Boolean).join(' '));
}

/** Klavye odak halkası: her etkileşimli denetimde (odak asla gizlenmez). */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-focus-ring';
