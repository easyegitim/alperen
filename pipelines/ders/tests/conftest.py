"""Ortak test yardımcıları: sahte Runtime (ağ yok, sabit saat 2026-10-20T09:00Z), CLI çağrısı, sentetik video.

Sentetik video ``fixtures/ders/scripts/make_fixture.sh`` (M01) ile aynı tarifle **geçici dizine** üretilir (betik
``fixtures/ders``'e yazdığı için doğrudan çağrılmaz; ``fixtures/`` salt okunurdur). ffmpeg yoksa video testleri atlanır.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from ogrenmen_common.adapters.base import LLMResult
from ogrenmen_common.fakes import FakeLLM
from ogrenmen_common.fakes.jsonl_db import JsonlDb
from ogrenmen_common.paths import fixtures_root
from ogrenmen_common.runtime import Runtime

from ogrenmen_ders import cli

FIXTURES = fixtures_root()
DERS = FIXTURES / "ders"
WAV = DERS / "lesson-01.wav"
LESSON = "00000000-0000-0000-0000-000000000001"
AYSE = "de70e65e-1410-5026-a773-c5e55a3e6368"     # eğitmen (dev-seed)
ELIF_REF = "s_qk7m2rx4tn5a"
MERT_REF = "s_vd3hp6wz2kc7"
MERT_ENR = "1899cde6-c497-5b14-8051-882f44649013"
MERT_OPEN_MISCONCEPTION = "6dc17606-33d3-59ff-a693-a23ab515fc00"

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
needs_ffmpeg = pytest.mark.skipif(not HAVE_FFMPEG, reason="SKIP: ffmpeg/ffprobe yok")

ENV_KEYS = ("OGRENMEN_FAKES", "OGRENMEN_NOW", "OGRENMEN_ADAPTERS", "OGRENMEN_FIXTURES", "OGRENMEN_OUT",
            "OGRENMEN_VIDEO_DIR", "SUPABASE_URL", "SUPABASE_BATCH_JWT", "SUPABASE_ANON_KEY", "GEMINI_PAID_KEY",
            "GEMINI_FREE_KEY", "GROQ_KEY", "OPENROUTER_KEY", "CF_AI_TOKEN", "CF_ACCOUNT_ID", "ANTHROPIC_KEY",
            "TELEGRAM_OPS_BOT_TOKEN", "ADMIN_CHAT_ID", "GITHUB_ACTIONS", "WHISPER_CPP_BIN", "WHISPER_CPP_MODEL")


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


class ScriptedLLM(FakeLLM):
    """Amaç başına sıralı yanıt kuyruğu; ``None`` ya da boş kuyruk → fixture (``FakeLLM``). Gönderilen istemler
    ``prompts`` listesinde tutulur."""

    def __init__(self, script: dict[str, list] | None = None, **kw):
        super().__init__(**kw)
        self.script = {k: list(v) for k, v in (script or {}).items()}
        self.prompts: list[tuple[str, str]] = []

    def complete(self, request):
        self.prompts.append((request.purpose, request.prompt))
        queue = self.script.get(request.purpose)
        if queue:
            data = queue.pop(0)
            if data is not None:
                self.calls.append(None)
                return LLMResult(ok=True, text=json.dumps(data, ensure_ascii=False), json=data, tokens_in=1200,
                                 tokens_out=300, audio_sec=20 if request.purpose == "transcribe" else None)
        return super().complete(request)


def mert_transcript() -> dict:
    """Mert'in analiz fixture'ındaki her alıntıyı aynen içeren (ve adının geçtiği) transkript: alıntı denetimi geçer."""
    analysis = json.loads((FIXTURES / "llm" / "lesson_analysis" / "02-mert.json").read_text(encoding="utf-8"))
    quotes: dict[str, str] = {}
    for key in ("skills", "misconceptions", "previous_profile_check"):
        for item in analysis[key]:
            for ev in item.get("evidence") or []:
                quotes.setdefault(ev["quote"], ev["t"])
    for key in ("questions", "hesitations"):
        for item in analysis[key]:
            quotes.setdefault(item["quote"], item["t"])
    segments = [{"t": "00:00:00", "t_end": "00:00:03", "speaker": "EĞİTMEN",
                 "text": "Mert, üslü ifadelerle başlayalım."}]
    segments += [{"t": t, "speaker": "ÖĞRENCİ", "text": q} for q, t in sorted(quotes.items(), key=lambda x: x[1])]
    return {"segments": segments}


def make_rt(out: Path, fixtures: Path | None = DERS, **llm_options) -> Runtime:
    return Runtime.from_env(dry_run=True, fixtures=fixtures, out=out, llm_options=llm_options or None)


def run_cli(*args: str) -> int:
    return cli.cli_base.run_main(cli.main, list(args))


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def as_admin(db: JsonlDb):
    """Test kurulumu: ``postgres`` rolüyle yazım (yetki taklidi yok)."""

    class _Ctx:
        def __enter__(self):
            self.prev = db.role
            db.role = "postgres"
            return db

        def __exit__(self, *exc):
            db.role = self.prev
            return False

    return _Ctx()


COLORS = ("red", "blue", "yellow", "green", "white", "black", "magenta", "cyan", "orange", "purple")
TONE = "0.25*sin(2*PI*(220+110*mod(floor(t/2),2))*t)*gt(mod(t,2),0.08)"


def make_scene_video(target: Path, scenes: int = 30) -> Path:
    """make_fixture.sh tarifi: 20 sn, 30 sahne (testsrc2 ↔ düz renk), sesli mp4."""
    inputs: list[str] = []
    filters = ""
    for i in range(scenes):
        if i % 2 == 0:
            inputs += ["-f", "lavfi", "-t", "0.6667", "-i", "testsrc2=s=640x360:r=15"]
        else:
            inputs += ["-f", "lavfi", "-t", "0.6667", "-i", f"color=c={COLORS[(i // 2) % len(COLORS)]}:s=640x360:r=15"]
        filters += f"[{i}:v]setsar=1[v{i}];"
    filters += "".join(f"[v{i}]" for i in range(scenes)) + f"concat=n={scenes}:v=1:a=0,format=yuv420p[v]"
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *inputs, "-f", "lavfi", "-i",
                    f"aevalsrc='{TONE}':s=16000:d=20", "-filter_complex", filters, "-map", "[v]", "-map", f"{scenes}:a",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-c:a", "aac", "-shortest", str(target)],
                   check=True, capture_output=True)
    return target


@pytest.fixture(scope="session")
def scene_video(tmp_path_factory) -> Path:
    if not HAVE_FFMPEG:
        pytest.skip("SKIP: ffmpeg/ffprobe yok")
    return make_scene_video(tmp_path_factory.mktemp("video") / "lesson-01.mp4")
