"""``tablet pdf``: LaTeX exam şablonu, tectonic (yoksa SKIP), ``--with-keys`` yalnız eğitmen oturumuyla (§6.1)."""

from __future__ import annotations

import json
import re
import shutil

import httpx
import pytest
from ogrenmen_common.errors import OgrError
from ogrenmen_common.runtime import Runtime

from conftest import FIXTURES, TABLET_FIXTURES
from ogrenmen_tablet import cli
from ogrenmen_tablet import pdf as PDF
from scripted import envelope


def _diag_test_id() -> str:
    seed = json.loads((FIXTURES / "db" / "dev-seed.json").read_text(encoding="utf-8"))
    return seed["diagnostic_tests"][0]["id"]


def _tex(path) -> str:
    return path.read_text(encoding="utf-8")


def test_tex_from_items_with_figure(tmp_path):
    test = tmp_path / "test.json"
    test.write_text(json.dumps({"title": "Kesir denemesi", "items": [
        json.loads((TABLET_FIXTURES / "llm-question.json").read_text(encoding="utf-8")),
        envelope("tyt.mat.problem.sayi", 1)["item"],
        envelope("tyt.mat.temel.ondalik", 2, kind="numeric")["item"],
    ]}, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "pdf" / "deneme.pdf"
    assert cli.main(["pdf", "--test", str(test), "--dry-run", "--out", str(out)], env={}) == 0
    tex = _tex(out.with_suffix(".tex"))
    assert "\\documentclass[a4paper,11pt]{exam}" in tex and "answers" not in tex.split("\n")[1]
    assert tex.count("\\question ") == 3 and tex.count("\\choice ") == 8
    assert "\\CorrectChoice" not in tex and "Cevap anahtarı" not in tex
    assert "misconception" not in tex and "rasyonel.pay-payda" not in tex
    assert "\\texttt{5/6 - 1/4}" in tex
    match = re.search(r"\\includegraphics\[[^]]*\]\{([^}]+)\}", tex)
    assert match and (out.parent / match.group(1)).is_file()
    assert "{{" not in tex and "<<" not in tex and "<%" not in tex


def test_tex_from_diagnostic_test_and_escaping(tmp_path):
    rt = Runtime.from_env(dry_run=True, out=None, env={})
    result = PDF.build(rt, test=_diag_test_id(), out=tmp_path)
    rt.close()
    tex = _tex(result.tex)
    assert result.questions == 20 and tex.count("\\question ") == 20
    assert "\\textasciicircum{}" in tex  # üs işareti kaçışlı
    assert PDF.latex_text("%50 & $x_1$ #`a^2`") == r"\%50 \& \$x\_1\$ \#\texttt{a\textasciicircum{}2}"


def test_latex_square_root():
    assert PDF.latex_text("√3") == r"$\sqrt{3}$"  # boş kök + "3" değil
    assert PDF.latex_text("`2√3 + √(x+1)`") == r"\texttt{2$\sqrt{3}$ + $\sqrt{x+1}$}"
    assert PDF.latex_text("√12,5 ve √x") == r"$\sqrt{12{,}5}$ ve $\sqrt{x}$"
    assert PDF.latex_text("√ tek başına") == r"$\surd$ tek başına"
    assert PDF.latex_text("√(a_b)") == r"$\surd$(a\_b)"  # güvenli olmayan içerik kök altına alınmaz
    assert r"\sqrt{}" not in PDF.latex_text("√3 · √5")


def test_with_keys_requires_staff_session(tmp_path):
    rt = Runtime.from_env(dry_run=True, out=None, env={})
    with pytest.raises(OgrError, match="OGR-PDF-002"):
        PDF.build(rt, test=_diag_test_id(), out=tmp_path, with_keys=True, env={})
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/rpc/peek_answer_key"
        assert request.headers["authorization"] == "Bearer staff-test-jwt"
        qid = json.loads(request.content)["p_question"]
        seen.append(qid)
        return httpx.Response(200, json={"correct_option": "A", "numeric_value": None,
                                         "solution": "Çözüm adımları burada.", "sympy_status": "verified"})

    env = {"SUPABASE_URL": "http://supabase.test", "OGRENMEN_STAFF_JWT": "staff-test-jwt"}
    result = PDF.build(rt, test=_diag_test_id(), out=tmp_path / "keys", with_keys=True, env=env,
                       transport=httpx.MockTransport(handler))
    rt.close()
    tex = _tex(result.tex)
    assert len(seen) == 20
    assert tex.count("\\CorrectChoice") == 20 and "Cevap anahtarı (yalnız eğitmen)" in tex
    assert "answers]{exam}" in tex


def test_pdf_requires_tectonic(tmp_path):
    test = tmp_path / "t.json"
    test.write_text(json.dumps({"title": "Kısa deneme", "items": [envelope("tyt.mat.problem.sayi", 1)["item"]]},
                               ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "deneme.pdf"
    if shutil.which("tectonic") is None:
        with pytest.raises(OgrError, match="OGR-PDF-003"):
            cli.main(["pdf", "--test", str(test), "--require-pdf", "--dry-run", "--out", str(out)], env={})
        assert out.with_suffix(".tex").is_file() and not out.exists()
        pytest.skip("tectonic kurulu değil: PDF derlemesi SKIP (yalnız .tex doğrulandı; §12 #41)")
    assert cli.main(["pdf", "--test", str(test), "--require-pdf", "--dry-run", "--out", str(out)], env={}) == 0
    from pypdf import PdfReader

    reader = PdfReader(str(out))
    assert len(reader.pages) >= 1
    assert "Kısa deneme" in reader.pages[0].extract_text()
