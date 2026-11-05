import { BrandLockup } from '@/ds';
import markPurple from '@ogrenmen/design-system/assets/Logolar/easy-isaret-mor.png';
import markWhite from '@ogrenmen/design-system/assets/Logolar/easy-isaret-beyaz.png';

/**
 * Ürün imzası. Açık zeminde mor, koyu zeminde beyaz easy işareti; seçim CSS ile yapılır (globals.css: og-brand-*),
 * böylece tema değişince sayfa yeniden çizilmez.
 */
export function AppBrand({ size = 'md', endorsement = true }: { size?: 'sm' | 'md' | 'lg'; endorsement?: boolean }) {
  return (
    <>
      <BrandLockup className="og-brand-light" markSrc={markPurple.src} size={size} endorsement={endorsement} />
      <BrandLockup className="og-brand-dark" markSrc={markWhite.src} size={size} endorsement={endorsement} />
    </>
  );
}
