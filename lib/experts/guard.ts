import { ApiError } from "@/lib/api/errors";
import { isFeatureEnabled } from "@/lib/config/flags";

/** SPEC 12.2: FEATURE_EXPERT_NETWORK=false iken tüm uçlar FEATURE_DISABLED (404). */
export function assertExpertNetworkEnabled(): void {
  if (!isFeatureEnabled("expertNetwork")) throw new ApiError("FEATURE_DISABLED", "Bulunamadı.");
}
