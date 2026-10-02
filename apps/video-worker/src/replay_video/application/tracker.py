# 일부 필드만 교체한 자료 복제 도구 가져옴
from dataclasses import replace
# 공 후보와 보정 움직임 자료형 및 추적기 가져옴
from ..domain.ball import BallCandidate, BallMotion, BallTracker
# 복수 경로 연결기와 선택 자료형 가져옴
from ..domain.paths import BallPaths, PathSelection


# 경로 선택과 보정 움직임을 조립하는 추적기 선언
class CandidateTracker:
    """화면 좌표 연결·카메라 보정 움직임 조립과 상호 신뢰도 대체 금지"""

    # 초기 상태·입력 계약 구성
    def __init__(self) -> None:
        # 여러 화면 좌표 경로를 연결할 추적기 생성
        self.paths = BallPaths()
        # 선택한 후보의 카메라 보정 움직임 추적기 생성
        self.motion = BallTracker()

    # 현재 표본을 기존 연속 관측과 연결해 추적 상태를 갱신
    def update(
        self,
        time: int,
        continuity: int,
        width: int,
        height: int,
        candidates: tuple[BallCandidate, ...],
        affine: tuple[float, ...] | None,
    ) -> tuple[PathSelection, BallMotion]:
        # 현재 표본을 이전 경로와 연결하여 후보 선택
        selected = self.paths.update(time, continuity, width, height, candidates)
        # 선택한 단일 후보 또는 빈 후보 묶음 생성
        points = (selected.candidate,) if selected.candidate else ()
        # 경로 식별자가 바뀌면 이전 물체의 정지 이력을 계승 금지
        motion = self.motion.update(time, selected.track_id or -1, width, height, points, affine)
        # 경로 선택에서 위치를 얻었는지 확인
        if selected.candidate is not None:
            # 움직임 추적에서 위치가 빠졌는지 확인
            if motion.candidate is None:
                # 움직임 확정 없이 선택 위치와 경로 번호만 보존
                motion = replace(
                    motion,
                    status="POSITION_ONLY",
                    candidate=selected.candidate,
                    track_id=selected.track_id,
                )
            # 움직임 추적에도 후보 위치가 남아 있는 경우 분기
            else:
                # 움직임 결과에 경로 선택기의 식별자 연결
                motion = replace(motion, track_id=selected.track_id)
        # 경로 선택 근거와 보정 움직임을 분리하여 반환
        return selected, motion
