from dataclasses import replace

from ..domain.ball import BallCandidate, BallMotion, BallTracker
from ..domain.paths import BallPaths, PathSelection


class CandidateTracker:
    """화면 좌표 연결과 카메라 보정 움직임을 조립하며 서로의 신뢰도를 대체하지 않는다"""

    def __init__(self) -> None:
        self.paths = BallPaths()
        self.motion = BallTracker()

    def update(self, time: int, continuity: int, width: int, height: int,
               candidates: tuple[BallCandidate, ...], affine: tuple[float, ...] | None) -> tuple[PathSelection, BallMotion]:
        selected = self.paths.update(time, continuity, width, height, candidates)
        points = (selected.candidate,) if selected.candidate else ()
        # 경로 식별자가 바뀌면 이전 물체의 정지 이력을 물려받지 않는다
        motion = self.motion.update(time, selected.track_id or -1, width, height, points, affine)
        if selected.candidate is not None:
            if motion.candidate is None:
                motion = replace(motion, status="POSITION_ONLY", candidate=selected.candidate, track_id=selected.track_id)
            else:
                motion = replace(motion, track_id=selected.track_id)
        return selected, motion
