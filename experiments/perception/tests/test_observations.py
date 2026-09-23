# 불변 관측 복사와 수정 오류 도구 읽음
from dataclasses import FrozenInstanceError
# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 기록 직렬화와 읽기 도구 읽음
import json
# 각도와 비유한 수치 시험 도구 읽음
import math
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest

# 인터페이스 반환
def api():
    # 검사할 인식 구현 모듈 반환
    return importlib.import_module("replay_perception.observations")

# 관절점 생성
def points():
    # 검사할 인식 모듈 읽음
    module = api()
    # 좌표와 점수를 가진 단일 관절 목록의 비교 자료 반환
    return tuple(
        module.Keypoint(index, name, 20 + index, 40 + index, 0.8)
        for index, name in enumerate(module.KEYPOINT_NAMES)
    )

# 역할 검출의 분리와 불변성 확인
def test_role_detection_is_separate_and_immutable():
    # 역할 모델의 상자와 점수 관측 생성
    value = api().RoleDetection(2, "referee", (10, 20, 30, 90), .8)
    # 저장 계약에 맞춘 직렬화 자료의 기대 자료 일치 확인
    assert value.as_record() == {
        # 역할 가설의 심판 시험값 지정
        "roleDetectionId": 2, "role": "referee", "box": [10., 20., 30., 90.],
        # 검출 신뢰 점수의 0점8 시험값 지정
        "score": .8, "source": "MODEL_ROLE_DETECTION",
    }
    # 불변 자료 수정 오류 발생 기대
    with pytest.raises(FrozenInstanceError):
        # 역할 가설의 선수 설정
        value.role = "player"

# 역할 검출의 잘못된 값 거부 확인
@pytest.mark.parametrize("changes", [
    {"role_detection_id": True}, {"role_detection_id": -1}, {"role": "assistant referee"},
    {"box": (0, 0, 0, 10)}, {"box": (-1, 0, 10, 20)}, {"box": (0, 0, math.inf, 20)},
    {"box": [0, 0, 10, 20]}, {"score": math.nan}, {"score": 1.1}, {"score": True},
])
def test_role_detection_rejects_invalid_values(changes):
    # 키별로 모은 자료 생성
    kwargs = dict(role_detection_id=0, role="player", box=(0, 0, 10, 20), score=.5)
    # 전달된 선택 인자에 현재 입력 반영
    kwargs.update(changes)
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 역할 모델의 상자와 점수 관측 실행
        api().RoleDetection(**kwargs)

# 미연결 역할의 기본값 보충 방지 확인
def test_unmatched_role_does_not_supply_defaults():
    # 저장 계약에 맞춘 직렬화 자료 생성
    record = api().RoleHypothesis(9, "UNMATCHED").as_record()
    # 역할 가설 부재 확인
    assert record["role"] is None
    # 검출 신뢰 점수 부재 확인
    assert record["score"] is None
    # 역할 검출 식별자 부재 확인
    assert record["roleDetectionId"] is None
    # 상자 겹침 비율 부재 확인
    assert record["iou"] is None
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert record["admission"] == "NOT_ADMITTED"

# 역할 가설 필드 일관성 요구 확인
@pytest.mark.parametrize("kwargs", [
    dict(detection_id=0, status="MATCHED"),
    dict(detection_id=0, status="UNMATCHED", role="referee"),
    dict(detection_id=0, status="AMBIGUOUS", score=.6),
    dict(detection_id=0, status="CONFIRMED"),
    dict(detection_id=True, status="UNMATCHED"),
    dict(detection_id=0, status="MATCHED", role="ball", score=.9, role_detection_id=0, iou=.8),
    dict(detection_id=0, status="MATCHED", role="referee", score=.9, role_detection_id=0, iou=2),
])
def test_role_hypothesis_requires_consistent_fields(kwargs):
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 원시 검출과 분리된 역할 가설 실행
        api().RoleHypothesis(**kwargs)

# 연결된 역할의 점수와 겹침 분리 확인
def test_matched_role_keeps_score_and_overlap_distinct():
    # 원시 검출과 분리된 역할 가설 생성
    value = api().RoleHypothesis(5, "MATCHED", "referee", .7, 2, .9)
    # 검출 신뢰 점수 값이 0점7인지 확인
    assert value.as_record()["score"] == .7
    # 상자 겹침 비율 값이 0점9인지 확인
    assert value.as_record()["iou"] == .9
    # 원본 입력의 기대 자료 일치 확인
    assert value.as_record()["source"] == "MODEL_ROLE_ASSOCIATION"

# 관절점의 원시 외부 좌표와 비제한 열지도 점수 보존 확인
def test_keypoints_preserve_raw_outside_coordinates_and_unbounded_heatmap_score():
    # 좌표와 점수를 가진 단일 관절 생성
    point = api().Keypoint(0, "Nose", -2.5, 1200.5, 1.2)
    # 저장 계약에 맞춘 직렬화 자료의 기대 자료 일치 확인
    assert point.as_record() == {"index": 0, "name": "Nose", "x": -2.5, "y": 1200.5, "score": 1.2}

# 관절점의 손상된 대응과 비유한 값 거부 확인
@pytest.mark.parametrize("args", [
    (-1, "Nose", 0, 0, .5), (True, "Nose", 0, 0, .5), (0, "L_Wrist", 0, 0, .5),
    (0, "Nose", math.nan, 0, .5), (0, "Nose", 0, math.inf, .5),
    (0, "Nose", 0, 0, math.inf), (0, "Nose", True, 0, .5),
])
def test_keypoint_rejects_corrupt_mapping_and_nonfinite_values(args):
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 좌표와 점수를 가진 단일 관절 실행
        api().Keypoint(*args)

# 정확한 원본 변환과 모든 관절점 기록 확인
def test_pose_records_exact_source_transform_and_all_keypoints():
    # 원본 상자와 관절 좌표를 가진 자세 관측 생성
    pose = api().PoseObservation(4, (10, 20, 90, 220), points(), ((2., 0., -20.), (0., 2., -40.)))
    # 저장 계약에 맞춘 직렬화 자료 생성
    record = pose.as_record()
    # 직렬화한 모델 입력 크기가 너비 192와 높이 256인지 확인
    assert record["inputSize"] == {"width": 192, "height": 256}
    # 원본에서 모델 입력으로의 변환의 기대 자료 일치 확인
    assert record["sourceToInput"] == [[2., 0., -20.], [0., 2., -40.]]
    # 원본 검출 식별자 값이 4인지 확인
    assert record["detectionId"] == 4
    # 원본 입력의 기대 자료 일치 확인
    assert record["source"] == "MODEL_POSE"
    # 관절 좌표와 점수의 개수 값이 17인지 확인
    assert len(record["keypoints"]) == 17
    # 저장용으로 직렬화한 문자열 실행
    json.dumps(record, allow_nan=False)

# 대응 누락과 잘못된 자세 변환 거부 확인
@pytest.mark.parametrize(
    "case",
    [
        "missing",
        "duplicate",
        "reordered",
        "matrix_nan",
        "matrix_shape",
        "matrix_singular",
        "bad_size",
    ],
)
def test_pose_rejects_missing_mapping_or_invalid_transform(case):
    # 시험 관절 좌표 목록 생성
    keypoints = points()
    # 좌표 변환 행렬의 시험 항목 구성
    matrix = ((1., 0., 0.), (0., 1., 0.))
    # 파일 크기의 시험 항목 구성
    size = (192, 256)
    # 시험 분기의 비교 결과별 분기
    if case == "missing":
        # 관절 좌표와 점수 준비
        keypoints = keypoints[:-1]
    # 시험 분기의 비교 결과별 분기
    elif case == "duplicate":
        # 관절 좌표와 점수 준비
        keypoints = keypoints[:-1] + (keypoints[0],)
    # 시험 분기의 비교 결과별 분기
    elif case == "reordered":
        # 역순으로 배치한 관측 목록의 비교 자료 생성
        keypoints = tuple(reversed(keypoints))
    # 시험 분기의 비교 결과별 분기
    elif case == "matrix_nan":
        # 좌표 변환 행렬의 시험 항목 구성
        matrix = ((math.nan, 0., 0.), (0., 1., 0.))
    # 시험 분기의 비교 결과별 분기
    elif case == "matrix_shape":
        # 좌표 변환 행렬의 시험 항목 구성
        matrix = ((1., 0.), (0., 1.))
    # 시험 분기의 비교 결과별 분기
    elif case == "matrix_singular":
        # 좌표 변환 행렬의 시험 항목 구성
        matrix = ((0., 0., 0.), (0., 0., 0.))
    # 시험 분기의 비교 결과별 분기
    elif case == "bad_size":
        # 파일 크기의 시험 항목 구성
        size = (True, 0)
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 원본 상자와 관절 좌표를 가진 자세 관측 실행
        api().PoseObservation(0, (0, 0, 100, 200), keypoints, matrix, size)

# 모든 수치 필드의 유한 직렬화 값 정규화 확인
def test_all_numeric_fields_normalize_to_finite_json_values():
    # 원본 시간축의 정확한 분수 도구 읽음
    from fractions import Fraction

    # 좌표와 점수를 가진 단일 관절 생성
    point = api().Keypoint(0, "Nose", Fraction(1, 3), 10, Fraction(4, 5))
    # 검사 대상의 자료형의 기대 자료 일치 확인
    assert type(point.x) is float
    # 검출 신뢰 점수 값이 0점8인지 확인
    assert json.loads(json.dumps(point.as_record()))["score"] == .8
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 좌표와 점수를 가진 단일 관절 실행
        api().Keypoint(0, "Nose", 10 ** 1000, 0, .5)

# 행렬식 언더플로·오버플로에서도 유한 가역 변환 유지 확인
@pytest.mark.parametrize("scale", [1e-200, 1e200])
def test_finite_invertible_transform_survives_determinant_underflow_and_overflow(scale):
    # 좌표 변환의 시험 항목 구성
    transform = ((scale, 0., 0.), (0., scale, 0.))
    # 원본 상자와 관절 좌표를 가진 자세 관측 생성
    pose = api().PoseObservation(0, (0, 0, 100, 200), points(), transform)
    # 원본에서 입력으로의 변환 행렬이 제공한 행렬과 같은지 확인
    assert pose.source_to_input == transform
