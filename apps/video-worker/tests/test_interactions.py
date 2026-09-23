from copy import deepcopy
import importlib
import pytest
from fixtures.interaction import frame

# 측정 생성기 반환
def builder():
    # 관측과 사실 판단을 분리하는 상호작용 관측기 반환
    return importlib.import_module('replay_video.domain.interactions').InteractionObservations(
        "a" * 64
    )

# 중립 관측 쌍과 역순 중복 제거 확인
def test_pair_is_neutral_and_reverse_pair_deduplicated():
    # 화면 좌표 기반 참여자 관측기 생성
    engine = builder()
    # 동일 화면에 두 사람이 있는 정상 프레임 준비
    value = frame()
    # 상호작용 관측 목록에 이번 항목 추가
    value["interactions"].append({**value["interactions"][0], "actorTrackIds": ["t1", "t2"]})
    # 재개 상태 전이기에 입력을 반영하여 상태 갱신
    rows = engine.update(value, "shot-0")
    # 기록 행 목록의 개수가 1과 일치하는지 확인
    assert len(rows) == 1
    # 기록 행 목록의 선택 항목을 후속 비교에 사용할 값으로 보관
    row = rows[0]
    # 추적 식별자가 예상 계약과 일치하는지 확인
    assert row["participantA"]["trackId"] == "t1"
    # 추적 식별자가 예상 계약과 일치하는지 확인
    assert row["participantB"]["trackId"] == "t2"
    # 상태가 상태와 일치하는지 확인
    assert row["actionType"]["state"] == row["direction"]["state"] == "UNKNOWN"
    # 상태가 상태와 일치하는지 확인
    assert row["contact"]["state"] == row["movementImpeded"]["state"] == "UNKNOWN"
    # 상태가 예상 계약과 일치하는지 확인
    assert row["teamRelation"]["state"] == "UNKNOWN"

# 접촉 주장 없는 화면 거리·움직임·자세 측정 확인
def test_measures_image_distance_motion_and_pose_without_contact_claims():
    # 시간에 따른 거리와 속도를 계산할 관측기 생성
    engine = builder()
    # 첫 시각의 두 사람 위치를 기준 관측으로 입력
    first = engine.update(frame(), "shot-0")[0]
    # 다음 시각에 위치를 옮긴 관측으로 속도 측정
    row = engine.update(frame(100, shift=10), "shot-0")[0]
    # 변화 후보 식별자가 변화 후보 식별자와 일치하는지 확인
    assert row["candidateId"] == first["candidateId"]
    # 관측 식별자가 비교 대상과 구별되는지 확인
    assert row["observationId"] != first["observationId"]
    # 측정값 목록을 후속 비교에 사용할 값으로 보관
    measurements = row["measurements"]
    # 시험 값이 100과 일치하는지 확인
    assert measurements["centerDistance"]["value"] == 100
    # 시험 값이 100과 일치하는지 확인
    assert measurements["participantASpeed"]["value"] == 100
    # 측정 단위가 예상 계약과 일치하는지 확인
    assert measurements["participantASpeed"]["unit"] == "px_per_s"
    # 상태가 예상 계약과 일치하는지 확인
    assert measurements["aLeftWristToBTorso"]["state"] == "MEASURED"
    # 측정 좌표계가 예상 계약과 일치하는지 확인
    assert row["coordinateSpace"] == "SOURCE_IMAGE_PIXELS_UNCOMPENSATED"
    # 시험 값이 비어 있는지 확인
    assert row["movementImpeded"]["value"] is None

# 독립 관측 구간의 병합 방지 확인
@pytest.mark.parametrize("boundary", ["gap", "shot", "continuity", "absent"])
def test_separate_episodes_do_not_merge(boundary):
    # 연속성 경계 전후를 비교할 새 관측기 생성
    engine = builder()
    # 경계 이전 관측 식별자를 비교용으로 보관
    old = engine.update(frame(), "s0")[0]
    # 참여자가 사라지는 경계 사례 선택
    if boundary == "absent":
        # 참여자 목록을 비울 다음 시각 프레임 준비
        empty = frame(100)
        # 상호작용 관측 목록을 누적할 빈 자료 구조 준비
        empty["interactions"] = []
        # 재개 상태 전이기에 입력을 반영하여 상태 갱신
        engine.update(empty, "s0")
    # 경계 이후 재등장한 프레임에서 새 관측 생성
    new = engine.update(
        frame(400 if boundary == "gap" else 200, continuity=1 if boundary == "continuity" else 0),
        "s1" if boundary == "shot" else "s0",
    )[0]
    # 변화 후보 식별자가 비교 대상과 구별되는지 확인
    assert new["candidateId"] != old["candidateId"]
    # 상태가 예상 계약과 일치하는지 확인
    assert new["measurements"]["participantASpeed"]["state"] == "UNKNOWN"

# 자세 누락 시 가림 추정 없는 상자 측정 보존 확인
def test_missing_pose_preserves_box_measurements_without_inventing_occlusion():
    # 자세 일부가 빠진 상황을 재현할 정상 프레임 준비
    value = frame()
    # 자세 관측 목록을 누적할 빈 자료 구조 준비
    value["poses"] = []
    # 불완전 자세로도 가능한 측정만 관측기로 계산
    row = builder().update(value, "s0")[0]
    # 상태가 예상 계약과 일치하는지 확인
    assert row["measurements"]["centerDistance"]["state"] == "MEASURED"
    # 사유 목록이 예상 계약과 일치하는지 확인
    assert row["measurements"]["aLeftWristToBTorso"]["reasons"] == ["POSE_NOT_AVAILABLE"]
    # 단순 자세 누락을 가림 확정으로 바꾸지 않는지 확인
    assert "OCCLU" not in str(row)

# 잘못된 입력 거부 확인
@pytest.mark.parametrize("bad", ["nan", "duplicate", "pts", "source"])
def test_invalid_inputs_are_rejected(bad):
    # 잘못된 관측 필드를 주입하기 위한 정상 프레임 준비
    value = frame()
    # 비유한 검출 좌표 사례 선택
    if bad == "nan":
        # 숫자로 사용할 수 없는 좌표를 넣어 검증 실패 재현
        value["detections"][0]["box"][0] = float("nan")
    # 검출 식별자가 중복되는 사례 선택
    if bad == "duplicate":
        # 같은 검출을 복사하여 식별자 충돌 재현
        value["detections"].append(deepcopy(value["detections"][0]))
    # 시각 계약이 어긋나는 사례 선택
    if bad == "pts":
        # 표시 시각을 시험 조건에 맞춰 고정
        value["frame"]["pts"] = 50
    # 원본 지문 귀속이 어긋나는 사례 선택
    if bad == "source":
        # 다른 원본 지문으로 바꾸어 출처 불일치 재현
        value["sourceSha256"] = "b" * 64
    # 잘못된 입력 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError): builder().update(value, "s0")

# 생성 기록의 저장 전 구조 검증 확인
def test_generated_record_has_structure_validation_before_storage():
    # 직접 측정값 검증을 호출할 관측 모듈 읽음
    module = importlib.import_module('replay_video.domain.interactions')
    # 검증 가능한 정상 측정 기록 생성
    row = builder().update(frame(), "s0")[0]
    # 변조 전 정상 측정 기록의 계약 검증
    module.validation(row)
    # 계산된 거리 값을 비유한 수로 바꾸어 사후 검증 실패 재현
    row["measurements"]["centerDistance"]["value"] = float("nan")
    # 생성 기록의 저장 전 구조 검증을 위한 예상 예외 확인
    with pytest.raises(ValueError): module.validation(row)
