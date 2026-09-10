from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..domain.models import Candidate, Evidence, Shot, VideoMetadata


@dataclass(frozen=True, slots=True)
class PipelinePorts:
    # 영상 메타데이터 포트
    probe: Callable[[Path | str], VideoMetadata]
    # 샷 경계 포트
    shots: Callable[[Path | str, VideoMetadata], tuple[Shot, ...]]
    # 후보 탐지 포트
    candidates: Callable[[Path | str, VideoMetadata, tuple[Shot, ...]], tuple[Candidate, ...]]
    # 증거 생성 포트
    evidence: Callable[[Path | str, Path | str, VideoMetadata, tuple[Candidate, ...]], tuple[Evidence, ...]]
    tracking: Callable[[Path | str, Path | str, VideoMetadata, tuple[Candidate, ...]], tuple[Candidate, ...]] | None = None
