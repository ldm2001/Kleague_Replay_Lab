from __future__ import annotations

from dataclasses import replace

from ..application.ports import PipelinePorts
from .candidates import candidates
from .evidence import evidence
from .probe import probe
from .shots import shots
from .tracking import tracking
from .perception import PerceptionAdapter


def media() -> PipelinePorts:
    # 미디어 인프라 포트 조립
    return PipelinePorts(probe=probe, shots=shots, candidates=candidates, evidence=evidence, tracking=tracking)


def operating(*, progress=None, check_cancelled=None) -> PipelinePorts:
    return replace(media(), perception=PerceptionAdapter(progress=progress, check_cancelled=check_cancelled))
