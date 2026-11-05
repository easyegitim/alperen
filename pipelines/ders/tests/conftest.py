"""Ortak test yardımcıları: yalıtılmış ortam (çalışma kökü geçici dizin), sentetik video, servisin HTTP kopyası ve
sahte Groq / Supabase Storage uçları (yerel ``http.server``; ağ yok). ffmpeg yoksa medya testleri atlanır."""

from __future__ import annotations

import json
import shutil
import subprocess
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from ogrenmen_ders import service as S

ROOT = Path(__file__).resolve().parents[3]
DERS = ROOT / "fixtures" / "ders"
WAV = DERS / "lesson-01.wav"
LESSON = "00000000-0000-4000-8000-0000000000d1"

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="SKIP: ffmpeg/ffprobe yok")

ENV_KEYS = ("OGRENMEN_STT", "GROQ_API_KEY", "GROQ_BASE_URL", "GROQ_STT_MODEL", "OGRENMEN_STT_CHUNK_SEC",
            "OGRENMEN_STT_FIXTURE", "OGRENMEN_STT_FIXTURES", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
            "OGRENMEN_DERS_TOKEN", "FFMPEG_BIN", "FFPROBE_BIN")


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch, tmp_path):
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OGRENMEN_DERS_WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setenv("OGRENMEN_DERS_QUIET", "1")


def make_video(target: Path, seconds: int = 10, *, scenes: bool = False) -> Path:
    """Sessiz (anullsrc) ya da tonlu test videosu; ``scenes`` ile 2 sn'de bir değişen renk sahneleri."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if scenes:
        colors = ("red", "blue", "yellow", "green", "white", "black", "magenta", "cyan", "orange", "purple")
        n = seconds * 3
        inputs: list[str] = []
        for i in range(n):
            inputs += ["-f", "lavfi", "-t", "0.3334", "-i", f"color=c={colors[i % len(colors)]}:s=320x180:r=15"]
        filt = "".join(f"[{i}:v]" for i in range(n)) + f"concat=n={n}:v=1:a=0,format=yuv420p[v]"
        args = [*inputs, "-f", "lavfi", "-i", f"sine=f=330:r=16000:d={seconds}", "-filter_complex", filt,
                "-map", "[v]", "-map", f"{n}:a"]
    else:
        args = ["-f", "lavfi", "-i", f"testsrc2=s=640x360:r=10:d={seconds}", "-f", "lavfi", "-i",
                "anullsrc=r=16000:cl=mono", "-t", str(seconds)]
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *args, "-c:v", "libx264", "-preset", "veryfast",
                    "-crf", "30", "-c:a", "aac", "-shortest", str(target)], check=True, capture_output=True)
    return target


@pytest.fixture(scope="session")
def silent_video(tmp_path_factory) -> Path:
    if not HAVE_FFMPEG:
        pytest.skip("SKIP: ffmpeg/ffprobe yok")
    return make_video(tmp_path_factory.mktemp("video") / "sessiz.mp4", 10)


@pytest.fixture(scope="session")
def scene_video(tmp_path_factory) -> Path:
    if not HAVE_FFMPEG:
        pytest.skip("SKIP: ffmpeg/ffprobe yok")
    return make_video(tmp_path_factory.mktemp("video") / "sahneli.mp4", 10, scenes=True)


def place(src: Path, lesson: str = LESSON, name: str | None = None) -> str:
    """Kaynağı çalışma köküne kopyalar; köke göreli yolu döner (worker'ın yaptığı gibi)."""
    target = S.work_root() / lesson / (name or f"source{src.suffix}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, target)
    return target.relative_to(S.work_root()).as_posix()


class _Server:
    def __init__(self, handler: type[BaseHTTPRequestHandler]):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def service() -> Iterator[str]:
    """Servisin kendisi (gerçek ``Handler``), rastgele portta."""
    httpd = S.make_server("127.0.0.1", 0)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def groq() -> Iterator[dict]:
    """Sahte Groq ``/audio/transcriptions``: istekleri kaydeder; her parçaya iki bölüm döner. ``fail`` listesi
    sırayla HTTP hata kodları döndürür (ör. ``[429]`` → bir kez yeniden deneme)."""
    state: dict = {"requests": [], "fail": []}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            return

        def do_POST(self):  # noqa: N802
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            state["requests"].append({"path": self.path, "auth": self.headers.get("Authorization"),
                                      "ctype": self.headers.get("Content-Type"), "body": body})
            if state["fail"]:
                code = state["fail"].pop(0)
                self.send_response(code)
                self.send_header("retry-after", "0")
                self.end_headers()
                return
            n = len([r for r in state["requests"] if r["path"].endswith("/audio/transcriptions")])
            data = {"duration": 4.0, "segments": [{"start": 0.0, "end": 1.5, "text": f" parça {n} bir "},
                                                  {"start": 1.5, "end": 3.9, "text": f"parça {n} iki"},
                                                  {"start": 3.9, "end": 4.0, "text": "  "}]}
            out = json.dumps(data).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    srv = _Server(H)
    state["url"] = srv.url
    yield state
    srv.close()


@pytest.fixture
def storage() -> Iterator[dict]:
    """Sahte Supabase Storage (``/storage/v1/object/<kova>/<yol>``): GET indirir, POST yükler (``x-upsert``)."""
    state: dict = {"objects": {}, "auth": []}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            return

        def _key(self) -> str:
            from urllib.parse import unquote

            return unquote(self.path.split("/storage/v1/object/", 1)[1])

        def do_GET(self):  # noqa: N802
            state["auth"].append(self.headers.get("Authorization"))
            obj = state["objects"].get(self._key())
            if obj is None:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(obj["body"])))
            self.end_headers()
            self.wfile.write(obj["body"])

        def do_POST(self):  # noqa: N802
            state["auth"].append(self.headers.get("Authorization"))
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            state["objects"][self._key()] = {"body": body, "type": self.headers.get("Content-Type"),
                                             "upsert": self.headers.get("x-upsert")}
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

    srv = _Server(H)
    state["url"] = srv.url
    yield state
    srv.close()
