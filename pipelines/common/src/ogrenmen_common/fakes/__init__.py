"""Deterministik sahteler (aynı girdi → aynı çıktı; ağ yok, anahtar yok)."""

from __future__ import annotations

import json
from importlib import resources

from .embedding import FakeEmbedding, cosine, hash_vector, to_halfvec
from .jsonl_db import JsonlDb
from .llm import FakeCall, FakeLLM, candidate_names, fixture_index, select_fixture
from .media import FakeOCR, FakeTranscriber, FakeVision
from .notifier import FakeNotifier
from .storage import LocalDirStorage


def rpc_names() -> list[str]:
    """``fakes/rpc-names.json`` — v2 migration gövdesi olan JsonlDb.rpc() eşlenikleri (check-rpc-parity.py okur)."""
    text = resources.files(__name__).joinpath("rpc-names.json").read_text(encoding="utf-8")
    return list(json.loads(text))


def legacy_rpc_names() -> list[str]:
    """``fakes/rpc-names-legacy-v1.json`` — v2'de karşılığı olmayan, P3/P5'e kadar duran eşlenikler (parite: WARN)."""
    text = resources.files(__name__).joinpath("rpc-names-legacy-v1.json").read_text(encoding="utf-8")
    return list(json.loads(text))


__all__ = [
    "FakeCall",
    "FakeEmbedding",
    "FakeLLM",
    "FakeNotifier",
    "FakeOCR",
    "FakeTranscriber",
    "FakeVision",
    "JsonlDb",
    "LocalDirStorage",
    "candidate_names",
    "cosine",
    "fixture_index",
    "hash_vector",
    "legacy_rpc_names",
    "rpc_names",
    "select_fixture",
    "to_halfvec",
]
