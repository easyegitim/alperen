"""PII temizleyici testleri: cases.json vakaları, hash türetimi, TCKN, API kuralları."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from ogrenmen_pii import (
    ERROR_CODES,
    FOLD_FROM,
    FOLD_TO,
    KINDS,
    PATTERNS,
    config,
    is_valid_tckn,
    name_token_hashes,
    normalize_token,
    scrub,
    token_hash,
    total_replacements,
)
from ogrenmen_pii.cases import cases_path, load_cases
from ogrenmen_pii.dump import build_dump, error_code

DATA = load_cases()
PII_ROOT = Path(__file__).resolve().parents[2]


def test_cases_file_has_at_least_60_cases():
    assert len(DATA["cases"]) >= 60
    ids = [c["id"] for c in DATA["cases"]]
    assert len(ids) == len(set(ids)), "vaka kimlikleri tekil olmalı"


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["id"] for c in DATA["cases"]])
def test_case(case):
    assert scrub(case["text"], case["opts"]) == case["expected"]


@pytest.mark.parametrize("hc", DATA["hash_cases"], ids=[h["id"] for h in DATA["hash_cases"]])
def test_hash_case(hc):
    assert name_token_hashes(hc["full_name"]) == hc["expected"]


@pytest.mark.parametrize("ec", DATA["error_cases"], ids=[e["id"] for e in DATA["error_cases"]])
def test_error_case(ec):
    assert error_code(lambda: scrub(ec["text"], ec["opts"])) == ec["expected_error"]


def test_every_error_code_is_covered():
    assert {e["expected_error"] for e in DATA["error_cases"]} == set(ERROR_CODES.values())
    assert all(re.fullmatch(r"OGR-SCR-[0-9]{3}", c) for c in ERROR_CODES.values()), "OGR-PII-001 kullanılmaz"


def test_every_kind_is_covered_by_some_case():
    seen = {r["kind"] for c in DATA["cases"] for r in c["expected"]["replacements"]}
    assert seen == set(KINDS)


def test_cases_contain_no_plain_name_inputs():
    # opts yalnız 64 haneli hex hash taşır; düz ad girdisi yok
    hexre = re.compile(r"^[0-9a-f]{64}$")
    for c in DATA["cases"]:
        for hh in c["opts"].get("nameHashes", []):
            assert hexre.match(hh), c["id"]
        for hh, role in c["opts"].get("roleHashes", {}).items():
            assert hexre.match(hh), c["id"]
            assert role in ("ÖĞRENCİ", "EĞİTMEN", "VELİ")


def test_math_cases_are_untouched():
    for c in DATA["cases"]:
        if c["id"].startswith(("math-", "skill-")):
            assert c["expected"]["text"] == c["text"]
            assert scrub(c["text"], c["opts"])["text"] == c["text"]


def test_cases_json_is_generated_from_source():
    gen = PII_ROOT / "scripts" / "gen_cases.py"
    r = subprocess.run([sys.executable, str(gen), "--check"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_normalize_token_fold():
    assert normalize_token("IŞIL") == "işil"
    assert normalize_token("Işıl") == "işil"
    assert normalize_token("İNCE") == "ince"
    assert normalize_token("elıf") == "elif"
    assert normalize_token("ÇĞÖŞÜÂÎÛ") == "çğöşüâîû"
    assert normalize_token("Elif") == "elif"
    assert len(FOLD_FROM) == len(FOLD_TO)
    assert "ı" not in FOLD_TO


def test_elif_spellings_share_one_hash():
    hs = {token_hash(t) for t in ("ELIF", "ELİF", "Elif", "elıf", "elif")}
    assert hs == {hashlib.sha256(b"elif").hexdigest()}


def test_nfc_decomposed_input():
    assert token_hash("S\u0327u\u0308kru\u0308") == hashlib.sha256("şükrü".encode()).hexdigest()
    assert name_token_hashes("E\u0301lif") == name_token_hashes("\u00c9lif")
    h = token_hash("şükrü")
    assert scrub("S\u0327u\u0308kru\u0308 geldi", {"nameHashes": [h]})["text"] == "[AD] geldi"


def test_token_hash_strips_apostrophe_suffix():
    expected = hashlib.sha256(b"elif").hexdigest()
    assert token_hash("Elif'in") == expected
    assert token_hash("ELİF’e") == expected


def test_name_token_hashes_skip_short_and_dedupe():
    assert name_token_hashes("Su Ay") == []
    assert len(name_token_hashes("Elif Kaya Elif")) == 2


@pytest.mark.parametrize(
    "number,valid",
    [
        ("10000000146", True),
        ("12345678950", True),
        ("12345678901", False),
        ("01234567890", False),
        ("1234567890", False),
        ("1000000014a", False),
        ("10000000147", False),
    ],
)
def test_tckn_checksum(number, valid):
    assert is_valid_tckn(number) is valid


def test_role_label_must_be_known():
    with pytest.raises(ValueError, match="^OGR-SCR-003"):
        scrub("Elif", {"nameHashes": [], "roleHashes": {token_hash("elif"): "ANNE"}})
    with pytest.raises(ValueError, match="^OGR-SCR-003"):
        scrub("Elif", {"nameHashes": [], "roleHashes": {token_hash("elif"): "toString"}})


def test_plain_string_is_not_accepted_as_hash_list():
    h = token_hash("elif")
    with pytest.raises(TypeError, match="^OGR-SCR-001"):
        scrub("Elif", "Elif")  # type: ignore[arg-type]
    # tek hash dizgesi karakterlere bölünüp sessizce geçmez (her çağrı biçiminde)
    with pytest.raises(TypeError, match="^OGR-SCR-001"):
        scrub("Elif geldi", {"nameHashes": h})
    with pytest.raises(TypeError, match="^OGR-SCR-001"):
        scrub("Elif geldi", name_hashes=h)  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="^OGR-SCR-001"):
        scrub("Elif geldi", {"nameHashes": {h}})
    with pytest.raises(TypeError, match="^OGR-SCR-001"):
        scrub("Elif geldi")


def test_plain_names_are_rejected():
    with pytest.raises(ValueError, match="^OGR-SCR-002"):
        scrub("Elif geldi", {"nameHashes": ["Elif"]})
    with pytest.raises(ValueError, match="^OGR-SCR-002"):
        scrub("Elif geldi", name_hashes=["Elif"])
    with pytest.raises(ValueError, match="^OGR-SCR-002"):
        scrub("Elif geldi", ["elif"])
    with pytest.raises(ValueError, match="^OGR-SCR-002"):
        scrub("Elif geldi", {"nameHashes": []}, role_hashes={"Elif": "ÖĞRENCİ"})


def test_alternative_call_styles_are_equivalent():
    h = token_hash("elif")
    text = "Elif geldi"
    a = scrub(text, {"nameHashes": [h]})
    b = scrub(text, [h])
    c = scrub(text, name_hashes=[h])
    assert a == b == c == {"text": "[AD] geldi", "replacements": [{"kind": "name", "count": 1}]}


def test_uppercase_hash_input_is_accepted():
    h = token_hash("elif").upper()
    assert scrub("Elif", {"nameHashes": [h]})["text"] == "[AD]"


def test_deterministic_and_stateless():
    text = "Benim adım Elif, numaram 0532 123 45 67"
    first = scrub(text, {"nameHashes": []})
    for _ in range(3):
        assert scrub(text, {"nameHashes": []}) == first


def test_total_replacements():
    r = scrub("a@b.com ve 05321234567 ve c@d.org", {"nameHashes": []})
    assert total_replacements(r) == 3


def test_patterns_compile_and_config_is_complete():
    for p in PATTERNS.values():
        re.compile(p)
    cfg = config()
    assert list(cfg) == ["rules_version", "kinds", "placeholders", "stop_cap", "subjects", "low_stop",
                         "school_words", "answer_words", "verdict_words", "fold_from", "fold_to", "error_codes",
                         "patterns"]
    assert set(cfg["placeholders"]) == set(KINDS)


def test_dump_matches_expected_values():
    dump = build_dump(DATA)
    by_id = {c["id"]: c for c in DATA["cases"]}
    for row in dump["cases"]:
        exp = by_id[row["id"]]["expected"]
        assert {"text": row["text"], "replacements": row["replacements"]} == exp
    for row, hc in zip(dump["hash_cases"], DATA["hash_cases"], strict=True):
        assert row["hashes"] == hc["expected"]
    assert dump["error_cases"] == [{"id": e["id"], "error": e["expected_error"]} for e in DATA["error_cases"]]


def test_dump_cli_outputs_valid_json():
    r = subprocess.run([sys.executable, "-m", "ogrenmen_pii.dump"], capture_output=True)
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout.decode("utf-8"))
    assert len(out["cases"]) == len(DATA["cases"])
    assert r.stdout.endswith(b"\n")


def test_cases_path_env_override(tmp_path, monkeypatch):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"hash_cases": [], "cases": [], "error_cases": []}), encoding="utf-8")
    monkeypatch.setenv("OGRENMEN_PII_CASES", str(p))
    assert cases_path() == p
    assert load_cases() == {"hash_cases": [], "cases": [], "error_cases": []}


# --- SQL eşleniği (packages/pii/sql/name_token_hashes.sql) --------------------------------
SQL_FILE = PII_ROOT / "sql" / "name_token_hashes.sql"
PG_URL = os.environ.get("OGRENMEN_PII_PG_URL", "postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen")


def _sql_block() -> str:
    text = SQL_FILE.read_text(encoding="utf-8")
    m = re.search(r"^-- begin pii\n(.*?)^-- end pii$", text, re.S | re.M)
    assert m, "-- begin pii / -- end pii işaretleri yok"
    return m.group(1)


def test_sql_reference_uses_same_fold_and_token_pattern():
    block = _sql_block()
    assert f"'{FOLD_FROM}'" in block and f"'{FOLD_TO}'" in block
    assert PATTERNS["token"].replace("'", "''") in block
    assert "lower(" not in block, "düz lower() kullanılmaz"


def test_sql_reference_matches_on_live_postgres():
    """Yerel Postgres varsa SQL fonksiyonu hash_cases ile bayt eşit hash üretir; yoksa atlanır (ağ yok)."""
    if shutil.which("psql") is None:
        pytest.skip("psql yok")
    env = {**os.environ, "PGCONNECT_TIMEOUT": "2"}
    probe = subprocess.run(["psql", "-X", "-At", PG_URL, "-c", "select 1"], capture_output=True, env=env)
    if probe.returncode != 0:
        pytest.skip("yerel Postgres erişilemiyor")
    fn = _sql_block().replace("app.pii_name_token_hashes", "pg_temp.pii_name_token_hashes")
    names = [hc["full_name"] for hc in DATA["hash_cases"]]
    lits = ", ".join("(" + str(i) + ", '" + n.replace("'", "''") + "')" for i, n in enumerate(names))
    query = (
        fn + "\nselect i, array_to_string(pg_temp.pii_name_token_hashes(n), ',') "
        f"from (values {lits}) v(i, n) order by i;\n"
    )
    r = subprocess.run(["psql", "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", PG_URL], input=query.encode("utf-8"),
                       capture_output=True, env=env)
    assert r.returncode == 0, r.stderr.decode("utf-8")
    rows = [line.split("|", 1) for line in r.stdout.decode("utf-8").splitlines() if "|" in line]
    got = [row[1].split(",") if row[1] else [] for row in rows]
    assert got == [hc["expected"] for hc in DATA["hash_cases"]]
