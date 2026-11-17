"""Render sandbox'ı: AST + süreç düzeyi engeller, boyut denetimi, boş görüntü reddi, motor SKIP'leri (§6.1, §12 #41)."""

from __future__ import annotations

import io
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from matplotlib import image as mpimg

from conftest import TABLET_FIXTURES
from ogrenmen_tablet import figures as FG
from ogrenmen_tablet import sandbox as S

FIG = TABLET_FIXTURES / "figures"


def _png(width: int, height: int, *, noise: bool = True, seed: int = 0) -> bytes:
    rng = np.random.default_rng(seed)
    if noise:
        pixels = rng.random((height, width, 3))
    else:
        pixels = np.ones((height, width, 3)) * 0.97
    buf = io.BytesIO()
    mpimg.imsave(buf, pixels, format="png")
    return buf.getvalue()


def test_sandbox_blocks_network_and_fs(tmp_path):
    # 1) AST ön denetimi: fixture net.py socket içe alır → hiç çalıştırılmaz
    net = S.render("matplotlib", (FIG / "net.py").read_text(encoding="utf-8"))
    assert net.status == "rejected" and "socket" in net.log
    assert net.png is None and net.render_status == "failed" and net.vision_default == "skipped"
    for code, needle in [
        ("import os\nos.listdir('.')\n", "os"),
        ("import subprocess\n", "subprocess"),
        ("x = open('figure.png', 'w')\n", "open"),
        ("m = __import__('socket')\n", "__import__"),
        ("import numpy as np\nnp.loadtxt('a.txt')\n", "loadtxt"),
        ("import matplotlib.pyplot as plt\nplt.savefig('/tmp/kacak.png')\n", "mutlak yol"),
        ("import matplotlib.pyplot as plt\nplt.savefig('../kacak.png')\n", "'..'"),
        ("import matplotlib\nmatplotlib.__dict__\n", "dunder"),
        ("import requests\n", "requests"),
        ("import matplotlib\nmatplotlib.os.environ\n", ".os"),
        ("import numpy as np\nnp.os.execv('x', [])\n", ".os"),
        ("import matplotlib\nmatplotlib.subprocess\n", ".subprocess"),
        ("import numpy as np\nnp.ctypeslib\n", ".ctypeslib"),
        ("import matplotlib\nmatplotlib.cbook.sys.modules\n", ".sys"),
        ("import numpy as np\nnp.save('x.npy', [1])\n", ".save"),
    ]:
        with pytest.raises(S.SandboxRejected) as exc:
            S.ast_check(code)
        assert needle in str(exc.value), (code, str(exc.value))
    # 2) Süreç düzeyi: AST'den kaçmış kod bile ağa çıkamaz, çalışma dizini dışına yazamaz, dışarıyı okuyamaz
    leak = tmp_path / "kacak.png"
    escaped = {
        "ag": "import socket\nsocket.create_connection(('127.0.0.1', 9), timeout=1)\n",
        "okuma": "import numpy as np\nnp.loadtxt('/etc/' + 'passwd', dtype=str)\n",
        "yazma": ("import matplotlib.pyplot as plt\nfig = plt.figure()\nplt.plot([0, 1])\n"
                  f"fig.savefig({str(leak)!r})\n"),
        "komut": "import os\nos.system('touch ' + " + repr(str(leak)) + ")\n",
        "dizin": "import os\nos.listdir('/etc')\n",
    }
    for name, code in escaped.items():
        work = tmp_path / name
        work.mkdir()
        result = S._sandboxed_python(code, "matplotlib", work, ast_checked=False)
        assert result.status == "failed", (name, result.log)
        assert "sandbox:" in result.log or "socket" in result.log, (name, result.log)
    assert not leak.exists()
    # 3) Yazma kaçışları: AST'den geçmiş (ya da AST'siz) kod çalışma dizini dışına dosya bırakamaz
    _escapes_are_blocked(tmp_path)
    # 4) Ağ ad alanı: unshare -n çalışıyorsa soket bile açılsa dışarı çıkılamaz
    prefix = S.netns_prefix()
    if prefix:
        probe = subprocess.run([*prefix, sys.executable, "-c",
                                "import socket\ntry:\n    socket.create_connection(('1.1.1.1', 53), timeout=2)\n"
                                "    print('OPEN')\nexcept OSError as e:\n    print('BLOCKED', e.errno)\n"],
                               capture_output=True, text=True, timeout=20)
        assert "BLOCKED" in probe.stdout, probe.stdout + probe.stderr


def test_good_figure_renders_inside_bounds():
    result = S.render("matplotlib", (FIG / "good.py").read_text(encoding="utf-8"),
                      expected_px={"min_w": 600, "max_w": 1000, "min_h": 300, "max_h": 600})
    assert result.ok, result.log
    assert (result.width_px, result.height_px) == (800, 400)
    assert S.MIN_BYTES <= result.bytes <= S.MAX_BYTES
    assert result.render_status == "rendered" and result.verification_render == "ok"
    assert result.report()["status"] == "ok"
    again = S.render("matplotlib", (FIG / "good.py").read_text(encoding="utf-8"))
    assert again.png == result.png  # deterministik


def test_size_sanity():
    ok = S.check_png(_png(800, 400))
    assert ok.ok and ok.status == "ok"
    small = S.check_png(_png(150, 120))
    assert not small.ok and small.status == "size_mismatch" and "boyut" in small.reason
    wide = S.check_png(_png(1700, 400))
    assert not wide.ok and "1700x400" in wide.reason
    big = S.check_png(_png(1600, 1600, seed=3))
    assert len(_png(1600, 1600, seed=3)) > S.MAX_BYTES
    assert not big.ok and "bayt" in big.reason
    halves = np.ones((400, 800, 3))
    halves[:, :400] = 0.1
    buf = io.BytesIO()
    mpimg.imsave(buf, halves, format="png")
    assert len(buf.getvalue()) < S.MIN_BYTES
    tiny = S.check_png(buf.getvalue())
    assert not tiny.ok and tiny.status == "size_mismatch" and "bayt" in tiny.reason
    broken = S.check_png(_png(800, 400)[:200])
    assert not broken.ok and broken.status == "size_mismatch"
    narrowed = S.check_png(_png(800, 400), {"min_w": 900, "max_w": 1000})
    assert not narrowed.ok and "900" in narrowed.reason
    assert not S.check_png(b"GIF89a....").ok
    # render tarafı: boyutu dışarıda kalan çizim size_mismatch olur
    code = ("import matplotlib.pyplot as plt\nfig = plt.figure(figsize=(1.2, 1.2), dpi=100)\n"
            "plt.plot([0, 1, 2], [1, 0, 1])\nfig.savefig('figure.png', dpi=100)\n")
    result = S.render("matplotlib", code)
    assert result.status == "size_mismatch" and result.verification_render == "size_mismatch"


def test_blank_image_rejected():
    result = S.render("matplotlib", (FIG / "blank.py").read_text(encoding="utf-8"))
    assert result.status == "blank", result.log
    assert "boş" in result.log
    assert result.render_status == "failed" and result.vision_default == "skipped"
    assert result.pixel_variance == pytest.approx(0.0)
    assert result.report()["status"] == "blank"
    solid = S.check_png(_png(800, 400, noise=False))
    assert solid.status == "blank"


def test_svg_engine(tmp_path):
    bad = S.render("svg", (FIG / "bad.svg").read_text(encoding="utf-8"))
    assert bad.status == "failed" and "XML" in bad.log
    scripted = S.render("svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    assert scripted.status == "rejected"
    external = S.render("svg", '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
                               '<image xlink:href="file:///etc/passwd"/></svg>')
    assert external.status == "rejected"
    dots = "".join(f'<circle cx="{60 + i * 50}" cy="200" r="8" fill="#0030a2"/>'
                   f'<text x="{55 + i * 50}" y="240" font-size="18" fill="#051c60">{i - 7}</text>' for i in range(15))
    good = ('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" '
            'fill="#f6f8fc"/><line x1="40" y1="200" x2="760" y2="200" stroke="#051c60" stroke-width="3"/>'
            + dots + "</svg>")
    result = S.render("svg", good)
    if S.installed("cairosvg") or shutil.which("rsvg-convert"):
        assert result.ok, result.log
        assert (result.width_px, result.height_px) == (800, 400) and result.svg is not None
    else:
        assert result.status == "skipped" and result.svg is not None and result.render_status == "failed"


@pytest.mark.parametrize("tool,binary", [("tikz", "tectonic"), ("graphviz", "dot")])
def test_missing_engine_is_skipped(tool, binary):
    if shutil.which(binary):
        pytest.skip(f"{binary} kurulu; SKIP yolu sınanamaz")
    result = S.render(tool, "\\draw (0,0) -- (1,1);" if tool == "tikz" else "digraph { a -> b }")
    assert result.status == "skipped" and result.render_status == "failed" and result.vision_default == "skipped"
    assert result.log.startswith("SKIP")


def test_render_fixtures_report(tmp_path):
    report = {r["file"]: r for r in FG.render_fixtures(FIG, tmp_path)}
    assert set(report) == {"good.py", "blank.py", "net.py", "bad.svg"}
    assert report["good.py"]["status"] == "ok" and Path(report["good.py"]["png"]).is_file()
    assert report["blank.py"]["status"] == "blank"
    assert report["net.py"]["status"] == "rejected"
    assert report["bad.svg"]["status"] == "failed"
    assert all(report[f]["vision"] == "skipped" for f in ("blank.py", "net.py", "bad.svg"))


def test_read_roots_never_include_cwd_or_filesystem_root(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "path", ["/", "", str(tmp_path), str(Path.home()), *sys.path])
    roots = S._sandbox_sys_path()
    assert "/" not in roots and str(tmp_path) not in roots and str(Path.home()) not in roots
    work = tmp_path / "w"
    work.mkdir()
    result = S._sandboxed_python("import numpy as np\nnp.loadtxt('/etc/' + 'passwd', dtype=str)\n", "matplotlib",
                                 work, ast_checked=False)
    assert result.status == "failed" and "izinsiz okuma" in result.log


def _escapes_are_blocked(tmp_path: Path) -> None:
    target = tmp_path / "kacak.pth"
    payload = "import os; os.system('true')\n"
    chars = ", ".join(str(ord(c)) for c in str(target))
    # (a) AST'yi geçen kod: yol çalışma anında chr ile kurulur → savefig dışarı yazamaz
    built = ("import matplotlib.pyplot as plt\nfig = plt.figure(figsize=(8, 4))\nplt.plot([0, 1], [1, 0])\n"
             f"fig.savefig(''.join(map(chr, [{chars}])), format='png')\n")
    S.ast_check(built)  # danışma katmanı bunu göremez; engel süreç düzeyindedir
    result = S.render("matplotlib", built)
    assert result.status == "failed" and "sandbox:" in result.log, result.log
    assert not target.exists()
    # (b) bulgudaki kaçış: matplotlib.os ile os.open + os.write + os.replace → AST reddeder
    poc = ("import matplotlib\no = matplotlib.os\nfd = o.open('x.pth', o.O_WRONLY | o.O_CREAT, 420)\n"
           f"o.write(fd, b'{payload.strip()}')\no.close(fd)\no.replace('x.pth', ''.join(map(chr, [{chars}])))\n")
    assert S.render("matplotlib", poc).status == "rejected"
    # (c) AST'siz: her kaçış süreç düzeyinde düşer, hedef dosya oluşmaz
    fonts = S.lexend_fonts()
    fd_dir = str(Path(fonts[0]).parent) if fonts else None  # okuma kökü ve yazılabilir bir dizin
    fd_target = Path(fd_dir) / "kacak.pth" if fd_dir else None
    cases = {
        "rename": ("import matplotlib.pyplot as plt\nfig = plt.figure(figsize=(8, 4))\nplt.plot([0, 1])\n"
                   f"fig.savefig('figure.png')\nimport os\nos.rename('figure.png', {str(target)!r})\n"),
        "replace": ("import matplotlib.pyplot as plt\nfig = plt.figure(figsize=(8, 4))\nplt.plot([0, 1])\n"
                    f"fig.savefig('figure.png')\nimport os\nos.replace('figure.png', {str(target)!r})\n"),
        "os_open_replace": ("import matplotlib\no = matplotlib.os\n"
                            "fd = o.open('x.pth', o.O_WRONLY | o.O_CREAT, 420)\n"
                            f"o.write(fd, {payload!r}.encode())\no.close(fd)\no.replace('x.pth', {str(target)!r})\n"),
        "yerel_ad": "f = open('x.pth', 'w')\nf.write('x')\nf.close()\n",
        "mpl_os_system": f"import matplotlib\nmatplotlib.os.system('touch {target}')\n",
        "runner_globals": ("import sys\nmain = sys.modules['__main__']\nmain._WORK = '/'\nmain._READ = ('/',)\n"
                           f"open({str(target)!r}, 'w').write('x')\n"),
    }
    if fd_dir:
        cases["dir_fd_os_open"] = (f"import os\nd = os.open({fd_dir!r}, os.O_RDONLY)\n"
                                   "fd = os.open('kacak.pth', os.O_WRONLY | os.O_CREAT, 420, dir_fd=d)\n"
                                   "os.write(fd, b'x')\n")
        cases["dir_fd_opener"] = (f"import os\nd = os.open({fd_dir!r}, os.O_RDONLY)\n"
                                  "f = open('kacak.pth', 'w', opener=lambda p, fl: os.open(p, fl, 0o644, dir_fd=d))\n"
                                  "f.write('x')\nf.close()\n")
    for name, code in cases.items():
        work = tmp_path / f"kacis-{name}"
        work.mkdir()
        result = S._sandboxed_python(code, "matplotlib", work, ast_checked=False)
        assert result.status == "failed" and "sandbox:" in result.log, (name, result.log)
        assert not (work / "x.pth").exists(), name
        assert not target.exists(), name
        if fd_target is not None:
            assert not fd_target.exists(), name


def test_svg_size_checked_before_conversion(monkeypatch):
    import time

    calls: list[str] = []
    real = S._run_python

    def spy(code, tool, work, *, preload):
        calls.append(tool)
        return real(code, tool, work, preload=preload)

    monkeypatch.setattr(S, "_run_python", spy)
    huge = ('<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000">'
            '<rect width="20000" height="20000" fill="#0030a2"/></svg>')
    start = time.monotonic()
    result = S.render("svg", huge)
    assert time.monotonic() - start < 2.0
    assert not result.ok and result.status == "size_mismatch" and "20000x20000" in result.log
    assert calls == []  # dönüştürücüye hiç gitmedi
    for svg in ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30000 30000"/>',
                '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>',
                '<svg xmlns="http://www.w3.org/2000/svg" width="20in" height="2in"/>'):
        assert S.render("svg", svg).status == "size_mismatch", svg
    assert S.svg_size(S_root('<svg xmlns="http://www.w3.org/2000/svg" width="8in" height="4in"/>')) == (768, 384)
    assert S.svg_size(S_root('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="800"/>')) == \
        (800, 400)
    styled = ('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><style>@import url(file:///etc/x.css);'
              '</style></svg>')
    assert S.render("svg", styled).status == "rejected"
    if S.installed("cairosvg"):
        ok = ('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400"><rect width="800" height="400" '
              'fill="#f6f8fc"/>' + "".join(f'<circle cx="{40 + i * 48}" cy="{100 + (i % 5) * 50}" r="14" '
                                           f'fill="#0030a2"/>' for i in range(16)) + "</svg>")
        good = S.render("svg", ok)
        assert good.ok, good.log
        assert calls == ["svg"] and "sandbox" in good.log  # cairosvg runner sürecinde çalıştı


def S_root(svg: str):
    from defusedxml import ElementTree as SafeET

    return SafeET.fromstring(svg)
