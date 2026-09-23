from pathlib import Path
import json
import cv2
import numpy as np
import pytest
from replay_video.domain.ball import BallCandidate, BallTracker
from replay_video.infrastructure.ball import ballCandidates
from replay_video.inspection import inspection
from test_context import pitch


# 카메라 이동이 없는 항등 변환의 여섯 계수 준비
IDENTITY = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0)

# 시험용 좌표 반환
def point(x=50, y=50):
    # 위치와 크기 및 점수가 정해진 공 후보 반환
    return BallCandidate(x, y, 4, 0.85)

# 갱신 모형
def update(tracker, time, x=50, *, candidates=None, affine=IDENTITY, continuity=0):
    # 추적기에 입력을 반영하여 상태 갱신 결과 반환
    return tracker.update(
        time, continuity, 320, 180, candidates if candidates is not None else (point(x),), affine
    )

# 작고 둥근 후보 검출과 선·큰 물체 제외 확인
def test_detects_small_round_candidate_and_rejects_lines_and_large_objects():
    # 공과 밝은 사각형을 비교할 잔디 화면 생성
    image = pitch()
    # 공 크기에 맞는 작은 밝은 원 배치
    cv2.circle(image, (50, 50), 4, (240, 240, 240), -1)
    # 공으로 오인하면 안 되는 큰 밝은 사각형 배치
    cv2.rectangle(image, (200, 25), (220, 70), (240, 240, 240), -1)
    # 화면에서 공 크기와 밝기에 맞는 원시 후보 추출
    candidates = ballCandidates(image)
    # 변화 후보 목록의 개수가 1과 일치하는지 확인
    assert len(candidates) == 1
    # 선택한 공의 수평 중심이 그려 넣은 위치와 일치하는지 확인
    assert candidates[0].x == pytest.approx(50, abs=1)
    # 선택한 공의 수직 중심이 그려 넣은 위치와 일치하는지 확인
    assert candidates[0].y == pytest.approx(50, abs=1)
    # 화면에서 공 크기와 밝기에 맞는 원시 후보 추출 결과이 빈 값으로 유지되는지 확인
    assert ballCandidates(np.zeros_like(image)) == ()

# 복수 밝은 영역의 임의 선택 금지 확인
def test_multiple_blobs_are_not_silently_resolved():
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 비슷한 점수의 두 공 후보를 동시에 전달하여 모호성 재현
    result = update(tracker, 0, candidates=(point(40), point(60)))
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert result.status == "UNKNOWN"
    # 변화 후보가 비어 있는지 확인
    assert result.candidate is None
    # 사유가 예상 계약과 일치하는지 확인
    assert result.reason == "AMBIGUOUS_BALL_CANDIDATES"

# 고립된 녹색 표시의 공 탐색 영역 확장 방지 확인
def test_isolated_green_overlay_does_not_expand_ball_search_area():
    # 시험 이미지를 지정 크기와 자료형의 시험 배열로 생성
    image = np.full((180, 320, 3), (40, 40, 40), dtype=np.uint8)
    # 화면 아래쪽에 주 경기장 잔디 영역 배치
    cv2.rectangle(image, (0, 100), (319, 179), (35, 110, 35), -1)
    # 주 경기장과 분리된 작은 녹색 영역 배치
    cv2.rectangle(image, (20, 5), (80, 25), (35, 110, 35), -1)
    # 작은 녹색 영역 안에 공처럼 보이는 오인 후보 배치
    cv2.circle(image, (40, 15), 4, (240, 240, 240), -1)
    # 실제 선택 대상으로 주 경기장 인접 공 배치
    cv2.circle(image, (170, 85), 4, (240, 240, 240), -1)
    # 화면에서 공 크기와 밝기에 맞는 원시 후보 추출
    candidates = ballCandidates(image)
    # 변화 후보 목록의 개수가 1과 일치하는지 확인
    assert len(candidates) == 1
    # 분리된 녹색 배경의 오인 후보 대신 주 경기장 공을 선택하는지 확인
    assert candidates[0].x == pytest.approx(170, abs=1)

# 잔디 적은 근접 화면의 공 추적 시작 차단 확인
def test_low_grass_closeup_does_not_seed_a_ball_track():
    # 시험 이미지를 지정 크기와 자료형의 시험 배열로 생성
    image = np.full((180, 320, 3), (40, 40, 40), dtype=np.uint8)
    # 잔디 비율이 낮아지도록 좁은 띠만 배치
    cv2.rectangle(image, (0, 140), (319, 170), (35, 110, 35), -1)
    # 녹색 띠 위에 공을 그려 화면 품질 제한 재현
    cv2.circle(image, (50, 150), 4, (240, 240, 240), -1)
    # 화면에서 공 크기와 밝기에 맞는 원시 후보 추출 결과이 빈 값으로 유지되는지 확인
    assert ballCandidates(image) == ()

# 경기장 바로 위 공중 공의 후보 포함 확인
def test_airborne_ball_just_above_pitch_is_included_as_a_candidate():
    # 프레임 가장자리 후보 제외 시험용 잔디 화면 생성
    image = pitch()
    # 시험 이미지를 비교에 사용할 고정 시험 자료로 구성
    image[:65] = (50, 40, 45)
    # 경계 후보와 비교할 정상 위치의 공 배치
    cv2.circle(image, (70, 50), 4, (240, 240, 240), -1)
    # 가장자리와 무관한 정상 위치 공 후보가 유지되는지 확인
    assert any(
        abs(candidate.x - 70) < 1 and abs(candidate.y - 50) < 1
        for candidate in ballCandidates(image)
    )

# 정지 후 이동을 후보 움직임으로만 기록 확인
def test_stationary_then_moving_is_only_a_candidate_motion_event():
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 같은 위치의 공을 200밀리초 간격으로 반복 관측
    for time in (0, 200, 400, 600):
        # 움직이지 않는 공으로 정지 시간 누적
        result = update(tracker, time)
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert result.status == "STATIONARY"
    # 누적 정지 시간이 600밀리초인지 확인
    assert result.stationary_ms == 600
    # 움직임 시작 시각이 비어 있는지 확인
    assert update(tracker, 800, 55).motion_onset_ms is None
    # 정지 이후 공 위치를 옮겨 움직임 시작 재현
    onset = update(tracker, 1000, 60)
    # 움직임 시작 시각이 800과 일치하는지 확인
    assert onset.motion_onset_ms == 800
    # 움직임 시작 시각이 비어 있는지 확인
    assert update(tracker, 1200, 65).motion_onset_ms is None
    # 움직임 시작 신호를 경기 중단 사실로 승격하지 않는지 확인
    assert not hasattr(onset, "dead_ball")

# 카메라 수평 이동의 움직임 시작 오인 방지 확인
def test_camera_pan_does_not_generate_motion_onset():
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 여덟 프레임에 걸쳐 카메라만 수평 이동하는 상황 재현
    for frame in range(8):
        # 공 좌표 변화와 동일한 카메라 이동 보정량 전달
        result = update(tracker, frame * 200, 50 + frame * 5, affine=(1, 0, 5, 0, 1, 0))
        # 움직임 시작 시각이 비어 있는지 확인
        assert result.motion_onset_ms is None
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert result.status == "STATIONARY"
    # 카메라 보정 뒤 공의 상대 이동량이 영인지 확인
    assert result.compensated_displacement_px == 0

# 카메라 확대의 움직임 시작 오인 방지 확인
def test_camera_scale_does_not_generate_motion_onset():
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 여섯 프레임에 걸쳐 확대되는 카메라 상황 재현
    for frame in range(6):
        # 프레임마다 2퍼센트씩 누적되는 확대율 계산
        scale = 1.02 ** frame
        # 추적기에 입력을 반영하여 상태 갱신
        result = tracker.update(
            frame * 200,
            0,
            320,
            180,
            (BallCandidate(50 * scale, 50 * scale, 4 * scale, 0.85),),
            (1.02, 0, 0, 0, 1.02, 0),
        )
        # 움직임 시작 시각이 비어 있는지 확인
        assert result.motion_onset_ms is None
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert result.status == "STATIONARY"

# 불연속 시 이전 정지 이력 초기화 확인
@pytest.mark.parametrize("failure", ["occlusion", "cut", "gap", "camera", "ambiguous"])
def test_discontinuity_clears_previous_stationary_history(failure):
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 실패 전 동일 위치 관측으로 정지 상태 확보
    for time in (0, 200, 400, 600):
        # 정상 정지 관측을 추적기에 누적
        update(tracker, time)
    # 시간 공백 사례일 때만 관측 간격을 길게 설정
    time = 1400 if failure == "gap" else 800
    # 화면 전환 사례일 때 연속 구간 식별자 변경
    continuity = 1 if failure == "cut" else 0
    # 누락과 모호성 및 정상 입력에 맞는 공 후보 목록 구성
    candidates = (
        ()
        if failure == "occlusion"
        else (point(51), point(52)) if failure == "ambiguous" else (point(55),)
    )
    # 시간 공백과 화면 전환 및 관측 누락을 추적기에 전달
    result = update(
        tracker,
        time,
        candidates=candidates,
        continuity=continuity,
        affine=None if failure == "camera" else IDENTITY,
    )
    # 움직임 시작 시각이 비어 있는지 확인
    assert result.motion_onset_ms is None
    # 움직임 시작 시각이 비어 있는지 확인
    assert update(tracker, time + 200, 60, continuity=continuity).motion_onset_ms is None

# 점진 이동·단일 도약의 움직임 시작 제외 확인
def test_no_motion_trigger_on_gradual_drift_or_a_single_jump():
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 연속 움직임을 반복하여 정지 없는 이동 상황 재현
    for frame in range(8):
        # 움직임 시작 시각이 비어 있는지 확인
        assert update(tracker, frame * 200, 50 + frame).motion_onset_ms is None
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 이후 정지 구간을 만들어 재출발 조건 확보
    for time in (0, 200, 400, 600):
        # 공이 같은 위치에 머무는 관측 누적
        update(tracker, time)
    # 움직임 시작 시각이 비어 있는지 확인
    assert update(tracker, 800, 55).motion_onset_ms is None
    # 움직임 시작 시각이 비어 있는지 확인
    assert update(tracker, 1000, 55).motion_onset_ms is None

# 미확인 변환과 시간 역순 입력 확인
def test_unknown_transform_and_out_of_order_input():
    # 카메라 이동을 보정하는 공 추적기 생성
    tracker = BallTracker()
    # 유효한 첫 관측으로 추적 시간축 시작
    update(tracker, 0)
    # 사유가 예상 계약과 일치하는지 확인
    assert update(tracker, 200, affine=None).reason == "CAMERA_TRANSFORM_UNAVAILABLE"
    # 미확인 변환과 시간 역순 입력을 위한 예상 예외 확인
    with pytest.raises(ValueError, match="ball-time-not-increasing"):
        # 이전 시각보다 역행하는 관측 거부 경로 실행
        update(tracker, 100)

# 세트피스 주장 없는 공 출발 후보 진단 기록 확인
def test_video_diagnostic_records_a_candidate_release_without_claiming_a_setpiece(tmp_path: Path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "ball.mp4"
    # 초당 열 프레임의 공 움직임 시험 영상 인코더 생성
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10, (320, 180))
    # 시험 영상을 쓸 코덱이 열렸는지 확인
    assert writer.isOpened()
    # 프레임 생성 실패 시에도 인코더가 닫히는 범위 시작
    try:
        # 정지와 이동을 포함하는 스무 프레임 생성
        for index in range(20):
            # 각 프레임의 잔디 배경 생성
            image = pitch()
            # 전반에는 고정 위치를 사용하고 후반에는 공을 점차 이동
            x = 50 if index < 10 else 50 + (index - 9) * 3
            # 계산한 공 위치에 작은 밝은 원 배치
            cv2.circle(image, (x, 50), 4, (240, 240, 240), -1)
            # 완성한 시험 프레임을 영상에 기록
            writer.write(image)
    finally:
        # 시험 영상 인코더가 점유한 자원 해제
        writer.release()
    # 실제 디코딩 경로로 공 움직임 진단 실행
    summary_path = inspection(source, tmp_path / "diagnostic")
    # 저장된 문자열을 구조화된 자료로 읽음
    summary = json.loads(summary_path.read_text())
    # 진단에서 저장한 프레임별 관측 기록 읽음
    samples = [
        json.loads(line)
        for line in (summary_path.parent / "context.jsonl").read_text().splitlines()
    ]
    # 공 추적 표본 수가 8 이상인지 확인
    assert summary["ball_tracked_samples"] >= 8
    # 후보별 움직임 시작 시각의 개수가 1과 일치하는지 확인
    assert len(summary["candidate_motion_onsets"]) == 1
    # 움직임 시작 후보가 정지 종료 주변 시각에 놓이는지 확인
    assert 900 <= summary["candidate_motion_onsets"][0]["timestamp_ms"] <= 1200
    # 세트피스 관측 상태가 예상 계약과 일치하는지 확인
    assert summary["set_piece_status"] == "UNKNOWN"
    # 원시 움직임 신호가 확정 재개 사실로 변환되지 않는지 확인
    assert all(
        sample["dead_ball"] is None and sample["ball_restarted"] is None for sample in samples
    )
