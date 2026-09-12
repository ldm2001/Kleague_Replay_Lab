from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, BinaryIO
import zlib

from .report import _inside_git_worktree


MAX_RAW_BYTES = 512 * 1024 * 1024
MAX_COMPRESSED_BYTES = 128 * 1024 * 1024
MAX_RECORD_BYTES = 8 * 1024 * 1024
_FOOTER_RESERVE = 128


class DiagnosticArtifact:
    """Append complete JSONL records while preserving a readable partial gzip on failure."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path).expanduser().absolute()
        self._file: BinaryIO | None = None
        self._compressor = zlib.compressobj(level=6, wbits=31)
        self._raw_bytes = 0
        self._compressed_bytes = 0
        self._metadata: dict[str, Any] | None = None
        self._primary_error: Exception | None = None

    def __enter__(self) -> DiagnosticArtifact:
        if self._file is not None or self._metadata is not None:
            raise RuntimeError("DIAGNOSTIC_ALREADY_OPENED")
        if _inside_git_worktree(self.path):
            raise ValueError("OUTPUT_INSIDE_GIT_WORKTREE")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._file = self.path.open("xb")
        return self

    def append(self, record: dict[str, Any]) -> None:
        if self._file is None or self._file.closed or self._metadata is not None:
            raise RuntimeError("DIAGNOSTIC_NOT_ACTIVE")
        if not isinstance(record, dict):
            raise ValueError("DIAGNOSTIC_RECORD_INVALID")
        raw = (json.dumps(record, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode()
        if len(raw) > MAX_RECORD_BYTES:
            raise ValueError("DIAGNOSTIC_RECORD_LIMIT")
        if self._raw_bytes + len(raw) > MAX_RAW_BYTES:
            raise ValueError("DIAGNOSTIC_RAW_LIMIT")
        # Trial-compress one bounded record. Do not mutate the live stream on a size rejection.
        proposed = self._compressor.copy()
        chunk = proposed.compress(raw) + proposed.flush(zlib.Z_SYNC_FLUSH)
        if self._compressed_bytes + len(chunk) + _FOOTER_RESERVE > MAX_COMPRESSED_BYTES:
            raise ValueError("DIAGNOSTIC_COMPRESSED_LIMIT")
        position = self._file.tell()
        try:
            self._file.write(chunk)
            self._file.flush()
        except OSError:
            self._file.seek(position)
            self._file.truncate()
            raise
        self._compressor = proposed
        self._raw_bytes += len(raw)
        self._compressed_bytes += len(chunk)

    def note_failure(self, error: Exception) -> None:
        # The caller may handle inference errors in order to return a partial report.
        # Remember that primary error if finalizing this partial artifact also fails.
        if self._primary_error is None:
            self._primary_error = error

    def __exit__(self, error_type, _error, _traceback) -> None:
        if self._file is None or self._file.closed:
            return
        try:
            tail = self._compressor.flush(zlib.Z_FINISH)
            if self._compressed_bytes + len(tail) > MAX_COMPRESSED_BYTES:
                raise ValueError("DIAGNOSTIC_COMPRESSED_LIMIT")
            self._file.write(tail)
            self._file.flush()
            self._file.close()
            with self.path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            self._metadata = {"path": str(self.path), "contentType": "application/gzip",
                              "contentSha256": digest, "sizeBytes": self.path.stat().st_size}
        except Exception as finalization_error:
            try:
                self._file.close()
            except Exception:
                pass
            if error_type is None:
                if self._primary_error is not None:
                    raise self._primary_error from finalization_error
                raise

    def metadata(self) -> dict[str, Any]:
        if self._metadata is None:
            raise RuntimeError("DIAGNOSTIC_NOT_FINALIZED")
        return dict(self._metadata)
