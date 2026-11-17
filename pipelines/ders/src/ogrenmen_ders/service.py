"""Ders medya servisi (P5; docs/PLAN-v2.md §9): ffmpeg ile ses + sahne kareleri, Groq Whisper ile transkript.

Yalnız standart kitaplık kullanır (bağımlılık yok) ve paketin geri kalanını içe aktarmaz; böylece
``python3 -I <yol>/service.py --port 8711`` ile (yalıtılmış kip, PYTHONPATH yok) tek dosya olarak çalışır.
apps/worker ``lesson.*`` işleri bu servisi HTTP ile çağırır (``LESSON_SERVICE_URL``, varsayılan
``http://127.0.0.1:8711``).

Uç noktalar (gövde JSON, ≤ 64 KB; yanıt JSON):

* ``GET /healthz`` → ``{ok, ffmpeg, stt: groq|fake|none, storage, work_dir}``
* ``POST /prepare`` ``{lesson_id, local_path? | storage_path?, bucket?, dest_prefix?, max_frames?}`` →
  ``ffmpeg -vn -ac 1 -ar 16000`` WAV + sahne kareleri (≤ 30 JPEG, iki kenar da ≤ 1280 px; dikey 4K telefon kaydı
  da Claude API'nin çok görselli istek sınırının, kenar ≤ 2000 px, altında kalır). ``local_path`` çalışma kökü
  (``OGRENMEN_DERS_WORK_DIR``) altında göreli bir yoldur. Servisin Storage erişimi varsa (``SUPABASE_URL`` +
  ``SUPABASE_SERVICE_ROLE_KEY``) ``storage_path`` kaynağı indirilir ve çıktılar ``dest_prefix`` altına yüklenir
  (``stored: true``); yoksa yalnız yerel (köke göreli) yollar döner ve worker aynı makinede onları Storage'a yükler.
* ``POST /stt`` ``{lesson_id, wav_path? | storage_path?, bucket?, language?, fixture?}`` → ``{provider, language,
  duration_sec, chunks, segments: [{t0, t1, text}]}`` (saniye). Groq Whisper ``GROQ_API_KEY`` ile; dosya 25 MB'yi
  aşmasın diye ses ``OGRENMEN_STT_CHUNK_SEC`` (varsayılan 600 sn ≈ 19 MB) parçalara bölünür, zamanlar kaydırılır.
  ``OGRENMEN_STT=fake``: ağ yok, deterministik transkript (``fixtures/ders/*.transcript.json``; konuşmacısız, çünkü
  Whisper konuşmacı ayırmaz). İkisi de yoksa ``OGR-DERS-008`` (sessizce sahteye düşülmez).
* ``POST /cleanup`` ``{lesson_id}`` → dersin çalışma dizini silinir (24 saatten eski dizinler açılışta da silinir).

``bucket`` yalnız ``lessons`` olabilir (servis service_role anahtarı taşır; başka kovaya okuma/yazma yok,
``OGR-DERS-007``).
``OGRENMEN_DERS_TOKEN`` (ya da worker'la paylaşılan ``LESSON_SERVICE_TOKEN``) tanımlıysa her POST isteği
``Authorization: Bearer <token>`` taşımalıdır. ``--host ::`` IPv6 dinler (Fly 6PN); loopback dışı bir adreste
belirteç yoksa servis açılmaz (çıkış 78, EX_CONFIG).
Hata gövdesi ``{error: OGR-DERS-NNN, message}``: 001 girdi yok/okunamıyor, 004 ffmpeg, 007 geçersiz istek,
008 STT yapılandırılmamış ya da başarısız, 009 Storage, 010 yetkisiz.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Sequence
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_PORT = 8711
MAX_BODY = 64 * 1024
MAX_FRAMES = 30
MIN_FRAMES = 20
SCENE_THRESHOLD = 0.30
SCENE_THRESHOLD_HIGH = 0.45
SCENE_THRESHOLD_LOW = 0.20
MAX_WIDTH = 1280
LESSON_BUCKET = "lessons"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
EX_CONFIG = 78
SEEK_EPSILON = 0.0005
AUDIO_RATE = 16000
SUBPROCESS_TIMEOUT_S = 6 * 3600
STALE_DIR_S = 24 * 3600
GROQ_BASE = "https://api.groq.com/openai/v1"
GROQ_DEFAULT_MODEL = "whisper-large-v3-turbo"
GROQ_MAX_BYTES = 25 * 1024 * 1024
DEFAULT_CHUNK_SEC = 600
GROQ_TIMEOUT_S = 600
GROQ_ATTEMPTS = 3
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
STORAGE_PATH_RE = re.compile(r"^[^/]+(/[^/]+)+$")
FIXTURE_NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+\.json$")
SOURCE_EXT_RE = re.compile(r"^\.[A-Za-z0-9]{1,8}$")


class ServiceError(Exception):
    """İstemciye dönen hata: HTTP durumu + ``OGR-DERS-NNN`` kodu + Türkçe ileti."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code} {message}")
        self.status = status
        self.code = code
        self.message = message


# --- yapılandırma -----------------------------------------------------------------------------------------------------


def work_root() -> Path:
    raw = os.environ.get("OGRENMEN_DERS_WORK_DIR") or str(Path(tempfile.gettempdir()) / "ogrenmen-ders")
    root = Path(raw).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def stt_mode() -> str:
    """``groq`` (anahtar var), ``fake`` (OGRENMEN_STT=fake) ya da ``none``. Açık ``fake`` anahtarı ezer."""
    explicit = (os.environ.get("OGRENMEN_STT") or "").strip().lower()
    if explicit == "fake":
        return "fake"
    if explicit not in ("", "groq"):
        return "none"
    return "groq" if os.environ.get("GROQ_API_KEY") else "none"


def storage_config() -> tuple[str, str] | None:
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    return (url, key) if url and key else None


def chunk_seconds() -> int:
    try:
        v = int(os.environ.get("OGRENMEN_STT_CHUNK_SEC") or DEFAULT_CHUNK_SEC)
    except ValueError:
        v = DEFAULT_CHUNK_SEC
    # 16 kHz mono 16 bit = 32 000 B/sn: 25 MB sınırının altında kalan en uzun parça ~ 819 sn
    return max(1, min(v, (GROQ_MAX_BYTES - 1024 * 1024) // (AUDIO_RATE * 2)))


def fixtures_dir() -> Path:
    env = os.environ.get("OGRENMEN_STT_FIXTURES")
    if env:
        return Path(env)
    # pipelines/ders/src/ogrenmen_ders/service.py → depo kökü
    return Path(__file__).resolve().parents[4] / "fixtures" / "ders"


# --- ffmpeg -----------------------------------------------------------------------------------------------------------


def _bin(name: str) -> str:
    env = {"ffmpeg": "FFMPEG_BIN", "ffprobe": "FFPROBE_BIN"}[name]
    path = os.environ.get(env) or shutil.which(name)
    if not path:
        raise ServiceError(503, "OGR-DERS-004", f"{name} bulunamadı (kurulu olmalı ya da {env} ile verilmeli)")
    return path


def have_ffmpeg() -> bool:
    try:
        _bin("ffmpeg")
        _bin("ffprobe")
        return True
    except ServiceError:
        return False


def _run(args: Sequence[str], *, what: str, cwd: str | Path | None = None) -> subprocess.CompletedProcess[str]:
    try:
        proc = subprocess.run(list(args), capture_output=True, text=True, check=False, cwd=cwd,
                              timeout=SUBPROCESS_TIMEOUT_S)
    except subprocess.TimeoutExpired as exc:
        raise ServiceError(500, "OGR-DERS-004", f"{what} zaman aşımı") from exc
    except OSError as exc:
        raise ServiceError(500, "OGR-DERS-004", f"{what} çalıştırılamadı: {exc}") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-1:] or ["?"]
        raise ServiceError(422, "OGR-DERS-004", f"{what} başarısız (çıkış {proc.returncode}): {tail[0][:200]}")
    return proc


def probe(path: Path) -> dict:
    """Süre (sn) ve akış türleri; kapak resmi (attached_pic) ders karesi sayılmaz."""
    proc = _run([_bin("ffprobe"), "-v", "error", "-show_entries", "format=duration:stream=codec_type,disposition",
                 "-of", "json", str(path)], what="ffprobe")
    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams") or []
    video = [s for s in streams if s.get("codec_type") == "video"
             and not (s.get("disposition") or {}).get("attached_pic")]
    try:
        duration = float((data.get("format") or {}).get("duration") or 0.0)
    except ValueError:
        duration = 0.0
    return {"duration_sec": duration, "has_video": bool(video),
            "has_audio": any(s.get("codec_type") == "audio" for s in streams)}


def hms(seconds: float) -> str:
    s = max(0, int(seconds))
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def extract_audio(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    _run([_bin("ffmpeg"), "-nostdin", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", str(AUDIO_RATE),
          "-c:a", "pcm_s16le", "-map_metadata", "-1", "-fflags", "+bitexact", str(dest)], what="ffmpeg (ses)")
    return dest


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


def scene_scores(video: Path) -> list[tuple[float, float]]:
    with tempfile.TemporaryDirectory(prefix="ogrenmen-scene-") as tmp:
        target = Path(tmp) / "scores.txt"
        _run([_bin("ffmpeg"), "-nostdin", "-v", "error", "-i", str(video.resolve()), "-an", "-sn", "-dn",
              "-vf", "select='gte(scene,0)',metadata=print:file=scores.txt", "-f", "null", "-"],
             what="ffmpeg (sahne)", cwd=tmp)
        text = target.read_text(encoding="utf-8") if target.exists() else ""
    return parse_scene_scores(text)


def uniform_times(duration: float, target: int = MAX_FRAMES) -> list[float]:
    """Eşit aralıklı: en çok ``target`` kare, saniyede en çok bir kare; aralık ortaları."""
    if duration <= 0:
        return []
    n = min(target, max(1, int(math.floor(duration))))
    step = duration / n
    return [round((i + 0.5) * step, 6) for i in range(n)]


def _top(items: list[tuple[float, float]], k: int) -> list[tuple[float, float]]:
    return sorted(sorted(items, key=lambda x: (-x[1], x[0]))[:k])


def choose_timestamps(scores: Sequence[tuple[float, float]], duration: float, *, lo: int = MIN_FRAMES,
                      hi: int = MAX_FRAMES) -> tuple[list[tuple[float, float | None]], str]:
    """Sahne eşiği kuralı (saf, deterministik): 0.30 ile lo..hi kare; fazlaysa 0.45 (yine fazlaysa en yüksek hi),
    azsa 0.20; o da azsa eşit aralıklı en çok hi kare."""

    def above(th: float) -> list[tuple[float, float]]:
        return [(t, s) for t, s in scores if s > th]

    s30 = above(SCENE_THRESHOLD)
    if lo <= len(s30) <= hi:
        return list(s30), "scene>0.30"
    if len(s30) > hi:
        s45 = above(SCENE_THRESHOLD_HIGH)
        if lo <= len(s45) <= hi:
            return list(s45), "scene>0.45"
        return (list(_top(s45, hi)), "scene>0.45/top") if len(s45) > hi else (list(_top(s30, hi)), "scene>0.30/top")
    s20 = above(SCENE_THRESHOLD_LOW)
    if lo <= len(s20) <= hi:
        return list(s20), "scene>0.20"
    if len(s20) > hi:
        return list(_top(s20, hi)), "scene>0.20/top"
    times = uniform_times(duration, hi)
    return ([(t, None) for t in times], "uniform") if times else ([], "none")


def _grab(video: Path, t: float, dest: Path) -> bool:
    start = max(0.0, t - SEEK_EPSILON)
    _run([_bin("ffmpeg"), "-nostdin", "-v", "error", "-y", "-ss", f"{start:.4f}", "-i", str(video), "-frames:v", "1",
          "-an", "-vf",
          f"scale='min({MAX_WIDTH},iw)':'min({MAX_WIDTH},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
          "-q:v", "3", str(dest)], what="ffmpeg (kare)")
    return dest.is_file() and dest.stat().st_size > 0


def extract_frames(video: Path, dest_dir: Path, duration: float, *, hi: int = MAX_FRAMES) -> tuple[list[dict], str]:
    chosen, method = choose_timestamps(scene_scores(video), duration, lo=min(MIN_FRAMES, hi), hi=hi)
    dest_dir.mkdir(parents=True, exist_ok=True)
    frames: list[dict] = []
    for t, score in chosen:
        target = dest_dir / f"frame-{len(frames) + 1:02d}.jpg"
        if _grab(video, t, target):
            frames.append({"file": target, "t_sec": round(t, 3), "t": hms(t),
                           "score": None if score is None else round(score, 4)})
    return frames, method


# --- Storage (Supabase REST; supabase-py gerekmez) --------------------------------------------------------------------


def _storage_url(base: str, bucket: str, path: str) -> str:
    return f"{base}/storage/v1/object/{urllib.parse.quote(bucket)}/{urllib.parse.quote(path)}"


def storage_download(cfg: tuple[str, str], bucket: str, path: str, dest: Path) -> int:
    base, key = cfg
    req = urllib.request.Request(_storage_url(base, bucket, path),
                                 headers={"Authorization": f"Bearer {key}", "apikey": key})
    try:
        with urllib.request.urlopen(req, timeout=GROQ_TIMEOUT_S) as res, dest.open("wb") as fh:
            shutil.copyfileobj(res, fh, 1024 * 1024)
    except urllib.error.HTTPError as exc:
        raise ServiceError(424, "OGR-DERS-009", f"Storage indirme başarısız ({bucket}/{path}): HTTP {exc.code}"
                           ) from exc
    except (urllib.error.URLError, OSError) as exc:
        raise ServiceError(424, "OGR-DERS-009", f"Storage indirme başarısız ({bucket}/{path}): {exc}") from exc
    return dest.stat().st_size


def storage_upload(cfg: tuple[str, str], bucket: str, path: str, src: Path, content_type: str) -> None:
    base, key = cfg
    req = urllib.request.Request(_storage_url(base, bucket, path), data=src.read_bytes(), method="POST",
                                 headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": content_type,
                                          "x-upsert": "true"})
    try:
        with urllib.request.urlopen(req, timeout=GROQ_TIMEOUT_S) as res:
            res.read()
    except urllib.error.HTTPError as exc:
        raise ServiceError(424, "OGR-DERS-009", f"Storage yükleme başarısız ({bucket}/{path}): HTTP {exc.code}"
                           ) from exc
    except (urllib.error.URLError, OSError) as exc:
        raise ServiceError(424, "OGR-DERS-009", f"Storage yükleme başarısız ({bucket}/{path}): {exc}") from exc


# --- STT --------------------------------------------------------------------------------------------------------------


def _multipart(fields: dict[str, str], file_field: str, filename: str, data: bytes, mime: str) -> tuple[bytes, str]:
    boundary = f"ogrenmen-{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for k, v in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
                 f"Content-Type: {mime}\r\n\r\n".encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def groq_transcribe(audio: Path, *, language: str) -> dict:
    """Tek parça (≤ 25 MB) Groq Whisper isteği → ``{duration, segments: [{start, end, text}]}``. 429/5xx'te en çok üç
    deneme (``retry-after`` gözetilir); 4xx kalıcıdır. Ses sağlayıcıya nötr ``ders.wav`` adıyla gider."""
    key = os.environ.get("GROQ_API_KEY") or ""
    base = (os.environ.get("GROQ_BASE_URL") or GROQ_BASE).rstrip("/")
    model = os.environ.get("GROQ_STT_MODEL") or GROQ_DEFAULT_MODEL
    body, ctype = _multipart({"model": model, "response_format": "verbose_json", "language": language,
                              "temperature": "0"}, "file", "ders.wav", audio.read_bytes(), "audio/wav")
    last = ""
    for attempt in range(GROQ_ATTEMPTS):
        req = urllib.request.Request(f"{base}/audio/transcriptions", data=body, method="POST",
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
        try:
            with urllib.request.urlopen(req, timeout=GROQ_TIMEOUT_S) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
            if exc.code != 429 and exc.code < 500:
                raise ServiceError(502, "OGR-DERS-008", f"Groq STT reddetti: {last}") from exc
            wait = exc.headers.get("retry-after") if exc.headers else None
            delay = float(wait) if wait and wait.replace(".", "", 1).isdigit() else 2.0 * (attempt + 1)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            last = str(exc)[:200]
            delay = 2.0 * (attempt + 1)
        if attempt + 1 < GROQ_ATTEMPTS:
            time.sleep(min(delay, 30.0))
    raise ServiceError(502, "OGR-DERS-008", f"Groq STT başarısız: {last}")


def split_wav(wav: Path, dest_dir: Path, seconds: int) -> list[Path]:
    """``-f segment`` ile PCM kopyası; her parçanın başlığı doğru olur."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    for old in dest_dir.glob("part-*.wav"):
        old.unlink()
    _run([_bin("ffmpeg"), "-nostdin", "-v", "error", "-y", "-i", str(wav), "-f", "segment", "-segment_time",
          str(seconds), "-c", "copy", "-reset_timestamps", "1", str(dest_dir / "part-%03d.wav")], what="ffmpeg (parça)")
    return sorted(dest_dir.glob("part-*.wav"))


def _clean_segments(raw: Sequence[dict], offset: float) -> list[dict]:
    out: list[dict] = []
    for s in raw:
        text = str(s.get("text", "")).strip()
        if not text:
            continue
        t0 = max(0.0, float(s.get("start", 0) or 0) + offset)
        t1 = max(t0, float(s.get("end", 0) or 0) + offset)
        while text:  # bölüm metni 4000 karakterle sınırlı (write_lesson_transcript)
            out.append({"t0": round(t0, 2), "t1": round(t1, 2), "text": text[:4000]})
            text = text[4000:].strip()
    return out


def stt_groq(wav: Path, work: Path, *, language: str) -> dict:
    size = wav.stat().st_size
    parts = [wav] if size <= GROQ_MAX_BYTES - 1024 * 1024 else split_wav(wav, work / "chunks", chunk_seconds())
    if len(parts) == 1 and size > GROQ_MAX_BYTES - 1024 * 1024:
        raise ServiceError(422, "OGR-DERS-008", "ses parçalara bölünemedi")
    segments: list[dict] = []
    offset = 0.0
    for part in parts:
        data = groq_transcribe(part, language=language)
        segments += _clean_segments(data.get("segments") or [], offset)
        dur = data.get("duration")
        offset += float(dur) if isinstance(dur, (int, float)) and dur > 0 else probe(part)["duration_sec"]
    return {"provider": "groq", "segments": segments, "chunks": len(parts), "duration_sec": round(offset, 2)}


def _ts_seconds(v: object) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    m = re.fullmatch(r"(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?", str(v or ""))
    if not m:
        return 0.0
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3]) + (float(f"0.{m[4]}") if m[4] else 0.0)


def stt_fake(fixture: str | None) -> dict:
    """Deterministik transkript: fixture bölümleri (HH:MM:SS) saniyeye çevrilir, konuşmacı düşer (Whisper gibi)."""
    name = fixture or os.environ.get("OGRENMEN_STT_FIXTURE") or "lesson-01.transcript.json"
    if not FIXTURE_NAME_RE.match(name):
        raise ServiceError(400, "OGR-DERS-007", "fixture yalnız dosya adı olabilir")
    path = fixtures_dir() / name
    if not path.is_file():
        raise ServiceError(503, "OGR-DERS-008", f"sahte transkript yok: {name}")
    data = json.loads(path.read_text(encoding="utf-8"))
    raw = [{"start": _ts_seconds(s.get("t")), "end": _ts_seconds(s.get("t_end") or s.get("t")),
            "text": s.get("text", "")} for s in data.get("segments") or []]
    segments = _clean_segments(raw, 0.0)
    return {"provider": "fake", "segments": segments, "chunks": 1,
            "duration_sec": max((s["t1"] for s in segments), default=0.0)}


# --- istek işleme -----------------------------------------------------------------------------------------------------


def _lesson_dir(lesson_id: object) -> Path:
    if not isinstance(lesson_id, str) or not UUID_RE.match(lesson_id):
        raise ServiceError(400, "OGR-DERS-007", "lesson_id geçerli bir kimlik değil")
    d = work_root() / lesson_id.lower()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _inside_root(rel: object, what: str) -> Path:
    """Çalışma köküne göreli yol → mutlak; kök dışına çıkan, mutlak ya da boş yol reddedilir."""
    if not isinstance(rel, str) or not rel or rel.startswith("/") or "\\" in rel:
        raise ServiceError(400, "OGR-DERS-007", f"{what} çalışma köküne göreli bir yol olmalı")
    root = work_root()
    p = (root / rel).resolve()
    if root not in p.parents:
        raise ServiceError(400, "OGR-DERS-007", f"{what} çalışma kökünün dışında")
    return p


def _rel(p: Path) -> str:
    return p.resolve().relative_to(work_root()).as_posix()


def _storage_path(v: object, what: str) -> str:
    if not isinstance(v, str) or not STORAGE_PATH_RE.match(v) or re.search(r"(^|/)\.{1,2}(/|$)", v):
        raise ServiceError(400, "OGR-DERS-007", f"{what} geçerli bir Storage yolu değil")
    return v


def _bucket(body: dict) -> str:
    """İstekteki kova yalnız ``lessons`` olabilir (servis service_role taşır; diğer kovalar kapalı)."""
    b = body.get("bucket")
    if b is None or b == LESSON_BUCKET:
        return LESSON_BUCKET
    raise ServiceError(400, "OGR-DERS-007", "bucket yalnız 'lessons' olabilir")


def _source(body: dict, ldir: Path) -> Path:
    if body.get("local_path"):
        src = _inside_root(body["local_path"], "local_path")
        if not src.is_file():
            raise ServiceError(404, "OGR-DERS-001", "kaynak dosya yok")
        return src
    if body.get("storage_path"):
        path = _storage_path(body["storage_path"], "storage_path")
        cfg = storage_config()
        if cfg is None:
            raise ServiceError(400, "OGR-DERS-001", "servisin Storage erişimi yok: local_path verilmeli")
        ext = Path(path).suffix if SOURCE_EXT_RE.match(Path(path).suffix or "") else ".bin"
        dest = ldir / f"source{ext.lower()}"
        storage_download(cfg, _bucket(body), path, dest)
        return dest
    raise ServiceError(400, "OGR-DERS-001", "local_path ya da storage_path gerekli")


def handle_prepare(body: dict) -> dict:
    ldir = _lesson_dir(body.get("lesson_id"))
    bucket = _bucket(body)
    src = _source(body, ldir)
    try:
        hi = int(body.get("max_frames") or MAX_FRAMES)
    except (TypeError, ValueError) as exc:
        raise ServiceError(400, "OGR-DERS-007", "max_frames bir sayı olmalı") from exc
    hi = max(1, min(hi, MAX_FRAMES))
    info = probe(src)
    if not info["has_audio"]:
        raise ServiceError(422, "OGR-DERS-001", "kayıtta ses akışı yok")
    wav = extract_audio(src, ldir / "audio.wav")
    frames, method = (extract_frames(src, ldir / "frames", info["duration_sec"], hi=hi) if info["has_video"]
                      else ([], "none"))
    out = {
        "lesson_id": body["lesson_id"],
        "duration_sec": round(info["duration_sec"], 3),
        "has_video": info["has_video"],
        "has_audio": True,
        "method": method,
        "audio": {"path": _rel(wav), "bytes": wav.stat().st_size, "mime": "audio/wav"},
        "frames": [{"path": _rel(f["file"]), "t_sec": f["t_sec"], "t": f["t"], "score": f["score"],
                    "bytes": f["file"].stat().st_size, "mime": "image/jpeg"} for f in frames],
        "stored": False,
    }
    cfg = storage_config()
    prefix = body.get("dest_prefix")
    if cfg is not None and prefix:
        if not isinstance(prefix, str):
            raise ServiceError(400, "OGR-DERS-007", "dest_prefix metin olmalı")
        prefix = _storage_path(f"{prefix.rstrip('/')}/x", "dest_prefix")[:-2]
        out["audio"]["storage_path"] = f"{prefix}/audio.wav"
        storage_upload(cfg, bucket, out["audio"]["storage_path"], wav, "audio/wav")
        for fr, meta in zip(frames, out["frames"], strict=True):
            meta["storage_path"] = f"{prefix}/frames/{fr['file'].name}"
            storage_upload(cfg, bucket, meta["storage_path"], fr["file"], "image/jpeg")
        out["stored"] = True
    return out


def handle_stt(body: dict) -> dict:
    ldir = _lesson_dir(body.get("lesson_id"))
    language = str(body.get("language") or "tr")
    if not re.fullmatch(r"[a-z]{2}", language):
        raise ServiceError(400, "OGR-DERS-007", "language iki harfli bir dil kodu olmalı")
    bucket = _bucket(body)
    mode = stt_mode()
    if mode == "none":
        raise ServiceError(503, "OGR-DERS-008", "STT yapılandırılmamış (GROQ_API_KEY ya da OGRENMEN_STT=fake)")
    wav: Path | None = None
    if body.get("wav_path"):
        cand = _inside_root(body["wav_path"], "wav_path")
        wav = cand if cand.is_file() else None
    if wav is None and body.get("storage_path"):
        cfg = storage_config()
        if cfg is not None:
            wav = ldir / "audio.wav"
            src = _storage_path(body["storage_path"], "storage_path")
            storage_download(cfg, bucket, src, wav)
    if mode == "fake":
        res = stt_fake(body.get("fixture") if isinstance(body.get("fixture"), str) else None)
        if wav is not None and have_ffmpeg():
            res["duration_sec"] = round(max(res["duration_sec"], probe(wav)["duration_sec"]), 2)
    else:
        if wav is None:
            raise ServiceError(404, "OGR-DERS-001", "ses dosyası yok (wav_path ya da storage_path)")
        res = stt_groq(wav, ldir, language=language)
    res["language"] = language
    return res


def handle_cleanup(body: dict) -> dict:
    lesson_id = body.get("lesson_id")
    if not isinstance(lesson_id, str) or not UUID_RE.match(lesson_id):
        raise ServiceError(400, "OGR-DERS-007", "lesson_id geçerli bir kimlik değil")
    d = work_root() / lesson_id.lower()
    existed = d.exists()
    shutil.rmtree(d, ignore_errors=True)
    return {"lesson_id": lesson_id, "removed": existed}


def sweep_stale(now: float | None = None) -> int:
    """Çalışma kökünde 24 saatten eski ders dizinlerini siler (yarım kalmış işler)."""
    now = time.time() if now is None else now
    n = 0
    for d in work_root().iterdir():
        if d.is_dir() and UUID_RE.match(d.name) and now - d.stat().st_mtime > STALE_DIR_S:
            shutil.rmtree(d, ignore_errors=True)
            n += 1
    return n


def health() -> dict:
    return {"ok": True, "ffmpeg": have_ffmpeg(), "stt": stt_mode(), "storage": storage_config() is not None,
            "work_dir": str(work_root())}


ROUTES = {"/prepare": handle_prepare, "/stt": handle_stt, "/cleanup": handle_cleanup}
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lesson_lock(body: dict) -> threading.Lock:
    key = str(body.get("lesson_id") or "")
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


class Handler(BaseHTTPRequestHandler):
    server_version = "ogrenmen-ders/2"

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401 - stdlib imzası
        if os.environ.get("OGRENMEN_DERS_QUIET") != "1":
            sys.stderr.write("ders-servis: " + (fmt % args) + "\n")

    def _send(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorized(self) -> bool:
        token = service_token()
        return not token or self.headers.get("Authorization") == f"Bearer {token}"

    def do_GET(self) -> None:  # noqa: N802 - stdlib adı
        if self.path.split("?", 1)[0] in ("/healthz", "/health"):
            self._send(200, health())
        else:
            self._send(404, {"error": "OGR-DERS-007", "message": "uç nokta yok"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib adı
        fn = ROUTES.get(self.path.split("?", 1)[0])
        if fn is None:
            self._send(404, {"error": "OGR-DERS-007", "message": "uç nokta yok"})
            return
        if not self._authorized():
            self._send(401, {"error": "OGR-DERS-010", "message": "yetkisiz"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY:
                raise ServiceError(400, "OGR-DERS-007", "gövde 1 bayt ile 64 KB arasında JSON olmalı")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(body, dict):
                raise ServiceError(400, "OGR-DERS-007", "gövde bir JSON nesnesi olmalı")
            with _lesson_lock(body):
                self._send(200, fn(body))
        except ServiceError as exc:
            self._send(exc.status, {"error": exc.code, "message": exc.message})
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"error": "OGR-DERS-007", "message": "gövde geçerli JSON değil"})
        except Exception as exc:  # noqa: BLE001 - servis düşmez, hata istemciye döner
            self._send(500, {"error": "OGR-DERS-004", "message": f"beklenmeyen hata: {type(exc).__name__}"})


class _Server6(ThreadingHTTPServer):
    """IPv6 dinleyici (Fly iç ağı 6PN yalnız IPv6'dır: ``--host ::``)."""

    address_family = socket.AF_INET6


def make_server(host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    server = (_Server6 if ":" in host else ThreadingHTTPServer)((host, port), Handler)
    server.daemon_threads = True
    return server


def service_token() -> str | None:
    return (os.environ.get("OGRENMEN_DERS_TOKEN") or os.environ.get("LESSON_SERVICE_TOKEN") or "").strip() or None


def is_loopback(host: str) -> bool:
    return host in LOOPBACK_HOSTS or host.startswith("127.")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ogrenmen-ders-service",
                                     description="Öğrenmen ders medya servisi (ffmpeg + STT)")
    parser.add_argument("--host", default=os.environ.get("LESSON_SERVICE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("LESSON_SERVICE_PORT", DEFAULT_PORT)))
    args = parser.parse_args(argv)
    if not is_loopback(args.host) and service_token() is None:
        # ağa açık (ör. Fly 6PN, --host ::) ve service_role taşıyan servis belirteçsiz açılmaz
        sys.stderr.write(f"ders-servis: {args.host} loopback değil; OGRENMEN_DERS_TOKEN ya da LESSON_SERVICE_TOKEN "
                         "gerekli (açılmadı)\n")
        sys.stderr.flush()
        return EX_CONFIG
    removed = sweep_stale()
    server = make_server(args.host, args.port)
    h = health()
    sys.stderr.write(f"ders-servis: {args.host}:{server.server_address[1]} ffmpeg={h['ffmpeg']} stt={h['stt']} "
                     f"storage={h['storage']} eski_dizin={removed}\n")
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
