"""Model tabanlı şekil denetimi, OCR ve transkript adaptörleri.

Üçü de isteği burada kurar ve ``CostLedger.call`` üzerinden zincire (``vision_check``, ``ocr``,
``transcribe``) gönderir; böylece tavan kapısı, sağlayıcı düşüşü, şema doğrulaması/onarımı ve
``llm_calls`` kaydı tek yerdedir. Arkadaki ``LLM`` gerçek ``ProviderRouter`` ya da ``FakeLLM``
olabilir. Sahte eşlenikler (``fakes/media.py``) aynı istek kurucularını kullanır; aynı girdiyle
``FakeLLM`` ile aynı fixture'ı seçerler.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..purposes import output_errors
from .base import LLMRequest, Media

if TYPE_CHECKING:  # pragma: no cover
    from ..ledger import CostLedger

VISION_SYSTEM = (
    "Sen bir matematik şekli denetçisisin. Görüntüdeki şeklin soru kökündeki değerlerle uyuşup "
    "uyuşmadığını denetle. Yalnızca figure-render-report JSON döndür: matches_stem, status, mismatches, notes."
)
OCR_SYSTEM = (
    "Sen bir sınav arşivi OCR yardımcısısın. Her soruyu ayrı exam-item nesnesi olarak çıkar: item_no, topic, "
    "kind (proof|calc|mc|other), points, ocr_text. Yalnızca exam-item dizisi JSON döndür; yorum ekleme."
)
TRANSCRIBE_SYSTEM = (
    "Ders kaydını yazıya dök. Konuşmacıları yalnız ÖĞRENCİ ya da EĞİTMEN olarak etiketle; zamanı HH:MM:SS yaz. "
    "Yalnızca transcript JSON döndür: {\"segments\": [{\"t\", \"t_end\", \"speaker\", \"text\"}]}."
)
DIARIZE_SYSTEM = (
    "Aşağıdaki ders transkripti parçasında her bölümün konuşmacısını ÖĞRENCİ ya da EĞİTMEN olarak etiketle; "
    "metni ve zamanları değiştirme. Yalnızca transcript JSON döndür."
)
EXAM_META_KEYS = ("source_id", "year", "term", "instructor_alias")
DIARIZE_WINDOW_SEC = 120


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def vision_request(image: bytes, *, stem: str, stem_values: Mapping[str, Any], alt_text: str = "") -> LLMRequest:
    prompt = f"Soru kökü: {stem}\nKök değerleri: {_json(dict(stem_values))}\nŞekil açıklaması: {alt_text}"
    return LLMRequest(purpose="vision_check", model="", system=VISION_SYSTEM, prompt=prompt,
                      schema_id="figure-render-report", media=(Media(image, "image/png", "figure.png"),),
                      max_tokens=600, temperature=0.0)


def ocr_request(pages: Sequence[bytes], *, meta: Mapping[str, Any]) -> LLMRequest:
    hint = meta.get("fixture_hint")
    shown = {k: meta[k] for k in EXAM_META_KEYS if k in meta}
    prompt = f"Sayfa sayısı: {len(pages)}\nKaynak: {_json(shown)}"
    media = tuple(Media(p, "image/png", f"page-{i + 1}.png") for i, p in enumerate(pages))
    return LLMRequest(purpose="ocr", model="", system=OCR_SYSTEM, prompt=prompt, schema_id="exam-item[]",
                      media=media, max_tokens=8192, temperature=0.0, fixture_hint=str(hint) if hint else None)


def transcribe_request(audio: Path, data: bytes, *, language: str = "tr") -> LLMRequest:
    mime = "audio/wav" if audio.suffix.lower() == ".wav" else "audio/mpeg" if audio.suffix.lower() == ".mp3" else (
        "audio/ogg" if audio.suffix.lower() in (".ogg", ".oga") else "audio/wav")
    prompt = f"Dil: {language}\nDosya: {audio.name}"
    return LLMRequest(purpose="transcribe", model="", system=TRANSCRIBE_SYSTEM, prompt=prompt,
                      schema_id="transcript", media=(Media(data, mime, audio.name),), max_tokens=32768,
                      temperature=0.0, fixture_hint=audio.stem)


def apply_exam_meta(items: list[dict], meta: Mapping[str, Any]) -> list[dict]:
    """``instructor_alias``, ``year``, ``term``, ``source_id`` kaynaktan doldurulur (§6.4); model değeri ezilir."""
    out = []
    for item in items:
        row = dict(item)
        for key in EXAM_META_KEYS:
            if key in meta and meta[key] is not None:
                row[key] = meta[key]
        out.append(row)
    return out


class LLMVision:
    """``Vision`` Protocol'ü — ``vision_check`` zinciri."""

    def __init__(self, ledger: CostLedger, *, chain: str = "vision_check"):
        self.ledger = ledger
        self.chain = chain

    def check_figure(self, image: bytes, *, stem: str, stem_values: Mapping[str, Any], alt_text: str = "") -> dict:
        req = vision_request(image, stem=stem, stem_values=stem_values, alt_text=alt_text)
        return self.ledger.call("vision_check", req, chain=self.chain, ref_table="figures").data


class LLMOCR:
    """``OCR`` Protocol'ü — ``ocr`` zinciri; kaynak meta verisi her maddeye yazılır."""

    def __init__(self, ledger: CostLedger, *, chain: str = "ocr"):
        self.ledger = ledger
        self.chain = chain

    def extract_items(self, pages: Sequence[bytes], *, meta: Mapping[str, Any]) -> list[dict]:
        req = ocr_request(pages, meta=meta)
        ref = meta.get("source_id")
        result = self.ledger.call("ocr", req, chain=self.chain, ref_table="exam_sources",
                                  ref_id=str(ref) if ref else None)
        return apply_exam_meta(list(result.data), meta)


def transcript_or_unlabeled_errors(data: Any) -> list[str]:
    """``transcript`` sözleşmesi ya da Whisper'ın etiketsiz çıktısı (``{"segments": [...], "unlabeled": true}``)."""
    if isinstance(data, Mapping) and data.get("unlabeled") is True:
        segments = data.get("segments")
        if not isinstance(segments, list) or not segments:
            return ["etiketsiz transkript boş"]
        return [f"/segments/{i} t ve text zorunlu" for i, seg in enumerate(segments)
                if not (isinstance(seg, Mapping) and seg.get("t") and str(seg.get("text") or "").strip())]
    return output_errors("transcript", data)


def _seconds(ts: str) -> int:
    h, m, s = (int(x) for x in ts.split(":"))
    return h * 3600 + m * 60 + s


def diarize_windows(segments: Sequence[Mapping[str, Any]], window_sec: int = DIARIZE_WINDOW_SEC) -> list[list[dict]]:
    """Etiketsiz bölümleri ``window_sec`` (2 dk) pencerelere ayırır (§6.3)."""
    windows: dict[int, list[dict]] = {}
    for seg in segments:
        windows.setdefault(_seconds(str(seg["t"])) // window_sec, []).append(dict(seg))
    return [windows[k] for k in sorted(windows)]


def diarize_request(window: Sequence[Mapping[str, Any]]) -> LLMRequest:
    return LLMRequest(purpose="diarize", model="", system=DIARIZE_SYSTEM, prompt=_json({"segments": list(window)}),
                      schema_id="transcript", max_tokens=8192, temperature=0.0)


class LLMTranscriber:
    """``Transcriber`` Protocol'ü — ``transcribe`` zinciri (Gemini ses girdisi, konuşmacı etiketli); yedek
    Groq Whisper etiketsiz döndüğünde ``diarize`` zinciri 2 dakikalık pencerelerde ÖĞRENCİ/EĞİTMEN yazar."""

    def __init__(self, ledger: CostLedger, *, chain: str = "transcribe", diarize_chain: str = "diarize",
                 ref_table: str = "lessons"):
        self.ledger = ledger
        self.chain = chain
        self.diarize_chain = diarize_chain
        self.ref_table = ref_table

    def transcribe(self, audio: Path, *, language: str = "tr") -> dict:
        audio = Path(audio)
        req = transcribe_request(audio, audio.read_bytes(), language=language)
        data = self.ledger.call("transcribe", req, chain=self.chain, ref_table=self.ref_table,
                                validator=transcript_or_unlabeled_errors).data
        if not (isinstance(data, Mapping) and data.get("unlabeled") is True):
            return data
        labeled: list[dict] = []
        for window in diarize_windows(data["segments"]):
            part = self.ledger.call("diarize", diarize_request(window), chain=self.diarize_chain,
                                    ref_table=self.ref_table).data
            labeled.extend(part["segments"])
        result = {"segments": labeled}
        errs = output_errors("transcript", result)
        if errs:
            from ..errors import LedgerError

            raise LedgerError(f"OGR-LLM-001 diarize sonrası transkript geçersiz: {errs[0]}")
        return result
