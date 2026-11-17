"""Pipeline CLI'larının ortak bayrakları ve yardımcıları (argparse; §2.9, §6).

Ortak bayraklar: ``--dry-run --fixtures <dizin> --out <dizin> --limit N --since <tarih|zaman>
--student-ref s_… --adapters fake|real``. Kullanım::

    parser = build_parser("ogrenmen_kulaklik", "Kulaklık gece işleri")
    sub = parser.add_subparsers(dest="command", required=True)
    facts = add_command(sub, "facts", "Gece olgu çıkarımı")
    facts.add_argument("--day", required=True)
    args = parser.parse_args(argv)
    with open_runtime(args) as rt: ...

Veritabanı bilgileri yokken (``SUPABASE_URL`` ya da ``SUPABASE_BATCH_JWT`` tanımsız) gerçek çalışma istenirse
iş ``--dry-run``'a düşer ve başarılı sayılır; stderr'e (GitHub Actions'ta ``::warning::``) uyarı satırı yazılır
(§2.9). İkisi de varken model anahtarı yoksa ``Runtime`` kurulmaz (``OGR-ADP-001``; gerçek veritabanına sahte
model çıktısı yazılmaz).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from .clock import parse_ts
from .errors import OgrError
from .ids import STUDENT_REF
from .runtime import Runtime, fakes_forced


def _student_ref(value: str) -> str:
    if not STUDENT_REF.match(value):
        raise argparse.ArgumentTypeError("öğrenci kimliği s_ ile başlayan public_ref olmalı (uuid değil)")
    return value


def _since(value: str) -> datetime:
    try:
        return parse_ts(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(f"tarih/zaman ISO biçiminde olmalı: {value}") from exc


def _positive(value: str) -> int:
    n = int(value)
    if n < 1:
        raise argparse.ArgumentTypeError("--limit en az 1")
    return n


def add_common_args(parser: argparse.ArgumentParser, *, suppress_defaults: bool = False) -> argparse.ArgumentParser:
    """Ortak bayraklar. Alt komutlarda ``suppress_defaults=True``: varsayılanlar üst ayrıştırıcının
    değerini ezmesin (``prog --dry-run komut`` ve ``prog komut --dry-run`` ikisi de çalışır)."""

    def d(value: Any) -> Any:
        return argparse.SUPPRESS if suppress_defaults else value

    g = parser.add_argument_group("ortak bayraklar")
    g.add_argument("--dry-run", action="store_true", default=d(False), help="ağ yok; fixtures'tan okur, --out'a yazar")
    g.add_argument("--fixtures", type=Path, default=d(None), help="fixture dizini (dry-run girdisi)")
    g.add_argument("--out", type=Path, default=d(None), help="çıktı dizini (JSON/JSONL + cost_estimate.json)")
    g.add_argument("--limit", type=_positive, default=d(None), help="en çok N kayıt işle")
    g.add_argument("--since", type=_since, default=d(None), help="bu andan sonraki kayıtlar (ISO)")
    g.add_argument("--student-ref", type=_student_ref, default=d(None), help="yalnız bu öğrenci (s_…)")
    g.add_argument("--adapters", choices=("fake", "real"), default=d(None), help="adaptör seti (varsayılan real)")
    return parser


def build_parser(prog: str, description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog=prog, description=description)
    return add_common_args(parser)


def add_command(subparsers: Any, name: str, help_text: str) -> argparse.ArgumentParser:
    """Alt komut; ortak bayraklar alt komuttan sonra da yazılabilsin diye ona da eklenir."""
    sub = subparsers.add_parser(name, help=help_text, description=help_text)
    add_common_args(sub, suppress_defaults=True)
    return sub


@dataclass(frozen=True)
class CommonArgs:
    dry_run: bool
    fixtures: Path | None
    out: Path | None
    limit: int | None
    since: datetime | None
    student_ref: str | None
    adapters: str | None


def common_args(ns: argparse.Namespace) -> CommonArgs:
    return CommonArgs(dry_run=bool(getattr(ns, "dry_run", False)), fixtures=getattr(ns, "fixtures", None),
                      out=getattr(ns, "out", None), limit=getattr(ns, "limit", None),
                      since=getattr(ns, "since", None), student_ref=getattr(ns, "student_ref", None),
                      adapters=getattr(ns, "adapters", None))


def effective_dry_run(args: CommonArgs, env: Mapping[str, str] | None = None) -> tuple[bool, str | None]:
    """``(dry_run, uyarı)``: gerçek çalışma istenip ``SUPABASE_URL`` ya da ``SUPABASE_BATCH_JWT`` yoksa dry-run'a
    düşülür (ikisi birlikte gerçek veritabanıdır)."""
    env = os.environ if env is None else env
    if args.dry_run or args.adapters == "fake" or fakes_forced(env):
        return True, None
    missing = [k for k in ("SUPABASE_URL", "SUPABASE_BATCH_JWT") if not env.get(k)]
    if missing:
        return True, (f"{'/'.join(missing)} yok; iş --dry-run olarak çalışıyor (ağ yok, çıktı --out dizininde).")
    return False, None


def warn(text: str, env: Mapping[str, str] | None = None) -> None:
    env = os.environ if env is None else env
    prefix = "::warning::" if env.get("GITHUB_ACTIONS") == "true" else "UYARI: "
    print(f"{prefix}{text}", file=sys.stderr)


def runtime_from_args(ns: argparse.Namespace | CommonArgs, *, env: Mapping[str, str] | None = None,
                      llm_options: Mapping[str, Any] | None = None) -> Runtime:
    args = ns if isinstance(ns, CommonArgs) else common_args(ns)
    dry, message = effective_dry_run(args, env)
    if message:
        warn(message, env)
    if args.out is not None:
        args.out.mkdir(parents=True, exist_ok=True)
    return Runtime.from_env(dry_run=dry, fixtures=args.fixtures, out=args.out,
                            adapters="fake" if dry else args.adapters, env=env, llm_options=llm_options)


@contextmanager
def open_runtime(ns: argparse.Namespace | CommonArgs, **kwargs: Any) -> Iterator[Runtime]:
    """Runtime'ı açar; çıkışta (hata olsa da) JsonlDb çıktısını ve ``cost_estimate.json``'u yazar."""
    rt = runtime_from_args(ns, **kwargs)
    try:
        yield rt
    finally:
        rt.close()


def write_json(out: Path, name: str, data: Any) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    path = out / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def write_jsonl(out: Path, name: str, rows: Iterable[Mapping[str, Any]]) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    path = out / name
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    return path


def run_main(main: Callable[[Sequence[str] | None], int | None], argv: Sequence[str] | None = None) -> int:
    """``OgrError``'u tek satır Türkçe hata ve çıkış kodu 1'e çevirir (iz sürme stderr'e yazılmaz)."""
    try:
        code = main(argv)
    except OgrError as exc:
        print(f"HATA: {exc.message}", file=sys.stderr)
        return 1
    return int(code or 0)
