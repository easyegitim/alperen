"""Transkript: ``transcribe`` zinciri (ya da yerel whisper.cpp) → ad temizliği → ``transcripts/<id>.jsonl``.

PII kuralı (§6.3 adım 3, §9.1): adlar modele giden HİÇBİR metinde yer almaz. Dersin ad-token hash'leri
``resolve_lesson_labels(lesson)`` RPC'sinden gelir (düz ad hiç alınmaz); ``ogrenmen_common.pii.label_transcript``
öğrenci adını ``[ÖĞRENCİ]``, eğitmen adını ``[EĞİTMEN]``, kalan "hocam X" kalıbını ``[AD]`` yapar. Whisper yolunda
etiketsiz metin ``diarize`` zincirine **temizlendikten sonra** gider; son kemer ``assert_no_names`` gönderilecek
metinde hash'i listede olan bir token görürse isteği hiç göndermez (``OGR-DERS-003``). Dersin öğrencisine ait
hiç ``ÖĞRENCİ`` hash'i yoksa (``student_pii.display_name`` boş ya da ``name_token_hashes='{}'``) temizlik
doğrulanamaz; bu durumda hiçbir model çağrısı yapılmaz (``require_student_labels``, ``OGR-DERS-003``).

``PayloadLog.sending`` her ``CostLedger.call`` süresince defterin LLM adaptörünü sarar: sağlayıcıya giden HER istek —
onarım turu (``REPAIR_NOTE`` + hatalar) ve yedek model denemeleri dahil — gönderilmeden hemen önce son kemerden geçer
ve ``out/api_payload.json``'a (sistem metni, istem, model, ek dosyaların adı/türü/boyu) gönderildiği hâliyle yazılır.
Onarım istemine giren doğrulama hataları da önce ad hash'leriyle temizlenir (``scrubbing_validator``).
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path
from typing import Any

import ogrenmen_contracts as contracts
from ogrenmen_common.adapters.base import LLMRequest
from ogrenmen_common.adapters.media import (
    diarize_request,
    diarize_windows,
    transcribe_request,
    transcript_or_unlabeled_errors,
)
from ogrenmen_common.pii import label_transcript, name_leaks, role_hashes_from_labels, scrub_for_llm
from ogrenmen_common.purposes import output_errors
from ogrenmen_common.runtime import Runtime

from .errors import DersError
from .media import hms

SEGMENT_SCHEMA = "transcript#/$defs/segment"
SEGMENT_KEYS = ("t", "t_end", "speaker", "text")
MAX_SEGMENT_TEXT = 4000
ENGINES = ("chain", "whispercpp")
STUDENT_LABEL = "ÖĞRENCİ"
WHISPER_TIMEOUT_S = 6 * 3600

Validator = Callable[[Any], list[str]]


class PayloadLog:
    """Sağlayıcıya giden isteklerin kaydı (``out/api_payload.json``); ``sending`` ile her gönderim yakalanır."""

    def __init__(self) -> None:
        self.requests: list[dict] = []

    def add(self, request: LLMRequest, *, chain: str) -> None:
        self.requests.append({
            "purpose": request.purpose,
            "chain": chain,
            "model": request.model,
            "schema_id": request.schema_id,
            "system": request.system,
            "prompt": request.prompt,
            "media": [{"name": m.name, "mime": m.mime, "bytes": len(m.data)} for m in request.media],
        })

    @contextmanager
    def sending(self, rt: Runtime, *, chain: str, name_hashes: Sequence[str], what: str) -> Iterator[None]:
        """Blok süresince ``rt.ledger.llm``'i ``_GuardedLLM`` ile sarar; çıkışta eski adaptör geri konur."""
        inner = rt.ledger.llm
        rt.ledger.llm = _GuardedLLM(inner, self, chain=chain, name_hashes=name_hashes, what=what)
        try:
            yield
        finally:
            rt.ledger.llm = inner

    def as_dict(self, lesson_id: str) -> dict:
        return {"lesson_ref": lesson_id, "requests": list(self.requests)}

    def write(self, out: Path, lesson_id: str) -> Path:
        out.mkdir(parents=True, exist_ok=True)
        path = out / "api_payload.json"
        path.write_text(json.dumps(self.as_dict(lesson_id), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return path


class _GuardedLLM:
    """Defterin LLM adaptörü için vekil: ``complete`` öncesi son kemer + kayıt; diğer öznitelikler içe yönlenir
    (``available``, sahtelerin ``calls`` listesi …)."""

    def __init__(self, inner: Any, log: PayloadLog, *, chain: str, name_hashes: Sequence[str], what: str) -> None:
        self._inner = inner
        self._log = log
        self._chain = chain
        self._hashes = list(name_hashes)
        self._what = what

    def complete(self, request: LLMRequest):
        assert_no_names(request.system + "\n" + request.prompt, self._hashes, what=self._what)
        self._log.add(request, chain=self._chain)
        return self._inner.complete(request)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


def scrubbing_validator(check: Validator, labels: Sequence[Mapping[str, Any]],
                        name_hashes: Sequence[str]) -> Validator:
    """Doğrulayıcının hata metinleri onarım istemine girer; model çıktısından alıntı (ör. ad geçen bir bölüm)
    taşıyabilecekleri için gönderilmeden önce ad hash'leriyle temizlenir."""
    roles = role_hashes_from_labels(labels)

    def wrapped(data: Any) -> list[str]:
        return [scrub_for_llm(str(e), name_hashes, roles).text for e in check(data)]

    return wrapped


def lesson_labels(rt: Runtime, lesson_id: str) -> tuple[list[dict], list[str]]:
    """``resolve_lesson_labels`` → (``[{hash, label}]``, hash listesi). Düz ad hiçbir zaman dönmez."""
    rows = rt.db.rpc("resolve_lesson_labels", {"p_lesson": lesson_id}) or []
    labels = [{"hash": str(r["hash"]), "label": str(r["label"])} for r in rows]
    return labels, sorted({r["hash"] for r in labels})


def require_student_labels(labels: Sequence[Mapping[str, Any]]) -> None:
    """Kapalı başarısızlık: öğrencinin ad hash'i yoksa temizlik doğrulanamaz, hiçbir istek gönderilmez.

    ``resolve_lesson_labels`` ``student_pii.display_name`` boşsa ya da ``name_token_hashes='{}'`` ise ÖĞRENCİ satırı
    döndürmez; o durumda ``assert_no_names`` boş listeye karşı her metni geçirirdi."""
    if not any(str(row.get("label")) == STUDENT_LABEL for row in labels):
        raise DersError("OGR-DERS-003 öğrenci ad hash'i yok; ad temizliği yapılamaz, istek gönderilmedi")


def assert_no_names(text: str, name_hashes: Sequence[str], *, what: str) -> None:
    """Son kemer: metinde hash'i listede olan token varsa istek gönderilmez."""
    leaks = name_leaks(text, name_hashes)
    if leaks:
        raise DersError(f"OGR-DERS-003 {what}: ad temizliği doğrulanamadı ({len(leaks)} token); istek gönderilmedi")


def _split_text(text: str, limit: int = MAX_SEGMENT_TEXT) -> list[str]:
    text = " ".join(str(text).split())
    if len(text) <= limit:
        return [text] if text else []
    parts: list[str] = []
    while len(text) > limit:
        cut = text.rfind(" ", 0, limit)
        cut = limit if cut <= 0 else cut
        parts.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        parts.append(text)
    return parts


def normalize_segments(transcript: Mapping[str, Any]) -> dict:
    """Bölümleri sözleşme anahtarlarına indirger (``t, t_end, speaker, text``), boşları atar, uzunları böler."""
    out: list[dict] = []
    for seg in transcript.get("segments") or []:
        for text in _split_text(str(seg.get("text") or "")):
            row = {"t": str(seg["t"]), "speaker": seg.get("speaker"), "text": text}
            if seg.get("t_end"):
                row["t_end"] = str(seg["t_end"])
            out.append({k: row[k] for k in SEGMENT_KEYS if k in row})
    return {"segments": out}


def clean_transcript(transcript: Mapping[str, Any], labels: Sequence[Mapping[str, Any]],
                     name_hashes: Sequence[str]) -> tuple[dict, int]:
    """Ad temizliği + biçim; her bölüm ``transcript#/$defs/segment``'ten geçer."""
    cleaned, replaced = label_transcript(normalize_segments(transcript), labels, name_hashes)
    cleaned = normalize_segments(cleaned)
    if not cleaned["segments"]:
        raise DersError("OGR-DERS-005 transkript boş")
    for i, seg in enumerate(cleaned["segments"]):
        errs = contracts.errors(SEGMENT_SCHEMA, seg)
        if errs:
            raise DersError(f"OGR-DERS-005 transkript bölümü {i} geçersiz: {errs[0].path} {errs[0].message}")
    assert_no_names(json.dumps(cleaned, ensure_ascii=False), name_hashes, what="transkript")
    return cleaned, replaced


def transcript_jsonl(transcript: Mapping[str, Any]) -> bytes:
    """Storage ``transcripts/<id>.jsonl``: satır başına bir bölüm."""
    lines = [json.dumps(seg, ensure_ascii=False) for seg in transcript["segments"]]
    return ("\n".join(lines) + "\n").encode("utf-8")


def transcript_text(transcript: Mapping[str, Any]) -> str:
    """Analiz istemindeki biçim: ``[00:00:04–00:00:06] EĞİTMEN: …``."""
    rows = []
    for seg in transcript["segments"]:
        span = f"{seg['t']}–{seg['t_end']}" if seg.get("t_end") else seg["t"]
        rows.append(f"[{span}] {seg['speaker']}: {seg['text']}")
    return "\n".join(rows)


# --- motorlar -----------------------------------------------------------------------------------


def _diarize(rt: Runtime, segments: Sequence[Mapping[str, Any]], *, labels: Sequence[Mapping[str, Any]],
             name_hashes: Sequence[str], payloads: PayloadLog, lesson_id: str, student_ref: str | None) -> dict:
    """Etiketsiz bölümler → (önce ad temizliği) → ``diarize`` zinciri, 2 dakikalık pencereler."""
    require_student_labels(labels)
    cleaned, _ = label_transcript({"segments": [dict(s) for s in segments]}, labels, name_hashes)
    labeled: list[dict] = []
    for window in diarize_windows(cleaned["segments"]):
        req = diarize_request(window)
        assert_no_names(req.prompt, name_hashes, what="diarize istemi")
        schema_id = req.schema_id
        check = scrubbing_validator(lambda data, sid=schema_id: output_errors(sid, data) if sid else [], labels,
                                    name_hashes)
        with payloads.sending(rt, chain="diarize", name_hashes=name_hashes, what="diarize istemi"):
            part = rt.ledger.call("diarize", req, chain="diarize", ref_table="lessons", ref_id=lesson_id,
                                  student_ref=student_ref, validator=check).data
        labeled.extend(part["segments"])
    return {"segments": labeled}


def _chain(rt: Runtime, audio: Path, *, language: str, hint: str | None, labels: Sequence[Mapping[str, Any]],
           name_hashes: Sequence[str], payloads: PayloadLog, lesson_id: str, student_ref: str | None) -> dict:
    """``transcribe`` zinciri: Gemini (ses doğrudan, konuşmacı etiketli) ya da yedek Whisper (etiketsiz → diarize).
    Ses dosyası nötr adla gönderilir; dosya adı sağlayıcıya gitmez (ad içerebilir)."""
    data = Path(audio).read_bytes()
    req = transcribe_request(Path("ders.wav"), data, language=language)
    req = replace(req, fixture_hint=hint)
    check = scrubbing_validator(transcript_or_unlabeled_errors, labels, name_hashes)
    with payloads.sending(rt, chain="transcribe", name_hashes=name_hashes, what="transkript istemi"):
        result = rt.ledger.call("transcribe", req, chain="transcribe", ref_table="lessons", ref_id=lesson_id,
                                student_ref=student_ref, validator=check).data
    if isinstance(result, Mapping) and result.get("unlabeled") is True:
        return _diarize(rt, result["segments"], labels=labels, name_hashes=name_hashes, payloads=payloads,
                        lesson_id=lesson_id, student_ref=student_ref)
    return dict(result)


def _ts_from_ms(value: Any) -> str:
    try:
        return hms(int(value) / 1000)
    except (TypeError, ValueError):
        return "00:00:00"


def parse_whisper_cpp(data: Mapping[str, Any]) -> list[dict]:
    """whisper.cpp ``-oj`` çıktısı (``transcription[].offsets.from/to`` ms, ``text``) → etiketsiz bölümler."""
    out = []
    for item in data.get("transcription") or []:
        text = " ".join(str(item.get("text") or "").split())
        if not text:
            continue
        offsets = item.get("offsets") or {}
        out.append({"t": _ts_from_ms(offsets.get("from")), "t_end": _ts_from_ms(offsets.get("to")), "text": text})
    return out


def whisper_cpp(audio: Path, *, language: str = "tr", env: Mapping[str, str] | None = None) -> list[dict]:
    """Yerel whisper.cpp (``WHISPER_CPP_BIN`` + ``WHISPER_CPP_MODEL``); ağ ve maliyet yok."""
    env = os.environ if env is None else env
    binary, model = env.get("WHISPER_CPP_BIN"), env.get("WHISPER_CPP_MODEL")
    if not binary or not model:
        raise DersError("OGR-DERS-006 whisper.cpp için WHISPER_CPP_BIN ve WHISPER_CPP_MODEL gerekli")
    with tempfile.TemporaryDirectory(prefix="ogrenmen-whisper-") as tmp:
        prefix = Path(tmp) / "transkript"
        args = [binary, "-m", model, "-f", str(audio), "-l", language, "-oj", "-of", str(prefix), "-np"]
        try:
            proc = subprocess.run(args, capture_output=True, text=True, check=False, timeout=WHISPER_TIMEOUT_S)
        except subprocess.TimeoutExpired as exc:
            raise DersError(f"OGR-DERS-006 whisper.cpp zaman aşımı ({WHISPER_TIMEOUT_S} sn)") from exc
        except OSError as exc:
            raise DersError(f"OGR-DERS-006 whisper.cpp çalıştırılamadı: {exc}") from exc
        out = prefix.with_suffix(".json")
        if proc.returncode != 0 or not out.is_file():
            raise DersError(f"OGR-DERS-006 whisper.cpp başarısız (çıkış {proc.returncode})")
        segments = parse_whisper_cpp(json.loads(out.read_text(encoding="utf-8")))
    if not segments:
        raise DersError("OGR-DERS-006 whisper.cpp boş transkript döndürdü")
    return segments


def transcribe_audio(rt: Runtime, audio: Path, *, lesson_id: str, student_ref: str | None,
                     labels: Sequence[Mapping[str, Any]], name_hashes: Sequence[str], payloads: PayloadLog,
                     engine: str = "chain", language: str = "tr", hint: str | None = None,
                     env: Mapping[str, str] | None = None) -> dict:
    """Ham (konuşmacı etiketli, henüz temizlenmemiş olabilir) transkript."""
    if engine not in ENGINES:
        raise DersError(f"OGR-DERS-007 bilinmeyen transkript motoru: {engine}")
    require_student_labels(labels)
    if engine == "whispercpp":
        return _diarize(rt, whisper_cpp(audio, language=language, env=env), labels=labels, name_hashes=name_hashes,
                        payloads=payloads, lesson_id=lesson_id, student_ref=student_ref)
    return _chain(rt, audio, language=language, hint=hint, labels=labels, name_hashes=name_hashes, payloads=payloads,
                  lesson_id=lesson_id, student_ref=student_ref)
