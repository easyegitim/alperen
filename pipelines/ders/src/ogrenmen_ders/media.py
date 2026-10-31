"""Ses ve kare çıkarımı (BLUEPRINT §6.3 adım 1–2; yerel ``ffmpeg``/``ffprobe``, ağ yok).

* Ses: ``ffmpeg -i video -vn -ac 1 -ar 16000 -c:a pcm_s16le <ad>.wav``.
* Kareler: sahne değişimi (``select='gt(scene,0.30)'``) ile 20–40 kare hedefi. 40'tan çoksa eşik 0.45, 20'den azsa
  0.20, hâlâ azsa eşit aralıklı örnekleme. Videonun tamamı modele verilmez; kareler JPEG, en çok 1280 px genişlik.

Sahne puanları tek geçişte (``metadata=print``) okunur, eşik seçimi saf Python'dadır (``choose_timestamps``; aynı
puanlar → aynı kareler) ve seçilen anlar ``-ss`` ile tek tek çıkarılır — böylece eşik denemeleri videoyu yeniden
çözmez. Sonuç blueprint'teki ``select='gt(scene,T)',showinfo -vsync vfr`` komutunun seçtiği karelerle aynıdır.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from .errors import DersError

SCENE_THRESHOLD = 0.30
SCENE_THRESHOLD_HIGH = 0.45
SCENE_THRESHOLD_LOW = 0.20
MIN_FRAMES = 20
MAX_FRAMES = 40
UNIFORM_TARGET = 30
MAX_WIDTH = 1280
SEEK_EPSILON = 0.0005
"""Saniye: ``-ss`` yuvarlamasıyla bir sonraki kareye kaymamak için seçilen anın biraz öncesine sarılır."""
AUDIO_RATE = 16000
SUBPROCESS_TIMEOUT_S = 6 * 3600
"""Saniye: 90 dakikalık bir kaydın en yavaş adımı bile bunun çok altındadır; aşılırsa takılmış süreç sayılır."""
IMAGE_SUFFIXES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


def _bin(name: str) -> str:
    env = {"ffmpeg": "FFMPEG_BIN", "ffprobe": "FFPROBE_BIN"}[name]
    path = os.environ.get(env) or shutil.which(name)
    if not path:
        raise DersError(f"OGR-DERS-004 {name} bulunamadı (kurulu olmalı ya da {env} ile verilmeli)")
    return path


def _run(args: Sequence[str], *, what: str, cwd: str | Path | None = None,
         timeout: float = SUBPROCESS_TIMEOUT_S) -> subprocess.CompletedProcess[str]:
    """Alt süreç; çalıştırılamazsa, zaman aşımına uğrarsa ya da sıfırdan farklı çıkarsa ``OGR-DERS-004``."""
    try:
        proc = subprocess.run(list(args), capture_output=True, text=True, check=False, cwd=cwd, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise DersError(f"OGR-DERS-004 {what} zaman aşımı ({int(timeout)} sn)") from exc
    except OSError as exc:
        raise DersError(f"OGR-DERS-004 {what} çalıştırılamadı: {exc}") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-1:] or ["?"]
        raise DersError(f"OGR-DERS-004 {what} başarısız (çıkış {proc.returncode}): {tail[0][:200]}")
    return proc


@dataclass(frozen=True)
class Probe:
    duration_sec: float
    has_video: bool
    has_audio: bool


def probe(path: Path) -> Probe:
    """Süre ve akış türleri (``ffprobe -show_entries format=duration:stream=codec_type``)."""
    path = Path(path)
    if not path.is_file():
        raise DersError(f"OGR-DERS-001 dosya yok: {path.name}")
    proc = _run([_bin("ffprobe"), "-v", "error", "-show_entries", "format=duration:stream=codec_type,disposition",
                 "-of", "json", str(path)], what="ffprobe")
    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams") or []
    # Kapak resmi (attached_pic) olan ses dosyaları "video" akışı taşır; ders karesi sayılmaz.
    video = [s for s in streams if s.get("codec_type") == "video"
             and not (s.get("disposition") or {}).get("attached_pic")]
    try:
        duration = float((data.get("format") or {}).get("duration") or 0.0)
    except ValueError:
        duration = 0.0
    return Probe(duration_sec=duration, has_video=bool(video),
                 has_audio=any(s.get("codec_type") == "audio" for s in streams))


def extract_audio(src: Path, dest: Path) -> Path:
    """§6.3 adım 1: mono, 16 kHz, 16 bit PCM WAV."""
    info = probe(src)
    if not info.has_audio:
        raise DersError(f"OGR-DERS-001 ses akışı yok: {Path(src).name}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    _run([_bin("ffmpeg"), "-nostdin", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", str(AUDIO_RATE),
          "-c:a", "pcm_s16le", "-map_metadata", "-1", "-fflags", "+bitexact", str(dest)], what="ffmpeg (ses)")
    return dest


@dataclass(frozen=True)
class Frame:
    path: Path
    t_sec: float
    score: float | None
    mime: str

    @property
    def hms(self) -> str:
        return hms(self.t_sec)


@dataclass(frozen=True)
class FrameSelection:
    frames: list[Frame]
    method: str
    """``scene>0.30`` | ``scene>0.45`` | ``scene>0.20`` (``/top40`` ekiyle kırpılmış) | ``uniform`` | ``none`` |
    ``fixtures``."""
    duration_sec: float

    def summary(self) -> dict:
        return {"method": self.method, "count": len(self.frames), "duration_sec": round(self.duration_sec, 3),
                "frames": [{"name": f.path.name, "t": f.hms, "score": None if f.score is None else round(f.score, 4),
                            "bytes": f.path.stat().st_size if f.path.exists() else 0} for f in self.frames]}


def hms(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def scene_scores(video: Path) -> list[tuple[float, float]]:
    """Her karenin ``(pts_time, lavfi.scene_score)`` çifti (tek çözme geçişi)."""
    with tempfile.TemporaryDirectory(prefix="ogrenmen-scene-") as tmp:
        target = Path(tmp) / "scores.txt"
        # metadata=print:file= değeri filtre sözdiziminde kaçışsız kalsın diye göreli yol + cwd kullanılır.
        args = [_bin("ffmpeg"), "-nostdin", "-v", "error", "-i", str(Path(video).resolve()), "-an", "-sn", "-dn",
                "-vf", "select='gte(scene,0)',metadata=print:file=scores.txt", "-f", "null", "-"]
        _run(args, what="ffmpeg (sahne)", cwd=tmp)
        text = target.read_text(encoding="utf-8") if target.exists() else ""
    return parse_scene_scores(text)


def parse_scene_scores(text: str) -> list[tuple[float, float]]:
    """``metadata=print`` çıktısı → ``[(t, score)]`` (puansız kare 0 sayılır)."""
    out: list[tuple[float, float]] = []
    current: float | None = None
    score = 0.0
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("frame:"):
            if current is not None:
                out.append((current, score))
            score = 0.0
            current = None
            for part in line.split():
                if part.startswith("pts_time:"):
                    try:
                        current = float(part.split(":", 1)[1])
                    except ValueError:
                        current = None
        elif line.startswith("lavfi.scene_score="):
            try:
                score = float(line.split("=", 1)[1])
            except ValueError:
                score = 0.0
    if current is not None:
        out.append((current, score))
    return out


def _top(items: list[tuple[float, float]], k: int) -> list[tuple[float, float]]:
    best = sorted(items, key=lambda x: (-x[1], x[0]))[:k]
    return sorted(best)


def uniform_times(duration: float, target: int = UNIFORM_TARGET) -> list[float]:
    """Eşit aralıklı örnekleme: en çok ``target`` kare, saniyede en çok bir kare; aralık ortaları."""
    if duration <= 0:
        return []
    n = min(target, max(1, int(math.floor(duration))))
    step = duration / n
    return [round((i + 0.5) * step, 6) for i in range(n)]


def choose_timestamps(scores: Sequence[tuple[float, float]], duration: float, *, lo: int = MIN_FRAMES,
                      hi: int = MAX_FRAMES) -> tuple[list[tuple[float, float | None]], str]:
    """§6.3 adım 2 eşik kuralı (saf, deterministik)."""

    def above(th: float) -> list[tuple[float, float]]:
        return [(t, s) for t, s in scores if s > th]

    s30 = above(SCENE_THRESHOLD)
    if lo <= len(s30) <= hi:
        return list(s30), "scene>0.30"
    if len(s30) > hi:
        s45 = above(SCENE_THRESHOLD_HIGH)
        if lo <= len(s45) <= hi:
            return list(s45), "scene>0.45"
        if len(s45) > hi:
            return list(_top(s45, hi)), "scene>0.45/top40"
        return list(_top(s30, hi)), "scene>0.30/top40"
    s20 = above(SCENE_THRESHOLD_LOW)
    if lo <= len(s20) <= hi:
        return list(s20), "scene>0.20"
    if len(s20) > hi:
        return list(_top(s20, hi)), "scene>0.20/top40"
    times = uniform_times(duration)
    return ([(t, None) for t in times], "uniform") if times else ([], "none")


def _grab(video: Path, t: float, dest: Path) -> bool:
    start = max(0.0, t - SEEK_EPSILON)
    _run([_bin("ffmpeg"), "-nostdin", "-v", "error", "-y", "-ss", f"{start:.4f}", "-i", str(video), "-frames:v", "1",
          "-an", "-vf", f"scale='min({MAX_WIDTH},iw)':-2", "-q:v", "3", str(dest)], what="ffmpeg (kare)")
    return dest.is_file() and dest.stat().st_size > 0


def extract_frames(video: Path, dest_dir: Path) -> FrameSelection:
    """Sahne kareleri (JPEG, ≤ 1280 px) ``dest_dir/frame-NN.jpg``; video akışı yoksa boş seçim."""
    video = Path(video)
    info = probe(video)
    if not info.has_video:
        return FrameSelection(frames=[], method="none", duration_sec=info.duration_sec)
    chosen, method = choose_timestamps(scene_scores(video), info.duration_sec)
    dest_dir.mkdir(parents=True, exist_ok=True)
    frames: list[Frame] = []
    for t, score in chosen:
        target = dest_dir / f"frame-{len(frames) + 1:02d}.jpg"
        if _grab(video, t, target):
            frames.append(Frame(path=target, t_sec=t, score=score, mime="image/jpeg"))
    return FrameSelection(frames=frames, method=method, duration_sec=info.duration_sec)


def fixture_frames(directory: Path, *, limit: int = MAX_FRAMES) -> list[Frame]:
    """Dry-run: ``fixtures/ders/frames/*.png`` (sıralı; zaman bilinmez → 0)."""
    files = sorted(p for p in Path(directory).iterdir() if p.suffix.lower() in IMAGE_SUFFIXES and p.is_file())
    return [Frame(path=p, t_sec=0.0, score=None, mime=IMAGE_SUFFIXES[p.suffix.lower()]) for p in files[:limit]]
