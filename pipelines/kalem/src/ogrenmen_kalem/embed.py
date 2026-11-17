"""``kalem embed --course`` — ``exam_items.ocr_text`` → ``embedding`` (``halfvec(768)``; §6.4).

Metin modele gitmeden önce ``scrub_for_llm``'den geçer; çağrı ``rt.embedding`` (``LedgeredEmbedding``) ile
``check_spend('embedding')`` kapısından ve ``llm_calls`` defterinden geçer. Varsayılan yalnız gömmesi boş
maddeler (``--all`` hepsini yeniden gömer).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from ogrenmen_common.pii import scrub_for_llm

from .common import course_items, parse_vector, to_halfvec, update_minimal

BATCH = 64


def embed_items(rt: Any, items: Sequence[Mapping[str, Any]], *, name_hashes: Sequence[str] = (),
                refresh: bool = False) -> dict[str, list[float]]:
    """Maddelerin vektörleri (``id → vektör``); eksik olanlar gömülüp ``exam_items.embedding``'e yazılır."""
    vectors: dict[str, list[float]] = {}
    todo: list[Mapping[str, Any]] = []
    for item in items:
        vec = None if refresh else parse_vector(item.get("embedding"))
        if vec is not None:
            vectors[str(item["id"])] = vec
        elif str(item.get("ocr_text") or "").strip():
            todo.append(item)
    for i in range(0, len(todo), BATCH):
        part = todo[i:i + BATCH]
        texts = [scrub_for_llm(str(it["ocr_text"]), list(name_hashes)).text for it in part]
        got = rt.embedding.embed(texts)
        for it, vec in zip(part, got, strict=True):
            vectors[str(it["id"])] = [float(x) for x in vec]
            update_minimal(rt.db, "exam_items", {"embedding": to_halfvec(vec)}, where={"id": str(it["id"])})
    return vectors


def embed_course(rt: Any, course: Mapping[str, Any], *, name_hashes: Sequence[str] = (),
                 refresh: bool = False) -> dict[str, Any]:
    items = course_items(rt.db, str(course["id"]))
    before = sum(1 for it in items if parse_vector(it.get("embedding")) is not None)
    vectors = embed_items(rt, items, name_hashes=name_hashes, refresh=refresh)
    embedded = len(vectors) - (0 if refresh else before)
    return {"course_code": course["code"], "items": len(items), "embedded": embedded,
            "without_text": sum(1 for it in items if not str(it.get("ocr_text") or "").strip())}
