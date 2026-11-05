"""FakeEmbedding — sha256 → 768 boyutlu birim vektör (§12 #32: aynı metin → aynı vektör)."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence
from typing import Any

import numpy as np
import ogrenmen_contracts as contracts

DIMS = 768


def hash_vector(text: str, dims: int = DIMS) -> list[float]:
    """Metnin deterministik birim vektörü: ``sha256(f"{i}:{metin}")`` blokları → uint32 → [-1, 1) → L2 = 1."""
    if dims <= 0:
        raise ValueError("dims pozitif olmalı")
    need = dims * 4
    chunks = []
    i = 0
    while sum(len(c) for c in chunks) < need:
        chunks.append(hashlib.sha256(f"{i}:{text}".encode()).digest())
        i += 1
    raw = np.frombuffer(b"".join(chunks)[:need], dtype=">u4").astype(np.float64)
    vec = raw / 2.0**31 - 1.0
    norm = float(np.linalg.norm(vec))
    if norm == 0.0:  # pragma: no cover - sha256 çıktısında olası değil
        vec = np.ones(dims) / np.sqrt(dims)
    else:
        vec = vec / norm
    return [float(x) for x in vec]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Kosinüs benzerliği (``1 - (a <=> b)`` eşleniği)."""
    va, vb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    na, nb = float(np.linalg.norm(va)), float(np.linalg.norm(vb))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def to_halfvec(vec: Sequence[float]) -> str:
    """pgvector ``halfvec`` metin biçimi: ``[0.0123,-0.04,…]`` (yarı hassasiyete yetecek 6 anlamlı basamak)."""
    return "[" + ",".join(f"{x:.6g}" for x in vec) + "]"


def embedding_model(models: Mapping[str, Any] | None = None) -> tuple[str, int]:
    """``models.json`` ``chains.embedding[0]`` ve onun ``dims`` değeri (model adı koda yazılmaz, §4.9)."""
    models = contracts.load_models() if models is None else models
    name = models["chains"]["embedding"][0]
    return name, int(models["models"][name].get("dims") or DIMS)


class FakeEmbedding:
    """``Embedding`` Protocol'ü; ``calls`` her ``embed`` çağrısındaki metin sayısını kaydeder. ``model`` ve
    varsayılan ``dims`` ``models.json`` ``embedding`` zincirinden gelir."""

    name = "fake"

    def __init__(self, dims: int | None = None, *, models: Mapping[str, Any] | None = None):
        model, model_dims = embedding_model(models)
        self.model = model
        self.dims = int(dims) if dims is not None else model_dims
        self.calls: list[int] = []

    def embed(self, texts: Sequence[str]) -> list[list[float]]:
        if isinstance(texts, str):
            raise TypeError("embed metin listesi bekler")
        self.calls.append(len(texts))
        return [hash_vector(t, self.dims) for t in texts]
