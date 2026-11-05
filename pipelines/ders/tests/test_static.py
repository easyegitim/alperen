"""Statik kemerler: paket yalnız standart kitaplığı kullanır, veritabanına yazmaz, STT model adı tek sabittedir,
kullanıcıya dönen metinler ünlemsizdir."""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

import ogrenmen_ders

SRC = Path(ogrenmen_ders.__file__).parent
FILES = sorted(SRC.glob("*.py"))


def test_stdlib_only():
    for path in FILES:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else (
                [node.module or ""] if isinstance(node, ast.ImportFrom) and node.level == 0 else [])
            for name in names:
                assert name.split(".")[0] in sys.stdlib_module_names or name == "__future__", (path.name, name)


def test_service_is_self_contained():
    """service.py tek dosya olarak (``python3 -I``) çalışır: paket içi göreli içe aktarma yok."""
    tree = ast.parse((SRC / "service.py").read_text(encoding="utf-8"))
    assert not [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.level > 0]


def test_no_database_access_and_model_name_once():
    for path in FILES:
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"\.rpc\(|/rest/v1/|psycopg|observations", text), path.name
        assert not re.search(r"gemini-|claude-|flash-lite|sonnet", text, re.I), path.name
    service = (SRC / "service.py").read_text(encoding="utf-8")
    assert len(re.findall(r"whisper-large-v3-turbo", service)) == 1     # GROQ_DEFAULT_MODEL; GROQ_STT_MODEL ezer


def test_user_facing_strings_have_no_exclamation():
    for path in FILES:
        for m in re.finditer(r'"([^"\n]*[A-Za-zÇĞİÖŞÜçğıöşü][^"\n]*)"', path.read_text(encoding="utf-8")):
            text = re.sub(r"!=|![rsa]\}", "", m.group(1))
            assert "!" not in text, (path.name, m.group(1))
