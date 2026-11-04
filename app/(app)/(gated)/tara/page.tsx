import { z } from "zod";
import { CaptureScreen } from "@/components/camera/CaptureScreen";
import { getPublicEngineInfo } from "@/lib/ai/disclosure.server";

/**
 * F05 v2: çoklu açı çekim (ön + yan profil zorunlu), cihaz analizi ve kilitli sonuç. Sağlayıcı adı sunucudan (gizli değer yok).
 * ?analysis=<uuid>: ödeme sonrası çekime dönüş (sonuç ekranındaki "Çekime dön" / "Yeniden dene"); set o analize gönderilir.
 * Sahiplik ve hak sunucuda (POST /api/analyses/[id]/run) doğrulanır; burada yalnız biçim kontrolü yapılır.
 */
export default async function CapturePage({ searchParams }: PageProps<"/tara">) {
  const info = getPublicEngineInfo();
  const sp = await searchParams;
  const raw = Array.isArray(sp.analysis) ? sp.analysis[0] : sp.analysis;
  const resumeAnalysisId = z.uuid().safeParse(raw).success ? String(raw) : null;
  return <CaptureScreen aiProviderName={info.analysisProvider} resumeAnalysisId={resumeAnalysisId} />;
}
