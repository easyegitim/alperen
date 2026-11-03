import type { AnchorHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';

export interface AppNavItem {
  id: string;
  label: string;
  href: string;
  /** Her zaman bir metin etiketiyle birlikte gösterilir. */
  icon?: ReactNode;
  active?: boolean;
  /** Sayaç ("3"). */
  badge?: string;
}

export interface AppShellFab {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: ReactNode;
}

export interface NavLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export interface AppShellProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Üst/kenar çubuğu marka alanı (BrandLockup). */
  brand?: ReactNode;
  items: AppNavItem[];
  /** Mobil alt gezinmede ortadaki "Sor" kamera düğmesi (FAB). */
  fab?: AppShellFab;
  /** Kenar çubuğu altı: kullanıcı menüsü vb. */
  footer?: ReactNode;
  /** Gezinme için bağlantı çizimi (ör. Next Link). Varsayılan düz <a>. */
  renderLink?: (props: NavLinkProps) => ReactNode;
  navLabel?: string;
  children?: ReactNode;
}

const defaultRenderLink = ({ children, ...props }: NavLinkProps) => <a {...props}>{children}</a>;

/**
 * Uygulama kabuğu: mobilde alt gezinme (+ isteğe bağlı FAB), masaüstünde (md ve üstü) kenar çubuğu.
 * Aynı öğeler iki yerleşimde çizilir; CSS ile yalnızca biri görünür (gizli olan erişilebilirlik ağacında yoktur).
 */
export function AppShell({ brand, items, fab, footer, renderLink = defaultRenderLink, navLabel = 'Ana gezinme', className, children, ...rest }: AppShellProps) {
  const link = (it: AppNavItem, classes: string, key: string) => (
    <li key={key} className="contents">
      {renderLink({
        href: it.href,
        'aria-current': it.active ? 'page' : undefined,
        className: cn(classes, FOCUS_RING),
        children: (
          <>
            {it.icon ? <span aria-hidden="true" className="inline-flex shrink-0">{it.icon}</span> : null}
            <span>{it.label}</span>
            {it.badge ? <span className="text-caption rounded-full bg-primary px-2 text-on-primary">{it.badge}</span> : null}
          </>
        ),
      })}
    </li>
  );

  const half = Math.ceil(items.length / 2);
  const fabClasses = cn(
    'og-motion -mt-6 inline-flex min-h-14 min-w-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full bg-primary px-4 text-on-primary shadow-lg no-underline',
    FOCUS_RING,
  );

  return (
    <div {...rest} className={cn('flex min-h-dvh flex-col bg-surface text-ink md:flex-row', className)}>
      <nav aria-label={navLabel} className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r border-line bg-surface-raised p-4 md:flex">
        {brand ? <div className="px-2 py-1">{brand}</div> : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {items.map((it) =>
            link(
              it,
              cn(
                'text-label flex min-h-11 items-center gap-3 rounded-md px-3 no-underline',
                it.active ? 'bg-primary-soft text-primary' : 'text-ink hover:bg-surface-sunken',
              ),
              `side-${it.id}`,
            ),
          )}
        </ul>
        {fab ? (
          <div className="mt-2">
            {fab.href ? (
              <a href={fab.href} className={cn(fabClasses, 'mt-0 w-full flex-row gap-2 rounded-md')}>
                {fab.icon ? <span aria-hidden="true">{fab.icon}</span> : null}
                <span className="text-label">{fab.label}</span>
              </a>
            ) : (
              <button type="button" onClick={fab.onClick} className={cn(fabClasses, 'mt-0 w-full flex-row gap-2 rounded-md')}>
                {fab.icon ? <span aria-hidden="true">{fab.icon}</span> : null}
                <span className="text-label">{fab.label}</span>
              </button>
            )}
          </div>
        ) : null}
        {footer ? <div className="mt-auto">{footer}</div> : null}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {brand ? <header className="flex min-h-14 items-center border-b border-line bg-surface-raised px-4 md:hidden">{brand}</header> : null}
        <main id="icerik" className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-8 md:pb-8">
          {children}
        </main>
      </div>

      <nav aria-label={`${navLabel} (alt çubuk)`} className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface-raised pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="m-0 flex list-none items-end justify-around p-0">
          {items.slice(0, half).map((it) => link(it, bottomClasses(it.active), `bot-${it.id}`))}
          {fab ? (
            <li className="flex justify-center">
              {fab.href ? (
                <a href={fab.href} className={fabClasses}>
                  {fab.icon ? <span aria-hidden="true">{fab.icon}</span> : null}
                  <span className="text-caption">{fab.label}</span>
                </a>
              ) : (
                <button type="button" onClick={fab.onClick} className={fabClasses}>
                  {fab.icon ? <span aria-hidden="true">{fab.icon}</span> : null}
                  <span className="text-caption">{fab.label}</span>
                </button>
              )}
            </li>
          ) : null}
          {items.slice(half).map((it) => link(it, bottomClasses(it.active), `bot-${it.id}`))}
        </ul>
      </nav>
    </div>
  );
}

function bottomClasses(active?: boolean): string {
  return cn(
    'text-caption flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 no-underline',
    active ? 'text-primary' : 'text-ink-muted',
  );
}
