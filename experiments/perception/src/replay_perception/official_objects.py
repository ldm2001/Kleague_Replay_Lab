from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from math import hypot
from typing import Any

import cv2
import numpy as np

from .media import timestamp_ms
from .observations import PoseObservation, RoleHypothesis
from .recorded_frames import RecordedFrame
from .signals import arm_observations


METHOD = "hand-object-pitch-context-v1"
# Development criteria, not calibrated probabilities or an admitted recognition method.
MIN_SUPPORT = 3
MIN_DURATION_MS = 200
MAX_GAP_MS = 250


def _image(rgb: np.ndarray) -> tuple[int, int]:
    if (not isinstance(rgb, np.ndarray) or rgb.dtype != np.uint8 or rgb.ndim != 3
            or rgb.shape[2] != 3 or min(rgb.shape[:2]) <= 0):
        raise ValueError("OFFICIAL_IMAGE_INVALID")
    return rgb.shape[:2]


def _patch(rgb: np.ndarray, x: float, y: float, radius: float):
    height, width = rgb.shape[:2]
    x1, y1 = max(0, int(x - radius)), max(0, int(y - radius))
    x2, y2 = min(width, int(x + radius) + 1), min(height, int(y + radius) + 1)
    return rgb[y1:y2, x1:x2], x1, y1


def _rectangle_distance(x: float, y: float, box) -> float:
    x1, y1, x2, y2 = box
    return hypot(max(x1 - x, 0, x - x2), max(y1 - y, 0, y - y2))


def _shaft_lines(patch, body_height: float) -> np.ndarray:
    edges = cv2.Canny(cv2.cvtColor(patch, cv2.COLOR_RGB2GRAY), 40, 100)
    minimum = max(6, int(.07 * body_height))
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=minimum,
                            minLineLength=minimum, maxLineGap=max(2, int(.02 * body_height)))
    return np.empty((0, 1, 4), dtype=np.int32) if lines is None else lines


def _shaft(lines, wrist, box, body_height: float) -> bool:
    tolerance = max(4., .04 * body_height)
    for x1, y1, x2, y2 in lines[:, 0]:
        for first, last in (((x1, y1), (x2, y2)), ((x2, y2), (x1, y1))):
            if (hypot(first[0] - wrist[0], first[1] - wrist[1]) <= tolerance
                    and _rectangle_distance(*first, box) >= max(3., .025 * body_height)
                    and _rectangle_distance(*last, box) <= tolerance):
                return True
    return False


def held_objects(rgb: np.ndarray, pose: PoseObservation) -> tuple[dict[str, Any], ...]:
    height, width = _image(rgb)
    body_height = pose.source_box[3] - pose.source_box[1]
    output = []
    for side, indices in (("LEFT", (5, 7, 9)), ("RIGHT", (6, 8, 10))):
        shoulder, elbow, wrist = (pose.keypoints[index] for index in indices)
        base = {"side": side, "kind": "UNKNOWN", "state": "UNOBSERVABLE",
                "admission": "NOT_ADMITTED", "method": METHOD, "keypointIndices": list(indices)}
        if (body_height < 64 or any(point.score < .5 for point in (shoulder, elbow, wrist))
                or any(not (0 <= point.x < width and 0 <= point.y < height)
                       for point in (shoulder, elbow, wrist))):
            output.append({**base, "reason": "HAND_GEOMETRY_UNOBSERVABLE"})
            continue
        if hypot(wrist.x - elbow.x, wrist.y - elbow.y) < 4:
            output.append({**base, "reason": "FOREARM_TOO_SHORT"})
            continue
        # Do not search the shirt/shorts for card-coloured pixels.
        if wrist.y >= shoulder.y:
            output.append({**base, "reason": "HAND_NOT_ABOVE_SHOULDER"})
            continue
        patch, ox, oy = _patch(rgb, wrist.x, wrist.y, min(192., .6 * body_height))
        hsv = cv2.cvtColor(patch, cv2.COLOR_RGB2HSV)
        masks = {
            "YELLOW": cv2.inRange(hsv, (18, 100, 100), (38, 255, 255)),
            "RED": cv2.bitwise_or(cv2.inRange(hsv, (0, 120, 90), (10, 255, 255)),
                                 cv2.inRange(hsv, (170, 120, 90), (179, 255, 255))),
        }
        candidates = []
        lines = None
        for colour, mask in masks.items():
            count, _, stats, _ = cv2.connectedComponentsWithStats(mask)
            for x, y, w, h, area in stats[1:count]:
                if area < 8 or min(w, h) < 3:
                    continue
                box = (int(x + ox), int(y + oy), int(x + ox + w), int(y + oy + h))
                distance = _rectangle_distance(wrist.x, wrist.y, box)
                long_side, short_side = float(max(w, h)), float(min(w, h))
                fill = float(area) / float(w * h)
                ratio = long_side / short_side
                if box[3] > shoulder.y or distance > .35 * body_height:
                    continue
                possible_flag = (.10 * body_height <= long_side <= .5 * body_height
                                 and 1 <= ratio <= 5 and fill >= .35)
                possible_card = (.02 * body_height <= long_side <= .14 * body_height
                                 and 1.15 <= ratio <= 2.4 and fill >= .70
                                 and distance <= .05 * body_height)
                if not possible_flag and not possible_card:
                    continue
                if lines is None:
                    lines = _shaft_lines(patch, body_height)
                shaft = _shaft(lines, (wrist.x - ox, wrist.y - oy),
                               (int(x), int(y), int(x + w), int(y + h)), body_height)
                kind = "UNKNOWN"
                if possible_flag and shaft:
                    kind = "FLAG_LIKE"
                elif possible_card and not shaft:
                    kind = f"{colour}_CARD_LIKE"
                if kind != "UNKNOWN":
                    candidates.append({**base, "kind": kind, "state": "CUE", "colour": colour,
                                       "objectBox": list(box), "pixelArea": int(area),
                                       "rectangleFill": fill, "aspectRatio": ratio,
                                       "wristDistancePx": distance, "shaftSupport": shaft,
                                       "reason": "COLOUR_GEOMETRY_ONLY"})
        if len(candidates) == 1:
            output.append(candidates[0])
        else:
            output.append({**base, "state": "UNKNOWN", "reason":
                           "MULTIPLE_HAND_PATCHES" if candidates else "NO_SUPPORTED_HAND_PATCH"})
    return tuple(output)


def pitch_context(rgb: np.ndarray, pose: PoseObservation) -> dict[str, Any]:
    height, width = _image(rgb)
    ankles = (pose.keypoints[15], pose.keypoints[16])
    if any(point.score < .5 or not (0 <= point.x < width and 0 <= point.y < height) for point in ankles):
        return {"state": "UNKNOWN", "reason": "FEET_UNOBSERVABLE"}
    body_height = pose.source_box[3] - pose.source_box[1]
    if body_height < 64:
        return {"state": "UNKNOWN", "reason": "PERSON_TOO_SMALL"}
    foot_x, foot_y = sum(point.x for point in ankles) / 2, sum(point.y for point in ankles) / 2
    patch, ox, oy = _patch(rgb, foot_x, foot_y, min(256., .65 * body_height))
    hsv = cv2.cvtColor(patch, cv2.COLOR_RGB2HSV)
    grass = cv2.inRange(hsv, (30, 45, 35), (85, 255, 255)) > 0
    white = cv2.inRange(hsv, (0, 0, 155), (179, 65, 255))
    minimum = max(20, int(.4 * body_height))
    lines = cv2.HoughLinesP(white, 1, np.pi / 180, threshold=max(15, minimum // 2),
                            minLineLength=minimum, maxLineGap=max(4, int(.04 * body_height)))
    yy, xx = np.indices(grass.shape)
    radius = np.hypot(xx - (foot_x - ox), yy - (foot_y - oy))
    ring = (radius >= .12 * body_height) & (radius <= .5 * body_height)
    local_ratio = float(grass[ring].mean()) if ring.any() else 0.
    if lines is not None:
        for x1, y1, x2, y2 in lines[:64, 0]:
            length = hypot(float(x2 - x1), float(y2 - y1))
            signed = ((xx - x1) * (y2 - y1) - (yy - y1) * (x2 - x1)) / length
            foot_distance = abs(((foot_x - ox - x1) * (y2 - y1)
                                 - (foot_y - oy - y1) * (x2 - x1)) / length)
            if foot_distance > .25 * body_height:
                continue
            first = (signed > .04 * body_height) & (signed < .25 * body_height)
            second = (signed < -.04 * body_height) & (signed > -.25 * body_height)
            if min(int(first.sum()), int(second.sum())) < 30:
                continue
            ratios = float(grass[first].mean()), float(grass[second].mean())
            contrast = abs(ratios[0] - ratios[1])
            if max(ratios) >= .55 and min(ratios) <= .35 and contrast >= .35:
                return {"state": "NEAR_PITCH_BOUNDARY", "grassSideContrast": contrast,
                        "grassSideRatios": list(ratios), "footLineDistancePx": foot_distance,
                        "line": [int(x1 + ox), int(y1 + oy), int(x2 + ox), int(y2 + oy)],
                        "reason": "WHITE_LINE_AND_OPPOSING_GROUND_CONTEXT"}
    return {"state": "IN_PITCH_CONTEXT" if local_ratio >= .75 else "UNKNOWN",
            "localGrassRatio": local_ratio, "reason": "LOCAL_GROUND_CONTEXT_ONLY"}


@dataclass(slots=True)
class _Support:
    start_ms: int
    start_time: Fraction
    last_time: Fraction
    count: int


class OfficialObserver:
    def __init__(self) -> None:
        self._active: dict[tuple, _Support] = {}
        self._last_ms: int | None = None
        self._source = None

    def update(self, frame: RecordedFrame, roles: tuple[RoleHypothesis, ...],
               poses: tuple[PoseObservation, ...]) -> tuple[dict[str, Any], ...]:
        sample = frame.sample
        ms = sample.timestamp_ms
        relative_time = sample.pts * sample.time_base - sample.origin_pts * sample.origin_time_base
        if ms != timestamp_ms(sample.pts, sample.time_base, sample.origin_pts, sample.origin_time_base):
            raise ValueError("FRAME_TIMESTAMP_PTS_MISMATCH")
        identity = (sample.stream_index, sample.origin_pts, sample.origin_time_base)
        if self._source is not None and identity != self._source:
            raise ValueError("SOURCE_SCOPE_CHANGED")
        if self._last_ms is not None and ms <= self._last_ms:
            raise ValueError("TIMELINE_NON_MONOTONIC")
        detections = {item.detection_id: item for item in frame.detections}
        by_role = {item.detection_id: item for item in roles}
        if len(detections) != len(frame.detections) or len(by_role) != len(roles):
            raise ValueError("DETECTION_ID_DUPLICATE")
        role_ids = [item.role_detection_id for item in roles if item.status == "MATCHED"]
        if len(role_ids) != len(set(role_ids)):
            raise ValueError("ROLE_ASSOCIATION_AMBIGUOUS")
        tracks = [item.track_id for item in frame.detections if item.track_id is not None]
        if len(set(tracks)) != len(tracks):
            raise ValueError("TRACK_ID_DUPLICATE")
        if len({item.detection_id for item in poses}) != len(poses):
            raise ValueError("POSE_ID_DUPLICATE")
        for pose in poses:
            detection = detections.get(pose.detection_id)
            if detection is None or detection.label != "person" or detection.box != pose.source_box:
                raise ValueError("POSE_SOURCE_MISMATCH")
        output, current = [], {}
        for pose in poses:
            detection = detections[pose.detection_id]
            role = by_role.get(pose.detection_id)
            objects = held_objects(sample.rgb, pose)
            context = pitch_context(sample.rgb, pose)
            arms = arm_observations(pose, sample.rgb.shape[1], sample.rgb.shape[0])
            kinds = {item["kind"] for item in objects if item["kind"] != "UNKNOWN"}
            signal = next(iter(kinds)) if len(kinds) == 1 else "UNKNOWN"
            sides = [item["side"] for item in objects if item["kind"] == signal and signal != "UNKNOWN"]
            if not kinds and any(arm["state"] == "ARM_RAISED" for arm in arms):
                signal = "RAISED_ARM"
                sides = [arm["side"] for arm in arms if arm["state"] == "ARM_RAISED"]
            signal_side = "+".join(sorted(sides)) if sides else "UNKNOWN"
            supported = (role is not None and role.status == "MATCHED" and role.role == "referee"
                         and detection.track_id is not None and signal != "UNKNOWN")
            key = (frame.continuity_id, detection.track_id, signal, signal_side, context["state"])
            previous = self._active.get(key) if supported else None
            support = _Support(ms, relative_time, relative_time, 1)
            if previous is not None and relative_time - previous.last_time <= Fraction(MAX_GAP_MS, 1000):
                support = _Support(previous.start_ms, previous.start_time, relative_time, previous.count + 1)
            if supported:
                current[key] = support
            sustained = (supported and support.count >= MIN_SUPPORT
                         and relative_time - support.start_time >= Fraction(MIN_DURATION_MS, 1000))
            official_role = "UNKNOWN"
            if sustained and signal == "FLAG_LIKE" and context["state"] == "NEAR_PITCH_BOUNDARY":
                official_role = "ASSISTANT_CANDIDATE"
            elif sustained and signal != "FLAG_LIKE" and context["state"] == "IN_PITCH_CONTEXT":
                official_role = "MAIN_CANDIDATE"
            ankles = (pose.keypoints[15], pose.keypoints[16])
            feet_visible = all(point.score >= .5 and 0 <= point.x < sample.rgb.shape[1]
                               and 0 <= point.y < sample.rgb.shape[0] for point in ankles)
            foot_point = ([sum(point.x for point in ankles) / 2, sum(point.y for point in ankles) / 2]
                          if feet_visible else None)
            output.append({"detectionId": pose.detection_id, "trackId": detection.track_id,
                           "continuityId": frame.continuity_id, "timestampMs": ms,
                           "startMs": support.start_ms, "supportFrameCount": support.count if supported else 0,
                           "roleHypothesis": role.as_record() if role is not None else None,
                           "objects": list(objects), "pitchContext": context, "arms": list(arms),
                           "signalKind": signal, "signalSide": signal_side, "sustained": bool(sustained),
                           "officialRole": official_role, "originalDecision": "UNKNOWN",
                           "footPoint": foot_point, "personHeightPx": pose.source_box[3] - pose.source_box[1],
                           "lastFrame": sample.as_record(),
                           "admission": "NOT_ADMITTED", "method": METHOD,
                           "reason": "ROLE_AND_OBJECT_METHOD_UNVALIDATED"})
        self._active, self._last_ms, self._source = current, ms, identity
        return tuple(output)
