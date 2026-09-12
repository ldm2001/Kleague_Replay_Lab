from dataclasses import replace
from fractions import Fraction
import importlib

import pytest

from replay_perception.models import Detection
from replay_perception.observations import RoleHypothesis
from test_official_objects import scene


def api():
    return importlib.import_module("replay_perception.incident_links")


def interaction_frame(ms=0, *, continuity=0, separate=False, second_role="player"):
    frame, _, _ = scene(ms, continuity=continuity)
    second = (180., 55., 260., 278.) if not separate else (270., 55., 310., 150.)
    detections = (Detection(0, "person", (100, 55, 190, 278), .9, "player-a"),
                  Detection(1, "person", second, .9, "player-b"),
                  Detection(2, "person", (220, 55, 300, 278), .9, "referee-a"))
    roles = (RoleHypothesis(0, "MATCHED", "player", .9, 10, .8),
             RoleHypothesis(1, "MATCHED", second_role, .9, 11, .8))
    return replace(frame, detections=detections), roles


def official(ms=300, *, continuity=0, x=240., signal="RAISED_ARM"):
    return {"trackId": "referee-a", "continuityId": continuity, "timestampMs": ms,
            "startMs": ms - 200, "sustained": True, "signalKind": signal,
            "officialRole": "MAIN_CANDIDATE", "footPoint": [x, 278.],
            "personHeightPx": 223., "admission": "NOT_ADMITTED",
            "lastFrame": scene(ms)[0].sample.as_record()}


def test_overlapping_players_remain_image_proximity_not_contact():
    tracker = api().InteractionTracker()
    frame, roles = interaction_frame()
    records = tracker.update(frame, roles)
    assert len(records) == 1
    value = records[0]
    assert value["actorTrackIds"] == ["player-a", "player-b"]
    assert value["contact"] == "UNVERIFIED"
    assert value["kind"] == "IMAGE_PROXIMITY"
    assert value["admission"] == "NOT_ADMITTED"
    assert not {"contactDetected", "contactIntensity", "foul"}.intersection(value)


@pytest.mark.parametrize("parameters", [{"separate": True}, {"second_role": "referee"},
                                         {"second_role": "goalkeeper"}])
def test_unsupported_role_or_depth_difference_does_not_form_player_pair(parameters):
    assert api().InteractionTracker().update(*interaction_frame(**parameters)) == ()


def test_interaction_identity_resets_at_cut_and_long_gap():
    tracker = api().InteractionTracker()
    first = tracker.update(*interaction_frame(0))[0]
    second = tracker.update(*interaction_frame(100))[0]
    cut = tracker.update(*interaction_frame(200, continuity=1))[0]
    gap = tracker.update(*interaction_frame(800, continuity=1))[0]
    assert first["id"] == second["id"]
    assert second["supportFrameCount"] == 2
    assert len({first["id"], cut["id"], gap["id"]}) == 3


def test_same_time_same_context_nearby_official_only_links_observations():
    tracker = api().InteractionTracker()
    linker = api().IncidentLinker()
    links = ()
    for ms in (0, 100, 200, 300):
        frame, roles = interaction_frame(ms)
        interactions = tracker.update(frame, roles)
        links = linker.update(frame, interactions, (official(ms),) if ms == 300 else ())
    assert len(links) == 1
    result = links[0]
    assert result["linkState"] == "CANDIDATE_LINK"
    assert result["contact"] == "UNVERIFIED"
    assert result["originalDecision"]["phase"] == "UNKNOWN"
    assert result["restart"]["state"] == "UNVERIFIED"
    assert "RESTART_NOT_VISIBLE" in result["reasons"]
    assert "SIGNAL_MEANING_UNVALIDATED" in result["reasons"]


@pytest.mark.parametrize("change", [{"continuityId": 3}, {"footPoint": None},
                                    {"footPoint": [2000, 278]}, {"sustained": False},
                                    {"officialRole": "UNKNOWN"}])
def test_remove_each_link_grounding_prevents_candidate_link(change):
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    frame, roles = interaction_frame(0)
    linker.update(frame, tracker.update(frame, roles), ())
    frame, roles = interaction_frame(100)
    result = linker.update(frame, tracker.update(frame, roles), ({**official(100), **change},))
    assert result == ()


def test_cut_cannot_connect_previous_interaction_to_later_signal():
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    frame, roles = interaction_frame(0)
    linker.update(frame, tracker.update(frame, roles), ())
    frame, _ = interaction_frame(100, continuity=1)
    assert linker.update(frame, (), (official(100, continuity=1),)) == ()


def test_restart_pattern_cannot_backfill_original_decision_or_independent_evidence():
    frame, roles = interaction_frame(100)
    interactions = api().InteractionTracker().update(frame, roles)
    result = api().IncidentLinker().update(
        frame, interactions, (official(100),),
        restart_patterns=({"kind": "CORNER_PATTERN", "timestampMs": 100, "continuityId": 0},),
    )[0]
    assert result["originalDecision"] == {"phase": "UNKNOWN", "value": None,
                                           "independentEvidenceIds": []}
    assert result["restart"]["state"] == "UNVERIFIED"
    assert "RESTART_PATTERN_NOT_LINKED" in result["reasons"]


def test_duplicate_or_stale_timeline_rejected():
    tracker = api().InteractionTracker()
    tracker.update(*interaction_frame(100))
    with pytest.raises(ValueError, match="TIMELINE_NON_MONOTONIC"):
        tracker.update(*interaction_frame(100))


def test_one_official_near_multiple_interactions_abstains_from_unique_link():
    frame, roles = interaction_frame(100)
    interaction = api().InteractionTracker().update(frame, roles)[0]
    competing = {**interaction, "id": "another", "actorTrackIds": ["player-c", "player-d"]}
    frame = replace(frame, detections=(*frame.detections,
                    replace(frame.detections[0], detection_id=3, track_id="player-c"),
                    replace(frame.detections[1], detection_id=4, track_id="player-d")))
    assert api().IncidentLinker().update(frame, (interaction, competing), (official(100),)) == ()


def test_missing_current_track_cannot_bridge_old_image_coordinates():
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    frame, roles = interaction_frame(0)
    linker.update(frame, tracker.update(frame, roles), ())
    frame, _ = interaction_frame(100)
    frame = replace(frame, detections=frame.detections[1:])
    assert linker.update(frame, (), (official(100),)) == ()


def test_official_must_have_a_matching_current_detection():
    frame, roles = interaction_frame(100)
    interactions = api().InteractionTracker().update(frame, roles)
    frame = replace(frame, detections=frame.detections[:2])
    assert api().IncidentLinker().update(frame, interactions, (official(100),)) == ()


def test_individual_actor_disappearance_expires_incident_eligibility():
    frame, roles = interaction_frame(0)
    linker = api().IncidentLinker()
    linker.update(frame, api().InteractionTracker().update(frame, roles), ())
    for ms in (100, 200, 300, 400):
        frame, _ = interaction_frame(ms)
        linker.update(replace(frame, detections=frame.detections[2:]), (), ())
    frame, _ = interaction_frame(500)
    assert linker.update(frame, (), (official(500),)) == ()


def test_interaction_from_different_source_time_origin_is_rejected():
    frame, roles = interaction_frame(100)
    foreign = replace(frame, sample=replace(frame.sample, origin_pts=1000, pts=1100))
    interactions = api().InteractionTracker().update(foreign, roles)
    with pytest.raises(ValueError, match="OBSERVATION_FRAME_MISMATCH"):
        api().IncidentLinker().update(frame, interactions, (official(100),))


def test_official_from_different_source_time_origin_is_rejected():
    frame, roles = interaction_frame(100)
    observation = official(100)
    observation["lastFrame"] = {**observation["lastFrame"], "originPts": 1000, "pts": 1100}
    with pytest.raises(ValueError, match="OBSERVATION_FRAME_MISMATCH"):
        api().IncidentLinker().update(frame, api().InteractionTracker().update(frame, roles), (observation,))


def test_linker_rejects_current_duplicate_track_ids():
    frame, roles = interaction_frame(100)
    interactions = api().InteractionTracker().update(frame, roles)
    frame = replace(frame, detections=(*frame.detections, replace(frame.detections[0], detection_id=3)))
    with pytest.raises(ValueError, match="INTERACTION_ID_DUPLICATE"):
        api().IncidentLinker().update(frame, interactions, (official(100),))


def test_interaction_role_detection_association_must_be_one_to_one():
    frame, roles = interaction_frame(100)
    with pytest.raises(ValueError, match="ROLE_ASSOCIATION_AMBIGUOUS"):
        api().InteractionTracker().update(frame, (roles[0], replace(roles[1], role_detection_id=10)))


def test_link_distance_is_normalized_by_current_not_historical_body_scale():
    frame, roles = interaction_frame(0)
    linker = api().IncidentLinker()
    linker.update(frame, api().InteractionTracker().update(frame, roles), ())
    frame, _ = interaction_frame(100)
    actors = (replace(frame.detections[0], box=(100, 200, 110, 264)),
              replace(frame.detections[1], box=(110, 200, 120, 264)), frame.detections[2])
    frame = replace(frame, detections=actors)
    assert linker.update(frame, (), (official(100, x=270),)) == ()


def test_interaction_gap_uses_exact_pts():
    tracker = api().InteractionTracker()
    result = []
    for pts in (1, 2502):
        frame, roles = interaction_frame(round(pts / 10))
        frame = replace(frame, sample=replace(frame.sample, pts=pts, time_base=Fraction(1, 10000)))
        result.append(tracker.update(frame, roles)[0])
    assert result[0]["id"] != result[1]["id"]


@pytest.mark.parametrize("next_ms", [200, 400])
def test_rejected_duplicate_does_not_advance_interaction_state(next_ms):
    tracker = api().InteractionTracker()
    first = tracker.update(*interaction_frame(0))[0]
    frame, roles = interaction_frame(200)
    duplicate = replace(frame, detections=(*frame.detections, replace(frame.detections[0], detection_id=3)))
    with pytest.raises(ValueError, match="INTERACTION_ID_DUPLICATE"):
        tracker.update(duplicate, roles)
    result = tracker.update(*interaction_frame(next_ms))[0]
    assert (result["id"] == first["id"]) is (next_ms == 200)


def test_rejected_link_input_can_be_corrected_without_advancing_timeline():
    linker = api().IncidentLinker()
    frame, roles = interaction_frame(100)
    interactions = api().InteractionTracker().update(frame, roles)
    bad = {**interactions[0], "lastFrame": {}}
    with pytest.raises(ValueError, match="OBSERVATION_FRAME_MISMATCH"):
        linker.update(frame, (bad,), (official(100),))
    assert len(linker.update(frame, interactions, (official(100),))) == 1


def test_link_expiry_uses_exact_pts_at_three_seconds():
    tracker, linker = api().InteractionTracker(), api().IncidentLinker()
    frame, roles = interaction_frame(0)
    linker.update(frame, tracker.update(frame, roles), ())
    for ms in range(100, 3000, 100):
        frame, _ = interaction_frame(ms)
        linker.update(frame, (), ())
    frame, _ = interaction_frame(3000)
    frame = replace(frame, sample=replace(frame.sample, pts=30001, time_base=Fraction(1, 10000)))
    value = {**official(3000), "lastFrame": frame.sample.as_record()}
    assert linker.update(frame, (), (value,)) == ()
