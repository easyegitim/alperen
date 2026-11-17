"""Ortak yardımcılar: TS testleriyle aynı fikstür ve vaka dosyaları (packages/contracts/)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

CONTRACTS = Path(__file__).resolve().parents[2]
FIXTURES = CONTRACTS / "fixtures"
CASES = CONTRACTS / "test" / "cases"
SCHEMA_DIR = CONTRACTS / "schemas"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def fixture_files():
    out = []
    for schema_dir in sorted(p for p in FIXTURES.iterdir() if (p / "valid").is_dir()):
        expect_path = schema_dir / "expect.json"
        expect = read_json(expect_path) if expect_path.exists() else {}
        for kind in ("valid", "invalid"):
            for f in sorted((schema_dir / kind).glob("*.json")):
                out.append(
                    pytest.param(
                        schema_dir.name, kind, f, expect.get(f.name, []), id=f"{schema_dir.name}/{kind}/{f.name}"
                    )
                )
    return out
