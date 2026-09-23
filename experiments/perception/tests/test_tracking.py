# 각도와 비유한 수치 시험 도구 읽음
import math
# 영상과 좌표의 수치 배열 도구 읽음
import numpy as np
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.tracking import TrackAssociator

# 검출 자료 생성
def detection(
    detection_id: int,
    label: str = "person",
    box: tuple[float, float, float, float] = (10, 10, 30, 50),
    score: float = 0.95,
) -> Detection:
    # 상자와 점수를 가진 원시 검출 반환
    return Detection(detection_id, label, box, score)

# 실제 추적기의 반복 상자 식별자 유지 확인
def test_actual_bytetrack_keeps_an_identifier_for_a_repeated_box():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(frame_rate=2)

    # 현재 입력을 반영한 누적 관측 생성
    first = associator.update((detection(0),), 0, 7)
    # 현재 입력을 반영한 누적 관측 생성
    second = associator.update((detection(0, box=(11, 10, 31, 50)),), 500, 7)
    # 현재 입력을 반영한 누적 관측 생성
    third = associator.update((detection(0, box=(12, 10, 32, 50)),), 1000, 7)

    # 추적 식별자 부재 확인
    assert first[0].track_id is None
    # 추적 식별자 존재 확인
    assert second[0].track_id is not None
    # 추적 식별자의 기대 자료 일치 확인
    assert second[0].track_id == third[0].track_id
    # 문자열 앞부분 일치 여부의 조건 충족 확인
    assert second[0].track_id.startswith("7:0:person:")

# 출처 기록의 정확한 고정 추적 설정 공개 확인
def test_provenance_exposes_the_exact_fixed_tracker_configuration():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(frame_rate=2)

    # 원본과 모델 출처의 기대 자료 일치 확인
    assert associator.provenance == {
        # 실행 의존성 이름의 기대값 지정
        "library": "roboflow/trackers",
        # 실행 의존성 판본의 기대값 지정
        "library_version": "2.6.0",
        # 시간축 추적기의 시험값 지정
        "tracker": "ByteTrackTracker",
        # 초당 프레임 수의 기대값 지정
        "frame_rate": 2.0,
        # 추적 소실 허용 길이의 기대값 지정
        "lost_track_buffer": 30,
        # 추적 시작 최소 점수의 기대값 지정
        "track_activation_threshold": .7,
        # 연속 관측 최소 프레임 수의 기대값 지정
        "minimum_consecutive_frames": 2,
        # 최소 상자 겹침 비율의 기대값 지정
        "minimum_iou_threshold": .1,
        # 고신뢰 검출 기준의 기대값 지정
        "high_conf_det_threshold": .6,
        # 추적 상태 추정 방식의 기대값 지정
        "state_estimator": "XCYCSRStateEstimator",
        # 상자 겹침 비율의 시험값 지정
        "iou": "IoU",
        # 최대 연결 시간 간격의 기대값 지정
        "maximum_gap_ms": 1_500,
        # 분류별 추적 분리 여부의 기대값 지정
        "label_partition": ["person", "sports ball"],
    }

# 겹친 라벨의 독립 식별자 사용 확인
def test_overlapping_labels_use_independent_identifiers():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(frame_rate=2)
    # 영상 프레임의 시험 항목 구성
    frame = (
        detection(1, "sports ball", (10, 10, 30, 50)),
        detection(0, "person", (10, 10, 30, 50)),
    )

    # 검출 추적 연결기에 현재 입력 반영
    associator.update(frame, 0, 4)
    # 현재 입력을 반영한 누적 관측 생성
    tracked = associator.update(frame, 500, 4)

    # 추적 식별자 존재 확인
    assert tracked[0].track_id is not None
    # 추적 식별자 존재 확인
    assert tracked[1].track_id is not None
    # 추적 식별자의 비교 대상과 구분 확인
    assert tracked[0].track_id != tracked[1].track_id
    # 추적 식별자에 지정한 항목 포함 확인
    assert ":sports ball:" in tracked[0].track_id
    # 추적 식별자에 지정한 항목 포함 확인
    assert ":person:" in tracked[1].track_id

# 소실 시 예측 검출 출력 방지 확인
def test_disappearance_does_not_emit_a_predicted_detection():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(frame_rate=2)
    # 검출 추적 연결기에 현재 입력 반영
    associator.update((detection(0),), 0, 0)
    # 검출 추적 연결기에 현재 입력 반영
    associator.update((detection(0),), 500, 0)

    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert associator.update((), 1000, 0) == ()

# 연속성 단절의 새 식별자 영역 할당 확인
def test_continuity_cut_allocates_a_new_identifier_namespace():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(frame_rate=2)
    # 검출 추적 연결기에 현재 입력 반영
    associator.update((detection(0),), 0, 2)
    # 변경 전 자료 준비
    before = associator.update((detection(0),), 500, 2)[0].track_id

    # 현재 입력을 반영한 누적 관측 생성
    first_after_cut = associator.update((detection(0),), 1000, 3)
    # 처리 후 자료 준비
    after = associator.update((detection(0),), 1500, 3)[0].track_id

    # 추적 식별자 부재 확인
    assert first_after_cut[0].track_id is None
    # 화면 전환 전과 전환 후 재확립한 추적 식별자 존재 확인
    assert before is not None and after is not None
    # 변경 전 자료의 비교 대상과 구분 확인
    assert before != after
    # 문자열 앞부분 일치 여부의 조건 충족 확인
    assert after.startswith("3:1:person:")

# 동일 연속성의 긴 간격 후 새 세대 사용 확인
def test_long_gap_in_same_continuity_uses_a_new_generation():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(frame_rate=2)
    # 검출 추적 연결기에 현재 입력 반영
    associator.update((detection(0),), 0, 5)
    # 변경 전 자료 준비
    before = associator.update((detection(0),), 500, 5)[0].track_id

    # 현재 입력을 반영한 누적 관측 생성
    first_after_gap = associator.update((detection(0),), 2001, 5)
    # 처리 후 자료 준비
    after = associator.update((detection(0),), 2501, 5)[0].track_id

    # 추적 식별자 부재 확인
    assert first_after_gap[0].track_id is None
    # 긴 간격 전과 이후 재확립한 추적 식별자 존재 확인
    assert before is not None and after is not None
    # 변경 전 자료의 비교 대상과 구분 확인
    assert before != after
    # 문자열 앞부분 일치 여부의 조건 충족 확인
    assert after.startswith("5:1:person:")

# 잘못된 시각 거부 확인
@pytest.mark.parametrize("timestamp", [-1, 1.5, math.nan, math.inf, True, "500"])
def test_invalid_timestamp_is_rejected(timestamp):
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="TIMESTAMP_INVALID"):
        # 검출 상자를 시간축에 연결할 추적기에 현재 입력 반영
        TrackAssociator().update((detection(0),), timestamp, 0)

# 시간 역행 방지 확인
def test_time_cannot_move_backwards():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator()
    # 검출 추적 연결기에 현재 입력 반영
    associator.update((detection(0),), 500, 0)

    # 원본 시간축 순서 오류 발생 기대
    with pytest.raises(ValueError, match="TIMELINE_NON_MONOTONIC"):
        # 검출 추적 연결기에 현재 입력 반영
        associator.update((detection(0),), 499, 0)

# 잘못된 연속성 식별자 거부 확인
@pytest.mark.parametrize("continuity_id", [-1, 1.5, math.nan, math.inf, True, "1"])
def test_invalid_continuity_identifier_is_rejected(continuity_id):
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="CONTINUITY_ID_INVALID"):
        # 검출 상자를 시간축에 연결할 추적기에 현재 입력 반영
        TrackAssociator().update((detection(0),), 0, continuity_id)

# 프레임 내 중복 검출 식별자 거부 확인
def test_duplicate_frame_local_identifiers_are_rejected():
    # 시험 값 목록의 시험 항목 구성
    values = (detection(0, "person"), detection(0, "sports ball"))

    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="DETECTION_ID_DUPLICATE"):
        # 검출 상자를 시간축에 연결할 추적기에 현재 입력 반영
        TrackAssociator().update(values, 0, 0)

# 미지원 프레임률 거부 확인
@pytest.mark.parametrize("frame_rate", [0, -1, math.nan, math.inf, True, "2"])
def test_unsupported_frame_rate_is_rejected(frame_rate):
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="FRAME_RATE_UNSUPPORTED"):
        # 검출 상자를 시간축에 연결할 추적기 실행
        TrackAssociator(frame_rate=frame_rate)

# 검출기 순서와 원본 관측 보존 확인
def test_detector_order_and_original_observations_are_preserved():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(frame_rate=2)
    # 영상 프레임의 시험 항목 구성
    frame = (
        detection(8, "sports ball", (2, 3, 9, 11), 0.91),
        detection(3, "person", (100, 50, 130, 110), 0.92),
        detection(5, "person", (10, 10, 30, 50), 0.93),
    )
    # 검출 추적 연결기에 현재 입력 반영
    associator.update(frame, 0, 9)

    # 현재 입력을 반영한 누적 관측 생성
    tracked = associator.update(frame, 500, 9)

    # 검출 식별자 목록 값이 8 · 3 · 5인지 확인
    assert [value.detection_id for value in tracked] == [8, 3, 5]
    # 검출 분류명 목록 값이 공 · 사람 · 사람인지 확인
    assert [value.label for value in tracked] == ["sports ball", "person", "person"]
    # 검출 상자 좌표 목록의 기대 자료 일치 확인
    assert [value.box for value in tracked] == [value.box for value in frame]
    # 검출 신뢰 점수 목록의 기대 자료 일치 확인
    assert [value.score for value in tracked] == [value.score for value in frame]


# 실제 외부 실행을 대신할 시험 객체 정의
class AlteredBoxTracker:

    # 모의 갱신 결과 반환
    def update(self, detections, *, timestamp):
        # 시험에 필요한 검증 도구와 의존성 읽음
        import supervision as sv

        # 검출 목록의 개수의 비교 결과별 분기
        if len(detections) == 0:
            # 빈 모의 출력 배열 반환
            return sv.Detections.empty()
        # 추적기에 전달할 검출 배열 반환
        return sv.Detections(
            xyxy=np.array([[900, 900, 999, 999]], dtype=float),
            confidence=np.array([0.01], dtype=float),
            tracker_id=np.array([42], dtype=int),
            data={"detection_id": np.array([detections.data["detection_id"][0]])},
        )

# 외부 추적 출력의 검출 좌표·점수 대체 방지 확인
def test_vendor_output_cannot_replace_detector_coordinates_or_score():
    # 상자와 점수를 갖춘 시험 검출 생성
    source = detection(6, box=(20, 30, 40, 70), score=.88)
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: AlteredBoxTracker(),
    )

    # 현재 입력을 반영한 누적 관측 생성
    result = associator.update((source,), 0, 1)

    # 처리 결과의 기대 자료 일치 확인
    assert result == (Detection(6, "person", source.box, source.score, "1:0:person:42"),)


# 실제 외부 실행을 대신할 시험 객체 정의
class UnknownSourceTracker:

    # 모의 갱신 결과 반환
    def update(self, detections, *, timestamp):
        # 시험에 필요한 검증 도구와 의존성 읽음
        import supervision as sv

        # 추적기에 전달할 검출 배열 반환
        return sv.Detections(
            xyxy=np.array([[1, 1, 2, 2]], dtype=float),
            confidence=np.array([0.5], dtype=float),
            tracker_id=np.array([9], dtype=int),
            data={"detection_id": np.array([999])},
        )

# 알 수 없는 외부 원본 대응 거부 확인
def test_unknown_vendor_source_mapping_is_rejected():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: UnknownSourceTracker(),
    )

    # 추적 식별 오류 발생 기대
    with pytest.raises(ValueError, match="TRACKER_OUTPUT_INVALID"):
        # 검출 추적 연결기에 현재 입력 반영
        associator.update((detection(0),), 0, 0)


# 실제 외부 실행을 대신할 시험 객체 정의
class MissingSourceTracker:

    # 모의 갱신 결과 반환
    def update(self, detections, *, timestamp):
        # 시험에 필요한 검증 도구와 의존성 읽음
        import supervision as sv

        # 추적기에 전달할 검출 배열 반환
        return sv.Detections(
            xyxy=detections.xyxy.copy(),
            confidence=detections.confidence.copy(),
            tracker_id=np.array([1], dtype=int),
        )

# 외부 원본 대응 누락 거부 확인
def test_missing_vendor_source_mapping_is_rejected():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: MissingSourceTracker(),
    )

    # 추적 식별 오류 발생 기대
    with pytest.raises(ValueError, match="TRACKER_OUTPUT_INVALID"):
        # 검출 추적 연결기에 현재 입력 반영
        associator.update((detection(0),), 0, 0)


# 실제 외부 실행을 대신할 시험 객체 정의
class OmittedDetectionTracker:

    # 모의 갱신 결과 반환
    def update(self, detections, *, timestamp):
        # 시험에 필요한 검증 도구와 의존성 읽음
        import supervision as sv

        # 빈 모의 출력 배열 반환
        return sv.Detections.empty()

# 외부 누락 시 식별자 조작 없는 원본 보존 확인
def test_vendor_omission_preserves_source_without_inventing_an_identifier():
    # 상자와 점수를 갖춘 시험 검출 생성
    source = detection(2)
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: OmittedDetectionTracker(),
    )

    # 현재 입력을 반영한 누적 관측의 기대 자료 일치 확인
    assert associator.update((source,), 0, 0) == (source,)


# 실제 외부 실행을 대신할 시험 객체 정의
class DuplicateTrackerIdentifier:

    # 모의 갱신 결과 반환
    def update(self, detections, *, timestamp):
        # 시험에 필요한 검증 도구와 의존성 읽음
        import supervision as sv

        # 검출 목록의 개수의 비교 결과별 분기
        if len(detections) == 0:
            # 빈 모의 출력 배열 반환
            return sv.Detections.empty()
        # 추적기에 전달할 검출 배열 반환
        return sv.Detections(
            xyxy=detections.xyxy.copy(),
            confidence=detections.confidence.copy(),
            tracker_id=np.array([3, 3], dtype=int),
            data={"detection_id": detections.data["detection_id"].copy()},
        )

# 중복 외부 식별자 거부 확인
def test_duplicate_vendor_identifier_is_rejected():
    # 검출 상자를 시간축에 연결할 추적기 생성
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: DuplicateTrackerIdentifier(),
    )
    # 시험 값 목록의 시험 항목 구성
    values = (detection(0), detection(1, box=(50, 10, 70, 50)))

    # 추적 식별 오류 발생 기대
    with pytest.raises(ValueError, match="TRACKER_OUTPUT_INVALID"):
        # 검출 추적 연결기에 현재 입력 반영
        associator.update(values, 0, 0)
