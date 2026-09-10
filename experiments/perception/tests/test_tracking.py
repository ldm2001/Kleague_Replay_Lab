import math

import numpy as np
import pytest

from replay_perception.models import Detection
from replay_perception.tracking import TrackAssociator


def detection(
    detection_id: int,
    label: str = "person",
    box: tuple[float, float, float, float] = (10, 10, 30, 50),
    score: float = .95,
) -> Detection:
    return Detection(detection_id, label, box, score)


def test_actual_bytetrack_keeps_an_identifier_for_a_repeated_box():
    associator = TrackAssociator(frame_rate=2)

    first = associator.update((detection(0),), 0, 7)
    second = associator.update((detection(0, box=(11, 10, 31, 50)),), 500, 7)
    third = associator.update((detection(0, box=(12, 10, 32, 50)),), 1000, 7)

    assert first[0].track_id is None
    assert second[0].track_id is not None
    assert second[0].track_id == third[0].track_id
    assert second[0].track_id.startswith("7:0:person:")


def test_provenance_exposes_the_exact_fixed_tracker_configuration():
    associator = TrackAssociator(frame_rate=2)

    assert associator.provenance == {
        "library": "roboflow/trackers",
        "library_version": "2.6.0",
        "tracker": "ByteTrackTracker",
        "frame_rate": 2.0,
        "lost_track_buffer": 30,
        "track_activation_threshold": .7,
        "minimum_consecutive_frames": 2,
        "minimum_iou_threshold": .1,
        "high_conf_det_threshold": .6,
        "state_estimator": "XCYCSRStateEstimator",
        "iou": "IoU",
        "maximum_gap_ms": 1_500,
        "label_partition": ["person", "sports ball"],
    }


def test_overlapping_labels_use_independent_identifiers():
    associator = TrackAssociator(frame_rate=2)
    frame = (
        detection(1, "sports ball", (10, 10, 30, 50)),
        detection(0, "person", (10, 10, 30, 50)),
    )

    associator.update(frame, 0, 4)
    tracked = associator.update(frame, 500, 4)

    assert tracked[0].track_id is not None
    assert tracked[1].track_id is not None
    assert tracked[0].track_id != tracked[1].track_id
    assert ":sports ball:" in tracked[0].track_id
    assert ":person:" in tracked[1].track_id


def test_disappearance_does_not_emit_a_predicted_detection():
    associator = TrackAssociator(frame_rate=2)
    associator.update((detection(0),), 0, 0)
    associator.update((detection(0),), 500, 0)

    assert associator.update((), 1000, 0) == ()


def test_continuity_cut_allocates_a_new_identifier_namespace():
    associator = TrackAssociator(frame_rate=2)
    associator.update((detection(0),), 0, 2)
    before = associator.update((detection(0),), 500, 2)[0].track_id

    first_after_cut = associator.update((detection(0),), 1000, 3)
    after = associator.update((detection(0),), 1500, 3)[0].track_id

    assert first_after_cut[0].track_id is None
    assert before is not None and after is not None
    assert before != after
    assert after.startswith("3:1:person:")


def test_long_gap_in_same_continuity_uses_a_new_generation():
    associator = TrackAssociator(frame_rate=2)
    associator.update((detection(0),), 0, 5)
    before = associator.update((detection(0),), 500, 5)[0].track_id

    first_after_gap = associator.update((detection(0),), 2001, 5)
    after = associator.update((detection(0),), 2501, 5)[0].track_id

    assert first_after_gap[0].track_id is None
    assert before is not None and after is not None
    assert before != after
    assert after.startswith("5:1:person:")


@pytest.mark.parametrize("timestamp", [-1, 1.5, math.nan, math.inf, True, "500"])
def test_invalid_timestamp_is_rejected(timestamp):
    with pytest.raises(ValueError, match="TIMESTAMP_INVALID"):
        TrackAssociator().update((detection(0),), timestamp, 0)


def test_time_cannot_move_backwards():
    associator = TrackAssociator()
    associator.update((detection(0),), 500, 0)

    with pytest.raises(ValueError, match="TIMELINE_NON_MONOTONIC"):
        associator.update((detection(0),), 499, 0)


@pytest.mark.parametrize("continuity_id", [-1, 1.5, math.nan, math.inf, True, "1"])
def test_invalid_continuity_identifier_is_rejected(continuity_id):
    with pytest.raises(ValueError, match="CONTINUITY_ID_INVALID"):
        TrackAssociator().update((detection(0),), 0, continuity_id)


def test_duplicate_frame_local_identifiers_are_rejected():
    values = (detection(0, "person"), detection(0, "sports ball"))

    with pytest.raises(ValueError, match="DETECTION_ID_DUPLICATE"):
        TrackAssociator().update(values, 0, 0)


@pytest.mark.parametrize("frame_rate", [0, -1, math.nan, math.inf, True, "2"])
def test_unsupported_frame_rate_is_rejected(frame_rate):
    with pytest.raises(ValueError, match="FRAME_RATE_UNSUPPORTED"):
        TrackAssociator(frame_rate=frame_rate)


def test_detector_order_and_original_observations_are_preserved():
    associator = TrackAssociator(frame_rate=2)
    frame = (
        detection(8, "sports ball", (2, 3, 9, 11), .91),
        detection(3, "person", (100, 50, 130, 110), .92),
        detection(5, "person", (10, 10, 30, 50), .93),
    )
    associator.update(frame, 0, 9)

    tracked = associator.update(frame, 500, 9)

    assert [value.detection_id for value in tracked] == [8, 3, 5]
    assert [value.label for value in tracked] == ["sports ball", "person", "person"]
    assert [value.box for value in tracked] == [value.box for value in frame]
    assert [value.score for value in tracked] == [value.score for value in frame]


class AlteredBoxTracker:
    def update(self, detections, *, timestamp):
        import supervision as sv

        if len(detections) == 0:
            return sv.Detections.empty()
        return sv.Detections(
            xyxy=np.array([[900, 900, 999, 999]], dtype=float),
            confidence=np.array([.01], dtype=float),
            tracker_id=np.array([42], dtype=int),
            data={"detection_id": np.array([detections.data["detection_id"][0]])},
        )


def test_vendor_output_cannot_replace_detector_coordinates_or_score():
    source = detection(6, box=(20, 30, 40, 70), score=.88)
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: AlteredBoxTracker(),
    )

    result = associator.update((source,), 0, 1)

    assert result == (Detection(6, "person", source.box, source.score, "1:0:person:42"),)


class UnknownSourceTracker:
    def update(self, detections, *, timestamp):
        import supervision as sv

        return sv.Detections(
            xyxy=np.array([[1, 1, 2, 2]], dtype=float),
            confidence=np.array([.5], dtype=float),
            tracker_id=np.array([9], dtype=int),
            data={"detection_id": np.array([999])},
        )


def test_unknown_vendor_source_mapping_is_rejected():
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: UnknownSourceTracker(),
    )

    with pytest.raises(ValueError, match="TRACKER_OUTPUT_INVALID"):
        associator.update((detection(0),), 0, 0)


class MissingSourceTracker:
    def update(self, detections, *, timestamp):
        import supervision as sv

        return sv.Detections(
            xyxy=detections.xyxy.copy(),
            confidence=detections.confidence.copy(),
            tracker_id=np.array([1], dtype=int),
        )


def test_missing_vendor_source_mapping_is_rejected():
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: MissingSourceTracker(),
    )

    with pytest.raises(ValueError, match="TRACKER_OUTPUT_INVALID"):
        associator.update((detection(0),), 0, 0)


class OmittedDetectionTracker:
    def update(self, detections, *, timestamp):
        import supervision as sv

        return sv.Detections.empty()


def test_vendor_omission_preserves_source_without_inventing_an_identifier():
    source = detection(2)
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: OmittedDetectionTracker(),
    )

    assert associator.update((source,), 0, 0) == (source,)


class DuplicateTrackerIdentifier:
    def update(self, detections, *, timestamp):
        import supervision as sv

        if len(detections) == 0:
            return sv.Detections.empty()
        return sv.Detections(
            xyxy=detections.xyxy.copy(),
            confidence=detections.confidence.copy(),
            tracker_id=np.array([3, 3], dtype=int),
            data={"detection_id": detections.data["detection_id"].copy()},
        )


def test_duplicate_vendor_identifier_is_rejected():
    associator = TrackAssociator(
        frame_rate=2,
        _tracker_factory=lambda **_: DuplicateTrackerIdentifier(),
    )
    values = (detection(0), detection(1, box=(50, 10, 70, 50)))

    with pytest.raises(ValueError, match="TRACKER_OUTPUT_INVALID"):
        associator.update(values, 0, 0)
