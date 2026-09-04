from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping

from .application.pipeline import pipeline
from .infrastructure.probe import probe
from .infrastructure.ports import media


class JobError(ValueError):
    # Worker 작업 오류
    pass


@dataclass(frozen=True, slots=True)
class JobResult:
    # 작업 결과
    job_id: str
    job_type: str
    status: str
    payload: dict[str, object]


# 문자열 입력 확인
def text(value: object) -> str:
    # 문자열 형식 확인
    if not isinstance(value, str) or not value.strip():
        raise JobError("job-field-invalid")
    # 문자열 값 반환
    return value


# 작업 실행
def job(value: Mapping[str, object], *, progress: Callable[[str, int, str], None] | None = None) -> JobResult:
    # 작업 식별자 확인
    job_id = text(value.get("job_id"))
    # 작업 유형 확인
    job_type = text(value.get("job_type"))
    # 입력 경로 확인
    source = Path(text(value.get("source_path"))).expanduser()

    # 영상 검증 작업 분기
    if job_type == "VALIDATE_VIDEO":
        # 영상 메타데이터 조회
        metadata = probe(source)
        # 검증 결과 반환
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

    # 영상 분석 작업 분기
    if job_type == "ANALYZE_VIDEO":
        # 출력 경로 확인
        output = Path(text(value.get("output_path"))).expanduser()
        # 영상 파이프라인 실행
        result = pipeline(source, output, ports=media(), progress=progress)
        # 분석 결과 반환
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
