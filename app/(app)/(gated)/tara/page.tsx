import { CaptureScreen } from "@/components/camera/CaptureScreen";
import { getPublicEngineInfo } from "@/lib/ai/disclosure.server";

/** F05 v2: çoklu açı çekim (ön + yan profil zorunlu), cihaz analizi ve kilitli sonuç. Sağlayıcı adı sunucudan (gizli değer yok). */
export default function CapturePage() {
  const info = getPublicEngineInfo();
  return <CaptureScreen aiProviderName={info.analysisProvider} />;
}
