from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping
from .application.pipeline import pipeline
from .application.ports import PipelinePorts
from .domain.models import AV_OBSERVER_PIPELINE_VERSION, LOCAL_OBSERVER_PIPELINE_VERSION
from .infrastructure.probe import probe


class JobError(ValueError):
    # 영상 작업 오류
    pass


@dataclass(frozen=True, slots=True)
class JobResult:
    # 작업 결과
    job_id: str
    # 영상 검증과 분석을 구별하는 작업 종류 보존
    job_type: str
    # 로컬 처리 실행의 성공 상태 보존
    status: str
    # 검증 메타데이터 또는 분석 보고서 참조 보존
    payload: dict[str, object]

# 분석 작업에서만 운영 관측 포트 적재와 조립
def operating(*, progress=None, check_cancelled=None) -> PipelinePorts:
    # 검증 경로의 모델 의존성 적재를 막는 지연 가져오기
    from .infrastructure.ports import operating as factory
    # 기존 운영 조립 함수의 진행과 취소 계약 보존
    return factory(progress=progress, check_cancelled=check_cancelled)

# 문자열 입력 확인
def text(value: object) -> str:
    # 문자열 형식 확인
    if not isinstance(value, str) or not value.strip():
        # 누락되거나 빈 필수 작업 필드 거부
        raise JobError("job-field-invalid")
    # 문자열 값 반환
    return value

# 작업 실행
def job(
    value: Mapping[str, object],
    *,
    progress: Callable[[str, int, str], None] | None = None,
    check_cancelled: Callable[[], None] | None = None,
    ports: PipelinePorts | None = None,
) -> JobResult:
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
        # 사용할 영상 처리 기능 묶음 선택
        selected_ports = (
            ports
            if ports is not None
            else operating(progress=progress, check_cancelled=check_cancelled)
        )
        # 운영 기본값은 음향 결합 판본으로 두고 주입된 관측기 계약에 맞춰 선택
        version = (
            AV_OBSERVER_PIPELINE_VERSION
            if ports is None
            else (
                getattr(
                    selected_ports.perception, "pipeline_version", LOCAL_OBSERVER_PIPELINE_VERSION
                )
                if selected_ports.perception is not None
                else "video-baseline-v1"
            )
        )
        # 선택한 처리기와 판본으로 원본 영상 분석 실행
        result = pipeline(
            source, output, ports=selected_ports, pipeline_version=version, progress=progress
        )
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

    # 영상 검증과 분석 이외의 작업 종류 거부
    raise JobError("job-type-unsupported")
