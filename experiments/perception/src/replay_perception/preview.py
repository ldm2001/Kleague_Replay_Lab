from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .media import VideoSample
from .models import Detection


_COLORS = {
    "person": (45, 220, 255),
    "sports ball": (255, 175, 55),
}


def _preview_record(frame: VideoSample, output_width: int, output_height: int) -> dict[str, Any]:
    frame_record = frame.as_record()
    source_width = frame_record["width"]
    source_height = frame_record["height"]
    return {
        "decodedIndex": frame_record["decodedIndex"],
        "streamIndex": frame_record["streamIndex"],
        "pts": frame_record["pts"],
        "timeBase": frame_record["timeBase"],
        "originPts": frame_record["originPts"],
        "originTimeBase": frame_record["originTimeBase"],
        "timestampMs": frame_record["timestampMs"],
        "timestampSource": frame_record["timestampSource"],
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


def render_preview(
    frame: VideoSample,
    detections: tuple[Detection, ...],
    *,
    max_width: int = 1280,
) -> tuple[bytes, dict[str, Any]]:
    """Render model observations without adding semantic football claims."""
    if type(max_width) is not int or max_width <= 0:
        raise ValueError("PREVIEW_MAX_WIDTH_INVALID")
    if (
        not isinstance(frame.rgb, np.ndarray)
        or frame.rgb.dtype != np.uint8
        or frame.rgb.ndim != 3
        or frame.rgb.shape[2] != 3
    ):
        raise ValueError("PREVIEW_RGB_INVALID")
    height, width = frame.rgb.shape[:2]
    if width <= 0 or height <= 0:
        raise ValueError("PREVIEW_RGB_INVALID")

    annotated = frame.rgb.copy()
    banner_height = min(height, 36)
    cv2.rectangle(annotated, (0, 0), (width - 1, banner_height - 1), (15, 15, 15), thickness=-1)
    banner = f"MODEL DETECTIONS | t={frame.timestamp_ms}ms | ROLE UNPROVEN"
    cv2.putText(
        annotated,
        banner,
        (8, min(25, banner_height - 6)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        (245, 245, 245),
        1,
        cv2.LINE_AA,
    )

    for detection in detections:
        if not isinstance(detection, Detection):
            raise TypeError("PREVIEW_DETECTION_INVALID")
        x1, y1, x2, y2 = (round(value) for value in detection.box)
        color = _COLORS[detection.label]
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, thickness=3)
        label = f"d{detection.detection_id} {detection.label} {detection.score:.2f}"
        if detection.track_id is not None:
            label += f" | track={detection.track_id}"
        text_y = max(banner_height + 16, y1 - 7)
        font_face = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.52
        thickness = 1
        available_width = max(1, width - 8)
        (text_width, _), _ = cv2.getTextSize(label, font_face, font_scale, thickness)
        if text_width > available_width:
            font_scale *= available_width / text_width
            (text_width, _), _ = cv2.getTextSize(label, font_face, font_scale, thickness)
        text_x = min(max(4, x1), max(0, width - text_width - 4))
        cv2.putText(
            annotated,
            label,
            (text_x, min(height - 4, text_y)),
            font_face,
            font_scale,
            color,
            thickness,
            cv2.LINE_AA,
        )

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
