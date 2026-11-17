"""LocalDirStorage — Supabase Storage'ın yerel dizin sahtesi (``Storage`` Protocol'ü).

Yazılar ``root/<bucket>/<path>``'e gider. Okuma sırası: yazılmış nesne → ``aliases``
(``"exams/<uuid>.pdf"`` → yerel dosya; ör. ``fixtures/kalem/exam-2022.pdf``, §2.3) →
``read_roots/<bucket>/<path>`` → ``read_roots/<path>``. ``fixtures/`` yalnız okunur.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path, PurePosixPath

from ..errors import StorageError


def _safe(bucket: str, path: str) -> PurePosixPath:
    parts = PurePosixPath(bucket) / PurePosixPath(path.lstrip("/"))
    if any(p in ("..", "") for p in parts.parts) or parts.is_absolute():
        raise StorageError(f"OGR-STO-001 geçersiz nesne yolu: {bucket}/{path}")
    return parts


class LocalDirStorage:
    def __init__(self, root: Path | str, *, read_roots: Sequence[Path | str] = (),
                 aliases: Mapping[str, Path | str] | None = None, public_base: str = "http://fake-storage"):
        self.root = Path(root)
        self.read_roots = [Path(r) for r in read_roots]
        self.aliases = {k.lstrip("/"): Path(v) for k, v in (aliases or {}).items()}
        self.public_base = public_base.rstrip("/")
        self.removed: list[str] = []
        self.uploaded: list[str] = []

    def _target(self, bucket: str, path: str) -> Path:
        return self.root / Path(*_safe(bucket, path).parts)

    def _resolve(self, bucket: str, path: str) -> Path | None:
        key = str(_safe(bucket, path))
        written = self._target(bucket, path)
        if key in self.removed and not written.exists():
            return None
        if written.is_file():
            return written
        if key in self.aliases and self.aliases[key].is_file():
            return self.aliases[key]
        rel = _safe(bucket, path)
        for base in self.read_roots:
            for candidate in (base / Path(*rel.parts), base / Path(*rel.parts[1:])):
                if candidate.is_file():
                    return candidate
        return None

    def upload(self, bucket: str, path: str, data: bytes, *, content_type: str = "application/octet-stream") -> str:
        target = self._target(bucket, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        key = str(_safe(bucket, path))
        if key in self.removed:
            self.removed.remove(key)
        self.uploaded.append(key)
        return key

    def download(self, bucket: str, path: str) -> bytes:
        found = self._resolve(bucket, path)
        if found is None:
            raise StorageError(f"OGR-STO-001 nesne yok: {bucket}/{path}")
        return found.read_bytes()

    def exists(self, bucket: str, path: str) -> bool:
        return self._resolve(bucket, path) is not None

    def remove(self, bucket: str, path: str) -> None:
        target = self._target(bucket, path)
        if target.is_file():
            target.unlink()
        self.removed.append(str(_safe(bucket, path)))

    def public_url(self, bucket: str, path: str) -> str:
        return f"{self.public_base}/{_safe(bucket, path)}"
