from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
from importlib.metadata import version
from math import isfinite
from numbers import Integral, Real
from typing import Any, Protocol

import numpy as np
import supervision as sv
from trackers import ByteTrackTracker
from trackers.utils.state_representations import XCYCSRStateEstimator

from .models import LABELS, Detection


_MAXIMUM_GAP_MS = 1_500
_TRACKER_SETTINGS: dict[str, Any] = {
    "lost_track_buffer": 30,
    "track_activation_threshold": .7,
    "minimum_consecutive_frames": 2,
    "minimum_iou_threshold": .1,
    "high_conf_det_threshold": .6,
    "state_estimator_class": XCYCSRStateEstimator,
}


class _Tracker(Protocol):
    def update(
        self,
        detections: sv.Detections,
        *,
        timestamp: float,
    ) -> sv.Detections: ...


TrackerFactory = Callable[..., _Tracker]


class TrackAssociator:
    """Attach ByteTrack identities to current-frame detector observations."""

    def __init__(
        self,
        frame_rate: float = 2,
        *,
        _tracker_factory: TrackerFactory = ByteTrackTracker,
    ) -> None:
        if (
            not isinstance(frame_rate, Real)
            or isinstance(frame_rate, bool)
            or not isfinite(frame_rate)
            or frame_rate <= 0
        ):
            raise ValueError("FRAME_RATE_UNSUPPORTED")
        if not callable(_tracker_factory):
            raise ValueError("TRACKER_FACTORY_INVALID")

        self._frame_rate = float(frame_rate)
        self._tracker_factory = _tracker_factory
        self.provenance = {
            "library": "roboflow/trackers",
            "library_version": version("trackers"),
            "tracker": "ByteTrackTracker",
            "frame_rate": self._frame_rate,
            "lost_track_buffer": _TRACKER_SETTINGS["lost_track_buffer"],
            "track_activation_threshold": _TRACKER_SETTINGS[
                "track_activation_threshold"
            ],
            "minimum_consecutive_frames": _TRACKER_SETTINGS[
                "minimum_consecutive_frames"
            ],
            "minimum_iou_threshold": _TRACKER_SETTINGS[
                "minimum_iou_threshold"
            ],
            "high_conf_det_threshold": _TRACKER_SETTINGS[
                "high_conf_det_threshold"
            ],
            "state_estimator": XCYCSRStateEstimator.__name__,
            "iou": "IoU",
            "maximum_gap_ms": _MAXIMUM_GAP_MS,
            "label_partition": list(LABELS),
        }
        self._generation = 0
        self._continuity_id: int | None = None
        self._last_timestamp_ms: int | None = None
        self._trackers = self._new_trackers()

    def update(
        self,
        detections: tuple[Detection, ...],
        timestamp_ms: int,
        continuity_id: int,
    ) -> tuple[Detection, ...]:
        self._validate_timestamp(timestamp_ms)
        self._validate_continuity_id(continuity_id)
        self._validate_detections(detections)

        if self._last_timestamp_ms is not None and timestamp_ms < self._last_timestamp_ms:
            raise ValueError("TIMELINE_NON_MONOTONIC")

        reset_required = self._continuity_id is not None and (
            continuity_id != self._continuity_id
            or timestamp_ms - self._last_timestamp_ms > _MAXIMUM_GAP_MS
        )
        if reset_required:
            self._generation += 1
            self._trackers = self._new_trackers()

        assigned: dict[int, str] = {}
        for label in LABELS:
            source = tuple(value for value in detections if value.label == label)
            vendor_input = self._to_vendor_detections(source)
            tracked = self._trackers[label].update(
                vendor_input,
                timestamp=timestamp_ms / 1_000,
            )
            vendor_ids = self._read_vendor_ids(tracked, source)
            for detection_id, vendor_id in vendor_ids.items():
                assigned[detection_id] = (
                    f"{continuity_id}:{self._generation}:{label}:{vendor_id}"
                )

        self._continuity_id = continuity_id
        self._last_timestamp_ms = timestamp_ms
        return tuple(
            replace(value, track_id=assigned.get(value.detection_id))
            for value in detections
        )

    def _new_trackers(self) -> dict[str, _Tracker]:
        return {
            label: self._tracker_factory(
                frame_rate=self._frame_rate,
                **_TRACKER_SETTINGS,
            )
            for label in LABELS
        }

    @staticmethod
    def _validate_timestamp(timestamp_ms: object) -> None:
        if type(timestamp_ms) is not int or timestamp_ms < 0:
            raise ValueError("TIMESTAMP_INVALID")

    @staticmethod
    def _validate_continuity_id(continuity_id: object) -> None:
        if type(continuity_id) is not int or continuity_id < 0:
            raise ValueError("CONTINUITY_ID_INVALID")

    @staticmethod
    def _validate_detections(detections: object) -> None:
        if not isinstance(detections, tuple) or not all(
            isinstance(value, Detection) for value in detections
        ):
            raise ValueError("DETECTIONS_INVALID")
        identifiers = [value.detection_id for value in detections]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("DETECTION_ID_DUPLICATE")

    @staticmethod
    def _to_vendor_detections(
        detections: tuple[Detection, ...],
    ) -> sv.Detections:
        if not detections:
            return sv.Detections.empty()
        return sv.Detections(
            xyxy=np.asarray([value.box for value in detections], dtype=np.float64),
            confidence=np.asarray(
                [value.score for value in detections],
                dtype=np.float64,
            ),
            data={
                "detection_id": np.asarray(
                    [value.detection_id for value in detections],
                    dtype=np.int64,
                )
            },
        )

    @staticmethod
    def _read_vendor_ids(
        tracked: object,
        source: tuple[Detection, ...],
    ) -> dict[int, int]:
        if not isinstance(tracked, sv.Detections):
            raise ValueError("TRACKER_OUTPUT_INVALID")
        if len(tracked) == 0:
            return {}
        if "detection_id" not in tracked.data or tracked.tracker_id is None:
            raise ValueError("TRACKER_OUTPUT_INVALID")

        source_ids = {value.detection_id for value in source}
        returned_source_ids = tracked.data["detection_id"]
        tracker_ids = tracked.tracker_id
        if len(returned_source_ids) != len(tracked) or len(tracker_ids) != len(tracked):
            raise ValueError("TRACKER_OUTPUT_INVALID")

        result: dict[int, int] = {}
        seen: set[int] = set()
        seen_tracker_ids: set[int] = set()
        for raw_source_id, raw_tracker_id in zip(returned_source_ids, tracker_ids):
            if (
                not isinstance(raw_source_id, Integral)
                or isinstance(raw_source_id, bool)
            ):
                raise ValueError("TRACKER_OUTPUT_INVALID")
            source_id = int(raw_source_id)
            if source_id not in source_ids or source_id in seen:
                raise ValueError("TRACKER_OUTPUT_INVALID")
            seen.add(source_id)

            if (
                not isinstance(raw_tracker_id, Integral)
                or isinstance(raw_tracker_id, bool)
                or raw_tracker_id < -1
            ):
                raise ValueError("TRACKER_OUTPUT_INVALID")
            tracker_id = int(raw_tracker_id)
            if tracker_id >= 0:
                if tracker_id in seen_tracker_ids:
                    raise ValueError("TRACKER_OUTPUT_INVALID")
                seen_tracker_ids.add(tracker_id)
                result[source_id] = tracker_id
        return result
