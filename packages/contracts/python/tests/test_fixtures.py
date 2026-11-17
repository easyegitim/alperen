"""Fikstürler (TS `test/fixtures.test.ts` ile aynı dosyalar).

`refine-` önekli geçersiz dosyalar yalnız TS tarafındaki çapraz alan kuralıyla (zod `refine`) düşer; JSON Schema ifade
edemediği için Python onları geçerli bulur (bu da burada sınanır, ad yanlış verilmesin). Diğer geçersiz dosyalar
Python'da da düşer; `expect.json` varsa dosyanın düşürmesi gereken anahtar kelimeyi yazar.
"""

from __future__ import annotations

import pytest
from conftest import FIXTURES, SCHEMA_DIR, fixture_files, read_json

import ogrenmen_contracts as oc


def _common_fragment_issues(data):
    cls = oc._validator_class()
    v = cls(
        {"$ref": "https://ogrenmen.easy/schemas/common.json" + data["ref"]},
        registry=oc._registry(),
        format_checker=oc._format_checker(),
    )
    return oc._flatten_errors(v.iter_errors(data["data"]))


def test_every_schema_has_fixture_folders():
    names = sorted(p.name[: -len(".schema.json")] for p in SCHEMA_DIR.glob("*.schema.json"))
    assert sorted(oc.SCHEMA_NAMES) == names
    assert len(names) >= 40
    for name in names:
        valid = list((FIXTURES / name / "valid").glob("*.json"))
        invalid = list((FIXTURES / name / "invalid").glob("*.json"))
        assert len(valid) >= 1, name
        assert len(invalid) >= 1, name
        expect_path = FIXTURES / name / "expect.json"
        if expect_path.exists():
            assert set(read_json(expect_path)) <= {f.name for f in invalid}, name


@pytest.mark.parametrize(("schema", "kind", "path", "expect"), fixture_files())
def test_fixture_classified_by_folder(schema, kind, path, expect):
    data = read_json(path)
    issues = _common_fragment_issues(data) if schema == "common" else oc.errors(schema, data)
    if kind == "valid":
        assert issues == []
        if schema != "common":
            assert oc.is_valid(schema, data)
            assert oc.validate(schema, data) is data
    elif path.name.startswith("refine-"):
        assert issues == [], f"{path.name}: JSON Schema ile de düşüyorsa refine- öneki kaldırılmalı"
    else:
        assert issues, f"{path.name} geçmemeliydi"
        if expect:
            keywords = {i.keyword for i in issues}
            assert keywords & set(expect), f"{path.name}: {sorted(keywords)} ∌ {expect}"
        if schema != "common":
            assert not oc.is_valid(schema, data)
            with pytest.raises(oc.ContractValidationError):
                oc.validate(schema, data)
