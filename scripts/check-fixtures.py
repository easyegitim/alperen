#!/usr/bin/env python3
"""fixtures-valid (BLUEPRINT §2.3, §8.1, §11 M13): paylaşılan sahte verinin sözleşmelere uygunluğu.

FAIL (çıkış 1):
* ``fixtures/**/*.json`` dosyalarından biri JSON olarak okunamıyor;
* ``fixtures/llm/<amaç>/*.json`` klasör → şema eşlemesiyle ``ogrenmen_contracts`` doğrulamasından geçmiyor
  (``"exam-item[]"`` = boş olmayan exam-item dizisi); bilinmeyen ya da eksik amaç klasörü; klasörde geçerli örnek
  ya da ``bad-schema*.json`` yok; ``bad-schema*.json`` şemadan **geçiyor** (geçmemeli — onarım yolunu tetikler);
* eşleme ``ogrenmen_common.purposes.FIXTURE_SCHEMAS`` ile aynı değil (paket kuruluysa);
* ``fixtures/db/dev-seed.json``'da aynı ``code`` için tam bir ``status='active'`` müfredat ya da
  ``settings.default_period`` yok.

UYARI (çıkış 0; kök README "Nerede kaldık" takip maddesi): ``dev-seed.json``'daki teşhis maddeleri
``content/tyt-matematik/diagnostic/items.json`` ile aynı değil — fark listesi yazılır.

Kullanım: ``python scripts/check-fixtures.py [--root <depo>]``
"""

from __future__ import annotations

import argparse
import glob
import json
import sys
import uuid
from pathlib import Path
from typing import Any

ROOT_DEFAULT = Path(__file__).resolve().parent.parent

FOLDER_SCHEMAS: dict[str, str] = {
    "chat": "tutor-reply",
    "chat_group": "tutor-reply",
    "nightly_facts": "nightly-facts-output",
    "weekly_summary": "weekly-summary",
    "question_gen": "question-generation",
    "vision_check": "figure-render-report",
    "ocr": "exam-item[]",
    "lesson_analysis": "lesson-analysis",
    "transcribe": "transcript",
    "diarize": "transcript",
    "query_expand": "query-expand",
    "research": "research-output",
}
"""§2.3: ``fixtures/llm/<amaç>`` → sözleşme. ``ogrenmen_common.purposes.FIXTURE_SCHEMAS`` ile aynı olmalı."""

# content/tyt-matematik/templates/_common.py ile aynı deterministik kimlikler (fixtures/README.md).
NAMESPACE_OGRENMEN = uuid.uuid5(uuid.NAMESPACE_DNS, "ogrenmen.easy")
DIAG_FIELDS = ("skill_ids", "kind", "stem", "stem_values", "options", "difficulty")


def uid(kind: str, key: str) -> str:
    return str(uuid.uuid5(NAMESPACE_OGRENMEN, f"{kind}:{key}"))


def curriculum_uuid(code: str) -> str:
    return str(uuid.uuid5(NAMESPACE_OGRENMEN, code))


class Report:
    def __init__(self) -> None:
        self.fails: list[str] = []
        self.warns: list[str] = []
        self.passes: list[str] = []

    def fail(self, msg: str) -> None:
        self.fails.append(msg)

    def warn(self, msg: str) -> None:
        self.warns.append(msg)

    def ok(self, msg: str) -> None:
        self.passes.append(msg)


def schema_errors(spec: str, data: Any) -> list[str]:
    import ogrenmen_contracts as contracts

    if spec.endswith("[]"):
        name = spec[:-2]
        if not isinstance(data, list) or not data:
            return [f"boş olmayan {name} dizisi bekleniyordu"]
        return [f"/{i}{e.path} {e.message}" for i, item in enumerate(data) for e in contracts.errors(name, item)]
    return [f"{e.path or '/'} {e.message}" for e in contracts.errors(spec, data)]


def check_parse(root: Path, rep: Report) -> None:
    files = sorted(glob.glob(str(root / "fixtures" / "**" / "*.json"), recursive=True))
    if not files:
        rep.fail("fixtures/**/*.json bulunamadı")
        return
    bad = 0
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                json.load(fh)
        except (OSError, ValueError) as exc:
            bad += 1
            rep.fail(f"{Path(f).relative_to(root)}: JSON okunamadı: {exc}")
    if not bad:
        rep.ok(f"fixtures/**/*.json: {len(files)} dosya JSON olarak okunuyor")


def check_mapping_against_common(rep: Report) -> None:
    try:
        from ogrenmen_common.purposes import FIXTURE_SCHEMAS
    except ImportError:
        rep.warn("ogrenmen_common kurulu değil; klasör→şema eşlemesi pipelines/common ile karşılaştırılamadı")
        return
    if dict(FIXTURE_SCHEMAS) != FOLDER_SCHEMAS:
        rep.fail(f"klasör→şema eşlemesi ogrenmen_common.purposes.FIXTURE_SCHEMAS ile farklı: {dict(FIXTURE_SCHEMAS)}")
    else:
        rep.ok("klasör→şema eşlemesi ogrenmen_common.purposes.FIXTURE_SCHEMAS ile aynı")


def check_llm(root: Path, rep: Report) -> None:
    base = root / "fixtures" / "llm"
    if not base.is_dir():
        rep.fail("fixtures/llm dizini yok")
        return
    present = {p.name for p in base.iterdir() if p.is_dir()}
    for name in sorted(present - set(FOLDER_SCHEMAS)):
        rep.fail(f"fixtures/llm/{name}: bilinmeyen amaç klasörü (şema eşlemesi yok)")
    for name in sorted(set(FOLDER_SCHEMAS) - present):
        rep.fail(f"fixtures/llm/{name}: amaç klasörü yok")
    for name in sorted(present & set(FOLDER_SCHEMAS)):
        spec = FOLDER_SCHEMAS[name]
        files = sorted((base / name).glob("*.json"))
        good = [f for f in files if not f.name.startswith("bad-schema")]
        bad = [f for f in files if f.name.startswith("bad-schema")]
        if not good:
            rep.fail(f"fixtures/llm/{name}: geçerli örnek yok")
        if not bad:
            rep.fail(f"fixtures/llm/{name}: bad-schema*.json yok (onarım yolu sınanamaz)")
        folder_ok = bool(good and bad)
        for f in files:
            rel = f.relative_to(root)
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except ValueError:
                folder_ok = False
                continue  # check_parse zaten raporladı
            errs = schema_errors(spec, data)
            if f in bad and not errs:
                folder_ok = False
                rep.fail(f"{rel}: {spec} şemasından GEÇİYOR; bad-schema dosyası geçmemeli")
            elif f in good and errs:
                folder_ok = False
                rep.fail(f"{rel}: {spec} şemasına uymuyor: {'; '.join(errs[:3])}")
        if folder_ok:
            rep.ok(f"fixtures/llm/{name} → {spec}: {len(good)} geçerli, {len(bad)} bilerek geçersiz")


def _load_json(path: Path, rep: Report) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        rep.fail(f"{path}: okunamadı: {exc}")
        return None


def check_dev_seed(root: Path, rep: Report) -> dict | None:
    path = root / "fixtures" / "db" / "dev-seed.json"
    if not path.exists():
        rep.fail("fixtures/db/dev-seed.json yok")
        return None
    seed = _load_json(path, rep)
    if not isinstance(seed, dict):
        rep.fail("fixtures/db/dev-seed.json: nesne bekleniyordu")
        return None
    curricula = seed.get("curricula") or []
    by_code: dict[str, int] = {}
    for c in curricula:
        if c.get("status") == "active":
            by_code[c.get("code")] = by_code.get(c.get("code"), 0) + 1
    if not by_code:
        rep.fail("dev-seed.json: aktif müfredat yok (status='active')")
    for code, n in sorted(by_code.items()):
        if n != 1:
            rep.fail(f"dev-seed.json: {code} için {n} aktif müfredat (tam bir tane olmalı)")
    period = next((s.get("value") for s in seed.get("settings") or [] if s.get("key") == "default_period"), None)
    if not isinstance(period, str) or not period:
        rep.fail("dev-seed.json: settings.default_period yok")
    if by_code and all(n == 1 for n in by_code.values()) and period:
        rep.ok(f"dev-seed.json: aktif müfredat {', '.join(sorted(by_code))}, default_period {period!r}")
    return seed


def _fmt(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return text if len(text) <= 48 else text[:45] + "…"


class DiagnosticInputError(Exception):
    """items.json / curriculum.json / dev-seed.json teşhis kısmı beklenen biçimde değil (rapora FAIL olarak yazılır)."""


def diagnostic_drift(root: Path, seed: dict) -> list[str]:
    """dev-seed.json teşhis maddeleri ↔ content items.json farkları (UYARI listesi).

    Bozuk girdi (eksik ``code``/``version`` alanı, yanlış tür, geçersiz JSON) traceback değil
    ``DiagnosticInputError`` olur; ``main`` bunu FAIL satırı olarak yazar.
    """
    content = root / "content" / "tyt-matematik"
    items_path, cur_path = content / "diagnostic" / "items.json", content / "curriculum.json"
    if not items_path.exists() or not cur_path.exists():
        return [f"{items_path.relative_to(root)} ya da curriculum.json yok; teşhis eşitliği denetlenemedi"]
    try:
        return _diagnostic_drift(items_path, cur_path, seed)
    except KeyError as exc:
        raise DiagnosticInputError(f"teşhis eşitliği denetlenemedi: zorunlu alan yok ({exc})") from exc
    except (TypeError, ValueError, AttributeError) as exc:
        raise DiagnosticInputError(f"teşhis eşitliği denetlenemedi: bozuk girdi ({type(exc).__name__}: {exc})") \
            from exc


def _diagnostic_drift(items_path: Path, cur_path: Path, seed: dict) -> list[str]:
    items = json.loads(items_path.read_text(encoding="utf-8"))
    items = items.get("items", items) if isinstance(items, dict) else items
    cur = json.loads(cur_path.read_text(encoding="utf-8"))
    code = f"{cur['code']}@{cur['version']}"
    out: list[str] = []
    seed_q = {q.get("id"): q for q in seed.get("questions") or []}
    expected_ids = [uid("question", it["code"]) for it in items]
    for it, qid in zip(items, expected_ids, strict=True):
        row = seed_q.get(qid)
        if row is None:
            out.append(f"{it['code']}: dev-seed.json'da yok (beklenen kimlik {qid})")
            continue
        diffs = []
        for f in DIAG_FIELDS:
            want = it.get(f) if f != "stem_values" else (it.get(f) or {})
            got = row.get(f) if f != "stem_values" else (row.get(f) or {})
            if f == "difficulty" and want is not None and got is not None and abs(float(want) - float(got)) < 1e-9:
                continue
            if want != got:
                diffs.append(f)
        if (it.get("figure") is None) != (row.get("figure_id") is None):
            diffs.append("şekil")
        if diffs:
            detail = f"; kök: items.json {_fmt(it.get('stem'))} ↔ dev-seed {_fmt(row.get('stem'))}" \
                if "stem" in diffs else ""
            out.append(f"{it['code']}: farklı alanlar {', '.join(diffs)}{detail}")
    extra = sorted(q["id"] for q in seed.get("questions") or []
                   if q.get("source") == "diagnostic" and q.get("id") not in set(expected_ids))
    for qid in extra:
        out.append(f"dev-seed.json teşhis sorusu {qid} items.json'da karşılıksız")
    tests = [t for t in seed.get("diagnostic_tests") or [] if t.get("version") == cur["version"]]
    want_test = uid("diagnostic_test", code)
    if not tests:
        out.append(f"dev-seed.json'da {cur['version']} teşhis testi yok")
    for t in tests:
        if t.get("id") != want_test:
            out.append(f"diagnostic_tests.id {t.get('id')} ↔ export-sql.py {want_test} "
                       f"(uuid5 'diagnostic_test:{code}')")
        if t.get("curriculum_id") != curriculum_uuid(code):
            out.append(f"diagnostic_tests.curriculum_id {t.get('curriculum_id')} ↔ {curriculum_uuid(code)}")
        if list(t.get("item_ids") or []) != expected_ids:
            out.append("diagnostic_tests.item_ids items.json sırasıyla aynı değil")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="fixtures-valid: fixtures/llm sözleşmeleri, dev-seed ve teşhis eşitliği.")
    ap.add_argument("--root", type=Path, default=ROOT_DEFAULT)
    args = ap.parse_args(argv)
    root = args.root.resolve()
    rep = Report()
    try:
        import ogrenmen_contracts  # noqa: F401
    except ImportError:
        print("HATA: ogrenmen_contracts kurulu değil (python -m pip install -e packages/contracts/python)",
              file=sys.stderr)
        return 2
    check_parse(root, rep)
    check_mapping_against_common(rep)
    check_llm(root, rep)
    seed = check_dev_seed(root, rep)
    drift: list[str] = []
    drift_failed = seed is None
    if seed is not None:
        try:
            drift = diagnostic_drift(root, seed)
        except DiagnosticInputError as exc:
            rep.fail(str(exc))
            drift_failed = True
    for msg in rep.passes:
        print(f"PASS  {msg}")
    for msg in rep.fails:
        print(f"FAIL  {msg}")
    for msg in rep.warns:
        print(f"UYARI {msg}")
    if drift:
        print(f"UYARI dev-seed.json teşhis maddeleri items.json'dan farklı ({len(drift)} madde; FAIL değil, README "
              "'Nerede kaldık' takip maddesi):")
        for line in drift:
            print(f"      - {line}")
    elif not drift_failed:
        print("PASS  dev-seed.json teşhis maddeleri items.json ile aynı")
    print(f"\nÖzet: {len(rep.passes) + (0 if drift or drift_failed else 1)} PASS, {len(rep.fails)} FAIL, "
          f"{len(rep.warns) + (1 if drift else 0)} UYARI")
    return 1 if rep.fails else 0


if __name__ == "__main__":
    sys.exit(main())
