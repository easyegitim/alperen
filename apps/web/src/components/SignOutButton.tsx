import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/ds';

/** Çıkış: sunucu eylemi oturumu kapatır ve /giris'e yollar (JavaScript olmadan da çalışır). */
export function SignOutButton({ block = false }: { block?: boolean }) {
  return (
    <form action={signOut}>
      <Button type="submit" variant="secondary" block={block} icon={<LogOut size={18} />}>
        Çıkış yap
      </Button>
    </form>
  );
}
