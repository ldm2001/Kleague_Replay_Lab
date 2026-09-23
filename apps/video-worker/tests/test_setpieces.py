from dataclasses import replace
import pytest
from replay_video.domain.setpieces import RestartObservation, setpieces

# 시험용 중단 상태 반환
def stopped(time=0, **kwargs):
    # 실제 영상 추출 결과가 아닌 상태 전이 검증용 입력
    return RestartObservation(
        time,
        0,
        dead_ball=True,
        restart_candidates=("CORNER_KICK",),
        evidence_ids=(f"frame:{time}",),
        is_replay=False,
        **kwargs,
    )

# 시험용 재개 상태 반환
def restarted(time=400):
    # 재개 전후 공 움직임을 나타내는 시험 관측 결과 반환
    return RestartObservation(
        time,
        0,
        dead_ball=False,
        ball_restarted=True,
        evidence_ids=(f"frame:{time}",),
        is_replay=False,
    )

# 관측 순서의 유형·근거 보존 확인
@pytest.mark.parametrize(
    "kind", ["KICK_OFF", "CORNER_KICK", "PENALTY_KICK", "THROW_IN", "GOAL_KICK", "FREE_KICK"]
)
def test_observed_sequence_retains_kind_and_evidence(kind):
    # 경기 중단과 지정 재개 유형 및 실제 재개 순서로 상태 전이 실행
    events = setpieces([replace(stopped(), restart_candidates=(kind,)), restarted()])
    # 발생 이력의 개수가 1과 일치하는지 확인
    assert len(events) == 1
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert events[0].status == "OBSERVED"
    # 종류가 종류와 일치하는지 확인
    assert events[0].kind == kind
    # 재개 시각이 400과 일치하는지 확인
    assert events[0].restart_ms == 400
    # 사건에 중단과 재개 프레임 근거가 모두 연결되는지 확인
    assert events[0].evidence_ids == ("frame:0", "frame:400")

# 정적·미확인 장면의 경기 중단 오인 방지 확인
def test_quiet_or_unknown_scene_is_not_a_dead_ball():
    # 앞선 경기 중단 근거 없이 재개만으로 사건을 만들지 않는지 확인
    assert setpieces([RestartObservation(0, 0), restarted()]) == ()

# 미확인 재개의 프리킥 기본값 방지 확인
def test_unidentified_restart_does_not_default_to_free_kick():
    # 재개 유형이 없는 상태에서 재개 관측을 전달
    event, = setpieces([replace(stopped(), restart_candidates=()), restarted()])
    # 종류가 예상 계약과 일치하는지 확인
    assert event.kind == "UNKNOWN"
    # 유형 누락을 추정으로 채우지 않고 보류 사유로 남기는지 확인
    assert "RESTART_TYPE_MISSING" in event.reasons

# 코너킥·스로인 모호성의 강제 분류 방지 확인
def test_corner_throw_in_ambiguity_is_not_forced_into_one_class():
    # 서로 다른 재개 유형이 경쟁하는 입력으로 상태 전이 실행
    (event,) = setpieces(
        [replace(stopped(), restart_candidates=("CORNER_KICK", "THROW_IN")), restarted()]
    )
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert event.status == "UNKNOWN"
    # 복수 재개 유형의 모호성을 보류 사유로 남기는지 확인
    assert "RESTART_TYPE_AMBIGUOUS" in event.reasons

# 상충 유형의 후속 일치에도 미확인 유지 확인
def test_conflicting_types_stay_unknown_even_after_later_agreement():
    # 충분한 근거가 없는 관측을 섞어 상태 전이 실행
    (event,) = setpieces(
        [
            stopped(),
            replace(stopped(100), restart_candidates=("THROW_IN",)),
            stopped(200),
            restarted(),
        ]
    )
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert event.status == "UNKNOWN"

# 불연속 시 긍정 결과 차단 확인
@pytest.mark.parametrize("last, reason", [
    (replace(restarted(), continuity_id=1), "SHOT_CHANGED"),
    (restarted(2000), "OBSERVATION_GAP"),
    (replace(restarted(), is_replay=True), "REPLAY_ENTERED"),
    (replace(restarted(), evidence_ids=()), "OBSERVATION_MISSING"),
    (replace(restarted(), ball_restarted=None), "RESTART_NOT_OBSERVED"),
])
def test_discontinuity_prevents_positive_result(last, reason):
    # 실패 조건이 적용된 마지막 관측으로 사건 종료 상태 계산
    event, = setpieces([stopped(), last])
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert event.status == "UNKNOWN"
    # 사유가 사유 목록에 포함되는지 확인
    assert reason in event.reasons

# 리플레이 미확인 시 긍정 결과 차단 확인
def test_unverified_replay_status_prevents_positive_result():
    # 본방 여부가 미확인인 중단 장면을 재개와 연결
    event, = setpieces([replace(stopped(), is_replay=None), restarted()])
    # 본방 출처 미확인 사유를 보존하는지 확인
    assert "BROADCAST_SOURCE_UNKNOWN" in event.reasons
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert event.status == "UNKNOWN"

# 준비 없는 재개의 추론 방지 확인
def test_restart_without_preparation_is_not_inferred():
    # 중단 없이 등장한 재개 관측에서 사건이 생기지 않는지 확인
    assert setpieces([restarted()]) == ()
    # 재개 없이 끝난 중단 관측의 미완료 사건 생성
    event, = setpieces([stopped()])
    # 클립 종료까지 재개를 보지 못했다는 사유 확인
    assert "CLIP_ENDED_BEFORE_RESTART" in event.reasons

# 경기 중단 사실 생성 없는 영상 패턴 관측 확인
def test_video_pattern_observation_does_not_require_invented_dead_ball_facts():
    # 관측 결과 목록을 비교에 사용할 고정 시험 자료로 구성
    observations = [
        RestartObservation(
            0,
            0,
            preparation_detected=True,
            restart_candidates=("CORNER_KICK",),
            evidence_ids=("frame:0",),
        ),
        RestartObservation(300, 0, departure_detected=True, evidence_ids=("frame:300",)),
    ]
    # 시각 패턴이 경기 중단이나 실제 재개 사실을 확정하지 않는지 확인
    assert all(item.dead_ball is None and item.ball_restarted is None for item in observations)
    # 본방 확인을 요구하지 않는 진단용 시각 패턴 모드 실행
    event, = setpieces(observations, require_live_source=False, visual_pattern=True)
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert event.status == "OBSERVED"
    # 진단 모드에서도 본방 출처 미확인 사유 보존 확인
    assert "BROADCAST_SOURCE_UNKNOWN" in event.reasons
    # 같은 관측을 엄격한 운영 계약에서는 사건으로 채택하지 않는지 확인
    assert setpieces(observations) == ()

# 지속 경기 중 사건 중복 방지 확인
def test_no_duplicate_event_during_continued_play():
    # 동일 재개를 반복 관측해도 사건이 하나만 생성되는지 확인
    assert len(setpieces([stopped(), restarted(), restarted(600)])) == 1

# 재개 위치의 소급 생성 금지 확인
def test_no_retroactive_restart_position():
    # 겹치는 재개 후보를 입력하여 단일 상태 전이 계산
    (event,) = setpieces(
        [
            replace(stopped(), restart_candidates=()),
            replace(restarted(), restart_candidates=("CORNER_KICK",)),
        ]
    )
    # 종류가 예상 계약과 일치하는지 확인
    assert event.kind == "UNKNOWN"

# 잘못되거나 증가하지 않는 시각 거부 확인
@pytest.mark.parametrize("time", [0, -1, 0.5, True])
def test_rejects_invalid_or_nonincreasing_times(time):
    # 잘못되거나 증가하지 않는 시각 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError):
        # 시간이 잘못된 재개 관측의 계약 검증 실행
        setpieces([stopped(), replace(restarted(), timestamp_ms=time)])
