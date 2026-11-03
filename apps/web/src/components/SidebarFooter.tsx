import { ROLE_LABELS, type AppRole } from '@/lib/roles';
import { Avatar } from '@/ds';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';

/** Kenar çubuğu altı: kullanıcı adı ve rolü, tema seçici, çıkış. */
export function SidebarFooter({ displayName, role }: { displayName: string | null; role: AppRole }) {
  const name = displayName?.trim() || ROLE_LABELS[role];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={name} variant="photo" size="sm" />
        <div className="flex min-w-0 flex-col">
          <span className="text-label truncate text-ink">{name}</span>
          <span className="text-caption text-ink-muted">{ROLE_LABELS[role]}</span>
        </div>
      </div>
      <ThemeToggle className="w-full" />
      <SignOutButton block />
    </div>
  );
}
