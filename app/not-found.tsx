import { NotFoundCard } from "@/components/app/NotFoundCard";

/** Bilinmeyen adresler (kök düzen; uygulama kabuğu yok). */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col justify-center">
      <NotFoundCard href="/" cta="toHome" />
    </main>
  );
}
