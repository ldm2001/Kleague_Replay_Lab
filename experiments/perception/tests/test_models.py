# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 각도와 비유한 수치 시험 도구 읽음
import math
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest

# 검출 자료 생성
def make_detection(*args, **kwargs):
    # 검출 자료의 실패 가능 구간 처리
    try:
        # 검출 자료 입력 준비
        constructor = importlib.import_module("replay_perception.models").Detection
    except ModuleNotFoundError:
        # 검출 자료의 금지 경로 실행 실패 처리
        pytest.fail("The neutral detection contract is not implemented")
    # 검출 자료 결과 반환
    return constructor(*args, **kwargs)

# 모델 관측과 미검증 역할만 기록 확인
def test_detection_records_only_model_observation_and_unproven_role():
    # 검출 자료 계약에 맞춘 시험 관측 생성
    value = make_detection(0, "person", (1, 2, 10, 20), .8)
    # 저장 계약에 맞춘 직렬화 자료의 기대 자료 일치 확인
    assert value.as_record() == {
        # 검출 분류명의 사람 시험값 지정
        "detectionId": 0, "label": "person", "box": [1.0, 2.0, 10.0, 20.0],
        # 검출 신뢰 점수의 0점8 시험값 지정
        "score": .8, "trackId": None, "actorRole": "UNPROVEN", "source": "MODEL_DETECTION",
    }

# 잘못된 상자 거부 확인
@pytest.mark.parametrize(
    "box",
    [
        (20, 0, 10, 30),
        (0, 1, 10, 1),
        (-1, 0, 10, 20),
        (0, 0, math.nan, 20),
        (0, 0, 10, math.inf),
        (0, 0, 10),
        (False, 0, 10, 20),
    ],
)
def test_invalid_box_is_rejected(box):
    # 검출 상자 오류 발생 기대
    with pytest.raises(ValueError, match="DETECTION_BOX_INVALID"):
        # 검출 자료 계약에 맞춘 시험 관측 실행
        make_detection(0, "person", box, .8)

# 잘못된 점수 거부 확인
@pytest.mark.parametrize("score", [-.01, 1.01, math.nan, math.inf, True, "0.9"])
def test_invalid_score_is_rejected(score):
    # 신뢰 점수 오류 발생 기대
    with pytest.raises(ValueError, match="DETECTION_SCORE_INVALID"):
        # 검출 자료 계약에 맞춘 시험 관측 실행
        make_detection(0, "person", (0, 0, 10, 20), score)

# 프레임별 정수 검출 식별자 확인
@pytest.mark.parametrize("identifier", [-1, True, 1.5, "1"])
def test_detection_identifier_is_frame_local_integer(identifier):
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="DETECTION_ID_INVALID"):
        # 검출 자료 계약에 맞춘 시험 관측 실행
        make_detection(identifier, "person", (0, 0, 10, 20), .8)

# 모델 라벨의 역할·축구 사실 승격 방지 확인
@pytest.mark.parametrize("label", ["referee", "player", "FOUL", "ball"])
def test_model_labels_are_not_promoted_to_roles_or_soccer_facts(label):
    # 분류명 오류 발생 기대
    with pytest.raises(ValueError, match="DETECTION_LABEL_INVALID"):
        # 검출 자료 계약에 맞춘 시험 관측 실행
        make_detection(0, label, (0, 0, 10, 20), .8)

# 추적 중 원시 검출의 불변성 확인
def test_tracking_keeps_the_raw_detection_immutable():
    # 불변 관측 복사와 수정 오류 도구 읽음
    from dataclasses import FrozenInstanceError, replace
    # 검출 자료 계약에 맞춘 시험 관측 생성
    value = make_detection(3, "sports ball", (1, 1, 8, 8), .4)
    # 지정 필드만 바꾼 시험 관측 생성
    tracked = replace(value, track_id="0:sports ball:1")
    # 추적 식별자 부재 확인
    assert value.track_id is None
    # 검출 상자 좌표의 기대 자료 일치 확인
    assert tracked.box == value.box
    # 검출 신뢰 점수의 기대 자료 일치 확인
    assert tracked.score == value.score
    # 불변 자료 수정 오류 발생 기대
    with pytest.raises(FrozenInstanceError):
        # 검출 분류명의 심판 설정
        tracked.label = "referee"

# 잘못된 추적 식별자 거부 확인
@pytest.mark.parametrize("identifier", ["", 1, True])
def test_malformed_tracking_identifier_is_rejected(identifier):
    # 추적 식별 오류 발생 기대
    with pytest.raises(ValueError, match="TRACK_ID_INVALID"):
        # 검출 자료 계약에 맞춘 시험 관측 실행
        make_detection(0, "person", (0, 0, 10, 20), .8, identifier)

# 실수 정규화 후 상자 양수 유지 확인
def test_box_must_remain_positive_after_float_normalization():
    # 원본 시간축의 정확한 분수 도구 읽음
    from fractions import Fraction
    # 검출 상자 오류 발생 기대
    with pytest.raises(ValueError, match="DETECTION_BOX_INVALID"):
        # 검출 자료 계약에 맞춘 시험 관측 실행
        make_detection(0, "person", (Fraction(1), 0, Fraction(1) + Fraction(1, 10**20), 1), .9)
