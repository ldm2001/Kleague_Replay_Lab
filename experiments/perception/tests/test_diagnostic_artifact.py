import gzip
import hashlib
import importlib
import json
import random

import pytest


def api():
    return importlib.import_module("replay_perception.diagnostic_artifact")


def test_streamed_jsonl_roundtrips_with_exact_digest_and_no_local_filename(tmp_path):
    path = tmp_path / "perception.jsonl.gz"
    with api().DiagnosticArtifact(path) as writer:
        writer.append({"kind": "HEADER", "sourceSha256": "a" * 64})
        writer.append({"kind": "FRAME", "pts": 100, "unknown": None})
    result = writer.metadata()
    assert result == {"path": str(path), "contentType": "application/gzip",
                      "contentSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                      "sizeBytes": path.stat().st_size}
    rows = [json.loads(line) for line in gzip.decompress(path.read_bytes()).splitlines()]
    assert [row["kind"] for row in rows] == ["HEADER", "FRAME"]
    assert path.name.encode() not in path.read_bytes()


def test_raw_limit_rejects_whole_record_and_preserves_valid_partial_gzip(tmp_path, monkeypatch):
    monkeypatch.setattr(api(), "MAX_RAW_BYTES", 100)
    path = tmp_path / "perception.jsonl.gz"
    with pytest.raises(ValueError, match="DIAGNOSTIC_RAW_LIMIT"):
        with api().DiagnosticArtifact(path) as writer:
            writer.append({"kind": "HEADER"})
            writer.append({"large": "x" * 100})
    assert gzip.decompress(path.read_bytes()) == b'{"kind":"HEADER"}\n'
    assert writer.metadata()["sizeBytes"] > 0


def test_compressed_limit_never_leaves_an_unreadable_prefix(tmp_path, monkeypatch):
    monkeypatch.setattr(api(), "MAX_COMPRESSED_BYTES", 300)
    path = tmp_path / "perception.jsonl.gz"
    with pytest.raises(ValueError, match="DIAGNOSTIC_COMPRESSED_LIMIT"):
        with api().DiagnosticArtifact(path) as writer:
            writer.append({"kind": "HEADER"})
            writer.append({"large": random.Random(7).randbytes(1000).hex()})
    assert path.stat().st_size <= 300
    assert gzip.decompress(path.read_bytes()) == b'{"kind":"HEADER"}\n'


def test_failure_keeps_completed_records_and_does_not_mask_primary_error(tmp_path):
    path = tmp_path / "perception.jsonl.gz"
    with pytest.raises(RuntimeError, match="INFERENCE_FAILED"):
        with api().DiagnosticArtifact(path) as writer:
            writer.append({"kind": "HEADER"})
            raise RuntimeError("INFERENCE_FAILED")
    assert json.loads(gzip.decompress(path.read_bytes())) == {"kind": "HEADER"}


def test_nonfinite_record_rejected_before_mutating_stream(tmp_path):
    with api().DiagnosticArtifact(tmp_path / "perception.jsonl.gz") as writer:
        with pytest.raises(ValueError):
            writer.append({"score": float("nan")})
        writer.append({"score": None})
    assert json.loads(gzip.decompress((tmp_path / "perception.jsonl.gz").read_bytes())) == {"score": None}


def test_existing_output_and_repository_output_are_rejected(tmp_path):
    existing = tmp_path / "perception.jsonl.gz"
    existing.write_bytes(b"preserve")
    with pytest.raises(FileExistsError):
        with api().DiagnosticArtifact(existing):
            pass
    assert existing.read_bytes() == b"preserve"
    (tmp_path / ".git").mkdir()
    with pytest.raises(ValueError, match="OUTPUT_INSIDE_GIT_WORKTREE"):
        with api().DiagnosticArtifact(tmp_path / "new.jsonl.gz"):
            pass


def test_cannot_append_after_finalization_or_read_metadata_before_it(tmp_path):
    with api().DiagnosticArtifact(tmp_path / "perception.jsonl.gz") as writer:
        with pytest.raises(RuntimeError, match="DIAGNOSTIC_NOT_FINALIZED"):
            writer.metadata()
        writer.append({"kind": "HEADER"})
    with pytest.raises(RuntimeError, match="DIAGNOSTIC_NOT_ACTIVE"):
        writer.append({"kind": "FRAME"})


def test_finalization_and_close_failures_do_not_replace_primary_inference_failure(tmp_path):
    with pytest.raises(RuntimeError, match="INFERENCE_FAILED"):
        with api().DiagnosticArtifact(tmp_path / "perception.jsonl.gz") as writer:
            writer.append({"kind": "HEADER"})
            original = writer._file
            class BrokenFinalizer:
                @property
                def closed(self):
                    return original.closed
                def write(self, data):
                    raise OSError("FINALIZE_FAILED")
                def close(self):
                    original.close()
                    raise OSError("CLOSE_FAILED")
            writer._file = BrokenFinalizer()
            raise RuntimeError("INFERENCE_FAILED")
    with pytest.raises(RuntimeError, match="DIAGNOSTIC_NOT_FINALIZED"):
        writer.metadata()
