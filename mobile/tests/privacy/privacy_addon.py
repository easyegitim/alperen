"""mitmproxy eklentisi: Aura mobil gizlilik kuralları (CLAUDE.md "Gizlilik testi").

Kullanım: mitmdump -s privacy_addon.py
İhlalde "PRIVACY VIOLATION" satırı basılır; bitişte ihlal varsa süreç 1 ile çıkar.
"""
import re
import sys
from mitmproxy import ctx, http

IMAGE_SINKS = ("/api/analyses", "/api/tryon")
TELEMETRY_HOSTS = ("posthog", "sentry", "supabase", "revenuecat", "resend", "cloudflare", "turnstile")
FORBIDDEN_IN_TELEMETRY = re.compile(r"/9j/|lengthRatio|jawRatio|\"overall\"|\"potential\"|subscores|@[A-Za-z0-9.-]+\.[a-z]{2,}")
LANDMARK_ARRAY = re.compile(r"\"x\"\s*:")


class AuraPrivacy:
    def __init__(self) -> None:
        self.violations: list[str] = []

    def _violation(self, msg: str) -> None:
        self.violations.append(msg)
        ctx.log.error(f"PRIVACY VIOLATION: {msg}")

    @staticmethod
    def _has_image(req: http.Request) -> bool:
        ct = req.headers.get("content-type", "")
        if ct.startswith("image/") or ct.startswith("multipart/"):
            return True
        body = req.get_text(strict=False) or ""
        return "/9j/" in body or "data:image/" in body

    def request(self, flow: http.HTTPFlow) -> None:
        req = flow.request
        path = req.path.split("?")[0]
        host = req.pretty_host
        body = req.get_text(strict=False) or ""
        if self._has_image(req) and not any(path.startswith(s) for s in IMAGE_SINKS):
            self._violation(f"görsel gövde izinsiz hedefe: {host}{path}")
        if path == "/api/analyses" and req.method == "POST":
            if "landmarks" in body or len(LANDMARK_ARRAY.findall(body)) > 400:
                self._violation("/api/analyses gövdesinde ham landmark dizisi")
        if any(h in host for h in TELEMETRY_HOSTS) and FORBIDDEN_IN_TELEMETRY.search(body):
            self._violation(f"telemetri/altyapı isteğinde yasak veri: {host}{path}")
        if "progress/" in body or "aura-session-selfie" in body:
            self._violation(f"cihaz fotoğrafı dosya adı istekte: {host}{path}")

    def response(self, flow: http.HTTPFlow) -> None:
        path = flow.request.path.split("?")[0]
        if path.startswith("/api/analyses") and flow.response and flow.response.status_code == 200:
            text = flow.response.get_text(strict=False) or ""
            # kilitli alanlarda değer sızıntısı: {"value":7.1,"locked":true}
            if re.search(r"\"value\"\s*:\s*[0-9.]+\s*,\s*\"locked\"\s*:\s*true", text):
                self._violation("kilitli alanda değer var")

    def done(self) -> None:
        if self.violations:
            ctx.log.error(f"{len(self.violations)} gizlilik ihlali")
            sys.exit(1)
        ctx.log.info("Gizlilik kuralları: ihlal yok")


addons = [AuraPrivacy()]
