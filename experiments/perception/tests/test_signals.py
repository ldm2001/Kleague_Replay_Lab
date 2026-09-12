from fractions import Fraction
import importlib
import json
import math

import numpy as np
import pytest

from replay_perception.media import VideoSample
from replay_perception.models import Detection
from replay_perception.observations import KEYPOINT_NAMES, Keypoint, PoseObservation, RoleHypothesis
from replay_perception.recorded_frames import RecordedFrame


def api():
    return importlib.import_module("replay_perception.signals")


def pose_observation(detection_id=0, *, left="raised", right="not_raised", changes=None,
                     source_box=(20, 10, 140, 220)):
    coordinates = {index: (30.0 + index, 30.0 + index) for index in range(17)}
    coordinates.update({
        5: (50, 100), 7: (50, 60), 9: (50, 20), 11: (50, 180),
        6: (100, 100), 8: (100, 130), 10: (100, 160), 12: (100, 180),
    })
    if left == "not_raised":
        coordinates.update({5: (50, 100), 7: (50, 130), 9: (50, 160), 11: (50, 180)})
    if right == "raised":
        coordinates.update({6: (100, 100), 8: (100, 60), 10: (100, 20), 12: (100, 180)})
    point_changes = changes or {}
    points = []
    for index, name in enumerate(KEYPOINT_NAMES):
        x, y = coordinates[index]
        point = {"x": x, "y": y, "score": .9}
        point.update(point_changes.get(index, {}))
        points.append(Keypoint(index, name, point["x"], point["y"], point["score"]))
    return PoseObservation(detection_id, source_box, tuple(points), ((1., 0., 0.), (0., 1., 0.)))


def source_detection(detection_id=0, *, track_id="person-track-7", label="person",
                     box=(20, 10, 140, 220)):
    return Detection(detection_id, label, box, .9, track_id)


def role_hypothesis(detection_id=0, *, role="referee", score=.9, status="MATCHED"):
    if status != "MATCHED":
        return RoleHypothesis(detection_id, status)
    return RoleHypothesis(detection_id, status, role, score, 10 + detection_id, .8)


def recorded_frame(timestamp_ms, *, detections=None, continuity_id=4, record_index=None,
                   pts=None, stream_index=2, origin_pts=10_000,
                   time_base=Fraction(1, 1000), origin_time_base=None):
    if detections is None:
        detections = (source_detection(),)
    if pts is None:
        pts = origin_pts + timestamp_ms
    if origin_time_base is None:
        origin_time_base = time_base
    if record_index is None:
        record_index = timestamp_ms // 100
    sample = VideoSample(
        record_index, stream_index, pts, time_base, origin_pts,
        origin_time_base, timestamp_ms, np.zeros((240, 160, 3), dtype=np.uint8),
    )
    return RecordedFrame(sample, tuple(detections), continuity_id, record_index)


def test_arm_observations_classifies_left_then_right_in_original_image_coordinates():
    left, right = api().arm_observations(pose_observation(), 160, 240)

    assert (left["side"], right["side"]) == ("LEFT", "RIGHT")
    assert left == {
        "detectionId": 0,
        "side": "LEFT",
        "state": "ARM_RAISED",
        "reasonCode": "ARM_RAISED_CRITERIA_MET",
        "keypointIndices": [5, 7, 9, 11],
        "rawMinimumKeypointScore": .9,
        "torsoLengthPx": 80.0,
        "upperArmLengthPx": 40.0,
        "forearmLengthPx": 40.0,
        "shoulderWristLengthPx": 80.0,
        "wristAboveShoulderPx": 80.0,
        "wristAboveShoulderTorsoRatio": 1.0,
        "elbowInteriorAngleDegrees": 180.0,
        "shoulderWristVerticalUpAngleDegrees": 0.0,
    }
    assert right["state"] == "NOT_RAISED"
    assert right["reasonCode"] == "ARM_RAISED_CRITERIA_NOT_MET"
    assert right["keypointIndices"] == [6, 8, 10, 12]
    json.dumps((left, right), allow_nan=False)


def test_right_arm_can_be_positive_independently_and_records_no_decision_or_foul():
    left, right = api().arm_observations(
        pose_observation(left="not_raised", right="raised"), 160, 240,
    )
    assert left["state"] == "NOT_RAISED"
    assert right["state"] == "ARM_RAISED"
    assert not ({"foul", "decision", "originalDecision"} & set(right))


@pytest.mark.parametrize("width,height", [(0, 240), (-1, 240), (160, 0), (True, 240), (160, 1.5)])
def test_arm_observations_rejects_nonpositive_or_noninteger_image_dimensions(width, height):
    with pytest.raises(ValueError, match="FRAME_DIMENSIONS_INVALID"):
        api().arm_observations(pose_observation(), width, height)


def test_raw_keypoint_score_boundary_is_inclusive_and_not_treated_as_probability_calibration():
    at_boundary = pose_observation(changes={5: {"score": .5}})
    below_boundary = pose_observation(changes={5: {"score": .499999}})
    raw_over_one = pose_observation(changes={5: {"score": 1.4}, 7: {"score": 1.2},
                                             9: {"score": 1.3}, 11: {"score": 1.1}})

    assert api().arm_observations(at_boundary, 160, 240)[0]["state"] == "ARM_RAISED"
    below = api().arm_observations(below_boundary, 160, 240)[0]
    assert below["state"] == "UNOBSERVABLE"
    assert below["reasonCode"] == "KEYPOINT_SCORE_BELOW_THRESHOLD"
    assert below["rawMinimumKeypointScore"] == .499999
    assert api().arm_observations(raw_over_one, 160, 240)[0]["rawMinimumKeypointScore"] == 1.1


@pytest.mark.parametrize("index,change", [
    (5, {"x": -0.001}), (7, {"x": 160}), (9, {"y": -0.001}), (11, {"y": 240}),
])
def test_out_of_original_image_keypoint_is_unobservable_and_never_clipped(index, change):
    record = api().arm_observations(pose_observation(changes={index: change}), 160, 240)[0]
    assert record["state"] == "UNOBSERVABLE"
    assert record["reasonCode"] == "KEYPOINT_OUTSIDE_SOURCE_IMAGE"
    assert "elbowInteriorAngleDegrees" not in record


@pytest.mark.parametrize("source_box,expected", [
    ((20, 10, 32, 74), "ARM_RAISED"),
    ((20, 10, 31.999, 74), "UNOBSERVABLE"),
    ((20, 10, 32, 73.999), "UNOBSERVABLE"),
])
def test_source_box_minimum_width_and_height_boundaries(source_box, expected):
    record = api().arm_observations(pose_observation(source_box=source_box), 160, 240)[0]
    assert record["state"] == expected
    if expected == "UNOBSERVABLE":
        assert record["reasonCode"] == "SOURCE_BOX_TOO_SMALL"


def test_short_torso_and_zero_arm_segments_are_unobservable_not_negative_observations():
    short_torso = api().arm_observations(
        pose_observation(changes={11: {"x": 50, "y": 107.999}}), 160, 240,
    )[0]
    zero_upper_arm = api().arm_observations(
        pose_observation(changes={7: {"x": 50, "y": 100}}), 160, 240,
    )[0]
    zero_shoulder_wrist = api().arm_observations(
        pose_observation(changes={9: {"x": 50, "y": 100}}), 160, 240,
    )[0]

    assert (short_torso["state"], short_torso["reasonCode"]) == (
        "UNOBSERVABLE", "TORSO_LENGTH_BELOW_MINIMUM",
    )
    assert short_torso["torsoLengthPx"] == pytest.approx(7.999)
    for record in (zero_upper_arm, zero_shoulder_wrist):
        assert (record["state"], record["reasonCode"]) == (
            "UNOBSERVABLE", "ARM_GEOMETRY_DEGENERATE",
        )
        json.dumps(record, allow_nan=False)


def test_overflowing_geometry_is_unobservable_and_never_serializes_nonfinite_measures():
    huge = 1.7e308
    record = api().arm_observations(
        pose_observation(
            changes={
                5: {"x": huge, "y": huge},
                7: {"x": huge, "y": 0},
                9: {"x": 0, "y": huge},
                11: {"x": 0, "y": 0},
            },
            source_box=(0, 0, huge, huge),
        ),
        10 ** 400,
        10 ** 400,
    )[0]
    assert (record["state"], record["reasonCode"]) == (
        "UNOBSERVABLE", "ARM_GEOMETRY_NONFINITE",
    )
    json.dumps(record, allow_nan=False)


def test_tiny_nonzero_arm_lengths_do_not_underflow_angle_denominator():
    record = api().arm_observations(
        pose_observation(changes={
            5: {"x": 0, "y": 0},
            7: {"x": 1e-200, "y": 0},
            9: {"x": 2e-200, "y": 0},
            11: {"x": 0, "y": 8},
        }),
        160,
        240,
    )[0]
    assert record["state"] == "NOT_RAISED"
    assert record["elbowInteriorAngleDegrees"] == pytest.approx(180)
    assert record["shoulderWristVerticalUpAngleDegrees"] == pytest.approx(90)
    json.dumps(record, allow_nan=False)


def test_exact_minimum_torso_length_is_observable_and_geometry_measures_are_finite():
    record = api().arm_observations(
        pose_observation(changes={11: {"x": 50, "y": 108}}), 160, 240,
    )[0]
    assert record["state"] == "ARM_RAISED"
    assert record["torsoLengthPx"] == 8.0
    assert all(not isinstance(value, float) or math.isfinite(value) for value in record.values())


def test_wrist_height_ratio_boundary_is_inclusive():
    exact = api().arm_observations(
        pose_observation(changes={7: {"y": 90}, 9: {"y": 80}}), 160, 240,
    )[0]
    below = api().arm_observations(
        pose_observation(changes={7: {"y": 90}, 9: {"y": 80.001}}), 160, 240,
    )[0]
    assert exact["wristAboveShoulderTorsoRatio"] == .25
    assert exact["state"] == "ARM_RAISED"
    assert below["state"] == "NOT_RAISED"


@pytest.mark.parametrize("angle,expected", [(150.0, "ARM_RAISED"), (149.99, "NOT_RAISED")])
def test_elbow_interior_angle_boundary_is_inclusive(angle, expected):
    direction = math.radians(90 + angle)
    wrist = {"x": 50 + 40 * math.cos(direction), "y": 60 + 40 * math.sin(direction)}
    record = api().arm_observations(pose_observation(changes={9: wrist}), 160, 240)[0]
    assert record["elbowInteriorAngleDegrees"] == pytest.approx(angle)
    assert record["state"] == expected


@pytest.mark.parametrize("angle,expected", [(30.0, "ARM_RAISED"), (30.01, "NOT_RAISED")])
def test_vertical_up_angle_boundary_is_inclusive(angle, expected):
    radians = math.radians(angle)
    wrist_x, wrist_y = 50 + 80 * math.sin(radians), 100 - 80 * math.cos(radians)
    changes = {
        7: {"x": (50 + wrist_x) / 2, "y": (100 + wrist_y) / 2},
        9: {"x": wrist_x, "y": wrist_y},
    }
    record = api().arm_observations(pose_observation(changes=changes), 160, 240)[0]
    assert record["shoulderWristVerticalUpAngleDegrees"] == pytest.approx(angle)
    assert record["state"] == expected


def test_tracker_emits_only_when_qualified_run_closes_at_last_observed_support():
    tracker = api().ArmSignalTracker()
    raised = pose_observation()
    referee = role_hypothesis()

    assert tracker.update(recorded_frame(0), (referee,), (raised,)) == ()
    assert tracker.update(recorded_frame(100), (referee,), (raised,)) == ()
    assert tracker.update(recorded_frame(200), (referee,), (raised,)) == ()
    closed = tracker.update(
        recorded_frame(300), (referee,), (pose_observation(left="not_raised"),),
    )

    assert len(closed) == 1
    episode = closed[0]
    assert episode["kind"] == "ARM_RAISED"
    assert episode["actorRoleHypothesis"] == "referee"
    assert episode["admission"] == "NOT_ADMITTED"
    assert episode["continuityId"] == 4
    assert episode["trackId"] == "person-track-7"
    assert episode["side"] == "LEFT"
    assert (episode["startMs"], episode["endMs"], episode["confirmedMs"]) == (0, 200, 200)
    assert episode["supportFrameCount"] == 3
    assert episode["startFrame"] == recorded_frame(0).sample.as_record()
    assert episode["endFrame"] == recorded_frame(200).sample.as_record()
    assert episode["confirmedFrame"] == recorded_frame(200).sample.as_record()
    assert episode["reason"] == "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY"
    assert episode["scope"] == "NOT_DECLARED_DECISION"
    assert episode["episodeId"].startswith("arm-raised-observation-")
    assert not ({"foul", "decision", "originalDecision"} & set(episode))
    json.dumps(episode, allow_nan=False)


@pytest.mark.parametrize("role,status,score", [
    ("player", "MATCHED", .99),
    ("goalkeeper", "MATCHED", .99),
    ("referee", "UNMATCHED", None),
    ("referee", "AMBIGUOUS", None),
    ("referee", "MATCHED", .499999),
])
def test_player_goalkeeper_unknown_and_low_confidence_roles_never_emit(role, status, score):
    tracker = api().ArmSignalTracker()
    hypothesis = role_hypothesis(role=role, status=status, score=score)
    for timestamp in (0, 100, 200):
        assert tracker.update(recorded_frame(timestamp), (hypothesis,), (pose_observation(),)) == ()
    assert tracker.finish() == ()


def test_referee_role_score_boundary_is_inclusive_but_untyped_track_is_never_invented():
    admitted = api().ArmSignalTracker()
    referee = role_hypothesis(score=.50)
    for timestamp in (0, 100, 200):
        admitted.update(recorded_frame(timestamp), (referee,), (pose_observation(),))
    assert len(admitted.finish()) == 1

    untracked = api().ArmSignalTracker()
    no_id = (source_detection(track_id=None),)
    for timestamp in (0, 100, 200):
        untracked.update(recorded_frame(timestamp, detections=no_id), (referee,), (pose_observation(),))
    assert untracked.finish() == ()


@pytest.mark.parametrize("timestamps,expected_count,expected_confirmation", [
    ((0, 100, 199), 0, None),
    ((0, 100, 200), 1, 200),
    ((0, 50, 100, 150, 200), 1, 200),
    ((0, 100, 350), 1, 350),
    ((0, 100, 351), 0, None),
])
def test_duration_frame_count_and_each_gap_use_exact_boundaries(
    timestamps, expected_count, expected_confirmation,
):
    tracker = api().ArmSignalTracker()
    for timestamp in timestamps:
        assert tracker.update(
            recorded_frame(timestamp), (role_hypothesis(),), (pose_observation(),),
        ) == ()
    episodes = tracker.finish()
    assert len(episodes) == expected_count
    if episodes:
        assert episodes[0]["confirmedMs"] == expected_confirmation
        assert episodes[0]["supportFrameCount"] == len(timestamps)


def test_rounded_200ms_timestamp_does_not_qualify_only_199_point_6ms_of_pts_support():
    tracker = api().ArmSignalTracker()
    for index, (pts, rounded_ms) in enumerate(((0, 0), (1000, 100), (1996, 200))):
        tracker.update(
            recorded_frame(
                rounded_ms, pts=pts, origin_pts=0, time_base=Fraction(1, 10_000),
                record_index=index,
            ),
            (role_hypothesis(),), (pose_observation(),),
        )
    assert tracker.finish() == ()


def test_rounded_250ms_gap_does_not_bridge_an_actual_250_point_4ms_gap():
    tracker = api().ArmSignalTracker()
    for index, (pts, rounded_ms) in enumerate(((0, 0), (1000, 100), (3504, 350))):
        tracker.update(
            recorded_frame(
                rounded_ms, pts=pts, origin_pts=0, time_base=Fraction(1, 10_000),
                record_index=index,
            ),
            (role_hypothesis(),), (pose_observation(),),
        )
    assert tracker.finish() == ()


@pytest.mark.parametrize("break_kind", ["role", "pose", "unobservable"])
def test_missing_or_unobservable_evidence_breaks_instead_of_bridging_occlusion(break_kind):
    tracker = api().ArmSignalTracker()
    referee = role_hypothesis()
    raised = pose_observation()
    tracker.update(recorded_frame(0), (referee,), (raised,))
    tracker.update(recorded_frame(100), (referee,), (raised,))
    roles, poses = (referee,), (raised,)
    if break_kind == "role":
        roles = ()
    elif break_kind == "pose":
        poses = ()
    else:
        poses = (pose_observation(changes={5: {"score": .1}}),)
    assert tracker.update(recorded_frame(200), roles, poses) == ()
    for timestamp in (300, 400, 500):
        assert tracker.update(recorded_frame(timestamp), (referee,), (raised,)) == ()
    episodes = tracker.finish()
    assert len(episodes) == 1
    assert (episodes[0]["startMs"], episodes[0]["endMs"]) == (300, 500)
    assert episodes[0]["supportFrameCount"] == 3


@pytest.mark.parametrize("break_kind", ["cut", "track", "role", "missing_detection", "not_raised"])
def test_cut_track_role_detection_or_pose_change_closes_at_prior_support(break_kind):
    tracker = api().ArmSignalTracker()
    referee = role_hypothesis()
    raised = pose_observation()
    for timestamp in (0, 100, 200):
        tracker.update(recorded_frame(timestamp), (referee,), (raised,))

    frame = recorded_frame(300)
    roles, poses = (referee,), (raised,)
    if break_kind == "cut":
        frame = recorded_frame(300, continuity_id=5)
    elif break_kind == "track":
        frame = recorded_frame(300, detections=(source_detection(track_id="person-track-8"),))
    elif break_kind == "role":
        roles = (role_hypothesis(role="player"),)
    elif break_kind == "missing_detection":
        frame = recorded_frame(300, detections=())
        roles, poses = (), ()
    else:
        poses = (pose_observation(left="not_raised"),)

    episodes = tracker.update(frame, roles, poses)
    assert len(episodes) == 1
    assert episodes[0]["endMs"] == 200
    assert episodes[0]["endFrame"]["timestampMs"] == 200


@pytest.mark.parametrize("case,reason", [
    ("duplicate_detection", "DUPLICATE_DETECTION_ID"),
    ("duplicate_role", "DUPLICATE_ROLE_ID"),
    ("duplicate_pose", "DUPLICATE_POSE_ID"),
    ("foreign_role", "FOREIGN_ROLE_ID"),
    ("foreign_pose", "FOREIGN_POSE_ID"),
    ("role_on_ball", "ROLE_NONPERSON_MAPPING"),
    ("pose_on_ball", "POSE_NONPERSON_MAPPING"),
    ("box_mismatch", "POSE_SOURCE_BOX_MISMATCH"),
])
def test_tracker_rejects_ambiguous_or_foreign_frame_local_mappings(case, reason):
    detections = (source_detection(),)
    roles = (role_hypothesis(),)
    poses = (pose_observation(),)
    if case == "duplicate_detection":
        detections = (source_detection(), source_detection())
    elif case == "duplicate_role":
        roles = (role_hypothesis(), role_hypothesis())
    elif case == "duplicate_pose":
        poses = (pose_observation(), pose_observation())
    elif case == "foreign_role":
        roles = roles + (role_hypothesis(99, status="UNMATCHED"),)
    elif case == "foreign_pose":
        poses = poses + (pose_observation(99),)
    elif case == "role_on_ball":
        detections = (source_detection(label="sports ball"),)
        poses = ()
    elif case == "pose_on_ball":
        detections = (source_detection(label="sports ball"),)
        roles = ()
    else:
        poses = (pose_observation(source_box=(21, 10, 140, 220)),)
    with pytest.raises(ValueError, match=reason):
        api().ArmSignalTracker().update(recorded_frame(0, detections=detections), roles, poses)


def test_same_role_detection_cannot_be_matched_to_two_source_people():
    detections = (source_detection(0, track_id="track-0"), source_detection(1, track_id="track-1"))
    roles = (
        RoleHypothesis(0, "MATCHED", "referee", .9, 12, .8),
        RoleHypothesis(1, "MATCHED", "referee", .9, 12, .8),
    )
    with pytest.raises(ValueError, match="DUPLICATE_ROLE_DETECTION_ID"):
        api().ArmSignalTracker().update(recorded_frame(0, detections=detections), roles, ())


def test_duplicate_person_track_ids_are_rejected_instead_of_counted_twice():
    detections = (source_detection(0), source_detection(1))
    with pytest.raises(ValueError, match="DUPLICATE_TRACK_ID"):
        api().ArmSignalTracker().update(recorded_frame(0, detections=detections), (), ())


def test_frame_local_detection_id_can_change_while_same_track_fragment_continues():
    tracker = api().ArmSignalTracker()
    for timestamp, detection_id in ((0, 0), (100, 1), (200, 2)):
        detection = source_detection(detection_id)
        tracker.update(
            recorded_frame(timestamp, detections=(detection,)),
            (role_hypothesis(detection_id),), (pose_observation(detection_id),),
        )
    episode, = tracker.finish()
    assert episode["supportFrameCount"] == 3
    assert (episode["startMs"], episode["endMs"]) == (0, 200)


def test_gap_over_limit_closes_qualified_run_before_current_observation():
    tracker = api().ArmSignalTracker()
    for timestamp in (0, 100, 200):
        tracker.update(recorded_frame(timestamp), (role_hypothesis(),), (pose_observation(),))
    episode, = tracker.update(
        recorded_frame(451), (role_hypothesis(),), (pose_observation(),),
    )
    assert (episode["startMs"], episode["endMs"], episode["supportFrameCount"]) == (0, 200, 3)
    assert tracker.finish() == ()


@pytest.mark.parametrize("second_timestamp", [100, 99])
def test_duplicate_or_backward_timestamps_fail_instead_of_extending_a_run(second_timestamp):
    tracker = api().ArmSignalTracker()
    tracker.update(recorded_frame(100), (role_hypothesis(),), (pose_observation(),))
    with pytest.raises(ValueError, match="TIMELINE_NON_MONOTONIC"):
        tracker.update(
            recorded_frame(second_timestamp, record_index=2),
            (role_hypothesis(),), (pose_observation(),),
        )


def test_timestamp_must_match_exact_pts_timebase_and_origin_relation():
    with pytest.raises(ValueError, match="FRAME_TIMESTAMP_PTS_MISMATCH"):
        api().ArmSignalTracker().update(
            recorded_frame(100, pts=10_099), (role_hypothesis(),), (pose_observation(),),
        )


@pytest.mark.parametrize("change", ["stream", "origin"])
def test_tracker_rejects_a_source_scope_change(change):
    tracker = api().ArmSignalTracker()
    tracker.update(recorded_frame(0), (role_hypothesis(),), (pose_observation(),))
    kwargs = {"stream_index": 3} if change == "stream" else {"origin_pts": 20_000}
    with pytest.raises(ValueError, match="SOURCE_SCOPE_CHANGED"):
        tracker.update(
            recorded_frame(100, **kwargs), (role_hypothesis(),), (pose_observation(),),
        )


def test_finish_flushes_qualified_runs_once_and_update_after_finish_is_rejected():
    tracker = api().ArmSignalTracker()
    for timestamp in (0, 100, 200):
        tracker.update(recorded_frame(timestamp), (role_hypothesis(),), (pose_observation(),))
    first = tracker.finish()
    assert len(first) == 1
    assert first[0]["endMs"] == 200
    assert tracker.finish() == ()
    with pytest.raises(ValueError, match="TRACKER_FINISHED"):
        tracker.update(recorded_frame(300), (role_hypothesis(),), (pose_observation(),))


def test_episode_ids_are_stable_for_the_same_scoped_source_and_distinct_per_side():
    def run_once():
        tracker = api().ArmSignalTracker()
        both = pose_observation(right="raised")
        for timestamp in (0, 100, 200):
            tracker.update(recorded_frame(timestamp), (role_hypothesis(),), (both,))
        return tracker.finish()

    first, second = run_once(), run_once()
    assert [item["episodeId"] for item in first] == [item["episodeId"] for item in second]
    assert len({item["episodeId"] for item in first}) == 2
    assert [item["side"] for item in first] == ["LEFT", "RIGHT"]


def test_tracker_state_stays_bounded_to_current_active_track_fragments():
    tracker = api().ArmSignalTracker()
    for index in range(500):
        detection = source_detection(track_id=f"track-{index}")
        tracker.update(
            recorded_frame(index * 100, detections=(detection,), record_index=index),
            (role_hypothesis(),), (pose_observation(),),
        )
        assert len(tracker._active) == 1
    assert tracker.finish() == ()
