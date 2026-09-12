from dataclasses import FrozenInstanceError
import importlib
import json
import math

import pytest


def api():
    return importlib.import_module("replay_perception.observations")


def points():
    module = api()
    return tuple(module.Keypoint(index, name, 20 + index, 40 + index, .8)
                 for index, name in enumerate(module.KEYPOINT_NAMES))


def test_role_detection_is_separate_and_immutable():
    value = api().RoleDetection(2, "referee", (10, 20, 30, 90), .8)
    assert value.as_record() == {
        "roleDetectionId": 2, "role": "referee", "box": [10., 20., 30., 90.],
        "score": .8, "source": "MODEL_ROLE_DETECTION",
    }
    with pytest.raises(FrozenInstanceError):
        value.role = "player"


@pytest.mark.parametrize("changes", [
    {"role_detection_id": True}, {"role_detection_id": -1}, {"role": "assistant referee"},
    {"box": (0, 0, 0, 10)}, {"box": (-1, 0, 10, 20)}, {"box": (0, 0, math.inf, 20)},
    {"box": [0, 0, 10, 20]}, {"score": math.nan}, {"score": 1.1}, {"score": True},
])
def test_role_detection_rejects_invalid_values(changes):
    kwargs = dict(role_detection_id=0, role="player", box=(0, 0, 10, 20), score=.5)
    kwargs.update(changes)
    with pytest.raises(ValueError):
        api().RoleDetection(**kwargs)


def test_unmatched_role_does_not_supply_defaults():
    record = api().RoleHypothesis(9, "UNMATCHED").as_record()
    assert record["role"] is None
    assert record["score"] is None
    assert record["roleDetectionId"] is None
    assert record["iou"] is None
    assert record["admission"] == "NOT_ADMITTED"


@pytest.mark.parametrize("kwargs", [
    dict(detection_id=0, status="MATCHED"),
    dict(detection_id=0, status="UNMATCHED", role="referee"),
    dict(detection_id=0, status="AMBIGUOUS", score=.6),
    dict(detection_id=0, status="CONFIRMED"),
    dict(detection_id=True, status="UNMATCHED"),
    dict(detection_id=0, status="MATCHED", role="ball", score=.9, role_detection_id=0, iou=.8),
    dict(detection_id=0, status="MATCHED", role="referee", score=.9, role_detection_id=0, iou=2),
])
def test_role_hypothesis_requires_consistent_fields(kwargs):
    with pytest.raises(ValueError):
        api().RoleHypothesis(**kwargs)


def test_matched_role_keeps_score_and_overlap_distinct():
    value = api().RoleHypothesis(5, "MATCHED", "referee", .7, 2, .9)
    assert value.as_record()["score"] == .7
    assert value.as_record()["iou"] == .9
    assert value.as_record()["source"] == "MODEL_ROLE_ASSOCIATION"


def test_keypoints_preserve_raw_outside_coordinates_and_unbounded_heatmap_score():
    point = api().Keypoint(0, "Nose", -2.5, 1200.5, 1.2)
    assert point.as_record() == {"index": 0, "name": "Nose", "x": -2.5, "y": 1200.5, "score": 1.2}


@pytest.mark.parametrize("args", [
    (-1, "Nose", 0, 0, .5), (True, "Nose", 0, 0, .5), (0, "L_Wrist", 0, 0, .5),
    (0, "Nose", math.nan, 0, .5), (0, "Nose", 0, math.inf, .5),
    (0, "Nose", 0, 0, math.inf), (0, "Nose", True, 0, .5),
])
def test_keypoint_rejects_corrupt_mapping_and_nonfinite_values(args):
    with pytest.raises(ValueError):
        api().Keypoint(*args)


def test_pose_records_exact_source_transform_and_all_keypoints():
    pose = api().PoseObservation(4, (10, 20, 90, 220), points(), ((2., 0., -20.), (0., 2., -40.)))
    record = pose.as_record()
    assert record["inputSize"] == {"width": 192, "height": 256}
    assert record["sourceToInput"] == [[2., 0., -20.], [0., 2., -40.]]
    assert record["detectionId"] == 4
    assert record["source"] == "MODEL_POSE"
    assert len(record["keypoints"]) == 17
    json.dumps(record, allow_nan=False)


@pytest.mark.parametrize("case", ["missing", "duplicate", "reordered", "matrix_nan", "matrix_shape", "matrix_singular", "bad_size"])
def test_pose_rejects_missing_mapping_or_invalid_transform(case):
    keypoints = points()
    matrix = ((1., 0., 0.), (0., 1., 0.))
    size = (192, 256)
    if case == "missing":
        keypoints = keypoints[:-1]
    elif case == "duplicate":
        keypoints = keypoints[:-1] + (keypoints[0],)
    elif case == "reordered":
        keypoints = tuple(reversed(keypoints))
    elif case == "matrix_nan":
        matrix = ((math.nan, 0., 0.), (0., 1., 0.))
    elif case == "matrix_shape":
        matrix = ((1., 0.), (0., 1.))
    elif case == "matrix_singular":
        matrix = ((0., 0., 0.), (0., 0., 0.))
    elif case == "bad_size":
        size = (True, 0)
    with pytest.raises(ValueError):
        api().PoseObservation(0, (0, 0, 100, 200), keypoints, matrix, size)


def test_all_numeric_fields_normalize_to_finite_json_values():
    from fractions import Fraction

    point = api().Keypoint(0, "Nose", Fraction(1, 3), 10, Fraction(4, 5))
    assert type(point.x) is float
    assert json.loads(json.dumps(point.as_record()))["score"] == .8
    with pytest.raises(ValueError):
        api().Keypoint(0, "Nose", 10 ** 1000, 0, .5)


@pytest.mark.parametrize("scale", [1e-200, 1e200])
def test_finite_invertible_transform_survives_determinant_underflow_and_overflow(scale):
    transform = ((scale, 0., 0.), (0., scale, 0.))
    pose = api().PoseObservation(0, (0, 0, 100, 200), points(), transform)
    assert pose.source_to_input == transform
