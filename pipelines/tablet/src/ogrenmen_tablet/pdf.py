"""``tablet pdf``: LaTeX ``exam`` sınıfıyla deneme PDF'i (BLUEPRINT §6.1 "PDF"; plan "Deneme PDF'i için LaTeX
``exam`` sınıfı + Tectonic yeterli").

* Şablon ``pipelines/tablet/templates/exam.tex.j2`` (jinja2; LaTeX ile çakışmasın diye ayraçlar ``<< >>``/``<% %>``).
* Girdi ``--test <uuid|json>``: ``diagnostic_tests.id`` (``item_ids`` sırasıyla sorular) ya da bir JSON dosyası
  (``{"title", "question_ids": [...]}``, ``{"title", "items": [question-item…]}`` veya bunların dizisi).
  Veritabanından yalnız ``status='approved'`` sorular basılır (diğerleri uyarıyla atlanır).
* Şıklar etiketsiz basılır (``misconception_tag`` PDF'e girmez); şekil PNG'si Storage'dan indirilir, yoksa şekil
  kodu sandbox'ta yeniden çizilir.
* ``tectonic`` varsa (``--untrusted``, ``-Z shell-escape`` YOK, ağsız ad alanında) PDF derlenir; yoksa yalnız ``.tex``
  yazılır (``--require-pdf`` ile bu durum hata olur; §12 #41).
* ``--with-keys``: cevap anahtarı sayfası **yalnız eğitmen** içindir. ``batch_worker`` ``secure`` şemasını okuyamaz;
  anahtar her soru için ``peek_answer_key`` RPC'siyle (audit'li) eğitmen oturumundan (``OGRENMEN_STAFF_JWT``) alınır.
  Eğitmen JWT'si yoksa komut reddeder (``OGR-PDF-002``).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ogrenmen_common.adapters.base import in_
from ogrenmen_common.errors import OgrError

from . import figures as FG
from . import sandbox as S

TEMPLATE_NAME = "exam.tex.j2"
DEFAULT_PDF = "deneme.pdf"
_LATEX_SPECIAL = {"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "$": r"\$", "&": r"\&", "#": r"\#",
                  "^": r"\textasciicircum{}", "_": r"\_", "%": r"\%", "~": r"\textasciitilde{}"}
_UNICODE = {"√": r"$\surd$", "×": r"$\times$", "÷": r"$\div$", "·": r"$\cdot$", "≤": r"$\leq$", "≥": r"$\geq$",
            "π": r"$\pi$", "−": "-", "–": "--"}


class PdfError(OgrError):
    """PDF girdisi ya da derleme hatası."""


def templates_dir() -> Path:
    """``pipelines/tablet/templates`` (editable kurulumda paket kaynağının iki üstü)."""
    return Path(__file__).resolve().parents[2] / "templates"


_ROOT = re.compile(r"√(?:\s*(?P<num>\d+(?:[.,]\d+)?)|(?P<var>[A-Za-z])(?![^\W\d_])"
                   r"|\s*\((?P<group>[0-9A-Za-z+\-*/.,= ]*)\))")
"""``√3``, ``√x``, ``√(x+1)`` → ``\\sqrt{…}``; içeriği güvenli olmayan ya da yalnız ``√`` → ``\\surd``."""


def _escape_chars(text: str) -> str:
    return "".join(_LATEX_SPECIAL.get(ch) or _UNICODE.get(ch) or ch for ch in text)


def _root(m: re.Match[str]) -> str:
    inner = next(g for g in (m.group("num"), m.group("var"), m.group("group")) if g is not None)
    inner = inner.strip().replace("*", r"\cdot ")
    return "$\\sqrt{" + inner.replace(",", "{,}") + "}$"


def latex_escape(text: str) -> str:
    """LaTeX özel karakterlerini kaçışlar; ``√`` ardındaki sayı/harf/parantez ``\\sqrt{}`` içine alınır."""
    out = []
    pos = 0
    for m in _ROOT.finditer(str(text)):
        out.append(_escape_chars(str(text)[pos:m.start()]))
        out.append(_root(m))
        pos = m.end()
    out.append(_escape_chars(str(text)[pos:]))
    return "".join(out)


def latex_text(text: str) -> str:
    """Telegram biçimli metin → LaTeX: `kod` → ``\\texttt{}``, **kalın** → ``\\textbf{}``, geri kalanı kaçışlı."""
    parts = re.split(r"(`[^`]*`|\*\*[^*]+\*\*)", str(text))
    out = []
    for part in parts:
        if part.startswith("`") and part.endswith("`") and len(part) >= 2:
            out.append(r"\texttt{" + latex_escape(part[1:-1]) + "}")
        elif part.startswith("**") and part.endswith("**") and len(part) >= 4:
            out.append(r"\textbf{" + latex_escape(part[2:-2]) + "}")
        else:
            out.append(latex_escape(part))
    return "".join(out)


@dataclass
class ExamQuestion:
    id: str | None
    kind: str
    stem: str
    options: list[dict[str, Any]] | None
    figure: dict[str, Any] | None = None
    figure_row: dict[str, Any] | None = None


@dataclass
class ExamSpec:
    title: str
    questions: list[ExamQuestion]
    warnings: list[str] = field(default_factory=list)


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def _from_rows(db: Any, ids: Sequence[str], warnings: list[str]) -> list[ExamQuestion]:
    rows = {str(r["id"]): dict(r) for r in db.select(
        "questions", where={"id": in_(list(ids))},
        columns=["id", "kind", "stem", "options", "figure_id", "status"])}
    fig_ids = [r["figure_id"] for r in rows.values() if r.get("figure_id")]
    figs = {str(f["id"]): dict(f) for f in (db.select("figures", where={"id": in_(fig_ids)},
                                                       columns=["id", "tool", "code", "png_path", "alt_text"])
                                             if fig_ids else [])}
    out = []
    for qid in ids:
        row = rows.get(str(qid))
        if row is None:
            warnings.append(f"soru yok: {qid}")
            continue
        if row.get("status") != "approved":
            warnings.append(f"onaylı değil, basılmadı: {qid} ({row.get('status')})")
            continue
        out.append(ExamQuestion(str(row["id"]), row["kind"], row["stem"], row.get("options"),
                                figure_row=figs.get(str(row.get("figure_id"))) if row.get("figure_id") else None))
    return out


def load_spec(db: Any, test: str) -> ExamSpec:
    """``--test`` değerini sınav tanımına çevirir."""
    warnings: list[str] = []
    if _is_uuid(test):
        rows = db.select("diagnostic_tests", where={"id": test}, columns=["id", "version", "item_ids"])
        if not rows:
            raise PdfError(f"OGR-PDF-001 test bulunamadı: {test} (diagnostic_tests.id ya da JSON dosyası)")
        row = rows[0]
        return ExamSpec(f"Teşhis testi {row.get('version', '')}".strip(),
                        _from_rows(db, [str(i) for i in row["item_ids"]], warnings), warnings)
    path = Path(test)
    if not path.is_file():
        raise PdfError(f"OGR-PDF-001 test bulunamadı: {test}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PdfError(f"OGR-PDF-001 test JSON okunamadı: {exc}") from exc
    if isinstance(data, list):
        data = {"items": data} if data and isinstance(data[0], Mapping) else {"question_ids": data}
    title = str(data.get("title") or "Deneme")
    if data.get("question_ids"):
        return ExamSpec(title, _from_rows(db, [str(i) for i in data["question_ids"]], warnings), warnings)
    questions = []
    for item in data.get("items") or []:
        if "item" in item and "key" in item:  # question-generation zarfı: anahtar yok sayılır
            item = item["item"]
        questions.append(ExamQuestion(item.get("id"), item.get("kind", "mcq"), item["stem"], item.get("options"),
                                      figure=item.get("figure")))
    if not questions:
        raise PdfError("OGR-PDF-001 testte soru yok")
    return ExamSpec(title, questions, warnings)


def _figure_png(rt: Any, q: ExamQuestion, folder: Path, index: int, warnings: list[str]) -> str | None:
    target = folder / f"soru-{index:02d}.png"
    row = q.figure_row
    if row and row.get("png_path"):
        try:
            data = rt.storage.download(FG.FIGURE_BUCKET, FG.storage_name(row["png_path"]))
            folder.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            return f"{folder.name}/{target.name}"
        except Exception as exc:  # noqa: BLE001 - depo yoksa kod yeniden çizilir
            warnings.append(f"soru {index}: PNG indirilemedi ({exc}); şekil kodu yeniden çiziliyor")
    figure = q.figure or ({"tool": row.get("tool"), "code": row.get("code")} if row else None)
    if not figure or not figure.get("code") or figure.get("tool") == "template":
        if figure:
            warnings.append(f"soru {index}: şekil dosyası yok, basılmadı")
        return None
    render = S.render(str(figure["tool"]), str(figure["code"]), expected_px=figure.get("expected_px"))
    if not render.ok or render.png is None:
        warnings.append(f"soru {index}: şekil çizilemedi ({render.status})")
        return None
    folder.mkdir(parents=True, exist_ok=True)
    target.write_bytes(render.png)
    return f"{folder.name}/{target.name}"


def staff_keys(env: Mapping[str, str], ids: Sequence[str], transport: Any = None) -> dict[str, dict[str, Any]]:
    """Eğitmen oturumuyla ``peek_answer_key`` (her çağrı audit'e yazılır)."""
    url, jwt = env.get("SUPABASE_URL"), env.get("OGRENMEN_STAFF_JWT")
    if not url or not jwt:
        raise PdfError("OGR-PDF-002 --with-keys yalnız eğitmen oturumuyla çalışır (SUPABASE_URL + OGRENMEN_STAFF_JWT; "
                       "peek_answer_key audit'li). batch_worker cevap anahtarını okuyamaz.")
    from ogrenmen_common.adapters.postgrest import PostgrestDb

    db = PostgrestDb(url, jwt, anon_key=env.get("SUPABASE_ANON_KEY"), transport=transport)
    out: dict[str, dict[str, Any]] = {}
    for qid in ids:
        # rpc-parity: staff (eğitmen JWT'si; batch_worker bu RPC'yi çağıramaz)
        res = db.rpc("peek_answer_key", {"p_question": qid})
        if isinstance(res, list):
            res = res[0] if res else None
        if not isinstance(res, Mapping):
            raise PdfError(f"OGR-PDF-002 anahtar alınamadı: {qid}")
        out[qid] = dict(res)
    return out


@dataclass
class PdfResult:
    tex: Path
    pdf: Path | None
    compiled: bool
    questions: int
    warnings: list[str]
    note: str


def render_tex(spec: ExamSpec, *, figures: Sequence[str | None], keys: Mapping[str, Mapping[str, Any]] | None,
               period: str = "YKS 2027", minutes: int | None = None) -> str:
    import jinja2

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(templates_dir())), autoescape=False, undefined=jinja2.StrictUndefined,
        block_start_string="<%", block_end_string="%>", variable_start_string="<<", variable_end_string=">>",
        comment_start_string="<#", comment_end_string="#>", trim_blocks=True, lstrip_blocks=True)
    tpl = env.get_template(TEMPLATE_NAME)
    questions, key_rows = [], []
    for q, fig in zip(spec.questions, figures, strict=True):
        key = (keys or {}).get(str(q.id)) if keys is not None else None
        options = None
        if q.kind == "mcq" and q.options:
            options = [{"text": latex_text(o.get("text", "")),
                        "correct": bool(key and key.get("correct_option") == o.get("key"))}
                       for o in sorted(q.options, key=lambda o: o.get("key", ""))]
        questions.append({"stem": latex_text(q.stem), "options": options, "figure": fig})
        if keys is not None:
            answer = (key or {}).get("correct_option") or (key or {}).get("numeric_value") or "?"
            key_rows.append({"answer": latex_escape(str(answer)), "solution": latex_text((key or {}).get("solution")
                                                                                         or "")})
    return tpl.render(title=latex_escape(spec.title), subtitle=latex_escape(f"{len(questions)} soru"),
                      period=latex_escape(period), minutes=minutes or max(10, 2 * len(questions)),
                      questions=questions, with_keys=keys is not None, keys=key_rows)


def compile_pdf(tex: Path, pdf: Path) -> tuple[bool, str]:
    tectonic = shutil.which("tectonic")
    if not tectonic:
        return False, "SKIP: tectonic kurulu değil; yalnız .tex üretildi"
    try:
        proc = subprocess.run([*S.netns_prefix(), tectonic, "--untrusted", "--outdir", str(tex.parent), tex.name],
                              cwd=tex.parent, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        return False, "tectonic zaman aşımı"
    built = tex.with_suffix(".pdf")
    if proc.returncode != 0 or not built.is_file():
        return False, f"tectonic hatası: {proc.stderr[-1500:]}"
    if built.resolve() != pdf.resolve():
        shutil.move(str(built), str(pdf))
    return True, "tectonic ile derlendi"


def output_paths(out: Path) -> tuple[Path, Path]:
    """``--out deneme.pdf`` (dosya) ya da ``--out <dizin>`` (``<dizin>/deneme.pdf``)."""
    pdf = out if out.suffix.lower() == ".pdf" else out / DEFAULT_PDF
    pdf.parent.mkdir(parents=True, exist_ok=True)
    return pdf.with_suffix(".tex"), pdf


def build(rt: Any, *, test: str, out: Path, with_keys: bool = False, require_pdf: bool = False,
          env: Mapping[str, str] | None = None, transport: Any = None) -> PdfResult:
    spec = load_spec(rt.db, test)
    if not spec.questions:
        raise PdfError("OGR-PDF-001 basılacak onaylı soru yok")
    keys = None
    if with_keys:
        ids = [q.id for q in spec.questions]
        if any(not i for i in ids):
            raise PdfError("OGR-PDF-002 --with-keys yalnız veritabanındaki sorularla (kimlikli) kullanılır")
        keys = staff_keys(env or {}, [str(i) for i in ids], transport=transport)
    tex, pdf = output_paths(out)
    fig_dir = tex.parent / f"{tex.stem}-sekiller"
    figures = [_figure_png(rt, q, fig_dir, i + 1, spec.warnings) for i, q in enumerate(spec.questions)]
    tex.write_text(render_tex(spec, figures=figures, keys=keys), encoding="utf-8")
    compiled, note = compile_pdf(tex, pdf)
    if require_pdf and not compiled:
        raise PdfError(f"OGR-PDF-003 PDF zorunlu (--require-pdf) ama derlenmedi: {note}")
    return PdfResult(tex=tex, pdf=pdf if compiled else None, compiled=compiled, questions=len(spec.questions),
                     warnings=spec.warnings, note=note)
