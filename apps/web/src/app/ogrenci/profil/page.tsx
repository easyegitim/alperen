import type { Metadata } from 'next';
import { Brain } from 'lucide-react';
import { GuardianInvite } from '@/components/GuardianInvite';
import { LinkButton } from '@/components/LinkButton';
import { PageHeader } from '@/components/PageHeader';
import { PushToggle } from '@/components/PushToggle';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Avatar } from '@/ds';
import { GRADE_LABELS, GRADES } from '@/lib/validation';
import { getPublicEnv } from '@/lib/env';
import { requireRole } from '@/server/auth';
import { getMyStudent } from '@/server/queries';
import { loadGuardianLinks } from '@/server/parent/links';

export const metadata: Metadata = { title: 'Profil' };

function gradeLabel(grade: string | null | undefined): string {
  if (!grade) return 'Sınıf belirtilmedi';
  return (GRADES as readonly string[]).includes(grade) ? GRADE_LABELS[grade as (typeof GRADES)[number]] : grade;
}

export default async function ProfilSayfasi() {
  const { user, displayName } = await requireRole('student', 'admin');
  const student = await getMyStudent(user.id);
  const vapid = getPublicEnv().vapidPublicKey;
  const links = student ? await loadGuardianLinks(student.id) : [];
  const name = displayName?.trim() || 'Öğrenci';
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title="Profil" description="Hesabın, öğretmenin senin hakkında tuttuğu notlar ve uygulama ayarların." />

      <section aria-label="Hesabın" className="flex items-center gap-4 rounded-lg border border-line bg-surface-raised p-4">
        <Avatar name={name} variant="photo" size="xl" />
        <div className="flex min-w-0 flex-col">
          <span className="text-title-3 truncate text-ink">{name}</span>
          <span className="text-small text-ink-muted">{gradeLabel(student?.grade)}</span>
          {user.email ? <span className="text-small truncate text-ink-muted">{user.email}</span> : null}
        </div>
      </section>

      <section aria-labelledby="hafiza" className="flex flex-col gap-3">
        <h2 id="hafiza" className="text-title-2 m-0 text-ink">
          Öğrenmen senin hakkında ne biliyor
        </h2>
        <p className="text-body m-0 max-w-prose text-ink-muted">Öğretmenin seni tanımak için tuttuğu notları okuyabilirsin. Yanlış ya da eksik bir şey görürsen eğitmenine söyle.</p>
        <div>
          <LinkButton href="/ogrenci/profil/hafiza" variant="secondary" icon={<Brain size={18} />}>
            Hafızamı gör
          </LinkButton>
        </div>
      </section>

      <section aria-labelledby="veli-davet" className="flex flex-col gap-3">
        <h2 id="veli-davet" className="text-title-2 m-0 text-ink">
          Velini davet et
        </h2>
        <p className="text-body m-0 max-w-prose text-ink-muted">Velin özetleri ve deneme sonuçlarını görür; koçla yazışmalarını görmez. Kod tek kullanımlıktır.</p>
        {links.length > 0 ? (
          <ul aria-label="Bağlı veliler" className="text-small m-0 flex list-none flex-col gap-1 p-0 text-ink-muted">
            {links.map((l) => (
              <li key={l.id}>{l.label}</li>
            ))}
          </ul>
        ) : null}
        <GuardianInvite simple />
      </section>

      <section aria-labelledby="bildirim" className="flex flex-col gap-3">
        <h2 id="bildirim" className="text-title-2 m-0 text-ink">
          Bildirimler
        </h2>
        <PushToggle userId={user.id} vapidPublicKey={vapid} />
      </section>

      <section aria-labelledby="gorunum" className="flex flex-col gap-3">
        <h2 id="gorunum" className="text-title-2 m-0 text-ink">
          Görünüm
        </h2>
        <ThemeToggle className="self-start" />
      </section>

      <section aria-label="Oturum" className="flex flex-col gap-3 border-t border-line pt-6">
        <div>
          <SignOutButton />
        </div>
      </section>
    </div>
  );
}
