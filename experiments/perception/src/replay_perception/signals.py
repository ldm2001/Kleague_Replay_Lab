from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from hashlib import sha256
import json
from math import acos, degrees, hypot, isclose, isfinite
from typing import Any

from .media import timestamp_ms as timestamp_from_pts
from .models import Detection
from .observations import PoseObservation, RoleHypothesis
from .recorded_frames import RecordedFrame


_SIDE_KEYPOINTS = (("LEFT", (5, 7, 9, 11)), ("RIGHT", (6, 8, 10, 12)))


def _at_least(value: float, threshold: float) -> bool:
    return value > threshold or isclose(value, threshold, rel_tol=0.0, abs_tol=1e-9)


def _at_most(value: float, threshold: float) -> bool:
    return value < threshold or isclose(value, threshold, rel_tol=0.0, abs_tol=1e-9)


def _unobservable(base: dict[str, Any], reason: str, **measures: float) -> dict[str, Any]:
    return {**base, "state": "UNOBSERVABLE", "reasonCode": reason, **measures}


def _arm_observation(
    pose: PoseObservation,
    side: str,
    indices: tuple[int, int, int, int],
    width: int,
    height: int,
) -> dict[str, Any]:
    shoulder, elbow, wrist, hip = (pose.keypoints[index] for index in indices)
    points = (shoulder, elbow, wrist, hip)
    base = {
        "detectionId": pose.detection_id,
        "side": side,
        "keypointIndices": list(indices),
        "rawMinimumKeypointScore": min(point.score for point in points),
    }
    x1, y1, x2, y2 = pose.source_box
    if x2 - x1 < 12.0 or y2 - y1 < 64.0:
        return _unobservable(base, "SOURCE_BOX_TOO_SMALL")
    if any(point.score < .50 for point in points):
        return _unobservable(base, "KEYPOINT_SCORE_BELOW_THRESHOLD")
    if any(not (0 <= point.x < width and 0 <= point.y < height) for point in points):
        return _unobservable(base, "KEYPOINT_OUTSIDE_SOURCE_IMAGE")

    torso_length = hypot(hip.x - shoulder.x, hip.y - shoulder.y)
    if not isfinite(torso_length):
        return _unobservable(base, "ARM_GEOMETRY_NONFINITE")
    if torso_length < 8.0:
        return _unobservable(base, "TORSO_LENGTH_BELOW_MINIMUM", torsoLengthPx=torso_length)

    upper_arm_length = hypot(elbow.x - shoulder.x, elbow.y - shoulder.y)
    forearm_length = hypot(wrist.x - elbow.x, wrist.y - elbow.y)
    shoulder_wrist_length = hypot(wrist.x - shoulder.x, wrist.y - shoulder.y)
    if not all(isfinite(value) for value in (upper_arm_length, forearm_length, shoulder_wrist_length)):
        return _unobservable(base, "ARM_GEOMETRY_NONFINITE", torsoLengthPx=torso_length)
    lengths = {
        "torsoLengthPx": torso_length,
        "upperArmLengthPx": upper_arm_length,
        "forearmLengthPx": forearm_length,
        "shoulderWristLengthPx": shoulder_wrist_length,
    }
    if min(upper_arm_length, forearm_length, shoulder_wrist_length) == 0:
        return _unobservable(base, "ARM_GEOMETRY_DEGENERATE", **lengths)

    elbow_cosine = (
        ((shoulder.x - elbow.x) / upper_arm_length)
        * ((wrist.x - elbow.x) / forearm_length)
        + ((shoulder.y - elbow.y) / upper_arm_length)
        * ((wrist.y - elbow.y) / forearm_length)
    )
    elbow_angle = degrees(acos(max(-1.0, min(1.0, elbow_cosine))))
    vertical_cosine = (shoulder.y - wrist.y) / shoulder_wrist_length
    vertical_angle = degrees(acos(max(-1.0, min(1.0, vertical_cosine))))
    wrist_above = shoulder.y - wrist.y
    raised = (
        _at_least(wrist_above, .25 * torso_length)
        and _at_least(elbow_angle, 150.0)
        and _at_most(vertical_angle, 30.0)
    )
    return {
        **base,
        "state": "ARM_RAISED" if raised else "NOT_RAISED",
        "reasonCode": "ARM_RAISED_CRITERIA_MET" if raised else "ARM_RAISED_CRITERIA_NOT_MET",
        **lengths,
        "wristAboveShoulderPx": wrist_above,
        "wristAboveShoulderTorsoRatio": wrist_above / torso_length,
        "elbowInteriorAngleDegrees": elbow_angle,
        "shoulderWristVerticalUpAngleDegrees": vertical_angle,
    }


def arm_observations(pose: PoseObservation, width: int, height: int) -> tuple[dict[str, Any], dict[str, Any]]:
    if type(width) is not int or width <= 0 or type(height) is not int or height <= 0:
        raise ValueError("FRAME_DIMENSIONS_INVALID")
    left = _arm_observation(pose, _SIDE_KEYPOINTS[0][0], _SIDE_KEYPOINTS[0][1], width, height)
    right = _arm_observation(pose, _SIDE_KEYPOINTS[1][0], _SIDE_KEYPOINTS[1][1], width, height)
    return left, right


@dataclass(slots=True)
class _Run:
    continuity_id: int
    track_id: str
    side: str
    start_ms: int
    last_ms: int
    start_time: Fraction
    last_time: Fraction
    support_count: int
    start_frame: dict[str, Any]
    last_frame: dict[str, Any]
    confirmed_ms: int | None = None
    confirmed_frame: dict[str, Any] | None = None

    def extend(self, timestamp_ms: int, relative_time: Fraction, frame_record: dict[str, Any]) -> None:
        self.last_ms = timestamp_ms
        self.last_time = relative_time
        self.last_frame = frame_record
        self.support_count += 1
        if (
            self.confirmed_ms is None
            and self.support_count >= 3
            and relative_time - self.start_time >= Fraction(1, 5)
        ):
            self.confirmed_ms = timestamp_ms
            self.confirmed_frame = frame_record


class ArmSignalTracker:
    def __init__(self) -> None:
        self._active: dict[tuple[int, str, str], _Run] = {}
        self._episode_counter = 0
        self._previous_timestamp_ms: int | None = None
        self._previous_pts_time = None
        self._source_identity = None
        self._finished = False

    def _episode_id(self, run: _Run) -> str:
        identity = {
            "counter": self._episode_counter,
            "streamIndex": run.start_frame["streamIndex"],
            "originPts": run.start_frame["originPts"],
            "originTimeBase": run.start_frame["originTimeBase"],
            "continuityId": run.continuity_id,
            "trackId": run.track_id,
            "side": run.side,
            "startPts": run.start_frame["pts"],
            "startTimeBase": run.start_frame["timeBase"],
        }
        digest = sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        return f"arm-raised-observation-{digest}"

    def _close(self, key: tuple[int, str, str]) -> dict[str, Any] | None:
        run = self._active.pop(key)
        if run.confirmed_ms is None or run.confirmed_frame is None:
            return None
        episode = {
            "episodeId": self._episode_id(run),
            "kind": "ARM_RAISED",
            "actorRoleHypothesis": "referee",
            "admission": "NOT_ADMITTED",
            "continuityId": run.continuity_id,
            "trackId": run.track_id,
            "side": run.side,
            "startMs": run.start_ms,
            "endMs": run.last_ms,
            "confirmedMs": run.confirmed_ms,
            "supportFrameCount": run.support_count,
            "startFrame": run.start_frame,
            "endFrame": run.last_frame,
            "confirmedFrame": run.confirmed_frame,
            "reason": "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY",
            "scope": "NOT_DECLARED_DECISION",
        }
        self._episode_counter += 1
        return episode

    @staticmethod
    def _index_unique(items: tuple[Any, ...], attribute: str, reason: str) -> dict[int, Any]:
        indexed: dict[int, Any] = {}
        for item in items:
            identifier = getattr(item, attribute)
            if identifier in indexed:
                raise ValueError(reason)
            indexed[identifier] = item
        return indexed

    def _validate_input(
        self,
        frame: RecordedFrame,
        roles: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
    ) -> tuple[
        dict[int, Detection],
        dict[int, RoleHypothesis],
        dict[int, PoseObservation],
        Fraction,
        Fraction,
        tuple[Any, ...],
    ]:
        if self._finished:
            raise ValueError("TRACKER_FINISHED")
        if type(frame.continuity_id) is not int or frame.continuity_id < 0:
            raise ValueError("CONTINUITY_ID_INVALID")
        if type(frame.record_index) is not int or frame.record_index < 0:
            raise ValueError("RECORD_INDEX_INVALID")

        sample = frame.sample
        computed_timestamp = timestamp_from_pts(
            sample.pts, sample.time_base, sample.origin_pts, sample.origin_time_base,
        )
        if type(sample.timestamp_ms) is not int or sample.timestamp_ms != computed_timestamp:
            raise ValueError("FRAME_TIMESTAMP_PTS_MISMATCH")
        source_identity = (sample.stream_index, sample.origin_pts, sample.origin_time_base)
        if self._source_identity is not None and source_identity != self._source_identity:
            raise ValueError("SOURCE_SCOPE_CHANGED")
        pts_time = sample.pts * sample.time_base
        relative_time = pts_time - sample.origin_pts * sample.origin_time_base
        if (
            self._previous_timestamp_ms is not None
            and (
                sample.timestamp_ms <= self._previous_timestamp_ms
                or pts_time <= self._previous_pts_time
            )
        ):
            raise ValueError("TIMELINE_NON_MONOTONIC")

        if not isinstance(frame.detections, tuple) or any(
            not isinstance(item, Detection) for item in frame.detections
        ):
            raise ValueError("DETECTIONS_INVALID")
        if not isinstance(roles, tuple) or any(not isinstance(item, RoleHypothesis) for item in roles):
            raise ValueError("ROLES_INVALID")
        if not isinstance(poses, tuple) or any(not isinstance(item, PoseObservation) for item in poses):
            raise ValueError("POSES_INVALID")
        detections = self._index_unique(frame.detections, "detection_id", "DUPLICATE_DETECTION_ID")
        role_by_id = self._index_unique(roles, "detection_id", "DUPLICATE_ROLE_ID")
        pose_by_id = self._index_unique(poses, "detection_id", "DUPLICATE_POSE_ID")
        matched_role_detection_ids: set[int] = set()
        for role in roles:
            if role.status != "MATCHED":
                continue
            if role.role_detection_id in matched_role_detection_ids:
                raise ValueError("DUPLICATE_ROLE_DETECTION_ID")
            matched_role_detection_ids.add(role.role_detection_id)
        track_ids: set[str] = set()
        for detection in detections.values():
            if detection.label != "person" or detection.track_id is None:
                continue
            if detection.track_id in track_ids:
                raise ValueError("DUPLICATE_TRACK_ID")
            track_ids.add(detection.track_id)

        for detection_id in role_by_id:
            if detection_id not in detections:
                raise ValueError("FOREIGN_ROLE_ID")
            if detections[detection_id].label != "person":
                raise ValueError("ROLE_NONPERSON_MAPPING")
        for detection_id, pose in pose_by_id.items():
            if detection_id not in detections:
                raise ValueError("FOREIGN_POSE_ID")
            detection = detections[detection_id]
            if detection.label != "person":
                raise ValueError("POSE_NONPERSON_MAPPING")
            if pose.source_box != detection.box:
                raise ValueError("POSE_SOURCE_BOX_MISMATCH")
        return detections, role_by_id, pose_by_id, pts_time, relative_time, source_identity

    def update(
        self,
        frame: RecordedFrame,
        roles: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
    ) -> tuple[dict[str, Any], ...]:
        (
            detections,
            role_by_id,
            pose_by_id,
            pts_time,
            relative_time,
            source_identity,
        ) = self._validate_input(frame, roles, poses)
        frame_record = frame.sample.as_record()
        width, height = frame_record["width"], frame_record["height"]
        timestamp_ms = frame.sample.timestamp_ms
        observed: set[tuple[int, str, str]] = set()
        emitted: list[dict[str, Any]] = []

        for detection_id, detection in detections.items():
            role = role_by_id.get(detection_id)
            pose = pose_by_id.get(detection_id)
            if (
                detection.label != "person"
                or detection.track_id is None
                or role is None
                or role.status != "MATCHED"
                or role.role != "referee"
                or role.score is None
                or role.score < .50
                or pose is None
                or pose.source_box != detection.box
            ):
                continue
            for arm in arm_observations(pose, width, height):
                if arm["state"] != "ARM_RAISED":
                    continue
                key = (frame.continuity_id, detection.track_id, arm["side"])
                observed.add(key)
                current = self._active.get(key)
                if current is not None and relative_time - current.last_time > Fraction(1, 4):
                    episode = self._close(key)
                    if episode is not None:
                        emitted.append(episode)
                    current = None
                if current is None:
                    self._active[key] = _Run(
                        continuity_id=frame.continuity_id,
                        track_id=detection.track_id,
                        side=arm["side"],
                        start_ms=timestamp_ms,
                        last_ms=timestamp_ms,
                        start_time=relative_time,
                        last_time=relative_time,
                        support_count=1,
                        start_frame=frame_record,
                        last_frame=frame_record,
                    )
                else:
                    current.extend(timestamp_ms, relative_time, frame_record)

        for key in tuple(self._active):
            if key not in observed:
                episode = self._close(key)
                if episode is not None:
                    emitted.append(episode)
        self._previous_timestamp_ms = timestamp_ms
        self._previous_pts_time = pts_time
        self._source_identity = source_identity
        return tuple(emitted)

    def finish(self) -> tuple[dict[str, Any], ...]:
        if self._finished:
            return ()
        emitted: list[dict[str, Any]] = []
        for key in tuple(self._active):
            episode = self._close(key)
            if episode is not None:
                emitted.append(episode)
        self._finished = True
        return tuple(emitted)
