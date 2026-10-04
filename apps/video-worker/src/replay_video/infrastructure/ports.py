from __future__ import annotations
from dataclasses import replace
from functools import partial
from typing import Callable
from ..application.ports import PipelinePorts
from .candidates import candidates
from .evidence import evidence
from .probe import probe
from .shots import shots
from .signals import sampler
from .tracking import tracking
from .perception import PerceptionAdapter
from .interactions import enrichment

# 작업 취소를 공유하는 모델 없는 기본 영상 포트 조립
def media(*, check_cancelled: Callable[[], None] | None = None) -> PipelinePorts:
    # 샷과 후보가 한 번 디코딩한 변화 신호를 공유할 작업 단위 재사용기 생성
    sample = sampler(check_cancelled)
    # 원본 전체를 디코딩하거나 외부 추출을 반복하는 단계에 작업 취소 연결
    return PipelinePorts(
        probe=probe,
        shots=partial(shots, sampler=sample),
        candidates=partial(candidates, sampler=sample),
        evidence=partial(evidence, check_cancelled=check_cancelled),
        tracking=partial(tracking, check_cancelled=check_cancelled),
    )

# 승인 관측기·영상 포트의 운영 파이프라인 조립
def operating(*, progress=None, check_cancelled=None) -> PipelinePorts:
    # 기본 미디어 처리기를 유지하면서 승인된 관측 단계만 연결
    return replace(
        # 같은 작업 취소를 공유하는 메타데이터·샷·변화 후보·증거·추적 기본 처리기 재사용
        media(check_cancelled=check_cancelled),
        # 승인된 로컬 모델과 원본 음향의 결합 관측기 생성
        perception=PerceptionAdapter(
            progress=progress, check_cancelled=check_cancelled, audio_enabled=True
        ),
        # 작업 취소 함수를 공유하는 비공개 중립 측정 확장기 연결
        private_observations=partial(enrichment, check_cancelled=check_cancelled),
    )
