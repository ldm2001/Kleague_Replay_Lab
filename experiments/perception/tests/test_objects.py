# 불변 관측 복사와 수정 오류 도구 읽음
from dataclasses import replace
# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 영상 변환과 그림 표시 도구 읽음
import cv2
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.media import VideoSample
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import KEYPOINT_NAMES, Keypoint, PoseObservation, RoleHypothesis
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.frames import RecordedFrame

# 인터페이스 반환
def api():
    # 검사할 인식 구현 모듈 반환
    return importlib.import_module('replay_perception.objects')

# 시험 장면 생성
def scene(ms=0, *, kind="flag", role="referee", boundary=True, continuity=0, changes=None):
    # 일정한 값으로 채운 시험 배열 생성
    rgb = np.full((360, 320, 3), (45, 130, 45), dtype=np.uint8)
    # 시험 장면 입력의 조건에 따른 분기
    if boundary:
        # 색상 영상 배열의 선택 항목의 시험 항목 구성
        rgb[282:] = (70, 60, 60)
        # 색상 영상 배열의 선택 항목의 시험 항목 구성
        rgb[279:282] = (245, 245, 245)
    # 검출 상자 좌표의 시험 항목 구성
    box = (100., 55., 180., 278.)
    # 좌표 배열의 조건별 항목 수집
    coordinates = {index: (140., 170.) for index in range(17)}
    # 좌표 배열에 현재 입력 반영
    coordinates.update(
        {
            # 왼쪽 어깨의 화면 좌표의 시험값 지정
            5: (120, 140),
            # 왼쪽 팔꿈치의 화면 좌표의 시험값 지정
            7: (120, 100),
            # 왼쪽 손목의 화면 좌표의 시험값 지정
            9: (120, 60),
            # 왼쪽 엉덩이의 화면 좌표의 시험값 지정
            11: (120, 220),
            # 오른쪽 어깨의 화면 좌표의 시험값 지정
            6: (160, 140),
            # 오른쪽 팔꿈치의 화면 좌표의 시험값 지정
            8: (160, 180),
            # 오른쪽 손목의 화면 좌표의 시험값 지정
            10: (160, 210),
            # 오른쪽 엉덩이의 화면 좌표의 시험값 지정
            12: (160, 220),
            15: (120, 276),
            16: (160, 276),
        }
    )
    # 관절 좌표 목록의 빈 누적 공간 생성
    points = []
    # 순번을 붙인 시험 자료의 항목별 순회
    for index, name in enumerate(KEYPOINT_NAMES):
        # 가로 좌표와 세로 좌표 준비
        x, y = coordinates[index]
        # 시험 값 목록의 시험 항목 구성
        values = {"x": x, "y": y, "score": .95, **(changes or {}).get(index, {})}
        # 관절 좌표 목록에 현재 관측 추가
        points.append(Keypoint(index, name, **values))
    # 원본 상자와 관절 좌표를 가진 자세 관측 생성
    pose = PoseObservation(0, box, tuple(points), ((1., 0., 0.), (0., 1., 0.)))
    # 관측 종류의 비교 결과별 분기
    if kind == "flag":
        # 기록 한 줄 실행
        cv2.line(rgb, (120, 60), (120, 20), (15, 15, 15), 2)
        # 색상 영상 배열의 선택 항목의 시험 항목 구성
        rgb[20:47, 122:142] = (245, 225, 15)
    # 관측 종류의 비교 결과별 분기
    elif kind in ("yellow", "red"):
        # 색상 영상 배열의 선택 항목의 시험 조건별 값 선택
        rgb[43:59, 116:126] = (245, 225, 15) if kind == "yellow" else (235, 20, 20)
    # 관측 종류의 비교 결과별 분기
    elif kind == "advert":
        # 색상 영상 배열의 선택 항목의 시험 항목 구성
        rgb[5:55, 210:300] = (245, 225, 15)
    # 상자와 점수를 가진 원시 검출 생성
    detection = Detection(0, "person", box, .9, "actor-1")
    # 원본 표시 시각과 픽셀을 가진 표본 생성
    sample = VideoSample(ms // 100, 0, ms, Fraction(1, 1000), 0, Fraction(1, 1000), ms, rgb)
    # 원본 표본과 검출을 묶은 기록 프레임 생성
    frame = RecordedFrame(sample, (detection,), continuity, ms // 100)
    # 원시 검출과 분리된 역할 가설 생성
    matched = RoleHypothesis(0, "MATCHED", role, .9, 1, .8)
    # 영상 프레임과 연결된 관측 반환
    return frame, (matched,), (pose,)

# 물체 관측 실행
def observed(tracker, **kwargs):
    # 현재 입력을 반영한 누적 관측 목록 반환
    return [tracker.update(*scene(ms, **kwargs)) for ms in (0, 100, 200, 300)]

# 손과 깃대가 필요한 깃발 패치의 단서 한정 확인
def test_flag_patch_requires_hand_and_shaft_and_is_only_a_cue():
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene()
    # 손 주변 카드와 깃발 관측 생성
    left, right = api().heldObjects(frame.sample.rgb, poses[0])
    # 관측 종류의 기대 자료 일치 확인
    assert left["kind"] == "FLAG_LIKE"
    # 깃발 후보에 막대 모양 근거가 존재하는지 확인
    assert left["shaftSupport"] is True
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert left["admission"] == "NOT_ADMITTED"
    # 물체 후보에서 손목까지의 화면 거리가 음수가 아닌지 확인
    assert left["wristDistancePx"] >= 0
    # 관측 종류 값이 알 수 없는 상태인지 확인
    assert right["kind"] == "UNKNOWN"
    # 왼쪽 관측에 지정한 항목 미포함 확인
    assert "probability" not in left

# 작은 사각 손 패치의 선언된 카드 해석 방지 확인
@pytest.mark.parametrize(
    "kind,expected", [("yellow", "YELLOW_CARD_LIKE"), ("red", "RED_CARD_LIKE")]
)
def test_small_rectangular_hand_patch_is_not_a_declared_card(kind, expected):
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene(kind=kind)
    # 왼쪽 관측 준비
    left = api().heldObjects(frame.sample.rgb, poses[0])[0]
    # 관측 종류의 기대 자료 일치 확인
    assert left["kind"] == expected
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert left["admission"] == "NOT_ADMITTED"
    # 왼쪽 관측에 지정한 항목 미포함 확인
    assert "disciplinaryDecision" not in left

# 가림·화면 밖 손의 관측 보류 확인
@pytest.mark.parametrize("changes", [{9: {"score": .1}}, {9: {"x": -1}}, {7: {"score": .1}}])
def test_occluded_or_outside_hand_abstains(changes):
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene(changes=changes)
    # 왼쪽 관측 준비
    left = api().heldObjects(frame.sample.rgb, poses[0])[0]
    # 관측 종류 값이 알 수 없는 상태인지 확인
    assert left["kind"] == "UNKNOWN"
    # 관측 상태 값이 관측할 수 없는 상태인지 확인
    assert left["state"] == "UNOBSERVABLE"

# 손에서 먼 광고 색상의 손 물체 오인 방지 확인
def test_advertising_colour_away_from_hand_is_not_a_held_object():
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene(kind="advert")
    # 근거가 부족한 모든 손 주변 물체의 종류가 미확정인지 확인
    assert all(item["kind"] == "UNKNOWN" for item in api().heldObjects(frame.sample.rgb, poses[0]))

# 양쪽에 잔디가 있는 흰 선의 터치라인 오인 방지 확인
def test_white_line_with_grass_on_both_sides_is_not_a_sideline():
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene(kind="none", boundary=False)
    # 색상 영상 배열의 선택 항목의 시험 항목 구성
    frame.sample.rgb[279:282] = (245, 245, 245)
    # 관측 상태의 기대 자료 일치 확인
    assert api().pitchContext(frame.sample.rgb, poses[0])["state"] == "IN_PITCH_CONTEXT"
    # 시험 시각의 영상 장면 생성
    border, _, border_poses = scene()
    # 화면상의 경기장 맥락 관측 생성
    context = api().pitchContext(border.sample.rgb, border_poses[0])
    # 관측 상태의 기대 자료 일치 확인
    assert context["state"] == "NEAR_PITCH_BOUNDARY"
    # 경기장 양쪽 잔디 대비가 최소 0점35인지 확인
    assert context["grassSideContrast"] >= .35

# 지속된 심판·깃발·경계의 부심 가설 한정 확인
def test_persistent_referee_flag_and_boundary_form_only_assistant_hypothesis():
    # 시험 프레임의 관측 결과 생성
    records = observed(api().OfficialObserver())
    # 심판 세부 역할 후보 값이 알 수 없는 상태인지 확인
    assert records[0][0]["officialRole"] == "UNKNOWN"
    # 심판 세부 역할 후보 값이 부심 후보인지 확인
    assert records[-1][0]["officialRole"] == "ASSISTANT_CANDIDATE"
    # 관측을 뒷받침한 프레임 수 값이 4인지 확인
    assert records[-1][0]["supportFrameCount"] == 4
    # 원심 관측 상태 값이 알 수 없는 상태인지 확인
    assert records[-1][0]["originalDecision"] == "UNKNOWN"

# 선수·골키퍼 깃발 유사 패치의 심판 승격 방지 확인
@pytest.mark.parametrize("role", ["player", "goalkeeper"])
def test_flaglike_patch_on_player_or_goalkeeper_does_not_make_official(role):
    # 시험 프레임의 관측 결과 생성
    records = observed(api().OfficialObserver(), role=role)
    # 선수와 골키퍼의 깃발 유사 패치가 심판 역할로 승격되지 않음 확인
    assert all(record[0]["officialRole"] == "UNKNOWN" for record in records)

# 깃발 부재 대신 경기장 근거와 지속된 팔 신호의 주심 가설 요구 확인
def test_main_requires_positive_pitch_and_persistent_raised_signal_not_flag_absence():
    # 시험 프레임의 관측 결과 생성
    records = observed(api().OfficialObserver(), kind="none", boundary=False)
    # 심판 세부 역할 후보 값이 주심 후보인지 확인
    assert records[-1][0]["officialRole"] == "MAIN_CANDIDATE"
    # 시험 프레임의 관측 결과 생성
    hidden_feet = observed(
        api().OfficialObserver(),
        # 관측 종류의 호출 조건 지정
        kind="none",
        boundary=False,
        changes={15: {"score": 0.1}, 16: {"score": 0.1}},
    )
    # 심판 세부 역할 후보 값이 알 수 없는 상태인지 확인
    assert hidden_feet[-1][0]["officialRole"] == "UNKNOWN"

# 화면 전환·간격·역할 변경의 시간 근거 초기화 확인
def test_cut_gap_or_changed_role_clears_temporal_support():
    # 역할과 자세를 함께 처리할 심판 관측기 생성
    observer = api().OfficialObserver()
    # 시험 프레임의 관측 결과 실행
    observed(observer)
    # 심판 세부 역할 후보 값이 알 수 없는 상태인지 확인
    assert observer.update(*scene(400, continuity=1))[0]["officialRole"] == "UNKNOWN"
    # 관측을 뒷받침한 프레임 수 값이 1인지 확인
    assert observer.update(*scene(900, continuity=1))[0]["supportFrameCount"] == 1
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene(1000, continuity=1)
    # 화면 전환·간격·역할 변경의 시간 근거 초기화 입력의 시험 항목 구성
    unmatched = (RoleHypothesis(0, "UNMATCHED"),)
    # 심판 세부 역할 후보 값이 알 수 없는 상태인지 확인
    assert observer.update(frame, unmatched, poses)[0]["officialRole"] == "UNKNOWN"
    # 관측을 뒷받침한 프레임 수 값이 1인지 확인
    assert observer.update(*scene(1100, continuity=1))[0]["supportFrameCount"] == 1

# 중복 추적과 원본 상자 불일치 거부 확인
def test_duplicate_tracks_or_source_box_mismatch_is_rejected():
    # 시험 시각의 영상 장면 생성
    frame, roles, poses = scene()
    # 원본 일치 오류 발생 기대
    with pytest.raises(ValueError, match="POSE_SOURCE_MISMATCH"):
        # 역할과 자세를 함께 처리할 심판 관측기에 현재 입력 반영
        api().OfficialObserver().update(
            frame, roles, (replace(poses[0], source_box=(0, 0, 10, 10)),)
        )
    # 지정 필드만 바꾼 시험 관측 생성
    duplicate = replace(frame.detections[0], detection_id=1)
    # 추적 식별 오류 발생 기대
    with pytest.raises(ValueError, match="TRACK_ID_DUPLICATE"):
        # 역할과 자세를 함께 처리할 심판 관측기에 현재 입력 반영
        api().OfficialObserver().update(
            replace(frame, detections=(*frame.detections, duplicate)), roles, poses
        )

# 상자 중심 대신 보이는 발목의 지면 연결 위치 사용 확인
def test_link_location_uses_visible_ankles_and_not_box_centre_as_measured_ground():
    # 처리 결과 준비
    result = api().OfficialObserver().update(*scene())[0]
    # 화면상의 발 위치 값이 140점0 · 276점0인지 확인
    assert result["footPoint"] == [140., 276.]
    # 화면상의 사람 높이 값이 223점0인지 확인
    assert result["personHeightPx"] == 223.
    # 상자 중심 대신 보이는 발목의 지면 연결 위치 사용 입력 준비
    hidden = api().OfficialObserver().update(*scene(changes={15: {"score": .1}}))[0]
    # 화면상의 발 위치 부재 확인
    assert hidden["footPoint"] is None

# 두 사람의 동일 역할 검출 연결 방지 확인
def test_role_detection_cannot_be_matched_to_two_people():
    # 시험 시각의 영상 장면 생성
    frame, roles, poses = scene()
    # 지정 필드만 바꾼 시험 관측 생성
    frame = replace(
        frame,
        # 검출 목록의 호출 조건 지정
        detections=(
            *frame.detections,
            replace(frame.detections[0], detection_id=1, track_id="actor-2"),
        ),
    )
    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_ASSOCIATION_AMBIGUOUS"):
        # 역할과 자세를 함께 처리할 심판 관측기에 현재 입력 반영
        api().OfficialObserver().update(
            frame,
            (*roles, replace(roles[0], detection_id=1)),
            (*poses, replace(poses[0], detection_id=1)),
        )

# 반올림 밀리초 대신 정확한 원본 시각의 지속 시간 사용 확인
def test_duration_uses_exact_pts_not_rounded_milliseconds():
    # 역할과 자세를 함께 처리할 심판 관측기 생성
    observer = api().OfficialObserver()
    # 반올림 밀리초 대신 정확한 원본 시각의 지속 시간 사용 입력의 빈 누적 공간 생성
    results = []
    # 반올림 밀리초 대신 정확한 원본 시각의 지속 시간 사용 입력 목록의 항목별 순회
    for pts in (1, 1000, 1999):
        # 시험 시각의 영상 장면 생성
        frame, roles, poses = scene(round(pts / 10), kind="none", boundary=False)
        # 지정 필드만 바꾼 시험 관측 생성
        frame = replace(frame, sample=replace(frame.sample, pts=pts, time_base=Fraction(1, 10000)))
        # 반올림 밀리초 대신 정확한 원본 시각의 지속 시간 사용에 현재 관측 추가
        results.append(observer.update(frame, roles, poses)[0])
    # 동작 지속 여부 값이 거짓인지 확인
    assert results[-1]["sustained"] is False
    # 심판 세부 역할 후보 값이 알 수 없는 상태인지 확인
    assert results[-1]["officialRole"] == "UNKNOWN"

# 정확한 원본 시각 간격과 심판 원본 프레임 보존 확인
def test_gap_uses_exact_pts_and_official_retains_source_frame():
    # 역할과 자세를 함께 처리할 심판 관측기 생성
    observer = api().OfficialObserver()
    # 정확한 원본 시각 간격과 심판 원본 프레임 보존 입력 목록의 항목별 순회
    for pts in (1, 1000, 2001, 4502):
        # 시험 시각의 영상 장면 생성
        frame, roles, poses = scene(round(pts / 10), kind="none", boundary=False)
        # 지정 필드만 바꾼 시험 관측 생성
        frame = replace(frame, sample=replace(frame.sample, pts=pts, time_base=Fraction(1, 10000)))
        # 처리 결과 준비
        result = observer.update(frame, roles, poses)[0]
    # 관측을 뒷받침한 프레임 수 값이 1인지 확인
    assert result["supportFrameCount"] == 1
    # 마지막 근거 프레임의 기대 자료 일치 확인
    assert result["lastFrame"] == frame.sample.as_record()

# 양손 교대의 단일 지속 신호 인정 방지 확인
def test_alternating_hands_do_not_supply_one_persistent_signal():
    # 역할과 자세를 함께 처리할 심판 관측기 생성
    observer = api().OfficialObserver()
    # 양손 교대의 단일 지속 신호 인정 방지 입력 목록의 항목별 순회
    for ms, side in ((0, "LEFT"), (100, "RIGHT"), (200, "LEFT")):
        # 시험별 변경 항목의 값 없음 설정
        changes = None
        # 관측한 팔 방향의 비교 결과별 분기
        if side == "RIGHT":
            # 시험별 변경 항목의 시험 항목 구성
            changes = {
                7: {"x": 120, "y": 180},
                9: {"x": 120, "y": 210},
                8: {"x": 160, "y": 100},
                10: {"x": 160, "y": 60},
            }
        # 처리 결과 준비
        result = observer.update(*scene(ms, kind="none", boundary=False, changes=changes))[0]
    # 심판 세부 역할 후보 값이 알 수 없는 상태인지 확인
    assert result["officialRole"] == "UNKNOWN"
    # 관측을 뒷받침한 프레임 수 값이 1인지 확인
    assert result["supportFrameCount"] == 1
    # 관측 신호 방향이 왼쪽인지 확인
    assert result["signalSide"] == "LEFT"

# 불가능한 점 형상의 깃대 처리 생략 확인
def test_impossible_speck_geometry_does_not_run_shaft_processing(monkeypatch):
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene(kind="none")
    # 반복할 순번 범위의 항목별 순회
    for y in range(0, 130, 5):
        # 반복할 순번 범위의 항목별 순회
        for x in range(5, 250, 5):
            # 색상 영상 배열의 선택 항목의 시험 항목 구성
            frame.sample.rgb[y:y + 3, x:x + 3] = (245, 225, 15)
    # 호출 이력의 빈 누적 공간 생성
    calls = []
    # 변경 전 자료 준비
    original = cv2.Canny

    # 호출 횟수 집계
    def counted(*args, **kwargs):
        # 호출 이력에 현재 관측 추가
        calls.append(True)
        # 교체 전 원래 동작의 결과 반환
        return original(*args, **kwargs)
    # 불가능한 점 형상의 깃대 처리 생략 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "Canny", counted)
    # 관측 종류 값이 알 수 없는 상태인지 확인
    assert api().heldObjects(frame.sample.rgb, poses[0])[0]["kind"] == "UNKNOWN"
    # 호출 이력 값이 빈 목록인지 확인
    assert calls == []

# 다수 후보 패치의 손별 깃대 추출 공유 확인
def test_multiple_plausible_patches_share_one_hand_shaft_extraction(monkeypatch):
    # 시험 시각의 영상 장면 생성
    frame, _, poses = scene(kind="yellow")
    # 색상 영상 배열의 선택 항목의 시험 항목 구성
    frame.sample.rgb[43:59, 129:139] = (245, 225, 15)
    # 호출 이력의 빈 누적 공간 생성
    calls = []
    # 변경 전 자료 준비
    original = cv2.Canny

    # 호출 횟수 집계
    def counted(*args, **kwargs):
        # 호출 이력에 현재 관측 추가
        calls.append(True)
        # 교체 전 원래 동작의 결과 반환
        return original(*args, **kwargs)
    # 다수 후보 패치의 손별 깃대 추출 공유 의존성의 시험 대역 주입
    monkeypatch.setattr(cv2, "Canny", counted)
    # 손 주변 카드와 깃발 관측 실행
    api().heldObjects(frame.sample.rgb, poses[0])
    # 호출 이력의 개수 값이 1인지 확인
    assert len(calls) == 1
