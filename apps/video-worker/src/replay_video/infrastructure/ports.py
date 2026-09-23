from __future__ import annotations
from dataclasses import replace
from functools import partial
from ..application.ports import PipelinePorts
from .candidates import candidates
from .evidence import evidence
from .probe import probe
from .shots import shots
from .tracking import tracking
from .perception import PerceptionAdapter
from .interactions import enrichment

# 모델 없는 기본 영상 포트 조립
def media() -> PipelinePorts:
    # 미디어 인프라 포트 조립
    return PipelinePorts(
        probe=probe, shots=shots, candidates=candidates, evidence=evidence, tracking=tracking
    )

# 승인 관측기·영상 포트의 운영 파이프라인 조립
def operating(*, progress=None, check_cancelled=None) -> PipelinePorts:
    # 기본 미디어 처리기를 유지하면서 승인된 관측 단계만 연결
    return replace(
        # 메타데이터·샷·변화 후보·증거·추적 기본 처리기 재사용
        media(),
        # 승인된 로컬 모델과 원본 음향의 결합 관측기 생성
        perception=PerceptionAdapter(
            progress=progress, check_cancelled=check_cancelled, audio_enabled=True
        ),
        # 작업 취소 함수를 공유하는 비공개 중립 측정 확장기 연결
        private_observations=partial(enrichment, check_cancelled=check_cancelled),
    )
