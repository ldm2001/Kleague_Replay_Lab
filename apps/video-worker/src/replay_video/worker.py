from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from .application.pipeline import pipeline
from .infrastructure.probe import probe


class JobError(ValueError):
    """Raised when a worker job payload is outside the supported contract."""


@dataclass(frozen=True, slots=True)
class JobResult:
    job_id: str
    job_type: str
    status: str
    payload: dict[str, object]


def text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise JobError("job-field-invalid")
    return value


def job(value: Mapping[str, object]) -> JobResult:
    job_id = text(value.get("job_id"))
    job_type = text(value.get("job_type"))
    source = Path(text(value.get("source_path"))).expanduser()

    if job_type == "VALIDATE_VIDEO":
        metadata = probe(source)
        return JobResult(
            job_id=job_id,
            job_type=job_type,
            status="SUCCEEDED",
            payload={
                "kind": "VALIDATED",
                "duration_ms": metadata.duration_ms,
                "width": metadata.width,
                "height": metadata.height,
                "fps": metadata.fps,
                "frame_count": metadata.frame_count,
                "codec": metadata.codec,
            },
        )

    if job_type == "ANALYZE_VIDEO":
        output = Path(text(value.get("output_path"))).expanduser()
        result = pipeline(source, output)
        return JobResult(
            job_id=job_id,
            job_type=job_type,
            status="SUCCEEDED",
            payload={
                "kind": "ANALYZED",
                "report_path": str(result.report_path),
                "candidate_count": len(result.candidates),
                "evidence_count": len(result.evidence),
            },
        )

    raise JobError("job-type-unsupported")
