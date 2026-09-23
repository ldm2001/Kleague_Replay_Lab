# 불변 관측 복사와 수정 오류 도구 읽음
from dataclasses import replace
# 원본 시간축의 정확한 분수 도구 읽음
from fractions import Fraction
# 인식 모듈 지연 읽기 도구 읽음
import importlib
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.models import Detection
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception.observations import RoleHypothesis
# 시험에 필요한 검증 도구와 의존성 읽음
from test_objects import scene

# 인터페이스 반환
def api():
    # 검사할 인식 구현 모듈 반환
    return importlib.import_module('replay_perception.incidents')

# 상호작용 프레임 생성
def interaction_frame(ms=0, *, continuity=0, separate=False, second_role="player"):
    # 시험 시각의 영상 장면 생성
    frame, _, _ = scene(ms, continuity=continuity)
    # 두 번째 관측의 시험 조건별 값 선택
    second = (180., 55., 260., 278.) if not separate else (270., 55., 310., 150.)
    # 검출 목록의 시험 항목 구성
    detections = (
        # 사람 후보의 상자와 점수 지정
        Detection(0, "person", (100, 55, 190, 278), 0.9, "player-a"),
        # 사람 후보의 상자와 점수 지정
        Detection(1, "person", second, 0.9, "player-b"),
        # 사람 후보의 상자와 점수 지정
        Detection(2, "person", (220, 55, 300, 278), 0.9, "referee-a"),
    )
    # 역할 관측의 시험 항목 구성
    roles = (
        # 선수 후보의 상자와 점수 지정
        RoleHypothesis(0, "MATCHED", "player", 0.9, 10, 0.8),
        # 원시 검출과 분리된 역할 가설 지정
        RoleHypothesis(1, "MATCHED", second_role, 0.9, 11, 0.8),
    )
    # 지정 필드만 바꾼 시험 관측과 역할 관측 반환
    return replace(frame, detections=detections), roles

# 심판 관측 생성
def official(ms=300, *, continuity=0, x=240., signal="RAISED_ARM"):
    # 심판 관측 결과 반환
    return {
        # 추적 식별자의 시험값 지정
        "trackId": "referee-a",
        # 화면 연속성 식별자의 시험값 지정
        "continuityId": continuity,
        # 밀리초 원본 시각의 시험값 지정
        "timestampMs": ms,
        # 구간 시작 시각의 시험값 지정
        "startMs": ms - 200,
        # 동작 지속 여부의 참 시험값 지정
        "sustained": True,
        # 팔 신호 종류의 시험값 지정
        "signalKind": signal,
        # 심판 세부 역할 후보의 주심 후보 시험값 지정
        "officialRole": "MAIN_CANDIDATE",
        # 화면상의 발 위치의 시험값 지정
        "footPoint": [x, 278.0],
        # 화면상의 사람 높이의 223점0 시험값 지정
        "personHeightPx": 223.0,
        # 규정 입력 채택 상태의 규정 입력에 채택하지 않은 상태 시험값 지정
        "admission": "NOT_ADMITTED",
        # 마지막 근거 프레임의 시험값 지정
        "lastFrame": scene(ms)[0].sample.as_record(),
    }

# 겹친 선수의 접촉 대신 영상 근접 유지 확인
def test_overlapping_players_remain_image_proximity_not_contact():
    # 화면 연속성을 관리할 선수 근접 추적기 생성
    tracker = api().InteractionTracker()
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame()
    # 현재 입력을 반영한 누적 관측 생성
    records = tracker.update(frame, roles)
    # 관측 기록 목록의 개수 값이 1인지 확인
    assert len(records) == 1
    # 검사 대상 자료 준비
    value = records[0]
    # 관련 선수의 추적 식별자의 기대 자료 일치 확인
    assert value["actorTrackIds"] == ["player-a", "player-b"]
    # 접촉 검증 상태 값이 검증되지 않은 상태인지 확인
    assert value["contact"] == "UNVERIFIED"
    # 관측 종류 값이 영상상의 근접 관측인지 확인
    assert value["kind"] == "IMAGE_PROXIMITY"
    # 규정 입력 채택 상태 값이 규정 입력에 채택하지 않은 상태인지 확인
    assert value["admission"] == "NOT_ADMITTED"
    # 금지 항목과 겹치는 키 집합의 부재 또는 비활성 확인
    assert not {"contactDetected", "contactIntensity", "foul"}.intersection(value)

# 미지원 역할·깊이 차이의 선수 쌍 형성 방지 확인
@pytest.mark.parametrize("parameters", [{"separate": True}, {"second_role": "referee"},
                                         {"second_role": "goalkeeper"}])
def test_unsupported_role_or_depth_difference_does_not_form_player_pair(parameters):
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert api().InteractionTracker().update(*interaction_frame(**parameters)) == ()

# 화면 전환·긴 간격의 상호작용 식별 초기화 확인
def test_interaction_identity_resets_at_cut_and_long_gap():
    # 화면 연속성을 관리할 선수 근접 추적기 생성
    tracker = api().InteractionTracker()
    # 첫 번째 관측 준비
    first = tracker.update(*interaction_frame(0))[0]
    # 두 번째 관측 준비
    second = tracker.update(*interaction_frame(100))[0]
    # 화면 전환 뒤 관측 준비
    cut = tracker.update(*interaction_frame(200, continuity=1))[0]
    # 긴 간격 뒤 관측 준비
    gap = tracker.update(*interaction_frame(800, continuity=1))[0]
    # 관측 식별자의 기대 자료 일치 확인
    assert first["id"] == second["id"]
    # 관측을 뒷받침한 프레임 수 값이 2인지 확인
    assert second["supportFrameCount"] == 2
    # 화면 전환·긴 간격의 상호작용 식별 초기화의 개수 값이 3인지 확인
    assert len({first["id"], cut["id"], gap["id"]}) == 3

# 동일 시간·맥락의 가까운 심판 관측만 연결 확인
def test_same_time_same_context_nearby_official_only_links_observations():
    # 화면 연속성을 관리할 선수 근접 추적기 생성
    tracker = api().InteractionTracker()
    # 선수 근접과 심판 신호를 연결할 후보 연결기 생성
    linker = api().IncidentLinker()
    # 사건 연결 후보의 빈 누적 공간 생성
    links = ()
    # 동일 시간·맥락의 가까운 심판 관측만 연결 입력 목록의 항목별 순회
    for ms in (0, 100, 200, 300):
        # 선수 근접 조건을 반영한 프레임과 역할 생성
        frame, roles = interaction_frame(ms)
        # 현재 입력을 반영한 누적 관측 생성
        interactions = tracker.update(frame, roles)
        # 현재 입력을 반영한 누적 관측 생성
        links = linker.update(frame, interactions, (official(ms),) if ms == 300 else ())
    # 사건 연결 후보의 개수 값이 1인지 확인
    assert len(links) == 1
    # 처리 결과 준비
    result = links[0]
    # 사건 연결 상태 값이 검증 전 연결 후보인지 확인
    assert result["linkState"] == "CANDIDATE_LINK"
    # 접촉 검증 상태 값이 검증되지 않은 상태인지 확인
    assert result["contact"] == "UNVERIFIED"
    # 원심 처리 단계 값이 알 수 없는 상태인지 확인
    assert result["originalDecision"]["phase"] == "UNKNOWN"
    # 관측 상태 값이 검증되지 않은 상태인지 확인
    assert result["restart"]["state"] == "UNVERIFIED"
    # 판단 보류 이유에 재개 장면을 볼 수 없는 이유 포함 확인
    assert "RESTART_NOT_VISIBLE" in result["reasons"]
    # 판단 보류 이유에 신호 의미 미검증 이유 포함 확인
    assert "SIGNAL_MEANING_UNVALIDATED" in result["reasons"]

# 개별 연결 근거 제거 시 후보 연결 방지 확인
@pytest.mark.parametrize("change", [{"continuityId": 3}, {"footPoint": None},
                                    {"footPoint": [2000, 278]}, {"sustained": False},
                                    {"officialRole": "UNKNOWN"}])
def test_remove_each_link_grounding_prevents_candidate_link(change):
    # 시간축 추적기과 사건 후보 연결기의 시험 항목 구성
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(0)
    # 사건 후보 연결기에 현재 입력 반영
    linker.update(frame, tracker.update(frame, roles), ())
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 현재 입력을 반영한 누적 관측 생성
    result = linker.update(frame, tracker.update(frame, roles), ({**official(100), **change},))
    # 처리 결과 값이 빈 목록인지 확인
    assert result == ()

# 화면 전환 전 상호작용과 이후 신호 연결 방지 확인
def test_cut_cannot_connect_previous_interaction_to_later_signal():
    # 시간축 추적기과 사건 후보 연결기의 시험 항목 구성
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(0)
    # 사건 후보 연결기에 현재 입력 반영
    linker.update(frame, tracker.update(frame, roles), ())
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, _ = interaction_frame(100, continuity=1)
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert linker.update(frame, (), (official(100, continuity=1),)) == ()

# 재개 패턴의 원심·독립 근거 역추정 방지 확인
def test_restart_pattern_cannot_backfill_original_decision_or_independent_evidence():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 현재 입력을 반영한 누적 관측 생성
    interactions = api().InteractionTracker().update(frame, roles)
    # 처리 결과 준비
    result = (
        api()
        .IncidentLinker()
        .update(
            frame,
            interactions,
            (official(100),),
            restart_patterns=({"kind": "CORNER_PATTERN", "timestampMs": 100, "continuityId": 0},),
        )[0]
    )
    # 원심 관측 상태의 기대 자료 일치 확인
    assert result["originalDecision"] == {"phase": "UNKNOWN", "value": None,
                                           # 독립 근거 식별자의 빈 목록 시험값 지정
                                           "independentEvidenceIds": []}
    # 관측 상태 값이 검증되지 않은 상태인지 확인
    assert result["restart"]["state"] == "UNVERIFIED"
    # 판단 보류 이유에 재개 패턴 연결 보류 이유 포함 확인
    assert "RESTART_PATTERN_NOT_LINKED" in result["reasons"]

# 중복·오래된 시간축 거부 확인
def test_duplicate_or_stale_timeline_rejected():
    # 화면 연속성을 관리할 선수 근접 추적기 생성
    tracker = api().InteractionTracker()
    # 시간축 추적기에 현재 입력 반영
    tracker.update(*interaction_frame(100))
    # 원본 시간축 순서 오류 발생 기대
    with pytest.raises(ValueError, match="TIMELINE_NON_MONOTONIC"):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(*interaction_frame(100))

# 복수 상호작용 인접 심판의 유일 연결 보류 확인
def test_one_official_near_multiple_interactions_abstains_from_unique_link():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 선수 근접 관측 준비
    interaction = api().InteractionTracker().update(frame, roles)[0]
    # 경쟁하는 근접 관측의 시험 항목 구성
    competing = {**interaction, "id": "another", "actorTrackIds": ["player-c", "player-d"]}
    # 지정 필드만 바꾼 시험 관측 생성
    frame = replace(
        frame,
        # 검출 목록의 호출 조건 지정
        detections=(
            *frame.detections,
            replace(frame.detections[0], detection_id=3, track_id="player-c"),
            replace(frame.detections[1], detection_id=4, track_id="player-d"),
        ),
    )
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert api().IncidentLinker().update(frame, (interaction, competing), (official(100),)) == ()

# 현재 추적 누락 시 과거 영상 좌표 연결 방지 확인
def test_missing_current_track_cannot_bridge_old_image_coordinates():
    # 시간축 추적기과 사건 후보 연결기의 시험 항목 구성
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(0)
    # 사건 후보 연결기에 현재 입력 반영
    linker.update(frame, tracker.update(frame, roles), ())
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, _ = interaction_frame(100)
    # 지정 필드만 바꾼 시험 관측 생성
    frame = replace(frame, detections=frame.detections[1:])
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert linker.update(frame, (), (official(100),)) == ()

# 심판과 현재 검출의 일치 요구 확인
def test_official_must_have_a_matching_current_detection():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 현재 입력을 반영한 누적 관측 생성
    interactions = api().InteractionTracker().update(frame, roles)
    # 지정 필드만 바꾼 시험 관측 생성
    frame = replace(frame, detections=frame.detections[:2])
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert api().IncidentLinker().update(frame, interactions, (official(100),)) == ()

# 개별 행위자 소실 시 사건 연결 자격 만료 확인
def test_individual_actor_disappearance_expires_incident_eligibility():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(0)
    # 선수 근접과 심판 신호를 연결할 후보 연결기 생성
    linker = api().IncidentLinker()
    # 사건 후보 연결기에 현재 입력 반영
    linker.update(frame, api().InteractionTracker().update(frame, roles), ())
    # 개별 행위자 소실 시 사건 연결 자격 만료 입력 목록의 항목별 순회
    for ms in (100, 200, 300, 400):
        # 선수 근접 조건을 반영한 프레임과 역할 생성
        frame, _ = interaction_frame(ms)
        # 사건 후보 연결기에 현재 입력 반영
        linker.update(replace(frame, detections=frame.detections[2:]), (), ())
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, _ = interaction_frame(500)
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert linker.update(frame, (), (official(500),)) == ()

# 다른 원본 시간 시작점의 상호작용 거부 확인
def test_interaction_from_different_source_time_origin_is_rejected():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 지정 필드만 바꾼 시험 관측 생성
    foreign = replace(frame, sample=replace(frame.sample, origin_pts=1000, pts=1100))
    # 현재 입력을 반영한 누적 관측 생성
    interactions = api().InteractionTracker().update(foreign, roles)
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVATION_FRAME_MISMATCH"):
        # 선수 근접과 심판 신호를 연결할 후보 연결기에 현재 입력 반영
        api().IncidentLinker().update(frame, interactions, (official(100),))

# 다른 원본 시간 시작점의 심판 거부 확인
def test_official_from_different_source_time_origin_is_rejected():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 시각과 위치를 가진 심판 후보 관측 생성
    observation = official(100)
    # 마지막 근거 프레임의 시험 항목 구성
    observation["lastFrame"] = {**observation["lastFrame"], "originPts": 1000, "pts": 1100}
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVATION_FRAME_MISMATCH"):
        # 선수 근접과 심판 신호를 연결할 후보 연결기에 현재 입력 반영
        api().IncidentLinker().update(
            frame, api().InteractionTracker().update(frame, roles), (observation,)
        )

# 연결기의 현재 중복 추적 식별자 거부 확인
def test_linker_rejects_current_duplicate_track_ids():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 현재 입력을 반영한 누적 관측 생성
    interactions = api().InteractionTracker().update(frame, roles)
    # 지정 필드만 바꾼 시험 관측 생성
    frame = replace(
        frame, detections=(*frame.detections, replace(frame.detections[0], detection_id=3))
    )
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="INTERACTION_ID_DUPLICATE"):
        # 선수 근접과 심판 신호를 연결할 후보 연결기에 현재 입력 반영
        api().IncidentLinker().update(frame, interactions, (official(100),))

# 상호작용 역할·검출의 일대일 대응 요구 확인
def test_interaction_role_detection_association_must_be_one_to_one():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 역할 관측 오류 발생 기대
    with pytest.raises(ValueError, match="ROLE_ASSOCIATION_AMBIGUOUS"):
        # 화면 연속성을 관리할 선수 근접 추적기에 현재 입력 반영
        api().InteractionTracker().update(
            frame, (roles[0], replace(roles[1], role_detection_id=10))
        )

# 과거 대신 현재 신체 크기로 연결 거리 정규화 확인
def test_link_distance_is_normalized_by_current_not_historical_body_scale():
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(0)
    # 선수 근접과 심판 신호를 연결할 후보 연결기 생성
    linker = api().IncidentLinker()
    # 사건 후보 연결기에 현재 입력 반영
    linker.update(frame, api().InteractionTracker().update(frame, roles), ())
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, _ = interaction_frame(100)
    # 선수 관측 목록의 시험 항목 구성
    actors = (
        replace(frame.detections[0], box=(100, 200, 110, 264)),
        replace(frame.detections[1], box=(110, 200, 120, 264)),
        frame.detections[2],
    )
    # 지정 필드만 바꾼 시험 관측 생성
    frame = replace(frame, detections=actors)
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert linker.update(frame, (), (official(100, x=270),)) == ()

# 상호작용 간격의 정확한 원본 시각 사용 확인
def test_interaction_gap_uses_exact_pts():
    # 화면 연속성을 관리할 선수 근접 추적기 생성
    tracker = api().InteractionTracker()
    # 처리 결과의 빈 누적 공간 생성
    result = []
    # 상호작용 간격의 정확한 원본 시각 사용 입력 목록의 항목별 순회
    for pts in (1, 2502):
        # 선수 근접 조건을 반영한 프레임과 역할 생성
        frame, roles = interaction_frame(round(pts / 10))
        # 지정 필드만 바꾼 시험 관측 생성
        frame = replace(frame, sample=replace(frame.sample, pts=pts, time_base=Fraction(1, 10000)))
        # 처리 결과에 현재 관측 추가
        result.append(tracker.update(frame, roles)[0])
    # 관측 식별자의 비교 대상과 구분 확인
    assert result[0]["id"] != result[1]["id"]

# 중복 입력 거부 시 상호작용 상태 진행 방지 확인
@pytest.mark.parametrize("next_ms", [200, 400])
def test_rejected_duplicate_does_not_advance_interaction_state(next_ms):
    # 화면 연속성을 관리할 선수 근접 추적기 생성
    tracker = api().InteractionTracker()
    # 첫 번째 관측 준비
    first = tracker.update(*interaction_frame(0))[0]
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(200)
    # 지정 필드만 바꾼 시험 관측 생성
    duplicate = replace(
        frame, detections=(*frame.detections, replace(frame.detections[0], detection_id=3))
    )
    # 입력값 오류 발생 기대
    with pytest.raises(ValueError, match="INTERACTION_ID_DUPLICATE"):
        # 시간축 추적기에 현재 입력 반영
        tracker.update(duplicate, roles)
    # 처리 결과 준비
    result = tracker.update(*interaction_frame(next_ms))[0]
    # 중복 입력 거부 시 상호작용 상태 진행 방지의 기대 자료 일치 확인
    assert (result["id"] == first["id"]) is (next_ms == 200)

# 거부된 연결 입력의 시간축 진행 없는 수정 확인
def test_rejected_link_input_can_be_corrected_without_advancing_timeline():
    # 선수 근접과 심판 신호를 연결할 후보 연결기 생성
    linker = api().IncidentLinker()
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(100)
    # 현재 입력을 반영한 누적 관측 생성
    interactions = api().InteractionTracker().update(frame, roles)
    # 잘못된 입력의 시험 항목 구성
    bad = {**interactions[0], "lastFrame": {}}
    # 프레임 계약 오류 발생 기대
    with pytest.raises(ValueError, match="OBSERVATION_FRAME_MISMATCH"):
        # 사건 후보 연결기에 현재 입력 반영
        linker.update(frame, (bad,), (official(100),))
    # 현재 입력을 반영한 누적 관측의 개수 값이 1인지 확인
    assert len(linker.update(frame, interactions, (official(100),))) == 1

# 3초 연결 만료의 정확한 원본 시각 사용 확인
def test_link_expiry_uses_exact_pts_at_three_seconds():
    # 시간축 추적기과 사건 후보 연결기의 시험 항목 구성
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, roles = interaction_frame(0)
    # 사건 후보 연결기에 현재 입력 반영
    linker.update(frame, tracker.update(frame, roles), ())
    # 반복할 순번 범위의 항목별 순회
    for ms in range(100, 3000, 100):
        # 선수 근접 조건을 반영한 프레임과 역할 생성
        frame, _ = interaction_frame(ms)
        # 사건 후보 연결기에 현재 입력 반영
        linker.update(frame, (), ())
    # 선수 근접 조건을 반영한 프레임과 역할 생성
    frame, _ = interaction_frame(3000)
    # 지정 필드만 바꾼 시험 관측 생성
    frame = replace(frame, sample=replace(frame.sample, pts=30001, time_base=Fraction(1, 10000)))
    # 검사 대상 자료의 시험 항목 구성
    value = {**official(3000), "lastFrame": frame.sample.as_record()}
    # 현재 입력을 반영한 누적 관측 값이 빈 목록인지 확인
    assert linker.update(frame, (), (value,)) == ()
