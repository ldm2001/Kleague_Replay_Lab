import pytest
from replay_video.domain.ball import BallCandidate
from replay_video.domain.paths import BallPaths
from replay_video.application.track import CandidateTracker

# 시험용 공 후보 반환
def p(x, y=50):
    # 주어진 위치와 고정 점수를 갖는 공 후보 반환
    return BallCandidate(x, y, 4, 0.8)

# 일시 후보 중 지지된 경로 선택 확인
def test_selects_supported_path_while_transient_candidates_appear():
    # 복수 공 후보의 연속 경로를 연결할 추적기 생성
    paths = BallPaths()
    # 다섯 프레임 동안 복수 후보 위치를 이어 관측
    for frame in range(5):
        # 공 후보 경로 묶음에 입력을 반영하여 상태 갱신
        result = paths.update(frame * 100, 0, 640, 360, (p(100 + frame * 4), p(400 + frame * 40)))
    # 변화 후보가 존재하는지 확인
    assert result.candidate is not None
    # 연속 이동이 지지되는 공 후보의 마지막 위치 확인
    assert result.candidate.x == 116
    # 선택 경로에 최소 세 번의 관측 지지가 있는지 확인
    assert result.support >= 3

# 동등한 지지 경로의 모호성 유지 확인
def test_equal_supported_paths_remain_ambiguous():
    # 복수 공 후보의 연속 경로를 연결할 추적기 생성
    paths = BallPaths()
    # 여섯 프레임으로 오인 후보와 일관된 경로 비교
    for frame in range(6):
        # 공 후보 경로 묶음에 입력을 반영하여 상태 갱신
        result = paths.update(frame * 100, 0, 640, 360, (p(100 + frame * 4), p(400 + frame * 4)))
    # 변화 후보가 비어 있는지 확인
    assert result.candidate is None
    # 사유가 예상 계약과 일치하는지 확인
    assert result.reason == "AMBIGUOUS_PATHS"

# 가린 프레임의 관측 좌표 생성 금지 확인
def test_no_observed_coordinate_is_returned_for_an_occluded_frame():
    # 복수 공 후보의 연속 경로를 연결할 추적기 생성
    paths = BallPaths()
    # 연속 경로 식별자를 확보할 네 프레임 관측
    for frame in range(4):
        # 공 후보 경로 묶음에 입력을 반영하여 상태 갱신
        result = paths.update(frame * 100, 0, 640, 360, (p(100 + frame * 4),))
    # 경계 전 추적 식별자를 비교용으로 보관
    identifier = result.track_id
    # 변화 후보가 비어 있는지 확인
    assert paths.update(400, 0, 640, 360, ()).candidate is None
    # 추적 식별자가 예상 계약과 일치하는지 확인
    assert paths.update(500, 0, 640, 360, (p(120),)).track_id == identifier

# 공백·화면 전환 시 이전 지지 근거 제거 확인
@pytest.mark.parametrize("time, scene", [(1000, 0), (400, 1)])
def test_gap_and_cut_drop_old_support(time, scene):
    # 복수 공 후보의 연속 경로를 연결할 추적기 생성
    paths = BallPaths()
    # 관측 누락 뒤 경로 단절을 확인할 초기 구간 구성
    for frame in range(4):
        # 공 후보 경로 묶음에 입력을 반영하여 상태 갱신
        paths.update(frame * 100, 0, 640, 360, (p(100),))
    # 변화 후보가 비어 있는지 확인
    assert paths.update(time, scene, 640, 360, (p(100),)).candidate is None

# 모호한 연결에서 입력 순서 기반 선택 금지 확인
def test_ambiguous_association_does_not_select_by_input_order():
    # 같은 후보들을 정방향과 역방향으로 모두 시험
    for alternatives in ((p(98), p(102)), (p(102), p(98))):
        # 복수 공 후보의 연속 경로를 연결할 추적기 생성
        paths = BallPaths()
        # 각 입력 순서에 대해 동일한 관측 구간 구성
        for frame in range(4):
            # 공 후보 경로 묶음에 입력을 반영하여 상태 갱신
            paths.update(frame * 100, 0, 640, 360, (p(100),))
        # 변화 후보가 비어 있는지 확인
        assert paths.update(400, 0, 640, 360, alternatives).candidate is None

# 카메라 추정 실패 시 움직임 주장 없는 좌표 경로 보존 확인
def test_position_path_survives_camera_failure_without_motion_claim():
    # 다중 경로를 지원하는 공 후보 추적기 생성
    tracker = CandidateTracker()
    # 짧은 오인 경로와 실제 경로가 공존하는 구간 반복
    for frame in range(10):
        # 추적기에 입력을 반영하여 상태 갱신
        selection, motion = tracker.update(frame * 100, 0, 640, 360, (p(100 + frame * 4),), None)
        # 움직임 시작 시각이 비어 있는지 확인
        assert motion.motion_onset_ms is None
        # 모호한 경로에서 확정 이동량을 만들지 않는지 확인
        assert motion.compensated_displacement_px is None
    # 변화 후보가 존재하는지 확인
    assert selection.candidate is not None
    # 변화 후보가 변화 후보와 일치하는지 확인
    assert motion.candidate == selection.candidate

# 경로 확보 후 정지 이력을 요구하는 움직임 확인
def test_motion_requires_stationary_history_after_path_acquisition():
    # 재출발 시험에 사용할 다중 경로 추적기 생성
    tracker = CandidateTracker()
    # 정지와 출발이 이어지는 열두 프레임 관측
    for frame in range(12):
        # 추적기에 입력을 반영하여 상태 갱신
        tracker.update(frame * 100, 0, 640, 360, (p(100),), (1, 0, 0, 0, 1, 0))
    # 추적기에 입력을 반영하여 상태 갱신
    _, first = tracker.update(1200, 0, 640, 360, (p(104),), (1, 0, 0, 0, 1, 0))
    # 추적기에 입력을 반영하여 상태 갱신
    _, second = tracker.update(1300, 0, 640, 360, (p(108),), (1, 0, 0, 0, 1, 0))
    # 움직임 시작 시각이 비어 있는지 확인
    assert first.motion_onset_ms is None
    # 움직임 시작 시각이 1200과 일치하는지 확인
    assert second.motion_onset_ms == 1200
