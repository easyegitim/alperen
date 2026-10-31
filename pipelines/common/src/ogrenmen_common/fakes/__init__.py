"""Deterministik sahteler (aynı girdi → aynı çıktı; ağ yok, anahtar yok)."""

from __future__ import annotations

import json
from importlib import resources

from .embedding import FakeEmbedding, cosine, hash_vector, to_halfvec
from .jsonl_db import JsonlDb
from .llm import FakeCall, FakeLLM, candidate_names, fixture_index, select_fixture
from .media import FakeOCR, FakeTranscriber, FakeVision
from .notifier import FakeNotifier
from .scholar import FakeArxiv, FakeCrossref, FakeScholar, FakeUnpaywall
from .storage import LocalDirStorage


def rpc_names() -> list[str]:
    """``fakes/rpc-names.json`` — JsonlDb.rpc() eşleniklerinin adları (M13 ``check-rpc-parity.sh`` okur)."""
    text = resources.files(__name__).joinpath("rpc-names.json").read_text(encoding="utf-8")
    return list(json.loads(text))


__all__ = [
    "FakeArxiv",
    "FakeCall",
    "FakeCrossref",
    "FakeEmbedding",
    "FakeLLM",
    "FakeNotifier",
    "FakeOCR",
    "FakeScholar",
    "FakeTranscriber",
    "FakeUnpaywall",
    "FakeVision",
    "JsonlDb",
    "LocalDirStorage",
    "candidate_names",
    "cosine",
    "fixture_index",
    "hash_vector",
    "rpc_names",
    "select_fixture",
    "to_halfvec",
]
