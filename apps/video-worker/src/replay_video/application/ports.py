from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from ..domain.models import Candidate, Evidence, PerceptionOutput, Shot, VideoMetadata


@dataclass(frozen=True, slots=True)
class PipelinePorts:
    # 영상 메타데이터 포트
    probe: Callable[[Path | str], VideoMetadata]
    # 샷 경계 포트
    shots: Callable[[Path | str, VideoMetadata], tuple[Shot, ...]]
    # 후보 탐지 포트
    candidates: Callable[[Path | str, VideoMetadata, tuple[Shot, ...]], tuple[Candidate, ...]]
    # 증거 생성 포트
    evidence: Callable[
        [Path | str, Path | str, VideoMetadata, tuple[Candidate, ...]], tuple[Evidence, ...]
    ]
    # 선택적으로 후보 구간의 원시 추적 요약을 보강할 호출 계약
    tracking: (
        Callable[
            [Path | str, Path | str, VideoMetadata, tuple[Candidate, ...]], tuple[Candidate, ...]
        ]
        | None
    ) = None
    # 선택적으로 모델 관측과 후보 확장을 수행할 호출 계약
    perception: (
        Callable[
            [Path | str, Path | str, VideoMetadata, tuple[Candidate, ...], tuple[Shot, ...]],
            PerceptionOutput,
        ]
        | None
    ) = None
    # 공개 결과와 분리된 원시 관측에 화면 측정을 덧붙일 호출 계약
    private_observations: (
        Callable[[Path, dict, str, tuple[Shot, ...], tuple[Evidence, ...]], dict] | None
    ) = None
