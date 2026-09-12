from dataclasses import replace
from fractions import Fraction
import importlib

import cv2
import numpy as np
import pytest

from replay_perception.media import VideoSample
from replay_perception.models import Detection
from replay_perception.observations import KEYPOINT_NAMES, Keypoint, PoseObservation, RoleHypothesis
from replay_perception.recorded_frames import RecordedFrame


def api():
    return importlib.import_module("replay_perception.official_objects")


def scene(ms=0, *, kind="flag", role="referee", boundary=True, continuity=0, changes=None):
    rgb = np.full((360, 320, 3), (45, 130, 45), dtype=np.uint8)
    if boundary:
        rgb[282:] = (70, 60, 60)
        rgb[279:282] = (245, 245, 245)
    box = (100., 55., 180., 278.)
    coordinates = {index: (140., 170.) for index in range(17)}
    coordinates.update({5: (120, 140), 7: (120, 100), 9: (120, 60), 11: (120, 220),
                        6: (160, 140), 8: (160, 180), 10: (160, 210), 12: (160, 220),
                        15: (120, 276), 16: (160, 276)})
    points = []
    for index, name in enumerate(KEYPOINT_NAMES):
        x, y = coordinates[index]
        values = {"x": x, "y": y, "score": .95, **(changes or {}).get(index, {})}
        points.append(Keypoint(index, name, **values))
    pose = PoseObservation(0, box, tuple(points), ((1., 0., 0.), (0., 1., 0.)))
    if kind == "flag":
        cv2.line(rgb, (120, 60), (120, 20), (15, 15, 15), 2)
        rgb[20:47, 122:142] = (245, 225, 15)
    elif kind in ("yellow", "red"):
        rgb[43:59, 116:126] = (245, 225, 15) if kind == "yellow" else (235, 20, 20)
    elif kind == "advert":
        rgb[5:55, 210:300] = (245, 225, 15)
    detection = Detection(0, "person", box, .9, "actor-1")
    sample = VideoSample(ms // 100, 0, ms, Fraction(1, 1000), 0, Fraction(1, 1000), ms, rgb)
    frame = RecordedFrame(sample, (detection,), continuity, ms // 100)
    matched = RoleHypothesis(0, "MATCHED", role, .9, 1, .8)
    return frame, (matched,), (pose,)


def observed(tracker, **kwargs):
    return [tracker.update(*scene(ms, **kwargs)) for ms in (0, 100, 200, 300)]


def test_flag_patch_requires_hand_and_shaft_and_is_only_a_cue():
    frame, _, poses = scene()
    left, right = api().held_objects(frame.sample.rgb, poses[0])
    assert left["kind"] == "FLAG_LIKE"
    assert left["shaftSupport"] is True
    assert left["admission"] == "NOT_ADMITTED"
    assert left["wristDistancePx"] >= 0
    assert right["kind"] == "UNKNOWN"
    assert "probability" not in left


@pytest.mark.parametrize("kind,expected", [("yellow", "YELLOW_CARD_LIKE"), ("red", "RED_CARD_LIKE")])
def test_small_rectangular_hand_patch_is_not_a_declared_card(kind, expected):
    frame, _, poses = scene(kind=kind)
    left = api().held_objects(frame.sample.rgb, poses[0])[0]
    assert left["kind"] == expected
    assert left["admission"] == "NOT_ADMITTED"
    assert "disciplinaryDecision" not in left


@pytest.mark.parametrize("changes", [{9: {"score": .1}}, {9: {"x": -1}}, {7: {"score": .1}}])
def test_occluded_or_outside_hand_abstains(changes):
    frame, _, poses = scene(changes=changes)
    left = api().held_objects(frame.sample.rgb, poses[0])[0]
    assert left["kind"] == "UNKNOWN"
    assert left["state"] == "UNOBSERVABLE"


def test_advertising_colour_away_from_hand_is_not_a_held_object():
    frame, _, poses = scene(kind="advert")
    assert all(item["kind"] == "UNKNOWN" for item in api().held_objects(frame.sample.rgb, poses[0]))


def test_white_line_with_grass_on_both_sides_is_not_a_sideline():
    frame, _, poses = scene(kind="none", boundary=False)
    frame.sample.rgb[279:282] = (245, 245, 245)
    assert api().pitch_context(frame.sample.rgb, poses[0])["state"] == "IN_PITCH_CONTEXT"
    border, _, border_poses = scene()
    context = api().pitch_context(border.sample.rgb, border_poses[0])
    assert context["state"] == "NEAR_PITCH_BOUNDARY"
    assert context["grassSideContrast"] >= .35


def test_persistent_referee_flag_and_boundary_form_only_assistant_hypothesis():
    records = observed(api().OfficialObserver())
    assert records[0][0]["officialRole"] == "UNKNOWN"
    assert records[-1][0]["officialRole"] == "ASSISTANT_CANDIDATE"
    assert records[-1][0]["supportFrameCount"] == 4
    assert records[-1][0]["originalDecision"] == "UNKNOWN"


@pytest.mark.parametrize("role", ["player", "goalkeeper"])
def test_flaglike_patch_on_player_or_goalkeeper_does_not_make_official(role):
    records = observed(api().OfficialObserver(), role=role)
    assert all(record[0]["officialRole"] == "UNKNOWN" for record in records)


def test_main_requires_positive_pitch_and_persistent_raised_signal_not_flag_absence():
    records = observed(api().OfficialObserver(), kind="none", boundary=False)
    assert records[-1][0]["officialRole"] == "MAIN_CANDIDATE"
    hidden_feet = observed(api().OfficialObserver(), kind="none", boundary=False,
                           changes={15: {"score": .1}, 16: {"score": .1}})
    assert hidden_feet[-1][0]["officialRole"] == "UNKNOWN"


def test_cut_gap_or_changed_role_clears_temporal_support():
    observer = api().OfficialObserver()
    observed(observer)
    assert observer.update(*scene(400, continuity=1))[0]["officialRole"] == "UNKNOWN"
    assert observer.update(*scene(900, continuity=1))[0]["supportFrameCount"] == 1
    frame, _, poses = scene(1000, continuity=1)
    unmatched = (RoleHypothesis(0, "UNMATCHED"),)
    assert observer.update(frame, unmatched, poses)[0]["officialRole"] == "UNKNOWN"
    assert observer.update(*scene(1100, continuity=1))[0]["supportFrameCount"] == 1


def test_duplicate_tracks_or_source_box_mismatch_is_rejected():
    frame, roles, poses = scene()
    with pytest.raises(ValueError, match="POSE_SOURCE_MISMATCH"):
        api().OfficialObserver().update(frame, roles, (replace(poses[0], source_box=(0, 0, 10, 10)),))
    duplicate = replace(frame.detections[0], detection_id=1)
    with pytest.raises(ValueError, match="TRACK_ID_DUPLICATE"):
        api().OfficialObserver().update(replace(frame, detections=(*frame.detections, duplicate)), roles, poses)


def test_link_location_uses_visible_ankles_and_not_box_centre_as_measured_ground():
    result = api().OfficialObserver().update(*scene())[0]
    assert result["footPoint"] == [140., 276.]
    assert result["personHeightPx"] == 223.
    hidden = api().OfficialObserver().update(*scene(changes={15: {"score": .1}}))[0]
    assert hidden["footPoint"] is None


def test_role_detection_cannot_be_matched_to_two_people():
    frame, roles, poses = scene()
    frame = replace(frame, detections=(*frame.detections,
                    replace(frame.detections[0], detection_id=1, track_id="actor-2")))
    with pytest.raises(ValueError, match="ROLE_ASSOCIATION_AMBIGUOUS"):
        api().OfficialObserver().update(frame, (*roles, replace(roles[0], detection_id=1)),
                                        (*poses, replace(poses[0], detection_id=1)))


def test_duration_uses_exact_pts_not_rounded_milliseconds():
    observer = api().OfficialObserver()
    results = []
    for pts in (1, 1000, 1999):
        frame, roles, poses = scene(round(pts / 10), kind="none", boundary=False)
        frame = replace(frame, sample=replace(frame.sample, pts=pts, time_base=Fraction(1, 10000)))
        results.append(observer.update(frame, roles, poses)[0])
    assert results[-1]["sustained"] is False
    assert results[-1]["officialRole"] == "UNKNOWN"


def test_gap_uses_exact_pts_and_official_retains_source_frame():
    observer = api().OfficialObserver()
    for pts in (1, 1000, 2001, 4502):
        frame, roles, poses = scene(round(pts / 10), kind="none", boundary=False)
        frame = replace(frame, sample=replace(frame.sample, pts=pts, time_base=Fraction(1, 10000)))
        result = observer.update(frame, roles, poses)[0]
    assert result["supportFrameCount"] == 1
    assert result["lastFrame"] == frame.sample.as_record()


def test_alternating_hands_do_not_supply_one_persistent_signal():
    observer = api().OfficialObserver()
    for ms, side in ((0, "LEFT"), (100, "RIGHT"), (200, "LEFT")):
        changes = None
        if side == "RIGHT":
            changes = {7: {"x": 120, "y": 180}, 9: {"x": 120, "y": 210},
                       8: {"x": 160, "y": 100}, 10: {"x": 160, "y": 60}}
        result = observer.update(*scene(ms, kind="none", boundary=False, changes=changes))[0]
    assert result["officialRole"] == "UNKNOWN"
    assert result["supportFrameCount"] == 1
    assert result["signalSide"] == "LEFT"


def test_impossible_speck_geometry_does_not_run_shaft_processing(monkeypatch):
    frame, _, poses = scene(kind="none")
    for y in range(0, 130, 5):
        for x in range(5, 250, 5):
            frame.sample.rgb[y:y + 3, x:x + 3] = (245, 225, 15)
    calls = []
    original = cv2.Canny
    def counted(*args, **kwargs):
        calls.append(True)
        return original(*args, **kwargs)
    monkeypatch.setattr(cv2, "Canny", counted)
    assert api().held_objects(frame.sample.rgb, poses[0])[0]["kind"] == "UNKNOWN"
    assert calls == []


def test_multiple_plausible_patches_share_one_hand_shaft_extraction(monkeypatch):
    frame, _, poses = scene(kind="yellow")
    frame.sample.rgb[43:59, 129:139] = (245, 225, 15)
    calls = []
    original = cv2.Canny
    def counted(*args, **kwargs):
        calls.append(True)
        return original(*args, **kwargs)
    monkeypatch.setattr(cv2, "Canny", counted)
    api().held_objects(frame.sample.rgb, poses[0])
    assert len(calls) == 1
