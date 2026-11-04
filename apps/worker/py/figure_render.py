"""Belge figürü yerel üreticisi (document.generate, OGRENMEN_FIGURES=local ve sahte LLM). Worker figür başına ayrı
süreçte, OS yalıtımı altında (src/documents/sandbox.ts: ayrı kullanıcı + user/pid/net/mount ad alanı, yeni /proc, ağ yok,
/home /root /app /tmp … boş tmpfs ile örtülü, çalışma dizini yazılabilir tmpfs) ``python3 -I -c <bu dosya>`` ile çağırır.

Girdi (stdin, JSON): ``{"preamble": "<FIGURE_PREAMBLE>", "code": "<figure_code>", "file_name": "figure_<n>.svg"}``.
Çıktı (stdout, JSON): ``{"ok": true, "file": "figure_1.svg", "svg": "<svg…>"}`` ya da ``{"ok": false, "error": "…"}``.

Asıl güvenlik sınırı OS yalıtımıdır (kara liste tek başına yeterli değildir: sympy gibi dizeden ifade kuran kütüphaneler
``eval`` eder). Bu dosyadaki denetimler ek katmandır:
  1. Kaynak sınırları: CPU 10 sn, bellek 1,5 GB, yazılan dosya 8 MB, açık dosya 256.
  2. AST denetimi: yalnız izinli modüller (``math``, ``numpy``, ``matplotlib`` ve çizim alt modülleri; sympy YOK);
     ``__`` ile başlayan ad/öznitelik yok; ``open``/``exec``/``eval``/``compile``/``getattr`` … gibi yerleşikler ve
     ``os``/``sys``/``animation``/``lib``/``DataSource``/``savefig``/``load`` … gibi öznitelikler yasak; ``S``/
     ``sympify``/``simplify``/``solve``/``Eq`` … çağrılarına dize verilemez. Dosya yalnız başlıktaki
     ``save_figure(fig, n)`` ile yazılır.
  3. Kod kısıtlı yerleşiklerle çalışır (``__import__`` izin listesiyle sarılı). Başlık (güvenilir) tam yerleşiklerle önce
     çalışır.
"""

from __future__ import annotations

import ast
import builtins
import json
import os
import re
import signal
import sys
from pathlib import Path
from typing import Any

# Tam modül adı izin listesi (kök ad yetmez: ``numpy.f2py``, ``matplotlib.animation`` alt süreç çalıştırır).
ALLOWED_MODULES = {
    "math", "numpy", "matplotlib", "matplotlib.pyplot", "matplotlib.patches", "matplotlib.ticker", "matplotlib.lines",
    "matplotlib.colors", "matplotlib.path", "matplotlib.transforms", "matplotlib.collections", "matplotlib.text",
    "matplotlib.patheffects", "matplotlib.gridspec", "matplotlib.markers", "matplotlib.cm",
}
# Dizeyi ifadeye çeviren (sympify → eval) çağrılar: dize bağımsız değişkeni reddedilir.
STRING_EVAL_CALLS = {"S", "sympify", "simplify", "nsimplify", "solve", "Eq", "parse_expr", "lambdify", "Symbol", "symbols", "N", "evalf"}
DENIED_NAMES = {
    "open", "exec", "eval", "compile", "__import__", "globals", "locals", "vars", "getattr", "setattr", "delattr",
    "input", "breakpoint", "help", "exit", "quit", "memoryview", "classmethod", "staticmethod", "super", "object",
}
DENIED_ATTRS = {
    "os", "sys", "subprocess", "system", "popen", "spawn", "builtins", "importlib", "shutil", "socket", "pathlib",
    "ctypes", "pickle", "marshal", "savefig", "load", "loads", "save", "savez", "savez_compressed", "savetxt", "loadtxt",
    "fromfile", "tofile", "genfromtxt", "memmap", "dump", "dumps", "lambdify", "sympify", "parse_expr", "use", "rc", "rc_file", "get_cachedir", "get_configdir", "imread", "imsave", "f_globals", "f_locals", "gi_frame",
    "cr_frame", "f_back", "tb_frame", "open", "lib", "npyio", "DataSource", "f2py", "testing", "ctypeslib", "distutils",
    "animation", "backends", "backend_bases", "cbook", "font_manager", "texmanager", "dviread", "rcsetup", "sphinxext",
    "print_figure", "sympy", "mpmath", "fromregex", "frombuffer", "tofile",
}
FIGURE_FILE = re.compile(r"^figure_([1-9][0-9]{0,2})\.svg$")
MAX_CODE = 20000
MAX_SVG = 2 * 1024 * 1024


class Rejected(Exception):
    """Kod kum havuzu kuralına uymuyor."""


def on_cpu_limit(_signum: int, _frame: Any) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": "figür kodu CPU sınırını (10 sn) aştı"}, ensure_ascii=False))
    sys.stdout.flush()
    os._exit(0)


def limit_resources() -> None:
    try:
        import resource

        def cap(which: int, value: int) -> None:
            soft, hard = resource.getrlimit(which)
            target = value if hard == resource.RLIM_INFINITY else min(value, hard)
            resource.setrlimit(which, (target, target if hard == resource.RLIM_INFINITY else hard))

        # yumuşak sınırda SIGXCPU → anlamlı hata; sert sınırda çekirdek öldürür
        soft, hard = resource.getrlimit(resource.RLIMIT_CPU)
        if hard == resource.RLIM_INFINITY or hard > 10:
            resource.setrlimit(resource.RLIMIT_CPU, (9, 10))
        signal.signal(signal.SIGXCPU, on_cpu_limit)
        cap(resource.RLIMIT_AS, 1536 * 1024 * 1024)
        cap(resource.RLIMIT_FSIZE, 8 * 1024 * 1024)
        cap(resource.RLIMIT_NOFILE, 256)
    except Exception:  # noqa: BLE001 — sınır kurulamayan platformda süreç zaman aşımı yine geçerli
        pass


def check_code(code: str) -> None:
    if len(code) > MAX_CODE:
        raise Rejected("kod çok uzun")
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise Rejected(f"sözdizimi hatası: satır {exc.lineno}: {exc.msg}") from None
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_MODULES:
                    raise Rejected(f"izin verilmeyen modül: {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.level or not node.module or node.module not in ALLOWED_MODULES:
                raise Rejected(f"izin verilmeyen modül: {node.module or '.'}")
            for alias in node.names:
                if alias.name == "*" or alias.name.startswith("_") or alias.name in DENIED_ATTRS:
                    raise Rejected(f"izin verilmeyen içe aktarma: {alias.name}")
                if f"{node.module}.{alias.name}" not in ALLOWED_MODULES and is_submodule(node.module, alias.name):
                    raise Rejected(f"izin verilmeyen modül: {node.module}.{alias.name}")
        elif isinstance(node, ast.Call):
            fn = node.func.id if isinstance(node.func, ast.Name) else node.func.attr if isinstance(node.func, ast.Attribute) else None
            if fn in STRING_EVAL_CALLS and any(stringy(a) for a in [*node.args, *(k.value for k in node.keywords)]):
                raise Rejected(f"izin verilmeyen çağrı: {fn}(dize)")
        elif isinstance(node, ast.Name):
            if node.id.startswith("__") or node.id in DENIED_NAMES:
                raise Rejected(f"izin verilmeyen ad: {node.id}")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr.startswith("print_") or node.attr in DENIED_ATTRS:
                raise Rejected(f"izin verilmeyen öznitelik: {node.attr}")
        elif isinstance(node, (ast.Global, ast.Nonlocal, ast.AsyncFunctionDef, ast.Await)):
            raise Rejected(f"izin verilmeyen yapı: {type(node).__name__}")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and "__" in node.value:
            raise Rejected("dize içinde çift alt çizgi")


def stringy(node: ast.AST) -> bool:
    """Dize sabiti, f-dize ya da dize içeren birleştirme (``'a' + 'b'``, ``'%s' % x``)."""
    if isinstance(node, ast.Constant):
        return isinstance(node.value, (str, bytes))
    if isinstance(node, ast.JoinedStr):
        return True
    if isinstance(node, ast.BinOp):
        return stringy(node.left) or stringy(node.right)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in {"str", "repr", "format", "chr"}:
        return True
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in {"format", "join", "replace"}:
        return True
    return False


def is_submodule(package: str, name: str) -> bool:
    """``from <package> import <name>`` bir alt modül mü (ör. ``from matplotlib import animation``)?"""
    import importlib.util

    try:
        return importlib.util.find_spec(f"{package}.{name}") is not None
    except (ImportError, ValueError):
        return False


def restricted_builtins() -> dict[str, Any]:
    real_import = builtins.__import__

    def guarded_import(name: str, globals_: Any = None, locals_: Any = None, fromlist: Any = (), level: int = 0) -> Any:
        if level or name not in ALLOWED_MODULES:
            raise ImportError(f"izin verilmeyen modül: {name}")
        for item in fromlist or ():
            if not isinstance(item, str) or item.startswith("_") or item in DENIED_ATTRS:
                raise ImportError(f"izin verilmeyen içe aktarma: {item}")
            if f"{name}.{item}" not in ALLOWED_MODULES and is_submodule(name, item):
                raise ImportError(f"izin verilmeyen modül: {name}.{item}")
        return real_import(name, globals_, locals_, fromlist, level)

    safe = {k: v for k, v in vars(builtins).items() if k not in DENIED_NAMES and not k.startswith("_")}
    safe["__import__"] = guarded_import
    safe["__build_class__"] = builtins.__build_class__
    return safe


def pick_output(expected: str) -> Path | None:
    files = sorted(p for p in Path(".").iterdir() if p.is_file() and FIGURE_FILE.match(p.name))
    for p in files:
        if p.name == expected:
            return p
    return files[0] if len(files) == 1 else None


def main() -> int:
    req = json.loads(sys.stdin.read() or "{}")
    code = str(req.get("code") or "")
    preamble = str(req.get("preamble") or "")
    expected = str(req.get("file_name") or "figure_1.svg")
    out: dict[str, Any]
    try:
        check_code(code)
        limit_resources()
        scope: dict[str, Any] = {"__name__": "__figure__", "__builtins__": builtins}
        exec(compile(preamble, "<başlık>", "exec"), scope)  # noqa: S102 — güvenilir başlık (packages/prompts)
        scope["__builtins__"] = restricted_builtins()
        exec(compile(code, "<figür>", "exec"), scope)  # noqa: S102 — AST denetiminden geçmiş figür kodu
        path = pick_output(expected)
        if path is None:
            raise Rejected(f"{expected} üretilmedi (save_figure(fig, n) çağrılmalı)")
        data = path.read_bytes()
        if len(data) > MAX_SVG:
            raise Rejected("SVG 2 MB sınırını aşıyor")
        out = {"ok": True, "file": path.name, "svg": data.decode("utf-8", errors="replace")}
    except Rejected as exc:
        out = {"ok": False, "error": str(exc)[:400]}
    except MemoryError:
        out = {"ok": False, "error": "bellek sınırı aşıldı"}
    except Exception as exc:  # noqa: BLE001 — figür kodunun hatası iş hatası değildir
        out = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:400]}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
