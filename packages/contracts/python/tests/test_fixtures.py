"""Her fikstür klasörüne göre sınıflanır (TS fixtures.test.ts ile aynı dosyalar ve beklentiler)."""

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
    assert list(oc.SCHEMA_NAMES) == names
    assert len(names) == 25
    for name in names:
        valid = list((FIXTURES / name / "valid").glob("*.json"))
        invalid = list((FIXTURES / name / "invalid").glob("*.json"))
        assert len(valid) >= 2, name
        assert len(invalid) >= 2, name
        expect = read_json(FIXTURES / name / "expect.json")
        assert sorted(expect) == sorted(f.name for f in invalid), name


@pytest.mark.parametrize(("schema", "kind", "path", "expect"), fixture_files())
def test_fixture_classified_by_folder(schema, kind, path, expect):
    data = read_json(path)
    issues = _common_fragment_issues(data) if schema == "common" else oc.errors(schema, data)
    if kind == "valid":
        assert issues == []
        if schema != "common":
            assert oc.is_valid(schema, data)
            assert oc.validate(schema, data) is data
    else:
        assert issues, f"{path.name} geçmemeliydi"
        keywords = {i.keyword for i in issues}
        assert keywords & set(expect), f"{path.name}: {sorted(keywords)} ∌ {expect}"
        if schema != "common":
            assert not oc.is_valid(schema, data)
            with pytest.raises(oc.ContractValidationError):
                oc.validate(schema, data)
