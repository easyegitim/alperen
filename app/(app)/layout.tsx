import { AppHeader } from "@/components/app/AppHeader";
import { BottomNav } from "@/components/app/BottomNav";

/**
 * Uygulama kabuğu. Oturum kapısı burada DEĞİL (v2, KB P#2): yaş, cinsiyet ve giriş ekranları (/baslangic/{yas,cinsiyet,giris})
 * hesap açılmadan önce gelir. Oturum ve onboarding kontrolü (gated)/layout.tsx'te; /baslangic/izinler ve /baslangic/anket
 * ile /silme kendi içinde oturum ister. API uçları withGuard ile korunur; bu kabuk yalnız görseldir.
 */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))]">{children}</main>
      <BottomNav />
    </div>
  );
}
