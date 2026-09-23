# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 기록 직렬화와 읽기 도구 읽음
import json
# 각도와 비유한 수치 시험 도구 읽음
import math
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
    return importlib.import_module("replay_perception.signals")

# 자세 관측 생성
def pose_observation(
    detection_id=0,
    *,
    left="raised",
    right="not_raised",
    changes=None,
    source_box=(20, 10, 140, 220),
):
    # 좌표 배열의 조건별 항목 수집
    coordinates = {index: (30.0 + index, 30.0 + index) for index in range(17)}
    # 좌표 배열에 현재 입력 반영
    coordinates.update(
        {
            # 왼쪽 어깨의 화면 좌표의 시험값 지정
            5: (50, 100),
            # 왼쪽 팔꿈치의 화면 좌표의 시험값 지정
            7: (50, 60),
            # 왼쪽 손목의 화면 좌표의 시험값 지정
            9: (50, 20),
            # 왼쪽 엉덩이의 화면 좌표의 시험값 지정
            11: (50, 180),
            # 오른쪽 어깨의 화면 좌표의 시험값 지정
            6: (100, 100),
            # 오른쪽 팔꿈치의 화면 좌표의 시험값 지정
            8: (100, 130),
            # 오른쪽 손목의 화면 좌표의 시험값 지정
            10: (100, 160),
            # 오른쪽 엉덩이의 화면 좌표의 시험값 지정
            12: (100, 180),
        }
    )
    # 왼쪽 관측의 비교 결과별 분기
    if left == "not_raised":
        # 좌표 배열에 현재 입력 반영
        coordinates.update({5: (50, 100), 7: (50, 130), 9: (50, 160), 11: (50, 180)})
    # 오른쪽 관측의 비교 결과별 분기
    if right == "raised":
        # 좌표 배열에 현재 입력 반영
        coordinates.update({6: (100, 100), 8: (100, 60), 10: (100, 20), 12: (100, 180)})
    # 관절별 변경 좌표와 점수 준비
    point_changes = changes or {}
    # 관절 좌표 목록의 빈 누적 공간 생성
    points = []
    # 순번을 붙인 시험 자료의 항목별 순회
    for index, name in enumerate(KEYPOINT_NAMES):
        # 가로 좌표와 세로 좌표 준비
        x, y = coordinates[index]
        # 관절 좌표의 시험 항목 구성
        point = {"x": x, "y": y, "score": .9}
        # 관절 좌표에 현재 입력 반영
        point.update(point_changes.get(index, {}))
        # 관절 좌표 목록에 현재 관측 추가
        points.append(Keypoint(index, name, point["x"], point["y"], point["score"]))
    # 원본 상자와 관절 좌표를 가진 자세 관측 반환
    return PoseObservation(detection_id, source_box, tuple(points), ((1., 0., 0.), (0., 1., 0.)))

# 원본 검출 생성
def source_detection(
    detection_id=0, *, track_id="person-track-7", label="person", box=(20, 10, 140, 220)
):
    # 상자와 점수를 가진 원시 검출 반환
    return Detection(detection_id, label, box, .9, track_id)

# 역할 가설 생성
def role_hypothesis(detection_id=0, *, role="referee", score=.9, status="MATCHED"):
    # 처리 상태의 비교 결과별 분기
    if status != "MATCHED":
        # 원시 검출과 분리된 역할 가설 반환
        return RoleHypothesis(detection_id, status)
    # 원시 검출과 분리된 역할 가설 반환
    return RoleHypothesis(detection_id, status, role, score, 10 + detection_id, .8)

# 기록 프레임 생성
def recorded_frame(
    timestamp_ms,
    *,
    detections=None,
    continuity_id=4,
    record_index=None,
    pts=None,
    stream_index=2,
    origin_pts=10_000,
    time_base=Fraction(1, 1000),
    origin_time_base=None,
):
    # 검출 목록의 비교 결과별 분기
    if detections is None:
        # 검출 목록의 시험 항목 구성
        detections = (source_detection(),)
    # 원본 표시 시각의 비교 결과별 분기
    if pts is None:
        # 원본 표시 시각 준비
        pts = origin_pts + timestamp_ms
    # 원본 시작점 시간 단위의 비교 결과별 분기
    if origin_time_base is None:
        # 원본 시작점 시간 단위 준비
        origin_time_base = time_base
    # 저장된 프레임 순번의 비교 결과별 분기
    if record_index is None:
        # 저장된 프레임 순번 준비
        record_index = timestamp_ms // 100
    # 원본 표시 시각과 픽셀을 가진 표본 생성
    sample = VideoSample(
        record_index,
        stream_index,
        pts,
        time_base,
        origin_pts,
        origin_time_base,
        timestamp_ms,
        np.zeros((240, 160, 3), dtype=np.uint8),
    )
    # 원본 표본과 검출을 묶은 기록 프레임 반환
    return RecordedFrame(sample, tuple(detections), continuity_id, record_index)

# 원본 영상 좌표에서 왼팔·오른팔 순서 분류 확인
def test_arm_observations_classifies_left_then_right_in_original_image_coordinates():
    # 관절 좌표로 계산한 팔 동작 관측 생성
    left, right = api().armObservations(pose_observation(), 160, 240)

    # 관측한 팔 방향 값이 왼쪽 · 오른쪽인지 확인
    assert (left["side"], right["side"]) == ("LEFT", "RIGHT")
    # 왼쪽 관측의 기대 자료 일치 확인
    assert left == {
        # 원본 검출 식별자의 기대값 지정
        "detectionId": 0,
        # 관측한 팔 방향의 시험값 지정
        "side": "LEFT",
        # 관측 상태의 시험값 지정
        "state": "ARM_RAISED",
        # 보류 이유 코드의 시험값 지정
        "reasonCode": "ARM_RAISED_CRITERIA_MET",
        # 관절 순번 목록의 5 · 7 · 9 · 11 시험값 지정
        "keypointIndices": [5, 7, 9, 11],
        # 관절 원시 최소 점수의 0점9 시험값 지정
        "rawMinimumKeypointScore": .9,
        # 화면상의 몸통 길이의 80점0 시험값 지정
        "torsoLengthPx": 80.0,
        # 화면상의 위팔 길이의 기대값 지정
        "upperArmLengthPx": 40.0,
        # 화면상의 아래팔 길이의 기대값 지정
        "forearmLengthPx": 40.0,
        # 어깨에서 손목까지 화면 거리의 기대값 지정
        "shoulderWristLengthPx": 80.0,
        # 어깨 대비 손목 높이의 기대값 지정
        "wristAboveShoulderPx": 80.0,
        # 몸통 대비 손목 높이 비율의 1점0 시험값 지정
        "wristAboveShoulderTorsoRatio": 1.0,
        # 팔꿈치 안쪽 각도의 180점0 시험값 지정
        "elbowInteriorAngleDegrees": 180.0,
        # 어깨와 손목의 수직 각도의 0점0 시험값 지정
        "shoulderWristVerticalUpAngleDegrees": 0.0,
    }
    # 관측 상태 값이 팔을 들지 않은 상태인지 확인
    assert right["state"] == "NOT_RAISED"
    # 보류 이유 코드의 기대 자료 일치 확인
    assert right["reasonCode"] == "ARM_RAISED_CRITERIA_NOT_MET"
    # 관절 순번 목록 값이 6 · 8 · 10 · 12인지 확인
    assert right["keypointIndices"] == [6, 8, 10, 12]
    # 저장용으로 직렬화한 문자열 실행
    json.dumps((left, right), allow_nan=False)

# 오른팔 독립 양성 관측과 판정·반칙 기록 부재 확인
def test_right_arm_can_be_positive_independently_and_records_no_decision_or_foul():
    # 관절 좌표로 계산한 팔 동작 관측 생성
    left, right = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(left="not_raised", right="raised"),
        160,
        240,
    )
    # 관측 상태 값이 팔을 들지 않은 상태인지 확인
    assert left["state"] == "NOT_RAISED"
    # 관측 상태 값이 팔을 든 상태인지 확인
    assert right["state"] == "ARM_RAISED"
    # 오른팔 독립 양성 관측과 판정·반칙 기록 부재의 부재 또는 비활성 확인
    assert not ({"foul", "decision", "originalDecision"} & set(right))

# 비양수·비정수 영상 크기의 팔 관측 거부 확인
@pytest.mark.parametrize("width,height", [(0, 240), (-1, 240), (160, 0), (True, 240), (160, 1.5)])
def test_arm_observations_rejects_nonpositive_or_noninteger_image_dimensions(width, height):
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="FRAME_DIMENSIONS_INVALID"):
        # 관절 좌표로 계산한 팔 동작 관측 실행
        api().armObservations(pose_observation(), width, height)

# 원시 관절점 점수 경계 포함과 확률 보정 해석 방지 확인
def test_raw_keypoint_score_boundary_is_inclusive_and_not_treated_as_probability_calibration():
    # 시험 관절 좌표와 신뢰 점수 생성
    at_boundary = pose_observation(changes={5: {"score": .5}})
    # 시험 관절 좌표와 신뢰 점수 생성
    below_boundary = pose_observation(changes={5: {"score": .499999}})
    # 시험 관절 좌표와 신뢰 점수 생성
    raw_over_one = pose_observation(
        changes={5: {"score": 1.4}, 7: {"score": 1.2}, 9: {"score": 1.3}, 11: {"score": 1.1}}
    )

    # 관측 상태 값이 팔을 든 상태인지 확인
    assert api().armObservations(at_boundary, 160, 240)[0]["state"] == "ARM_RAISED"
    # 경계 바로 아래 입력 준비
    below = api().armObservations(below_boundary, 160, 240)[0]
    # 관측 상태 값이 관측할 수 없는 상태인지 확인
    assert below["state"] == "UNOBSERVABLE"
    # 보류 이유 코드의 기대 자료 일치 확인
    assert below["reasonCode"] == "KEYPOINT_SCORE_BELOW_THRESHOLD"
    # 관절 원시 최소 점수 값이 0점499999인지 확인
    assert below["rawMinimumKeypointScore"] == .499999
    # 관절 원시 최소 점수 값이 1점1인지 확인
    assert api().armObservations(raw_over_one, 160, 240)[0]["rawMinimumKeypointScore"] == 1.1

# 원본 밖 관절점의 자르기 없는 관측 불가 확인
@pytest.mark.parametrize("index,change", [
    (5, {"x": -0.001}), (7, {"x": 160}), (9, {"y": -0.001}), (11, {"y": 240}),
])
def test_out_of_original_image_keypoint_is_unobservable_and_never_clipped(index, change):
    # 직렬화 기록 준비
    record = api().armObservations(pose_observation(changes={index: change}), 160, 240)[0]
    # 관측 상태 값이 관측할 수 없는 상태인지 확인
    assert record["state"] == "UNOBSERVABLE"
    # 보류 이유 코드의 기대 자료 일치 확인
    assert record["reasonCode"] == "KEYPOINT_OUTSIDE_SOURCE_IMAGE"
    # 직렬화 기록에 지정한 항목 미포함 확인
    assert "elbowInteriorAngleDegrees" not in record

# 원본 상자의 최소 폭·높이 경계 확인
@pytest.mark.parametrize("source_box,expected", [
    ((20, 10, 32, 74), "ARM_RAISED"),
    ((20, 10, 31.999, 74), "UNOBSERVABLE"),
    ((20, 10, 32, 73.999), "UNOBSERVABLE"),
])
def test_source_box_minimum_width_and_height_boundaries(source_box, expected):
    # 직렬화 기록 준비
    record = api().armObservations(pose_observation(source_box=source_box), 160, 240)[0]
    # 관측 상태의 기대 자료 일치 확인
    assert record["state"] == expected
    # 기대 자료의 비교 결과별 분기
    if expected == "UNOBSERVABLE":
        # 보류 이유 코드의 기대 자료 일치 확인
        assert record["reasonCode"] == "SOURCE_BOX_TOO_SMALL"

# 짧은 몸통·길이 없는 팔의 음성 대신 관측 불가 확인
def test_short_torso_and_zero_arm_segments_are_unobservable_not_negative_observations():
    # 짧은 몸통 관측 준비
    short_torso = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(changes={11: {"x": 50, "y": 107.999}}),
        160,
        240,
    )[0]
    # 길이가 영인 위팔 관측 준비
    zero_upper_arm = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(changes={7: {"x": 50, "y": 100}}),
        160,
        240,
    )[0]
    # 어깨와 손목이 겹친 관측 준비
    zero_shoulder_wrist = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(changes={9: {"x": 50, "y": 100}}),
        160,
        240,
    )[0]

    # 관측 상태과 보류 이유 코드의 기대 자료 일치 확인
    assert (short_torso["state"], short_torso["reasonCode"]) == (
        "UNOBSERVABLE", "TORSO_LENGTH_BELOW_MINIMUM",
    )
    # 화면상의 몸통 길이의 기대 자료 일치 확인
    assert short_torso["torsoLengthPx"] == pytest.approx(7.999)
    # 길이가 영인 위팔 관측과 어깨와 손목이 겹친 관측의 항목별 순회
    for record in (zero_upper_arm, zero_shoulder_wrist):
        # 관측 상태과 보류 이유 코드의 기대 자료 일치 확인
        assert (record["state"], record["reasonCode"]) == (
            "UNOBSERVABLE", "ARM_GEOMETRY_DEGENERATE",
        )
        # 저장용으로 직렬화한 문자열 실행
        json.dumps(record, allow_nan=False)

# 넘친 형상의 관측 불가와 비유한 측정 직렬화 방지 확인
def test_overflowing_geometry_is_unobservable_and_never_serializes_nonfinite_measures():
    # 극단적으로 큰 시험 입력의 1점7의 지수 +308 설정
    huge = 1.7e308
    # 직렬화 기록 준비
    record = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(
            changes={
                5: {"x": huge, "y": huge},
                7: {"x": huge, "y": 0},
                9: {"x": 0, "y": huge},
                11: {"x": 0, "y": 0},
            },
            # 원본 검출 상자 좌표의 호출 조건 지정
            source_box=(0, 0, huge, huge),
        ),
        10**400,
        10**400,
    )[0]
    # 관측 상태과 보류 이유 코드의 기대 자료 일치 확인
    assert (record["state"], record["reasonCode"]) == (
        "UNOBSERVABLE", "ARM_GEOMETRY_NONFINITE",
    )
    # 저장용으로 직렬화한 문자열 실행
    json.dumps(record, allow_nan=False)

# 극소 양수 팔 길이의 각도 분모 언더플로 방지 확인
def test_tiny_nonzero_arm_lengths_do_not_underflow_angle_denominator():
    # 직렬화 기록 준비
    record = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(
            changes={
                5: {"x": 0, "y": 0},
                7: {"x": 1e-200, "y": 0},
                9: {"x": 2e-200, "y": 0},
                11: {"x": 0, "y": 8},
            }
        ),
        160,
        240,
    )[0]
    # 관측 상태 값이 팔을 들지 않은 상태인지 확인
    assert record["state"] == "NOT_RAISED"
    # 팔꿈치 안쪽 각도의 기대 자료 일치 확인
    assert record["elbowInteriorAngleDegrees"] == pytest.approx(180)
    # 어깨와 손목의 수직 각도의 기대 자료 일치 확인
    assert record["shoulderWristVerticalUpAngleDegrees"] == pytest.approx(90)
    # 저장용으로 직렬화한 문자열 실행
    json.dumps(record, allow_nan=False)

# 정확한 최소 몸통 길이의 관측 가능과 유한 측정 확인
def test_exact_minimum_torso_length_is_observable_and_geometry_measures_are_finite():
    # 직렬화 기록 준비
    record = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(changes={11: {"x": 50, "y": 108}}),
        160,
        240,
    )[0]
    # 관측 상태 값이 팔을 든 상태인지 확인
    assert record["state"] == "ARM_RAISED"
    # 화면상의 몸통 길이 값이 8점0인지 확인
    assert record["torsoLengthPx"] == 8.0
    # 직렬화한 관측의 모든 실수 값이 유한한지 확인
    assert all(not isinstance(value, float) or math.isfinite(value) for value in record.values())

# 손목 높이 비율 경계 포함 확인
def test_wrist_height_ratio_boundary_is_inclusive():
    # 경계와 정확히 같은 값 준비
    exact = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(changes={7: {"y": 90}, 9: {"y": 80}}),
        160,
        240,
    )[0]
    # 경계 바로 아래 입력 준비
    below = api().armObservations(
        # 시험 관절 좌표와 신뢰 점수 지정
        pose_observation(changes={7: {"y": 90}, 9: {"y": 80.001}}),
        160,
        240,
    )[0]
    # 몸통 대비 손목 높이 비율 값이 0점25인지 확인
    assert exact["wristAboveShoulderTorsoRatio"] == .25
    # 관측 상태 값이 팔을 든 상태인지 확인
    assert exact["state"] == "ARM_RAISED"
    # 관측 상태 값이 팔을 들지 않은 상태인지 확인
    assert below["state"] == "NOT_RAISED"

# 팔꿈치 내각 경계 포함 확인
@pytest.mark.parametrize("angle,expected", [(150.0, "ARM_RAISED"), (149.99, "NOT_RAISED")])
def test_elbow_interior_angle_boundary_is_inclusive(angle, expected):
    # 라디안으로 변환한 각도 생성
    direction = math.radians(90 + angle)
    # 손목 관절의 시험 항목 구성
    wrist = {"x": 50 + 40 * math.cos(direction), "y": 60 + 40 * math.sin(direction)}
    # 직렬화 기록 준비
    record = api().armObservations(pose_observation(changes={9: wrist}), 160, 240)[0]
    # 팔꿈치 안쪽 각도의 기대 자료 일치 확인
    assert record["elbowInteriorAngleDegrees"] == pytest.approx(angle)
    # 관측 상태의 기대 자료 일치 확인
    assert record["state"] == expected

# 수직 상승 각도 경계 포함 확인
@pytest.mark.parametrize("angle,expected", [(30.0, "ARM_RAISED"), (30.01, "NOT_RAISED")])
def test_vertical_up_angle_boundary_is_inclusive(angle, expected):
    # 라디안으로 변환한 각도 생성
    radians = math.radians(angle)
    # 손목 가로 좌표과 손목 세로 좌표의 시험 항목 구성
    wrist_x, wrist_y = 50 + 80 * math.sin(radians), 100 - 80 * math.cos(radians)
    # 시험별 변경 항목의 시험 항목 구성
    changes = {
        7: {"x": (50 + wrist_x) / 2, "y": (100 + wrist_y) / 2},
        9: {"x": wrist_x, "y": wrist_y},
    }
    # 직렬화 기록 준비
    record = api().armObservations(pose_observation(changes=changes), 160, 240)[0]
    # 어깨와 손목의 수직 각도의 기대 자료 일치 확인
    assert record["shoulderWristVerticalUpAngleDegrees"] == pytest.approx(angle)
    # 관측 상태의 기대 자료 일치 확인
    assert record["state"] == expected

# 적격 구간 종료 시 마지막 관측 근거까지만 추적 출력 확인
def test_tracker_emits_only_when_qualified_run_closes_at_last_observed_support():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 시험 관절 좌표와 신뢰 점수 생성
    raised = pose_observation()
    # 시험 조건의 역할 가설 생성
    referee = role_hypothesis()

    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert tracker.update(recorded_frame(0), (referee,), (raised,)) == ()
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert tracker.update(recorded_frame(100), (referee,), (raised,)) == ()
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert tracker.update(recorded_frame(200), (referee,), (raised,)) == ()
    # 현재 입력을 반영한 누적 관측 생성
    closed = tracker.update(
        recorded_frame(300),
        (referee,),
        (pose_observation(left="not_raised"),),
    )

    # 자원 종료 여부의 개수 값이 1인지 확인
    assert len(closed) == 1
    # 지속 관측 구간 준비
    episode = closed[0]
    # 관측 종류 값이 팔을 든 상태인지 확인
    assert episode["kind"] == "ARM_RAISED"
    # 별도 역할 가설 값이 심판인지 확인
    assert episode["actorRoleHypothesis"] == "referee"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert episode["admission"] == "NOT_ADMITTED"
    # 화면 연속성 식별자 값이 4인지 확인
    assert episode["continuityId"] == 4
    # 추적 식별자의 기대 자료 일치 확인
    assert episode["trackId"] == "person-track-7"
    # 관측한 팔 방향 값이 왼쪽인지 확인
    assert episode["side"] == "LEFT"
    # 구간 시작 시각과 구간 종료 시각 값이 0 · 200 · 200인지 확인
    assert (episode["startMs"], episode["endMs"], episode["confirmedMs"]) == (0, 200, 200)
    # 관측을 뒷받침한 프레임 수 값이 3인지 확인
    assert episode["supportFrameCount"] == 3
    # 구간 시작 프레임의 기대 자료 일치 확인
    assert episode["startFrame"] == recorded_frame(0).sample.as_record()
    # 구간 종료 프레임의 기대 자료 일치 확인
    assert episode["endFrame"] == recorded_frame(200).sample.as_record()
    # 지속 조건 충족 프레임의 기대 자료 일치 확인
    assert episode["confirmedFrame"] == recorded_frame(200).sample.as_record()
    # 보류 이유의 기대 자료 일치 확인
    assert episode["reason"] == "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY"
    # 분석 범위의 기대 자료 일치 확인
    assert episode["scope"] == "NOT_DECLARED_DECISION"
    # 문자열 앞부분 일치 여부의 조건 충족 확인
    assert episode["episodeId"].startswith("arm-raised-observation-")
    # 적격 구간 종료 시 마지막 관측 근거까지만 추적 출력의 부재 또는 비활성 확인
    assert not ({"foul", "decision", "originalDecision"} & set(episode))
    # 저장용으로 직렬화한 문자열 실행
    json.dumps(episode, allow_nan=False)

# 선수·골키퍼·미확정·저신뢰 역할의 사건 출력 방지 확인
@pytest.mark.parametrize("role,status,score", [
    ("player", "MATCHED", .99),
    ("goalkeeper", "MATCHED", .99),
    ("referee", "UNMATCHED", None),
    ("referee", "AMBIGUOUS", None),
    ("referee", "MATCHED", .499999),
])
def test_player_goalkeeper_unknown_and_low_confidence_roles_never_emit(role, status, score):
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 시험 조건의 역할 가설 생성
    hypothesis = role_hypothesis(role=role, status=status, score=score)
    # 선수·골키퍼·미확정·저신뢰 역할의 사건 출력 방지 입력 목록의 항목별 순회
    for timestamp in (0, 100, 200):
        # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
        assert tracker.update(recorded_frame(timestamp), (hypothesis,), (pose_observation(),)) == ()
    # 종료 시점까지 정리한 관측 결과 값이 빈 목록인지 확인
    assert tracker.finish() == ()

# 심판 역할 점수 경계 포함과 미지정 추적 조작 방지 확인
def test_referee_role_score_boundary_is_inclusive_but_untyped_track_is_never_invented():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    admitted = api().ArmSignalTracker()
    # 시험 조건의 역할 가설 생성
    referee = role_hypothesis(score=.50)
    # 심판 역할 점수 경계 포함과 미지정 추적 조작 방지 입력 목록의 항목별 순회
    for timestamp in (0, 100, 200):
        # 채택 상태를 바꾼 관측에 현재 입력 반영
        admitted.update(recorded_frame(timestamp), (referee,), (pose_observation(),))
    # 종료 시점까지 정리한 관측 결과의 개수 값이 1인지 확인
    assert len(admitted.finish()) == 1

    # 여러 프레임의 팔 동작 지속 추적기 생성
    untracked = api().ArmSignalTracker()
    # 식별자 없는 입력의 시험 항목 구성
    no_id = (source_detection(track_id=None),)
    # 심판 역할 점수 경계 포함과 미지정 추적 조작 방지 입력 목록의 항목별 순회
    for timestamp in (0, 100, 200):
        # 추적 식별자 없는 관측에 현재 입력 반영
        untracked.update(
            recorded_frame(timestamp, detections=no_id), (referee,), (pose_observation(),)
        )
    # 종료 시점까지 정리한 관측 결과 값이 빈 목록인지 확인
    assert untracked.finish() == ()

# 지속 시간·프레임 수·개별 간격의 정확한 경계 확인
@pytest.mark.parametrize("timestamps,expected_count,expected_confirmation", [
    ((0, 100, 199), 0, None),
    ((0, 100, 200), 1, 200),
    ((0, 50, 100, 150, 200), 1, 200),
    ((0, 100, 350), 1, 350),
    ((0, 100, 351), 0, None),
])
def test_duration_frame_count_and_each_gap_use_exact_boundaries(
    timestamps,
    expected_count,
    expected_confirmation,
):
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 지속 시간·프레임 수·개별 간격의 정확한 경계 입력 목록의 항목별 순회
    for timestamp in timestamps:
        # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
        assert tracker.update(
            recorded_frame(timestamp), (role_hypothesis(),), (pose_observation(),),
        ) == ()
    # 종료 시점까지 정리한 관측 결과 생성
    episodes = tracker.finish()
    # 지속 관측 구간 목록의 개수의 기대 자료 일치 확인
    assert len(episodes) == expected_count
    # 지속 관측 구간 목록의 조건에 따른 분기
    if episodes:
        # 지속 조건 충족 시각의 기대 자료 일치 확인
        assert episodes[0]["confirmedMs"] == expected_confirmation
        # 관측을 뒷받침한 프레임 수의 기대 자료 일치 확인
        assert episodes[0]["supportFrameCount"] == len(timestamps)

# 반올림된 200밀리초의 실제 미달 지지 구간 인정 방지 확인
def test_rounded_200ms_timestamp_does_not_qualify_only_199_point_6ms_of_pts_support():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 순번을 붙인 시험 자료의 항목별 순회
    for index, (pts, rounded_ms) in enumerate(((0, 0), (1000, 100), (1996, 200))):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(
            recorded_frame(
                rounded_ms,
                # 원본 표시 시각의 호출 조건 지정
                pts=pts,
                # 원본 시작 시각의 호출 조건 지정
                origin_pts=0,
                # 원본 시간 단위의 호출 조건 지정
                time_base=Fraction(1, 10_000),
                record_index=index,
            ),
            (role_hypothesis(),),
            (pose_observation(),),
        )
    # 종료 시점까지 정리한 관측 결과 값이 빈 목록인지 확인
    assert tracker.finish() == ()

# 반올림된 250밀리초의 실제 초과 간격 연결 방지 확인
def test_rounded_250ms_gap_does_not_bridge_an_actual_250_point_4ms_gap():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 순번을 붙인 시험 자료의 항목별 순회
    for index, (pts, rounded_ms) in enumerate(((0, 0), (1000, 100), (3504, 350))):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(
            recorded_frame(
                rounded_ms,
                # 원본 표시 시각의 호출 조건 지정
                pts=pts,
                # 원본 시작 시각의 호출 조건 지정
                origin_pts=0,
                # 원본 시간 단위의 호출 조건 지정
                time_base=Fraction(1, 10_000),
                record_index=index,
            ),
            (role_hypothesis(),),
            (pose_observation(),),
        )
    # 종료 시점까지 정리한 관측 결과 값이 빈 목록인지 확인
    assert tracker.finish() == ()

# 누락·관측 불가 근거의 가림 연결 대신 구간 단절 확인
@pytest.mark.parametrize("break_kind", ["role", "pose", "unobservable"])
def test_missing_or_unobservable_evidence_breaks_instead_of_bridging_occlusion(break_kind):
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 시험 조건의 역할 가설 생성
    referee = role_hypothesis()
    # 시험 관절 좌표와 신뢰 점수 생성
    raised = pose_observation()
    # 시간축 추적기에 현재 입력 반영
    tracker.update(recorded_frame(0), (referee,), (raised,))
    # 시간축 추적기에 현재 입력 반영
    tracker.update(recorded_frame(100), (referee,), (raised,))
    # 역할 관측과 자세 관측 목록의 시험 항목 구성
    roles, poses = (referee,), (raised,)
    # 누락·관측 불가 근거의 가림 연결 대신 구간 단절 입력의 비교 결과별 분기
    if break_kind == "role":
        # 역할 관측의 빈 누적 공간 생성
        roles = ()
    # 누락·관측 불가 근거의 가림 연결 대신 구간 단절 입력의 비교 결과별 분기
    elif break_kind == "pose":
        # 자세 관측 목록의 빈 누적 공간 생성
        poses = ()
    else:
        # 자세 관측 목록의 시험 항목 구성
        poses = (pose_observation(changes={5: {"score": .1}}),)
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert tracker.update(recorded_frame(200), roles, poses) == ()
    # 누락·관측 불가 근거의 가림 연결 대신 구간 단절 입력 목록의 항목별 순회
    for timestamp in (300, 400, 500):
        # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
        assert tracker.update(recorded_frame(timestamp), (referee,), (raised,)) == ()
    # 종료 시점까지 정리한 관측 결과 생성
    episodes = tracker.finish()
    # 지속 관측 구간 목록의 개수 값이 1인지 확인
    assert len(episodes) == 1
    # 구간 시작 시각과 구간 종료 시각 값이 300 · 500인지 확인
    assert (episodes[0]["startMs"], episodes[0]["endMs"]) == (300, 500)
    # 관측을 뒷받침한 프레임 수 값이 3인지 확인
    assert episodes[0]["supportFrameCount"] == 3

# 화면·추적·역할·검출·자세 변경 시 이전 근거에서 구간 종료 확인
@pytest.mark.parametrize("break_kind", ["cut", "track", "role", "missing_detection", "not_raised"])
def test_cut_track_role_detection_or_pose_change_closes_at_prior_support(break_kind):
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 시험 조건의 역할 가설 생성
    referee = role_hypothesis()
    # 시험 관절 좌표와 신뢰 점수 생성
    raised = pose_observation()
    # 화면·추적·역할·검출·자세 변경 시 이전 근거에서 구간 종료 입력 목록의 항목별 순회
    for timestamp in (0, 100, 200):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(recorded_frame(timestamp), (referee,), (raised,))

    # 원본 시간축을 가진 기록 프레임 생성
    frame = recorded_frame(300)
    # 역할 관측과 자세 관측 목록의 시험 항목 구성
    roles, poses = (referee,), (raised,)
    # 화면·추적·역할·검출·자세 변경 시 이전 근거에서 구간 종료 입력의 비교 결과별 분기
    if break_kind == "cut":
        # 원본 시간축을 가진 기록 프레임 생성
        frame = recorded_frame(300, continuity_id=5)
    # 화면·추적·역할·검출·자세 변경 시 이전 근거에서 구간 종료 입력의 비교 결과별 분기
    elif break_kind == "track":
        # 원본 시간축을 가진 기록 프레임 생성
        frame = recorded_frame(300, detections=(source_detection(track_id="person-track-8"),))
    # 화면·추적·역할·검출·자세 변경 시 이전 근거에서 구간 종료 입력의 비교 결과별 분기
    elif break_kind == "role":
        # 역할 관측의 시험 항목 구성
        roles = (role_hypothesis(role="player"),)
    # 화면·추적·역할·검출·자세 변경 시 이전 근거에서 구간 종료 입력의 비교 결과별 분기
    elif break_kind == "missing_detection":
        # 원본 시간축을 가진 기록 프레임 생성
        frame = recorded_frame(300, detections=())
        # 역할 관측과 자세 관측 목록의 시험 항목 구성
        roles, poses = (), ()
    else:
        # 자세 관측 목록의 시험 항목 구성
        poses = (pose_observation(left="not_raised"),)

    # 현재 입력을 반영한 누적 관측 생성
    episodes = tracker.update(frame, roles, poses)
    # 지속 관측 구간 목록의 개수 값이 1인지 확인
    assert len(episodes) == 1
    # 구간 종료 시각 값이 200인지 확인
    assert episodes[0]["endMs"] == 200
    # 밀리초 원본 시각 값이 200인지 확인
    assert episodes[0]["endFrame"]["timestampMs"] == 200

# 모호하거나 다른 프레임에 속한 대응 거부 확인
@pytest.mark.parametrize("case,reason", [
    ("duplicate_detection", "DUPLICATE_DETECTION_ID"),
    ("duplicate_role", "DUPLICATE_ROLE_ID"),
    ("duplicate_pose", "DUPLICATE_POSE_ID"),
    ("foreign_role", "FOREIGN_ROLE_ID"),
    ("foreign_pose", "FOREIGN_POSE_ID"),
    ("role_on_ball", "ROLE_NONPERSON_MAPPING"),
    ("pose_on_ball", "POSE_NONPERSON_MAPPING"),
    ("box_mismatch", "POSE_SOURCE_BOX_MISMATCH"),
])
def test_tracker_rejects_ambiguous_or_foreign_frame_local_mappings(case, reason):
    # 검출 목록의 시험 항목 구성
    detections = (source_detection(),)
    # 역할 관측의 시험 항목 구성
    roles = (role_hypothesis(),)
    # 자세 관측 목록의 시험 항목 구성
    poses = (pose_observation(),)
    # 시험 분기의 비교 결과별 분기
    if case == "duplicate_detection":
        # 검출 목록의 시험 항목 구성
        detections = (source_detection(), source_detection())
    # 시험 분기의 비교 결과별 분기
    elif case == "duplicate_role":
        # 역할 관측의 시험 항목 구성
        roles = (role_hypothesis(), role_hypothesis())
    # 시험 분기의 비교 결과별 분기
    elif case == "duplicate_pose":
        # 자세 관측 목록의 시험 항목 구성
        poses = (pose_observation(), pose_observation())
    # 시험 분기의 비교 결과별 분기
    elif case == "foreign_role":
        # 역할 관측 준비
        roles = roles + (role_hypothesis(99, status="UNMATCHED"),)
    # 시험 분기의 비교 결과별 분기
    elif case == "foreign_pose":
        # 자세 관측 목록 준비
        poses = poses + (pose_observation(99),)
    # 시험 분기의 비교 결과별 분기
    elif case == "role_on_ball":
        # 검출 목록의 시험 항목 구성
        detections = (source_detection(label="sports ball"),)
        # 자세 관측 목록의 빈 누적 공간 생성
        poses = ()
    # 시험 분기의 비교 결과별 분기
    elif case == "pose_on_ball":
        # 검출 목록의 시험 항목 구성
        detections = (source_detection(label="sports ball"),)
        # 역할 관측의 빈 누적 공간 생성
        roles = ()
    else:
        # 자세 관측 목록의 시험 항목 구성
        poses = (pose_observation(source_box=(21, 10, 140, 220)),)
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match=reason):
        # 여러 프레임의 팔 동작 지속 추적기에 현재 입력 반영
        api().ArmSignalTracker().update(recorded_frame(0, detections=detections), roles, poses)

# 동일 역할 검출의 두 원본 사람 연결 방지 확인
def test_same_role_detection_cannot_be_matched_to_two_source_people():
    # 검출 목록의 시험 항목 구성
    detections = (source_detection(0, track_id="track-0"), source_detection(1, track_id="track-1"))
    # 역할 관측의 시험 항목 구성
    roles = (
        # 심판 후보의 상자와 점수 지정
        RoleHypothesis(0, "MATCHED", "referee", 0.9, 12, 0.8),
        # 심판 후보의 상자와 점수 지정
        RoleHypothesis(1, "MATCHED", "referee", 0.9, 12, 0.8),
    )
    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="DUPLICATE_ROLE_DETECTION_ID"):
        # 여러 프레임의 팔 동작 지속 추적기에 현재 입력 반영
        api().ArmSignalTracker().update(recorded_frame(0, detections=detections), roles, ())

# 중복 사람 추적 식별자의 이중 집계 대신 거부 확인
def test_duplicate_person_track_ids_are_rejected_instead_of_counted_twice():
    # 검출 목록의 시험 항목 구성
    detections = (source_detection(0), source_detection(1))
    # 추적 식별 오류 발생 기대
    with pytest.raises(ValueError, match="DUPLICATE_TRACK_ID"):
        # 여러 프레임의 팔 동작 지속 추적기에 현재 입력 반영
        api().ArmSignalTracker().update(recorded_frame(0, detections=detections), (), ())

# 동일 추적 조각 지속 중 프레임별 검출 식별자 변경 허용 확인
def test_frame_local_detection_id_can_change_while_same_track_fragment_continues():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 동일 추적 조각 지속 중 프레임별 검출 식별자 변경 허용 입력 목록의 항목별 순회
    for timestamp, detection_id in ((0, 0), (100, 1), (200, 2)):
        # 원본 프레임의 검출 관측 생성
        detection = source_detection(detection_id)
        # 시간축 추적기에 현재 입력 반영
        tracker.update(
            recorded_frame(timestamp, detections=(detection,)),
            (role_hypothesis(detection_id),),
            (pose_observation(detection_id),),
        )
    # 종료 시점까지 정리한 관측 결과 생성
    episode, = tracker.finish()
    # 관측을 뒷받침한 프레임 수 값이 3인지 확인
    assert episode["supportFrameCount"] == 3
    # 구간 시작 시각과 구간 종료 시각 값이 0 · 200인지 확인
    assert (episode["startMs"], episode["endMs"]) == (0, 200)

# 상한 초과 간격의 현재 관측 전 적격 구간 종료 확인
def test_gap_over_limit_closes_qualified_run_before_current_observation():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 상한 초과 간격의 현재 관측 전 적격 구간 종료 입력 목록의 항목별 순회
    for timestamp in (0, 100, 200):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(recorded_frame(timestamp), (role_hypothesis(),), (pose_observation(),))
    # 현재 입력을 반영한 누적 관측 생성
    (episode,) = tracker.update(
        recorded_frame(451),
        (role_hypothesis(),),
        (pose_observation(),),
    )
    # 구간 시작 시각과 구간 종료 시각 값이 0 · 200 · 3인지 확인
    assert (episode["startMs"], episode["endMs"], episode["supportFrameCount"]) == (0, 200, 3)
    # 종료 시점까지 정리한 관측 결과 값이 빈 목록인지 확인
    assert tracker.finish() == ()

# 중복·역행 시각의 구간 연장 대신 실패 확인
@pytest.mark.parametrize("second_timestamp", [100, 99])
def test_duplicate_or_backward_timestamps_fail_instead_of_extending_a_run(second_timestamp):
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 시간축 추적기에 현재 입력 반영
    tracker.update(recorded_frame(100), (role_hypothesis(),), (pose_observation(),))
    # 원본 시간축 순서 오류 발생 기대
    with pytest.raises(ValueError, match="TIMELINE_NON_MONOTONIC"):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(
            recorded_frame(second_timestamp, record_index=2),
            (role_hypothesis(),),
            (pose_observation(),),
        )

# 시각과 정확한 원본 시간 기준·시작점 관계 일치 요구 확인
def test_timestamp_must_match_exact_pts_timebase_and_origin_relation():
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="FRAME_TIMESTAMP_PTS_MISMATCH"):
        # 여러 프레임의 팔 동작 지속 추적기에 현재 입력 반영
        api().ArmSignalTracker().update(
            recorded_frame(100, pts=10_099),
            (role_hypothesis(),),
            (pose_observation(),),
        )

# 추적기의 원본 범위 변경 거부 확인
@pytest.mark.parametrize("change", ["stream", "origin"])
def test_tracker_rejects_a_source_scope_change(change):
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 시간축 추적기에 현재 입력 반영
    tracker.update(recorded_frame(0), (role_hypothesis(),), (pose_observation(),))
    # 전달된 선택 인자의 시험 조건별 값 선택
    kwargs = {"stream_index": 3} if change == "stream" else {"origin_pts": 20_000}
    # 원본 일치 오류 발생 기대
    with pytest.raises(ValueError, match="SOURCE_SCOPE_CHANGED"):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(
            recorded_frame(100, **kwargs),
            (role_hypothesis(),),
            (pose_observation(),),
        )

# 적격 구간 단일 마감과 마감 후 갱신 거부 확인
def test_finish_flushes_qualified_runs_once_and_update_after_finish_is_rejected():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 적격 구간 단일 마감과 마감 후 갱신 거부 입력 목록의 항목별 순회
    for timestamp in (0, 100, 200):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(recorded_frame(timestamp), (role_hypothesis(),), (pose_observation(),))
    # 종료 시점까지 정리한 관측 결과 생성
    first = tracker.finish()
    # 첫 번째 관측의 개수 값이 1인지 확인
    assert len(first) == 1
    # 구간 종료 시각 값이 200인지 확인
    assert first[0]["endMs"] == 200
    # 종료 시점까지 정리한 관측 결과 값이 빈 목록인지 확인
    assert tracker.finish() == ()
    # 추적 식별 오류 발생 기대
    with pytest.raises(ValueError, match="TRACKER_FINISHED"):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(recorded_frame(300), (role_hypothesis(),), (pose_observation(),))

# 동일 원본 범위의 안정적 사건 식별과 좌우 구분 확인
def test_episode_ids_are_stable_for_the_same_scoped_source_and_distinct_per_side():

    # 단일 실행 결과 반환
    def run_once():
        # 여러 프레임의 팔 동작 지속 추적기 생성
        tracker = api().ArmSignalTracker()
        # 시험 관절 좌표와 신뢰 점수 생성
        both = pose_observation(right="raised")
        # 단일 실행 결과 입력 목록의 항목별 순회
        for timestamp in (0, 100, 200):
            # 시간축 추적기에 현재 입력 반영
            tracker.update(recorded_frame(timestamp), (role_hypothesis(),), (both,))
        # 종료 시점까지 정리한 관측 결과 반환
        return tracker.finish()

    # 첫 번째 관측과 두 번째 관측의 시험 항목 구성
    first, second = run_once(), run_once()
    # 지속 관측 구간 식별자 목록의 기대 자료 일치 확인
    assert [item["episodeId"] for item in first] == [item["episodeId"] for item in second]
    # 지속 관측 구간 식별자 목록의 개수 값이 2인지 확인
    assert len({item["episodeId"] for item in first}) == 2
    # 관측한 팔 방향 목록 값이 왼쪽 · 오른쪽인지 확인
    assert [item["side"] for item in first] == ["LEFT", "RIGHT"]

# 현재 활성 추적 조각으로 추적기 상태 제한 확인
def test_tracker_state_stays_bounded_to_current_active_track_fragments():
    # 여러 프레임의 팔 동작 지속 추적기 생성
    tracker = api().ArmSignalTracker()
    # 반복할 순번 범위의 항목별 순회
    for index in range(500):
        # 원본 프레임의 검출 관측 생성
        detection = source_detection(track_id=f"track-{index}")
        # 시간축 추적기에 현재 입력 반영
        tracker.update(
            recorded_frame(index * 100, detections=(detection,), record_index=index),
            (role_hypothesis(),),
            (pose_observation(),),
        )
        # 현재 활성 추적 조각으로 추적기 상태 제한의 개수 값이 1인지 확인
        assert len(tracker._active) == 1
    # 종료 시점까지 정리한 관측 결과 값이 빈 목록인지 확인
    assert tracker.finish() == ()
