"""Şekil kodu için render sandbox'ı ve PNG boyut/boşluk denetimi (BLUEPRINT §6.1, §9.1, §12 #40–41).

LLM'in yazdığı şekil kodu güvenilmez girdidir. Katmanlar:

1. **AST ön denetimi** (``ast_check``): yalnız izinli modüller içe alınır (``matplotlib``, ``numpy``, ``math``,
   ``sympy``; ``schemdraw``/``graphviz``/``rdkit`` yalnız kuruluysa); ``os``, ``subprocess``, ``socket``, ``sys`` …
   ve ``open``/``eval``/``exec``/``__import__``/``getattr`` gibi adlar, aynı modül adlarına öznitelik erişimi
   (``matplotlib.os``, ``np.sys`` …), ``_``/``__dunder__`` öznitelikleri, mutlak yol ya da ``..`` içeren dize
   sabitleri reddedilir. Reddedilen kod **hiç çalıştırılmaz**. Bu katman *danışma* niteliğindedir (çalışma anında
   kurulan yol dizeleri gibi şeyleri göremez); asıl engel 2. katmandır.
2. **Süreç düzeyi**: ``subprocess.run([sys.executable, "-I", "-S", runner], timeout=20, cwd=<geçici dizin>,
   env=<asgari>)``; ``unshare -n`` çalışıyorsa ağ ad alanı boş açılır. Runner içinde ``resource.setrlimit``
   (CPU 10 sn, adres alanı 512 MB, dosya 5 MB, çekirdek dökümü 0) ve bir ``sys.addaudithook`` kancası (değerleri
   tanım anında bağlı; runner'ın genel değişkenlerini değiştirmek kancayı gevşetmez): soket, alt süreç,
   ``os.system``/``exec``/``fork``, ``ctypes`` olayları reddedilir; **``os.rename``/``os.replace`` tümden yasak**;
   yazma yalnız çalışma dizinindeki ``figure.png``/``figure.svg``'ye ve yalnız ``open()`` ile (``os.open`` ile
   yazma yasak, ``dir_fd``'li dosya işlemleri yasak); okuma yalnız izinli köklerden (standart kütüphane, site
   dizinleri, matplotlib verisi ve önbelleği, yazı tipleri, çalışma dizini); ``socket`` modülü ayrıca
   ``sys.modules``'tan kaldırılır.
3. **Çıktı denetimi** (``check_png``): 200 ≤ w ≤ 1600, 150 ≤ h ≤ 1600 px (maddenin ``expected_px`` aralığıyla
   kesişim), 5 KB ≤ bayt ≤ 2 MB, boş görüntü (piksel varyansı ≈ 0) reddi.

Motorlar: ``matplotlib`` (``Agg``, Lexend yazı tipi tasarım sisteminden ``fontTools`` ile woff2 → ttf; olmazsa
DejaVu Sans), ``schemdraw`` (kuruluysa; matplotlib arka ucu), ``svg`` (XML ayrıştırma; kök ``width``/``height``/
``viewBox`` dönüştürmeden **önce** okunur ve sınır dışı ya da belirsiz boyut ``size_mismatch`` olur; PNG
``cairosvg`` ile **aynı runner sürecinde** (rlimit, 20 sn, ağsız, denetim kancası) ya da ``rsvg-convert`` ile
(rlimit + zaman sınırı), ikisi de yoksa ``.svg`` saklanır ve PNG ``SKIP``), ``tikz``/``latex`` (``tectonic`` varsa,
``-Z shell-escape`` YOK), ``vega-lite`` (``vl-convert-python`` varsa), ``graphviz`` (``dot`` ikilisi varsa),
``rdkit`` (kuruluysa). Motor yoksa sonuç ``skipped`` olur (``render_status='failed'``, ``vision='skipped'``;
§12 #41).
"""

from __future__ import annotations

import ast
import functools
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ogrenmen_common.paths import repo_root

PAPER, NAVY, PRIMARY = "#f6f8fc", "#051c60", "#0030a2"
"""Tasarım sistemi şekil renkleri (``paper``/``navy``/``primary``)."""

TIMEOUT_S = 20
CPU_SECONDS = 10
MEMORY_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 5 * 1024 * 1024

PX_BOUNDS = {"min_w": 200, "max_w": 1600, "min_h": 150, "max_h": 1600}
MIN_BYTES = 5 * 1024
MAX_BYTES = 2 * 1024 * 1024
BLANK_STD = 0.01
"""Kanal başına piksel standart sapmasının (0–1 ölçeği) en büyüğü bunun altındaysa görüntü boştur."""

PYTHON_TOOLS = ("matplotlib", "schemdraw", "rdkit")
BASE_MODULES = ("matplotlib", "numpy", "math", "sympy")
OPTIONAL_MODULES = ("schemdraw", "graphviz", "rdkit")
FORBIDDEN_NAMES = frozenset({
    "open", "eval", "exec", "compile", "__import__", "getattr", "setattr", "delattr", "globals", "locals", "vars",
    "input", "breakpoint", "help", "exit", "quit", "memoryview", "__builtins__", "__loader__", "__spec__",
    "os", "sys", "subprocess", "socket", "shutil", "pathlib", "importlib", "ctypes", "builtins",
})
FORBIDDEN_ATTRS = frozenset({
    "load", "loadtxt", "genfromtxt", "fromfile", "fromregex", "tofile", "save", "savez", "savez_compressed",
    "savetxt", "memmap", "DataSource", "imread", "imsave", "system", "popen", "urlopen", "urlretrieve",
    "open_file_cm", "to_filehandle", "get_sample_data",
})
"""Dosya/ağ okuyan ya da yazan bilinen kütüphane işlevleri (``savefig`` hariç; o yalnız göreli adla çalışır)."""
FORBIDDEN_MODULE_ATTRS = frozenset({
    "os", "sys", "subprocess", "socket", "shutil", "pathlib", "importlib", "ctypes", "ctypeslib", "builtins",
    "io", "tempfile", "pickle", "marshal", "multiprocessing", "threading", "signal", "pty", "posix", "resource",
    "inspect", "gc", "urllib", "http", "glob", "codecs", "zipfile", "tarfile", "sqlite3", "webbrowser",
})
"""İzinli modüllerin içinden bu modüllere uzanan öznitelik zincirleri (``matplotlib.os``, ``np.ctypeslib``)."""
WRITABLE_NAMES = ("figure.png", "figure.svg")
"""Runner'ın yazabildiği tek dosyalar (çalışma dizininde)."""

STATUS_OK = "ok"


class SandboxRejected(Exception):
    """AST ön denetimi kodu reddetti (kod çalıştırılmadı)."""


@dataclass
class RenderResult:
    """Bir şekil kodunun render sonucu.

    ``status``: ``ok`` | ``rejected`` (AST) | ``failed`` (çalışma hatası, zaman aşımı, bozuk SVG, PNG yok) |
    ``skipped`` (motor kurulu değil) | ``size_mismatch`` (boyut/bayt) | ``blank`` (boş görüntü).
    """

    status: str
    tool: str
    png: bytes | None = field(default=None, repr=False)
    svg: bytes | None = field(default=None, repr=False)
    width_px: int | None = None
    height_px: int | None = None
    bytes: int | None = None
    pixel_variance: float | None = None
    duration_ms: int = 0
    log: str = ""

    @property
    def ok(self) -> bool:
        return self.status == STATUS_OK

    @property
    def render_status(self) -> str:
        """``figures.render_status``."""
        return "rendered" if self.ok else "failed"

    @property
    def verification_render(self) -> str:
        """``question-item.verification.render``."""
        if self.ok:
            return "ok"
        return "size_mismatch" if self.status in ("size_mismatch", "blank") else "failed"

    @property
    def vision_default(self) -> str:
        """Render olmadıysa vision ``skipped`` (§12 #41); olduysa ``pending``."""
        return "pending" if self.ok else "skipped"

    def report(self) -> dict[str, Any]:
        """``figure-render-report.render`` nesnesi."""
        status = {"ok": "ok", "size_mismatch": "size_mismatch", "blank": "blank", "skipped": "skipped"}.get(
            self.status, "failed")
        out: dict[str, Any] = {"status": status, "tool": self.tool, "duration_ms": int(self.duration_ms)}
        for key in ("width_px", "height_px", "bytes"):
            value = getattr(self, key)
            if value is not None:
                out[key] = int(value)
        if self.pixel_variance is not None:
            out["pixel_variance"] = round(float(self.pixel_variance), 3)
        if self.log:
            out["log"] = self.log[-4000:]
        return out


# --- AST ön denetimi -------------------------------------------------------------------------------


def installed(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


@functools.lru_cache(maxsize=1)
def allowed_modules() -> frozenset[str]:
    """İzinli üst modüller: temel dört + kurulu olan isteğe bağlılar."""
    return frozenset(BASE_MODULES) | frozenset(m for m in OPTIONAL_MODULES if installed(m))


_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")


def _bad_path_literal(value: str) -> bool:
    v = value.strip()
    return v.startswith(("/", "~", "\\")) or ".." in v or "://" in v or bool(_DRIVE.match(v))


def ast_check(code: str) -> list[str]:
    """Kodu çalıştırmadan denetler; içe alınan üst modüllerin listesini döner, ihlalde ``SandboxRejected``."""
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError as exc:
        raise SandboxRejected(f"sözdizimi hatası: satır {exc.lineno}: {exc.msg}") from exc
    allowed = allowed_modules()
    imported: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name.split(".")[0]
                if top not in allowed:
                    raise SandboxRejected(f"izinsiz modül: {alias.name}")
                imported.append(top)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise SandboxRejected("göreli içe alma yasak")
            top = (node.module or "").split(".")[0]
            if top not in allowed:
                raise SandboxRejected(f"izinsiz modül: {node.module}")
            for alias in node.names:
                if alias.name == "*" or alias.name.startswith("_"):
                    raise SandboxRejected(f"izinsiz içe alma: from {node.module} import {alias.name}")
            imported.append(top)
        elif isinstance(node, ast.Name):
            if node.id in FORBIDDEN_NAMES or (node.id.startswith("__") and node.id != "__name__"):
                raise SandboxRejected(f"izinsiz ad: {node.id}")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                raise SandboxRejected(f"özel/dunder öznitelik yasak: .{node.attr}")
            if node.attr in FORBIDDEN_ATTRS:
                raise SandboxRejected(f"dosya/ağ işlevi yasak: .{node.attr}")
            if node.attr in FORBIDDEN_MODULE_ATTRS:
                raise SandboxRejected(f"izinsiz modüle öznitelik erişimi yasak: .{node.attr}")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            if _bad_path_literal(node.value):
                raise SandboxRejected(f"mutlak yol, URL ya da '..' içeren dize yasak: {node.value[:40]!r}")
        elif isinstance(node, ast.Constant) and isinstance(node.value, bytes):
            raise SandboxRejected("bayt dizesi sabiti yasak")
        elif isinstance(node, (ast.Global, ast.Nonlocal)):
            raise SandboxRejected("global/nonlocal yasak")
    return sorted(set(imported))


# --- süreç ----------------------------------------------------------------------------------------


@functools.lru_cache(maxsize=1)
def netns_prefix() -> tuple[str, ...]:
    """Ağsız ad alanı öneki (``unshare -n``; olmazsa kullanıcı ad alanıyla ``-r -n``); ikisi de yoksa boş."""
    unshare = shutil.which("unshare")
    if not unshare:
        return ()
    for prefix in ((unshare, "-n"), (unshare, "-r", "-n")):
        try:
            proc = subprocess.run([*prefix, "true"], capture_output=True, timeout=5)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if proc.returncode == 0:
            return prefix
    return ()


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    path = Path(base) / "ogrenmen-tablet"
    path.mkdir(parents=True, exist_ok=True)
    return path


@functools.lru_cache(maxsize=1)
def lexend_fonts() -> tuple[str, ...]:
    """Tasarım sistemi Lexend woff2 → ttf (``fontTools``; önbellek). Başarısızsa boş (DejaVu Sans kullanılır)."""
    src_dir = repo_root() / "packages" / "design-system" / "fonts"
    sources = sorted(src_dir.glob("Lexend-*.woff2"))
    if not sources:
        return ()
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return ()
    out_dir = cache_dir() / "fonts"
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[str] = []
    for src in sources:
        data = src.read_bytes()
        target = out_dir / f"{src.stem}-{hashlib.sha256(data).hexdigest()[:10]}.ttf"
        if not target.exists():
            try:
                font = TTFont(str(src))
                font.flavor = None
                tmp = target.with_suffix(".tmp")
                font.save(str(tmp))
                tmp.replace(target)
            except Exception:  # noqa: BLE001 - brotli yoksa ya da dosya bozuksa DejaVu'ya düşülür (§12 #40)
                return ()
        paths.append(str(target))
    return tuple(paths)


def _sandbox_sys_path() -> list[str]:
    """Runner'ın ``sys.path``'i: standart kütüphane ve site dizinleri; depo kaynakları (``ogrenmen_*``) yok."""
    repo = str(repo_root().resolve())
    prefixes = {str(Path(p).resolve()) for p in (sys.prefix, sys.base_prefix, sys.exec_prefix)}
    out: list[str] = []
    for entry in sys.path:
        if not entry or not Path(entry).exists():
            continue
        resolved = str(Path(entry).resolve())
        if resolved.startswith(repo) or resolved in ("/", str(Path.cwd().resolve())):
            continue
        # yalnız Python kurulumu ve site dizinleri: çalışma dizini, $HOME ya da / okuma kökü olamaz
        site_like = Path(resolved).name in ("site-packages", "dist-packages") or resolved.endswith(".zip")
        under_prefix = any(resolved.startswith(p.rstrip("/") + "/") for p in prefixes)
        if not (site_like or under_prefix):
            continue
        if resolved not in out:
            out.append(resolved)
    return out


def _read_roots(work: Path, mpl_dir: Path, fonts: tuple[str, ...]) -> list[str]:
    """Runner'ın okuyabildiği kökler: çalışma dizini, matplotlib önbelleği/verisi, yazı tipleri, standart kütüphane
    ve site dizinleri. Python kurulum öneki (``/usr``) bütünüyle **verilmez**."""
    import sysconfig

    roots = {str(work.resolve()), str(mpl_dir.resolve()), "/usr/share/fonts", "/usr/local/share/fonts"}
    paths = sysconfig.get_paths()
    for key in ("stdlib", "platstdlib", "purelib", "platlib"):
        if paths.get(key) and Path(paths[key]).exists():
            roots.add(str(Path(paths[key]).resolve()))
    roots.update(_sandbox_sys_path())
    roots.update(str(Path(f).parent) for f in fonts)
    if installed("matplotlib"):
        spec = importlib.util.find_spec("matplotlib")
        if spec is not None and spec.origin:
            roots.add(str(Path(spec.origin).resolve().parent))
    return sorted(r for r in roots if r != "/")


RUNNER = r'''
import json as _json
import sys as _sys

_CFG = _json.loads(open("sandbox.json", encoding="utf-8").read())
_sys.path[:0] = _CFG["sys_path"]
import resource as _res

for _name, _value in (("RLIMIT_CPU", _CFG["cpu"]), ("RLIMIT_AS", _CFG["mem"]), ("RLIMIT_FSIZE", _CFG["fsize"]),
                      ("RLIMIT_CORE", 0)):
    _lim = getattr(_res, _name, None)
    if _lim is not None:
        try:
            _res.setrlimit(_lim, (_value, _value))
        except (ValueError, OSError):
            pass

import os as _os

_WORK = _os.path.realpath(_os.getcwd())
_READ = tuple(_os.path.realpath(p) for p in _CFG["read_roots"])
_W_FLAGS = _os.O_WRONLY | _os.O_RDWR | _os.O_APPEND | _os.O_CREAT | _os.O_TRUNC


if _CFG["tool"] in ("matplotlib", "schemdraw"):
    import matplotlib as _mpl

    _mpl.use("Agg")
    import matplotlib.pyplot as _plt
    from matplotlib import font_manager as _fm

    _family = ["DejaVu Sans"]
    for _f in _CFG["fonts"]:
        try:
            _fm.fontManager.addfont(_f)
            _family = ["Lexend", "DejaVu Sans"]
        except Exception:
            pass
    _mpl.rcParams.update({
        "font.family": "sans-serif", "font.sans-serif": _family, "font.size": 12,
        "axes.labelsize": 12, "xtick.labelsize": 11, "ytick.labelsize": 11, "axes.titlesize": 13,
        "figure.facecolor": _CFG["paper"], "axes.facecolor": _CFG["paper"], "savefig.facecolor": _CFG["paper"],
        "axes.edgecolor": _CFG["navy"], "axes.labelcolor": _CFG["navy"], "text.color": _CFG["navy"],
        "xtick.color": _CFG["navy"], "ytick.color": _CFG["navy"], "lines.color": _CFG["primary"],
        "lines.linewidth": 2.0, "figure.dpi": 100, "savefig.dpi": 100,
    })
    from cycler import cycler as _cycler

    _mpl.rcParams["axes.prop_cycle"] = _cycler(color=[_CFG["primary"], _CFG["navy"], "#7a86a8", "#c9d6f2"])
for _mod in _CFG["preload"]:
    __import__(_mod)

_BLOCKED_PREFIX = ("socket.", "subprocess.", "os.system", "os.exec", "os.spawn", "os.posix_spawn", "os.fork",
                   "os.forkpty", "os.kill", "os.putenv", "os.unsetenv", "pty.", "ctypes.", "urllib.", "http.",
                   "ftplib.", "smtplib.", "telnetlib.", "webbrowser.", "winreg.", "sqlite3.", "shutil.",
                   "os.chdir", "os.chmod", "os.chown", "os.link", "os.symlink", "os.truncate", "os.rename",
                   "os.chflags", "os.lchflags", "os.lchmod", "os.setxattr", "os.removexattr", "tempfile.")
# olay → (yol argümanı, dir_fd argümanı) sırası
_WRITE_EVENTS = {"os.remove": 1, "os.rmdir": 1, "os.mkdir": 2, "os.utime": 3}
_READ_EVENTS = ("os.listdir", "os.scandir", "glob.glob")


class _Blocked(PermissionError):
    pass


def _make_hook(work, read_roots, writable, blocked_prefix, write_events, read_events, w_flags, realpath, fsdecode,
               blocked_cls):
    """Kanca değerleri kapanışta bağlıdır: şekil kodu runner'ın genel adlarını değiştirse de kanca değişmez."""
    writable_paths = frozenset(work + "/" + n for n in writable)

    def inside(path, roots):
        try:
            p = realpath(fsdecode(path))
        except Exception:
            return False
        return any(p == r or p.startswith(r.rstrip("/") + "/") for r in roots)

    def hook(event, args):
        if event.startswith(blocked_prefix):
            raise blocked_cls("sandbox: engellendi: " + event)
        if event == "open":
            path, mode, flags = (tuple(args) + (None, None, None))[:3]
            if path is None:
                return
            writing = (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
                isinstance(flags, int) and bool(flags & w_flags))
            if isinstance(path, int):
                if writing:
                    raise blocked_cls("sandbox: tanımlayıcıdan yazma açılışı yasak")
                return
            if writing:
                if mode is None:  # os.open (dir_fd ile çalışma dizini dışına kaçabilir) yazmada yasak
                    raise blocked_cls("sandbox: os.open ile yazma yasak: " + fsdecode(path))
                try:
                    target = realpath(fsdecode(path))
                except Exception:
                    target = ""
                if target not in writable_paths:
                    raise blocked_cls("sandbox: yalnız figure.png/figure.svg yazılabilir: " + fsdecode(path))
            elif not inside(path, read_roots):
                raise blocked_cls("sandbox: izinsiz okuma: " + fsdecode(path))
        elif event in write_events:
            fd_index = write_events[event]
            if len(args) > fd_index and args[fd_index] is not None:
                raise blocked_cls("sandbox: dir_fd ile dosya işlemi yasak: " + event)
            if args and (isinstance(args[0], int) or not inside(args[0], (work,))):
                raise blocked_cls("sandbox: çalışma dizini dışında değişiklik: " + event)
        elif event in read_events:
            if args and args[0] is not None and not isinstance(args[0], int) and not inside(args[0], read_roots):
                raise blocked_cls("sandbox: izinsiz dizin okuma: " + event)

    return hook


_hook = _make_hook(_WORK, _READ, tuple(_CFG["writable"]), _BLOCKED_PREFIX, dict(_WRITE_EVENTS), _READ_EVENTS,
                   _W_FLAGS, _os.path.realpath, _os.fsdecode, _Blocked)
_svg2png = _sys.modules["cairosvg"].svg2png if _CFG["tool"] == "svg" else None

for _m in ("socket", "_socket", "ssl", "_ssl", "subprocess", "_posixsubprocess"):
    _sys.modules[_m] = None
_sys.addaudithook(_hook)
del _make_hook

if _CFG["tool"] == "svg":
    with open("figure.svg", "rb") as _fh:
        _png = _svg2png(bytestring=_fh.read(), unsafe=False)
    with open("figure.png", "wb") as _fh:
        _fh.write(_png)
else:
    _code = open("figure_code.py", encoding="utf-8").read()
    _ns = {"__name__": "__main__"}
    exec(compile(_code, "figure_code.py", "exec"), _ns)

    if _CFG["tool"] in ("matplotlib", "schemdraw") and not _os.path.exists("figure.png"):
        if _plt.get_fignums():
            _plt.gcf().savefig("figure.png")
'''


def _run_python(code: str, tool: str, work: Path, *, preload: list[str]) -> tuple[int | None, str, int]:
    """Runner'ı ayrı süreçte çalıştırır: ``(dönüş kodu ya da None (zaman aşımı), log, süre ms)``."""
    fonts = lexend_fonts() if tool in ("matplotlib", "schemdraw") else ()
    mpl_dir = cache_dir() / "mplconfig"
    mpl_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "sys_path": _sandbox_sys_path(), "cpu": CPU_SECONDS, "mem": MEMORY_BYTES, "fsize": MAX_FILE_BYTES,
        "read_roots": _read_roots(work, mpl_dir, fonts), "fonts": list(fonts), "tool": tool,
        "writable": list(WRITABLE_NAMES),
        "preload": [m for m in preload if m != "math"], "paper": PAPER, "navy": NAVY, "primary": PRIMARY,
    }
    (work / "sandbox.json").write_text(json.dumps(config), encoding="utf-8")
    (work / "figure_code.py").write_text(code, encoding="utf-8")
    runner = work / "runner.py"
    runner.write_text(RUNNER, encoding="utf-8")
    env = {"PATH": "/usr/bin:/bin", "HOME": str(work), "MPLCONFIGDIR": str(mpl_dir), "MPLBACKEND": "Agg",
           "OPENBLAS_NUM_THREADS": "1", "OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": "1", "LANG": "C.UTF-8",
           "LC_ALL": "C.UTF-8", "TMPDIR": str(work), "SOURCE_DATE_EPOCH": "0"}
    cmd = [*netns_prefix(), sys.executable, "-I", "-S", str(runner)]
    start = time.monotonic()
    try:
        proc = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired as exc:
        ms = int((time.monotonic() - start) * 1000)
        err = exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        return None, f"zaman aşımı ({TIMEOUT_S} sn)\n{err[-2000:]}", ms
    ms = int((time.monotonic() - start) * 1000)
    log = (proc.stdout[-1000:] + "\n" + proc.stderr[-3000:]).strip()
    return proc.returncode, log, ms


def _sandboxed_python(code: str, tool: str, work: Path, *, ast_checked: bool = True) -> RenderResult:
    """Python motorları (matplotlib, schemdraw, rdkit). ``ast_checked=False`` yalnız süreç düzeyi kemerlerini
    sınayan testler içindir (AST'den kaçmış bir kodun da ağa/dosyaya erişemediğini gösterir)."""
    preload: list[str] = []
    if ast_checked:
        try:
            preload = ast_check(code)
        except SandboxRejected as exc:
            return RenderResult(status="rejected", tool=tool, log=f"AST ön denetimi: {exc}")
    if tool == "matplotlib" and "matplotlib" not in preload:
        preload.append("matplotlib")
    if tool == "schemdraw" and not installed("schemdraw"):
        return RenderResult(status="skipped", tool=tool, log="SKIP: schemdraw kurulu değil")
    if tool == "rdkit" and not installed("rdkit"):
        return RenderResult(status="skipped", tool=tool, log="SKIP: rdkit kurulu değil")
    code_rc, log, ms = _run_python(code, tool, work, preload=preload)
    png = work / "figure.png"
    if code_rc is None:
        return RenderResult(status="failed", tool=tool, duration_ms=ms, log=log)
    if code_rc != 0:
        return RenderResult(status="failed", tool=tool, duration_ms=ms, log=f"çıkış kodu {code_rc}\n{log}")
    if not png.is_file():
        return RenderResult(status="failed", tool=tool, duration_ms=ms, log=f"figure.png üretilmedi\n{log}")
    return RenderResult(status=STATUS_OK, tool=tool, png=png.read_bytes(), duration_ms=ms, log=log)


def _child_limits() -> None:  # pragma: no cover - alt süreçte çalışır
    """Dış motor süreçlerine (``rsvg-convert``, ``dot``) aynı CPU/bellek/dosya sınırları."""
    import resource

    for name, value in (("RLIMIT_CPU", CPU_SECONDS), ("RLIMIT_AS", MEMORY_BYTES), ("RLIMIT_FSIZE", MAX_FILE_BYTES),
                        ("RLIMIT_CORE", 0)):
        lim = getattr(resource, name, None)
        if lim is not None:
            try:
                resource.setrlimit(lim, (value, value))
            except (ValueError, OSError):
                pass


_SVG_LENGTH = re.compile(r"^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$")
_SVG_UNITS = {None: 1.0, "px": 1.0, "pt": 96 / 72, "pc": 16.0, "mm": 96 / 25.4, "cm": 96 / 2.54, "in": 96.0}


def _svg_length(value: str | None) -> float | None:
    """SVG uzunluğu → px (CSS 96 dpi); yüzde, em ya da ayrıştırılamayan değer ``None``."""
    if value is None:
        return None
    m = _SVG_LENGTH.match(str(value))
    if not m:
        return None
    return float(m.group(1)) * _SVG_UNITS[m.group(2)]


def svg_size(root: Any) -> tuple[float, float] | None:
    """Kök ``<svg>``'nin piksel boyutu: ``width``/``height``, yoksa ``viewBox``; belirsizse ``None``."""
    w, h = _svg_length(root.get("width")), _svg_length(root.get("height"))
    box = None
    if root.get("viewBox"):
        parts = re.split(r"[\s,]+", str(root.get("viewBox")).strip())
        try:
            nums = [float(x) for x in parts]
        except ValueError:
            nums = []
        if len(nums) == 4 and nums[2] > 0 and nums[3] > 0:
            box = (nums[2], nums[3])
    if w is None and root.get("width") is None and box:
        w = box[0] if h is None else h * box[0] / box[1]
    if h is None and root.get("height") is None and box:
        h = box[1] if w is None else w * box[1] / box[0]
    if w is None or h is None:
        return None
    return w, h


def _svg_to_png(svg: bytes, work: Path) -> tuple[bytes | None, str]:
    """SVG → PNG; ``cairosvg`` runner sürecinde (rlimit, zaman sınırı, ağsız, denetim kancası) çalışır."""
    (work / "figure.svg").write_bytes(svg)
    if installed("cairosvg"):
        code_rc, log, _ms = _run_python("", "svg", work, preload=["cairosvg"])
        png = work / "figure.png"
        if code_rc is None:
            return None, f"cairosvg {log}"
        if code_rc != 0 or not png.is_file():
            return None, f"cairosvg hatası (çıkış kodu {code_rc}): {log[-1500:]}"
        return png.read_bytes(), "cairosvg (sandbox)"
    rsvg = shutil.which("rsvg-convert")
    if rsvg:
        try:
            proc = subprocess.run([*netns_prefix(), rsvg, "-o", str(work / "figure.png"), str(work / "figure.svg")],
                                  capture_output=True, timeout=TIMEOUT_S, cwd=work, env={"PATH": "/usr/bin:/bin"},
                                  preexec_fn=_child_limits)
        except subprocess.TimeoutExpired:
            return None, "rsvg-convert zaman aşımı"
        if proc.returncode == 0 and (work / "figure.png").is_file():
            return (work / "figure.png").read_bytes(), "rsvg-convert"
        return None, f"rsvg-convert hatası: {proc.stderr.decode('utf-8', 'replace')[-500:]}"
    return None, "SKIP: PNG dönüştürücü yok (cairosvg / rsvg-convert); .svg saklandı"


def _render_svg(code: str, work: Path, expected_px: dict[str, int] | None = None) -> RenderResult:
    from defusedxml import ElementTree as SafeET

    start = time.monotonic()
    data = code.encode("utf-8")
    if len(data) > MAX_FILE_BYTES:
        return RenderResult(status="failed", tool="svg", log="SVG 5 MB sınırını aşıyor")
    try:
        root = SafeET.fromstring(data)
    except Exception as exc:  # noqa: BLE001 - defusedxml ve expat birçok tür fırlatır
        return RenderResult(status="failed", tool="svg", log=f"bozuk SVG/XML: {exc}")
    if not str(root.tag).endswith("svg"):
        return RenderResult(status="failed", tool="svg", log=f"kök öğe svg değil: {root.tag}")
    for el in root.iter():
        tag = str(el.tag).rsplit("}", 1)[-1].lower()
        if tag in ("script", "foreignobject", "iframe"):
            return RenderResult(status="rejected", tool="svg", log=f"SVG içinde izinsiz öğe: {tag}")
        if tag == "style" and re.search(r"@import|url\s*\(\s*['\"]?(?!#)", el.text or "", re.IGNORECASE):
            return RenderResult(status="rejected", tool="svg", log="SVG stilinde dış kaynak yasak")
        for attr, value in el.attrib.items():
            if attr.rsplit("}", 1)[-1].lower() == "href" and not str(value).startswith("#"):
                return RenderResult(status="rejected", tool="svg", log="SVG dış kaynak bağlantısı yasak")
            if attr.lower().startswith("on"):
                return RenderResult(status="rejected", tool="svg", log=f"SVG olay özniteliği yasak: {attr}")
    size = svg_size(root)
    exp = expected_px or {}
    hi_w = min(PX_BOUNDS["max_w"], exp.get("max_w", 10 ** 6))
    hi_h = min(PX_BOUNDS["max_h"], exp.get("max_h", 10 ** 6))
    if size is None:
        return RenderResult(status="size_mismatch", tool="svg", svg=data,
                            log="SVG boyutu belirsiz (width/height ya da viewBox px cinsinden okunamadı)")
    if size[0] > hi_w or size[1] > hi_h or size[0] <= 0 or size[1] <= 0:
        return RenderResult(status="size_mismatch", tool="svg", svg=data,
                            log=f"SVG boyutu {size[0]:.0f}x{size[1]:.0f} px sınır dışı (en çok {hi_w}x{hi_h}); "
                                "dönüştürülmedi")
    png, note = _svg_to_png(data, work)
    ms = int((time.monotonic() - start) * 1000)
    if png is None:
        status = "skipped" if note.startswith("SKIP") else "failed"
        return RenderResult(status=status, tool="svg", svg=data, duration_ms=ms, log=note)
    return RenderResult(status=STATUS_OK, tool="svg", svg=data, png=png, duration_ms=ms, log=note)


TIKZ_WRAPPER = r"""\documentclass[border=4pt]{standalone}
\usepackage{tikz}
\usepackage{amsmath}
\begin{document}
%s
\end{document}
"""


def _render_tikz(code: str, tool: str, work: Path) -> RenderResult:
    tectonic = shutil.which("tectonic")
    if not tectonic:
        return RenderResult(status="skipped", tool=tool, log="SKIP: tectonic kurulu değil")
    lowered = code.lower()
    for bad in ("\\write18", "\\input", "\\include", "\\openout", "\\openin", "\\read", "\\immediate", "\\catcode",
                "shell-escape", "\\directlua", "\\usepackage{shellesc"):
        if bad in lowered:
            return RenderResult(status="rejected", tool=tool, log=f"LaTeX içinde izinsiz komut: {bad}")
    body = code if "\\documentclass" in code else TIKZ_WRAPPER % code
    (work / "figure.tex").write_text(body, encoding="utf-8")
    start = time.monotonic()
    try:
        proc = subprocess.run([*netns_prefix(), tectonic, "--untrusted", "--outdir", str(work), "figure.tex"],
                              cwd=work, capture_output=True, text=True, timeout=TIMEOUT_S * 3,
                              env={"PATH": "/usr/bin:/bin", "HOME": str(work)})
    except subprocess.TimeoutExpired:
        return RenderResult(status="failed", tool=tool, log="tectonic zaman aşımı")
    ms = int((time.monotonic() - start) * 1000)
    pdf = work / "figure.pdf"
    if proc.returncode != 0 or not pdf.is_file():
        return RenderResult(status="failed", tool=tool, duration_ms=ms, log=proc.stderr[-3000:])
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return RenderResult(status="skipped", tool=tool, duration_ms=ms, log="SKIP: PDF → PNG için pypdfium2 yok")
    page = pdfium.PdfDocument(str(pdf))[0]
    page.render(scale=2).to_pil().save(work / "figure.png")
    return RenderResult(status=STATUS_OK, tool=tool, png=(work / "figure.png").read_bytes(), duration_ms=ms)


def _render_vega(code: str, work: Path) -> RenderResult:
    if not installed("vl_convert"):
        return RenderResult(status="skipped", tool="vega-lite", log="SKIP: vl-convert-python kurulu değil")
    try:
        spec = json.loads(code)
    except json.JSONDecodeError as exc:
        return RenderResult(status="failed", tool="vega-lite", log=f"bozuk Vega-Lite JSON: {exc}")
    if "url" in json.dumps(spec):
        return RenderResult(status="rejected", tool="vega-lite", log="Vega-Lite dış veri (url) yasak")
    import vl_convert as vlc

    start = time.monotonic()
    try:
        png = vlc.vegalite_to_png(vl_spec=spec, scale=1)
    except Exception as exc:  # noqa: BLE001
        return RenderResult(status="failed", tool="vega-lite", log=f"vl-convert hatası: {exc}")
    return RenderResult(status=STATUS_OK, tool="vega-lite", png=png, duration_ms=int((time.monotonic() - start) * 1000))


def _render_graphviz(code: str, work: Path) -> RenderResult:
    dot = shutil.which("dot")
    if not dot:
        return RenderResult(status="skipped", tool="graphviz", log="SKIP: graphviz (dot) kurulu değil")
    if "image=" in code.replace(" ", "") or "shapefile" in code:
        return RenderResult(status="rejected", tool="graphviz", log="graphviz dış dosya özniteliği yasak")
    (work / "figure.dot").write_text(code, encoding="utf-8")
    start = time.monotonic()
    try:
        proc = subprocess.run([*netns_prefix(), dot, "-Tpng", "-Gdpi=100", "-o", "figure.png", "figure.dot"], cwd=work,
                              capture_output=True, text=True, timeout=TIMEOUT_S, env={"PATH": "/usr/bin:/bin"},
                              preexec_fn=_child_limits)
    except subprocess.TimeoutExpired:
        return RenderResult(status="failed", tool="graphviz", log="dot zaman aşımı")
    ms = int((time.monotonic() - start) * 1000)
    if proc.returncode != 0 or not (work / "figure.png").is_file():
        return RenderResult(status="failed", tool="graphviz", duration_ms=ms, log=proc.stderr[-3000:])
    return RenderResult(status=STATUS_OK, tool="graphviz", png=(work / "figure.png").read_bytes(), duration_ms=ms)


# --- PNG denetimi ---------------------------------------------------------------------------------


@dataclass
class PngCheck:
    ok: bool
    status: str
    """``ok`` | ``size_mismatch`` | ``blank``"""
    reason: str | None
    width_px: int
    height_px: int
    bytes: int
    pixel_variance: float


def png_dimensions(data: bytes) -> tuple[int, int]:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 24:
        raise ValueError("PNG değil")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def check_png(data: bytes, expected_px: dict[str, int] | None = None, *, min_bytes: int = MIN_BYTES) -> PngCheck:
    """§6.1 boyut sanity'si: boyutlar (``expected_px`` ∩ genel sınır), boş görüntü, bayt aralığı."""
    import io

    import numpy as np
    from matplotlib import image as mpimg

    try:
        w, h = png_dimensions(data)
    except ValueError:
        return PngCheck(False, "size_mismatch", "dosya PNG değil", 0, 0, len(data), 0.0)
    exp = expected_px or {}
    lo_w, hi_w = max(PX_BOUNDS["min_w"], exp.get("min_w", 0)), min(PX_BOUNDS["max_w"], exp.get("max_w", 10 ** 6))
    lo_h, hi_h = max(PX_BOUNDS["min_h"], exp.get("min_h", 0)), min(PX_BOUNDS["max_h"], exp.get("max_h", 10 ** 6))
    size = len(data)
    if not (lo_w <= w <= hi_w and lo_h <= h <= hi_h):
        return PngCheck(False, "size_mismatch", f"boyut {w}x{h} px beklenen aralıkta değil (genişlik {lo_w}–{hi_w}, "
                        f"yükseklik {lo_h}–{hi_h})", w, h, size, 0.0)
    try:
        pixels = np.asarray(mpimg.imread(io.BytesIO(data), format="png"), dtype=float)
    except Exception as exc:  # noqa: BLE001 - bozuk PNG: Pillow/matplotlib farklı türler fırlatır
        return PngCheck(False, "size_mismatch", f"PNG okunamadı: {exc}", w, h, size, 0.0)
    channels = pixels.reshape(-1, pixels.shape[2]) if pixels.ndim == 3 else pixels.reshape(-1, 1)
    rgb = channels[:, :3] if channels.shape[1] >= 3 else channels
    gray = rgb.mean(axis=1) * 255.0
    variance = float(gray.var())
    if float(channels.std(axis=0).max()) < BLANK_STD:
        return PngCheck(False, "blank", "görüntü boş (piksel varyansı ≈ 0)", w, h, size, variance)
    if not (min_bytes <= size <= MAX_BYTES):
        return PngCheck(False, "size_mismatch", f"dosya {size} bayt; {min_bytes}–{MAX_BYTES} bayt arasında olmalı",
                        w, h, size, variance)
    return PngCheck(True, "ok", None, w, h, size, variance)


# --- giriş ----------------------------------------------------------------------------------------


def render(tool: str, code: str, *, expected_px: dict[str, int] | None = None,
           workdir: Path | None = None) -> RenderResult:
    """Şekil kodunu motoruna göre sandbox'ta çizer ve PNG'yi denetler (geçici dizin her çağrıda yenidir)."""
    with tempfile.TemporaryDirectory(prefix="ogrenmen-render-", dir=workdir) as tmp:
        work = Path(tmp)
        if tool in PYTHON_TOOLS:
            result = _sandboxed_python(code, tool, work)
        elif tool == "svg":
            result = _render_svg(code, work, expected_px)
        elif tool in ("tikz", "latex"):
            result = _render_tikz(code, tool, work)
        elif tool == "vega-lite":
            result = _render_vega(code, work)
        elif tool == "graphviz":
            result = _render_graphviz(code, work)
        else:
            result = RenderResult(status="rejected", tool=tool, log=f"bu yolda desteklenmeyen motor: {tool}")
    return apply_png_check(result, expected_px)


def apply_png_check(result: RenderResult, expected_px: dict[str, int] | None = None) -> RenderResult:
    if not result.ok or result.png is None:
        return result
    check = check_png(result.png, expected_px)
    result.width_px, result.height_px, result.bytes = check.width_px, check.height_px, check.bytes
    result.pixel_variance = check.pixel_variance
    if not check.ok:
        result.status = check.status
        result.log = f"{check.reason}\n{result.log}".strip()
    return result
