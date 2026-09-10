from __future__ import annotations

from ..application.ports import PipelinePorts
from .candidates import candidates
from .evidence import evidence
from .probe import probe
from .shots import shots
from .tracking import tracking


def media() -> PipelinePorts:
    # 미디어 인프라 포트 조립
    return PipelinePorts(probe=probe, shots=shots, candidates=candidates, evidence=evidence, tracking=tracking)
