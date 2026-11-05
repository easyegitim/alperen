import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/db/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Statik dosyalar, görsel optimizasyonu ve public varlıklar hariç her yol.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|mediapipe/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|tflite|task)$).*)",
  ],
};
