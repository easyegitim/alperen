import { NotFoundCard } from "@/components/app/NotFoundCard";

/** Uygulama içi notFound() (ör. /uzman flag kapalıyken, başkasının analizi): kabuk içinde, 404 durumuyla. */
export default function AppNotFound() {
  return <NotFoundCard href="/analiz" cta="toAnalyses" />;
}
