from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .observations import PoseObservation, RoleDetection, RoleHypothesis


_SOURCE_COLORS = {
    "person": (45, 220, 255),
    "sports ball": (255, 175, 55),
}
_POSE_COLOR = (100, 255, 120)
_ARM_COLOR = (255, 120, 220)
_KEYPOINT_THRESHOLD = 0.5
_BONES = (
    (5, 6),
    (5, 7),
    (7, 9),
    (6, 8),
    (8, 10),
    (5, 11),
    (6, 12),
    (11, 12),
)


def _preview_record(frame: Any, output_width: int, output_height: int) -> dict[str, Any]:
    sample = frame.sample.as_record()
    source_width = sample["width"]
    source_height = sample["height"]
    return {
        "upstreamRecordIndex": frame.record_index,
        "decodedIndex": sample["decodedIndex"],
        "streamIndex": sample["streamIndex"],
        "pts": sample["pts"],
        "timeBase": sample["timeBase"],
        "originPts": sample["originPts"],
        "originTimeBase": sample["originTimeBase"],
        "timestampMs": sample["timestampMs"],
        "timestampSource": sample["timestampSource"],
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "outputWidth": output_width,
        "outputHeight": output_height,
        "outputScale": {
            "x": output_width / source_width,
            "y": output_height / source_height,
        },
        "annotationCoordinateSpace": "SOURCE_XYXY_PIXELS",
    }


def _put_clamped_text(
    image: np.ndarray,
    text: str,
    x: int,
    y: int,
    color: tuple[int, int, int],
    *,
    font_scale: float = 0.48,
    thickness: int = 1,
) -> None:
    height, width = image.shape[:2]
    face = cv2.FONT_HERSHEY_SIMPLEX
    available_width = width - 4
    available_height = height - 2
    if available_width <= 0 or available_height <= 0:
        return
    (text_width, text_height), baseline = cv2.getTextSize(text, face, font_scale, thickness)
    required_height = text_height + baseline
    if text_width <= 0 or required_height <= 0:
        return
    if text_width > available_width or required_height > available_height:
        minimum_scale = 0.05
        (minimum_width, minimum_height), minimum_baseline = cv2.getTextSize(text, face, minimum_scale, thickness)
        if minimum_width > available_width or minimum_height + minimum_baseline > available_height:
            return
        low, high = minimum_scale, font_scale
        for _ in range(24):
            candidate = (low + high) / 2
            (candidate_width, candidate_height), candidate_baseline = cv2.getTextSize(text, face, candidate, thickness)
            if candidate_width <= available_width and candidate_height + candidate_baseline <= available_height:
                low = candidate
            else:
                high = candidate
        font_scale = low
        (text_width, text_height), baseline = cv2.getTextSize(text, face, font_scale, thickness)
    text_x = min(max(2, x), width - text_width - 2)
    minimum_baseline_y = text_height
    maximum_baseline_y = height - baseline - 1
    if text_x < 0 or minimum_baseline_y > maximum_baseline_y:
        return
    text_y = min(max(minimum_baseline_y, y), maximum_baseline_y)
    cv2.putText(image, text, (text_x, text_y), face, font_scale, color, thickness, cv2.LINE_AA)


def _draw_pose(image: np.ndarray, pose: PoseObservation) -> None:
    height, width = image.shape[:2]
    points = {point.index: point for point in pose.keypoints}
    usable = {
        index: point
        for index, point in points.items()
        if (
            point.score >= _KEYPOINT_THRESHOLD
            and 0 <= point.x < width
            and 0 <= point.y < height
        )
    }
    for first, second in _BONES:
        if first not in usable or second not in usable:
            continue
        start = (round(usable[first].x), round(usable[first].y))
        end = (round(usable[second].x), round(usable[second].y))
        cv2.line(image, start, end, _POSE_COLOR, thickness=2, lineType=cv2.LINE_AA)
    for point in usable.values():
        cv2.circle(
            image,
            (round(point.x), round(point.y)),
            3,
            _POSE_COLOR,
            thickness=-1,
            lineType=cv2.LINE_AA,
        )


def render_observation_preview(
    frame: Any,
    roles_raw: tuple[RoleDetection, ...],
    roles_matched: tuple[RoleHypothesis, ...],
    poses: tuple[PoseObservation, ...],
    arms: tuple[dict[str, Any], ...],
    *,
    max_width: int = 1280,
) -> tuple[bytes, dict[str, Any]]:
    """Render source-space hypotheses without turning them into football decisions."""
    if type(max_width) is not int or max_width <= 0:
        raise ValueError("PREVIEW_MAX_WIDTH_INVALID")
    if not isinstance(roles_raw, tuple) or any(not isinstance(item, RoleDetection) for item in roles_raw):
        raise TypeError("PREVIEW_ROLE_DETECTIONS_INVALID")
    if not isinstance(roles_matched, tuple) or any(
        not isinstance(item, RoleHypothesis) for item in roles_matched
    ):
        raise TypeError("PREVIEW_ROLE_HYPOTHESES_INVALID")
    if not isinstance(poses, tuple) or any(not isinstance(item, PoseObservation) for item in poses):
        raise TypeError("PREVIEW_POSES_INVALID")
    if not isinstance(arms, tuple) or any(not isinstance(item, dict) for item in arms):
        raise TypeError("PREVIEW_ARMS_INVALID")

    sample = getattr(frame, "sample", None)
    rgb = getattr(sample, "rgb", None)
    if (
        not isinstance(rgb, np.ndarray)
        or rgb.dtype != np.uint8
        or rgb.ndim != 3
        or rgb.shape[2] != 3
        or min(rgb.shape[:2]) <= 0
    ):
        raise ValueError("PREVIEW_RGB_INVALID")
    detections = getattr(frame, "detections", None)
    if not isinstance(detections, tuple):
        raise TypeError("PREVIEW_SOURCE_DETECTIONS_INVALID")

    height, width = rgb.shape[:2]
    annotated = rgb.copy()
    banner_height = min(height, 38)
    cv2.rectangle(annotated, (0, 0), (width - 1, banner_height - 1), (15, 15, 15), thickness=-1)
    base = sample.time_base
    origin_base = sample.origin_time_base
    banner = (
        "NOT ADMITTED | ROLE/POSE HYPOTHESES"
        f" | t={sample.timestamp_ms}ms | pts={sample.pts}@{base.numerator}/{base.denominator}"
        f" | origin={sample.origin_pts}@{origin_base.numerator}/{origin_base.denominator}"
    )
    _put_clamped_text(annotated, banner, 8, min(26, banner_height - 5), (245, 245, 245), font_scale=0.55)

    hypotheses = {item.detection_id: item for item in roles_matched}
    arms_by_detection: dict[int, list[dict[str, Any]]] = {}
    for arm in arms:
        if arm.get("state") == "NOT_RAISED":
            continue
        detection_id = arm.get("detectionId")
        if type(detection_id) is int:
            arms_by_detection.setdefault(detection_id, []).append(arm)

    for detection in detections:
        x1, y1, x2, y2 = (round(value) for value in detection.box)
        color = _SOURCE_COLORS[detection.label]
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, thickness=3)
        label = f"d{detection.detection_id} {detection.label}"
        hypothesis = hypotheses.get(detection.detection_id)
        if hypothesis is not None:
            if hypothesis.status == "MATCHED":
                label += f" | hyp:{hypothesis.role} {hypothesis.score:.2f}"
            else:
                label += f" | hyp:{hypothesis.status}"
        if detection.track_id is not None:
            label += f" | track-fragment={detection.track_id}"
        _put_clamped_text(annotated, label, x1, max(banner_height + 16, y1 - 7), color)
        for offset, arm in enumerate(arms_by_detection.get(detection.detection_id, ())):
            side = arm.get("side", "UNKNOWN")
            state = arm.get("state", "UNKNOWN")
            arm_text = f"d{detection.detection_id} raw-arm {side}={state}"
            _put_clamped_text(annotated, arm_text, x1, min(height - 5, y2 - 6 - offset * 16), _ARM_COLOR)

    for pose in poses:
        _draw_pose(annotated, pose)

    if width > max_width:
        output_width = max_width
        output_height = max(1, round(height * max_width / width))
        annotated = cv2.resize(annotated, (output_width, output_height), interpolation=cv2.INTER_AREA)
    else:
        output_width, output_height = width, height

    bgr = cv2.cvtColor(annotated, cv2.COLOR_RGB2BGR)
    encoded, buffer = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not encoded:
        raise ValueError("PREVIEW_JPEG_ENCODE_FAILED")
    return buffer.tobytes(), _preview_record(frame, output_width, output_height)
