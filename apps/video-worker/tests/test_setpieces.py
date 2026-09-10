from dataclasses import replace

import pytest

from replay_video.domain.setpieces import RestartObservation, setpieces


def stopped(time=0, **kwargs):
    # 실제 영상 추출 결과가 아닌 상태 전이 검증용 입력
    return RestartObservation(time, 0, dead_ball=True, restart_candidates=("CORNER_KICK",), evidence_ids=(f"frame:{time}",), is_replay=False, **kwargs)


def restarted(time=400):
    return RestartObservation(time, 0, dead_ball=False, ball_restarted=True, evidence_ids=(f"frame:{time}",), is_replay=False)


@pytest.mark.parametrize("kind", ["KICK_OFF", "CORNER_KICK", "PENALTY_KICK", "THROW_IN", "GOAL_KICK", "FREE_KICK"])
def test_observed_sequence_retains_kind_and_evidence(kind):
    events = setpieces([replace(stopped(), restart_candidates=(kind,)), restarted()])
    assert len(events) == 1
    assert events[0].status == "OBSERVED"
    assert events[0].kind == kind
    assert events[0].restart_ms == 400
    assert events[0].evidence_ids == ("frame:0", "frame:400")


def test_quiet_or_unknown_scene_is_not_a_dead_ball():
    assert setpieces([RestartObservation(0, 0), restarted()]) == ()


def test_unidentified_restart_does_not_default_to_free_kick():
    event, = setpieces([replace(stopped(), restart_candidates=()), restarted()])
    assert event.kind == "UNKNOWN"
    assert "RESTART_TYPE_MISSING" in event.reasons


def test_corner_throw_in_ambiguity_is_not_forced_into_one_class():
    event, = setpieces([replace(stopped(), restart_candidates=("CORNER_KICK", "THROW_IN")), restarted()])
    assert event.status == "UNKNOWN"
    assert "RESTART_TYPE_AMBIGUOUS" in event.reasons


def test_conflicting_types_stay_unknown_even_after_later_agreement():
    event, = setpieces([stopped(), replace(stopped(100), restart_candidates=("THROW_IN",)), stopped(200), restarted()])
    assert event.status == "UNKNOWN"


@pytest.mark.parametrize("last, reason", [
    (replace(restarted(), continuity_id=1), "SHOT_CHANGED"),
    (restarted(2000), "OBSERVATION_GAP"),
    (replace(restarted(), is_replay=True), "REPLAY_ENTERED"),
    (replace(restarted(), evidence_ids=()), "OBSERVATION_MISSING"),
    (replace(restarted(), ball_restarted=None), "RESTART_NOT_OBSERVED"),
])
def test_discontinuity_prevents_positive_result(last, reason):
    event, = setpieces([stopped(), last])
    assert event.status == "UNKNOWN"
    assert reason in event.reasons


def test_unverified_replay_status_prevents_positive_result():
    event, = setpieces([replace(stopped(), is_replay=None), restarted()])
    assert "BROADCAST_SOURCE_UNKNOWN" in event.reasons
    assert event.status == "UNKNOWN"


def test_restart_without_preparation_is_not_inferred():
    assert setpieces([restarted()]) == ()
    event, = setpieces([stopped()])
    assert "CLIP_ENDED_BEFORE_RESTART" in event.reasons


def test_video_pattern_observation_does_not_require_invented_dead_ball_facts():
    observations = [
        RestartObservation(0, 0, preparation_detected=True, restart_candidates=("CORNER_KICK",), evidence_ids=("frame:0",)),
        RestartObservation(300, 0, departure_detected=True, evidence_ids=("frame:300",)),
    ]
    assert all(item.dead_ball is None and item.ball_restarted is None for item in observations)
    event, = setpieces(observations, require_live_source=False, visual_pattern=True)
    assert event.status == "OBSERVED"
    assert "BROADCAST_SOURCE_UNKNOWN" in event.reasons
    assert setpieces(observations) == ()


def test_no_duplicate_event_during_continued_play():
    assert len(setpieces([stopped(), restarted(), restarted(600)])) == 1


def test_no_retroactive_restart_position():
    event, = setpieces([replace(stopped(), restart_candidates=()), replace(restarted(), restart_candidates=("CORNER_KICK",))])
    assert event.kind == "UNKNOWN"


@pytest.mark.parametrize("time", [0, -1, 0.5, True])
def test_rejects_invalid_or_nonincreasing_times(time):
    with pytest.raises(ValueError):
        setpieces([stopped(), replace(restarted(), timestamp_ms=time)])
