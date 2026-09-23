# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import RoleDetection

# 역할 연결 실행
def assign(*args):
    # 사람 검출과 역할 후보의 겹침에 따른 연결 결과 반환
    return importlib.import_module('replay_perception.matching').assignments(*args)

# 사람 검출 생성
def person(identifier=1, box=(10, 20, 30, 100)):
    # 상자와 점수를 가진 원시 검출 반환
    return Detection(identifier, "person", box, .9, f"1:1:person:{identifier}")

# 원시 사람 상자·점수와 미검증 역할 보존 확인
def test_matching_preserves_raw_person_box_score_and_unproven_role():
    # 고정 상자와 점수를 가진 사람 검출 생성
    source = person()
    # 저장 계약에 맞춘 직렬화 자료 생성
    before = source.as_record()
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign((source,), (RoleDetection(8, "referee", source.box, .7),))
    # 역할 가설 값이 심판인지 확인
    assert result[0].as_record()["role"] == "referee"
    # 역할 검출 식별자 값이 8인지 확인
    assert result[0].role_detection_id == 8
    # 검출 신뢰 점수 값이 0점7인지 확인
    assert result[0].score == .7
    # 상자 겹침 비율 값이 1점0인지 확인
    assert result[0].iou == 1.
    # 저장 계약에 맞춘 직렬화 자료의 기대 자료 일치 확인
    assert source.as_record() == before
    # 원시 검출의 행위자 역할 값이 검증되지 않은 역할인지 확인
    assert source.as_record()["actorRole"] == "UNPROVEN"

# 원본 사람 순서 유지와 원시 공 제외 확인
def test_matching_keeps_original_person_order_and_excludes_raw_ball():
    # 고정 상자와 점수를 가진 사람 검출 생성
    second = person(20, (100, 20, 120, 100))
    # 상자와 점수를 가진 원시 검출 생성
    ball = Detection(99, "sports ball", (0, 0, 2, 2), .8)
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign(
        (second, ball, person(1)),
        (
            # 심판 후보의 상자와 점수 지정
            RoleDetection(0, "referee", person().box, 0.8),
            # 선수 후보의 상자와 점수 지정
            RoleDetection(3, "player", second.box, 0.9),
            # 공 후보의 상자와 점수 지정
            RoleDetection(9, "ball", ball.box, 0.9),
        ),
    )
    # 검출 식별자 목록의 비교 자료 값이 20 · 1인지 확인
    assert tuple(item.detection_id for item in result) == (20, 1)
    # 역할 가설 목록의 비교 자료 값이 선수 · 심판인지 확인
    assert tuple(item.role for item in result) == ("player", "referee")

# 누락·저점수·위치 불일치·공 역할의 미확정 유지 확인
@pytest.mark.parametrize("roles", [
    (), (RoleDetection(0, "referee", (200, 20, 220, 100), .9),),
    (RoleDetection(0, "referee", (10, 20, 30, 100), .499),),
    (RoleDetection(0, "ball", (10, 20, 30, 100), .9),),
])
def test_missing_low_score_wrong_place_or_ball_role_stays_unknown(roles):
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign((person(),), roles)
    # 처리 상태 값이 연결되지 않은 상태인지 확인
    assert result[0].status == "UNMATCHED"
    # 역할 가설 부재 확인
    assert result[0].role is None

# 한 사람의 동등 역할 후보 모호성 확인
def test_equal_roles_on_one_person_are_ambiguous():
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign(
        (person(),),
        (
            # 심판 후보의 상자와 점수 지정
            RoleDetection(0, "referee", person().box, 0.99),
            # 골키퍼 후보의 상자와 점수 지정
            RoleDetection(1, "goalkeeper", person().box, 0.7),
        ),
    )
    # 처리 상태 값이 연결이 모호한 상태인지 확인
    assert result[0].status == "AMBIGUOUS"
    # 역할 가설 부재 확인
    assert result[0].role is None

# 중복 사람 사이 역할 검출 공유 방지 확인
def test_two_duplicate_people_cannot_share_one_role_detection():
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign((person(1), person(2)), (RoleDetection(0, "referee", person().box, .9),))
    # 처리 상태 목록의 비교 자료 값이 연결이 모호한 상태 · 연결이 모호한 상태인지 확인
    assert tuple(item.status for item in result) == ("AMBIGUOUS", "AMBIGUOUS")

# 최선 역할 후보의 최소 겹침 차이 요구 확인
def test_best_role_candidate_requires_minimum_overlap_margin():
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign(
        (person(),),
        (
            # 심판 후보의 상자와 점수 지정
            RoleDetection(0, "referee", person().box, 0.9),
            # 선수 후보의 상자와 점수 지정
            RoleDetection(1, "player", (10, 20, 30, 104), 0.9),
        ),
    )
    # 처리 상태 값이 연결이 모호한 상태인지 확인
    assert result[0].status == "AMBIGUOUS"

# 점수 경계의 유일한 최선 역할 연결 확인
def test_unique_best_match_uses_role_at_exact_score_boundary():
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign(
        (person(),),
        (
            # 심판 후보의 상자와 점수 지정
            RoleDetection(0, "referee", person().box, 0.5),
            # 선수 후보의 상자와 점수 지정
            RoleDetection(1, "player", (15, 20, 35, 100), 0.9),
        ),
    )
    # 처리 상태 값이 유일하게 연결된 상태인지 확인
    assert result[0].status == "MATCHED"
    # 역할 가설 값이 심판인지 확인
    assert result[0].role == "referee"

# 정확한 겹침 비율 경계 허용 확인
def test_exact_iou_boundary_is_allowed():
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign((person(),), (RoleDetection(0, "referee", (10, 20, 30, 180), .8),))
    # 처리 상태 값이 유일하게 연결된 상태인지 확인
    assert result[0].status == "MATCHED"
    # 상자 겹침 비율의 기대 자료 일치 확인
    assert result[0].iou == pytest.approx(.5)

# 빈 사람 목록의 역할 가설 부재 확인
def test_empty_people_produces_no_hypotheses():
    # 사람 검출과 역할 후보의 연결 결과 값이 빈 목록인지 확인
    assert assign((), ()) == ()

# 중복 식별자와 잘못된 타입 거부 확인
@pytest.mark.parametrize("case", ["people", "roles", "wrong_person_type", "wrong_role_type"])
def test_duplicate_ids_and_invalid_types_are_rejected(case):
    # 사람 검출 목록의 시험 항목 구성
    people = (person(),)
    # 역할 관측의 시험 항목 구성
    roles = (RoleDetection(0, "referee", person().box, .9),)
    # 시험 분기의 비교 결과별 분기
    if case == "people":
        # 사람 검출 목록의 시험 항목 구성
        people = (person(), person())
    # 시험 분기의 비교 결과별 분기
    elif case == "roles":
        # 역할 관측 준비
        roles = roles + roles
    # 시험 분기의 비교 결과별 분기
    elif case == "wrong_person_type":
        # 사람 검출 목록의 시험 항목 구성
        people = (object(),)
    else:
        # 역할 관측의 시험 항목 구성
        roles = (object(),)
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError):
        # 사람 검출과 역할 후보의 연결 결과 실행
        assign(people, roles)

# 유한 상자의 겹침 계산 넘침 방지 확인
def test_iou_does_not_overflow_finite_boxes():
    # 고정 상자와 점수를 가진 사람 검출 생성
    source = person(box=(0, 0, 1e200, 1e200))
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign((source,), (RoleDetection(0, "referee", source.box, .9),))
    # 상자 겹침 비율 값이 1점0인지 확인
    assert result[0].iou == 1.

# 동일한 비등방 상자의 겹침 비율 1 유지 확인
@pytest.mark.parametrize("box", [(0, 0, 1e-200, 1e200), (0, 0, 1e200, 1e-200)])
def test_identical_anisotropic_boxes_keep_iou_one(box):
    # 고정 상자와 점수를 가진 사람 검출 생성
    source = person(box=box)
    # 사람 검출과 역할 후보의 연결 결과 생성
    result = assign((source,), (RoleDetection(0, "referee", source.box, .9),))
    # 처리 상태 값이 유일하게 연결된 상태인지 확인
    assert result[0].status == "MATCHED"
    # 상자 겹침 비율 값이 1점0인지 확인
    assert result[0].iou == 1.
