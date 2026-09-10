import importlib
import math

import pytest


def make_detection(*args, **kwargs):
    try:
        constructor = importlib.import_module("replay_perception.models").Detection
    except ModuleNotFoundError:
        pytest.fail("The neutral detection contract is not implemented")
    return constructor(*args, **kwargs)


def test_detection_records_only_model_observation_and_unproven_role():
    value = make_detection(0, "person", (1, 2, 10, 20), .8)
    assert value.as_record() == {
        "detectionId": 0, "label": "person", "box": [1.0, 2.0, 10.0, 20.0],
        "score": .8, "trackId": None, "actorRole": "UNPROVEN", "source": "MODEL_DETECTION",
    }


@pytest.mark.parametrize("box", [(20, 0, 10, 30), (0, 1, 10, 1), (-1, 0, 10, 20), (0, 0, math.nan, 20), (0, 0, 10, math.inf), (0, 0, 10), (False, 0, 10, 20)])
def test_invalid_box_is_rejected(box):
    with pytest.raises(ValueError, match="DETECTION_BOX_INVALID"):
        make_detection(0, "person", box, .8)


@pytest.mark.parametrize("score", [-.01, 1.01, math.nan, math.inf, True, "0.9"])
def test_invalid_score_is_rejected(score):
    with pytest.raises(ValueError, match="DETECTION_SCORE_INVALID"):
        make_detection(0, "person", (0, 0, 10, 20), score)


@pytest.mark.parametrize("identifier", [-1, True, 1.5, "1"])
def test_detection_identifier_is_frame_local_integer(identifier):
    with pytest.raises(ValueError, match="DETECTION_ID_INVALID"):
        make_detection(identifier, "person", (0, 0, 10, 20), .8)


@pytest.mark.parametrize("label", ["referee", "player", "FOUL", "ball"])
def test_model_labels_are_not_promoted_to_roles_or_soccer_facts(label):
    with pytest.raises(ValueError, match="DETECTION_LABEL_INVALID"):
        make_detection(0, label, (0, 0, 10, 20), .8)


def test_tracking_keeps_the_raw_detection_immutable():
    from dataclasses import FrozenInstanceError, replace
    value = make_detection(3, "sports ball", (1, 1, 8, 8), .4)
    tracked = replace(value, track_id="0:sports ball:1")
    assert value.track_id is None
    assert tracked.box == value.box
    assert tracked.score == value.score
    with pytest.raises(FrozenInstanceError):
        tracked.label = "referee"


@pytest.mark.parametrize("identifier", ["", 1, True])
def test_malformed_tracking_identifier_is_rejected(identifier):
    with pytest.raises(ValueError, match="TRACK_ID_INVALID"):
        make_detection(0, "person", (0, 0, 10, 20), .8, identifier)


def test_box_must_remain_positive_after_float_normalization():
    from fractions import Fraction
    with pytest.raises(ValueError, match="DETECTION_BOX_INVALID"):
        make_detection(0, "person", (Fraction(1), 0, Fraction(1) + Fraction(1, 10**20), 1), .9)
