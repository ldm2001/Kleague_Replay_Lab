from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from math import isfinite
from numbers import Real
from typing import Any


ROLE_LABELS = ("ball", "goalkeeper", "player", "referee")
KEYPOINT_NAMES = (
    "Nose", "L_Eye", "R_Eye", "L_Ear", "R_Ear", "L_Shoulder", "R_Shoulder",
    "L_Elbow", "R_Elbow", "L_Wrist", "R_Wrist", "L_Hip", "R_Hip",
    "L_Knee", "R_Knee", "L_Ankle", "R_Ankle",
)


def _number(value: Any, reason: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError(reason)
    try:
        normalized = float(value)
    except (OverflowError, ValueError):
        raise ValueError(reason) from None
    if not isfinite(normalized):
        raise ValueError(reason)
    return normalized


def _identifier(value: Any, reason: str) -> None:
    if type(value) is not int or value < 0:
        raise ValueError(reason)


def _score(value: Any, reason: str) -> float:
    normalized = _number(value, reason)
    if not 0 <= normalized <= 1:
        raise ValueError(reason)
    return normalized


def _box(value: Any, reason: str) -> tuple[float, float, float, float]:
    if not isinstance(value, tuple) or len(value) != 4:
        raise ValueError(reason)
    normalized = tuple(_number(item, reason) for item in value)
    x1, y1, x2, y2 = normalized
    if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
        raise ValueError(reason)
    return normalized


@dataclass(frozen=True, slots=True)
class RoleDetection:
    role_detection_id: int
    role: str
    box: tuple[float, float, float, float]
    score: float

    def __post_init__(self) -> None:
        _identifier(self.role_detection_id, "ROLE_DETECTION_ID_INVALID")
        if self.role not in ROLE_LABELS:
            raise ValueError("ROLE_LABEL_INVALID")
        object.__setattr__(self, "box", _box(self.box, "ROLE_BOX_INVALID"))
        object.__setattr__(self, "score", _score(self.score, "ROLE_SCORE_INVALID"))

    def as_record(self) -> dict[str, Any]:
        return {"roleDetectionId": self.role_detection_id, "role": self.role,
                "box": list(self.box), "score": self.score, "source": "MODEL_ROLE_DETECTION"}


@dataclass(frozen=True, slots=True)
class RoleHypothesis:
    detection_id: int
    status: str
    role: str | None = None
    score: float | None = None
    role_detection_id: int | None = None
    iou: float | None = None

    def __post_init__(self) -> None:
        _identifier(self.detection_id, "ROLE_SOURCE_ID_INVALID")
        if self.status not in ("MATCHED", "UNMATCHED", "AMBIGUOUS"):
            raise ValueError("ROLE_MATCH_STATUS_INVALID")
        if self.status != "MATCHED":
            if any(value is not None for value in (self.role, self.score, self.role_detection_id, self.iou)):
                raise ValueError("UNMATCHED_ROLE_FIELDS_PRESENT")
            return
        if self.role not in ROLE_LABELS[1:]:
            raise ValueError("ROLE_MATCH_LABEL_INVALID")
        _identifier(self.role_detection_id, "ROLE_DETECTION_ID_INVALID")
        object.__setattr__(self, "score", _score(self.score, "ROLE_SCORE_INVALID"))
        object.__setattr__(self, "iou", _score(self.iou, "ROLE_IOU_INVALID"))

    def as_record(self) -> dict[str, Any]:
        return {"detectionId": self.detection_id, "status": self.status, "role": self.role,
                "score": self.score, "roleDetectionId": self.role_detection_id, "iou": self.iou,
                "source": "MODEL_ROLE_ASSOCIATION", "admission": "NOT_ADMITTED"}


@dataclass(frozen=True, slots=True)
class Keypoint:
    index: int
    name: str
    x: float
    y: float
    score: float

    def __post_init__(self) -> None:
        _identifier(self.index, "KEYPOINT_INDEX_INVALID")
        if self.index >= len(KEYPOINT_NAMES) or KEYPOINT_NAMES[self.index] != self.name:
            raise ValueError("KEYPOINT_MAPPING_INVALID")
        for field in ("x", "y", "score"):
            object.__setattr__(self, field, _number(getattr(self, field), "KEYPOINT_VALUE_INVALID"))

    def as_record(self) -> dict[str, Any]:
        return {"index": self.index, "name": self.name, "x": self.x, "y": self.y, "score": self.score}


@dataclass(frozen=True, slots=True)
class PoseObservation:
    detection_id: int
    source_box: tuple[float, float, float, float]
    keypoints: tuple[Keypoint, ...]
    source_to_input: tuple[tuple[float, float, float], tuple[float, float, float]]
    input_size: tuple[int, int] = (192, 256)

    def __post_init__(self) -> None:
        _identifier(self.detection_id, "POSE_SOURCE_ID_INVALID")
        object.__setattr__(self, "source_box", _box(self.source_box, "POSE_SOURCE_BOX_INVALID"))
        if (not isinstance(self.keypoints, tuple) or len(self.keypoints) != 17
                or any(not isinstance(point, Keypoint) for point in self.keypoints)
                or tuple(point.index for point in self.keypoints) != tuple(range(17))):
            raise ValueError("POSE_KEYPOINT_MAPPING_INVALID")
        if (not isinstance(self.input_size, tuple) or len(self.input_size) != 2
                or any(type(value) is not int or value <= 0 for value in self.input_size)):
            raise ValueError("POSE_INPUT_SIZE_INVALID")
        if (not isinstance(self.source_to_input, tuple) or len(self.source_to_input) != 2
                or any(not isinstance(row, tuple) or len(row) != 3 for row in self.source_to_input)):
            raise ValueError("POSE_TRANSFORM_INVALID")
        matrix = tuple(tuple(_number(value, "POSE_TRANSFORM_INVALID") for value in row)
                       for row in self.source_to_input)
        diagonal = Fraction(matrix[0][0]) * Fraction(matrix[1][1])
        cross = Fraction(matrix[0][1]) * Fraction(matrix[1][0])
        if diagonal == cross:
            raise ValueError("POSE_TRANSFORM_INVALID")
        object.__setattr__(self, "source_to_input", matrix)

    def as_record(self) -> dict[str, Any]:
        return {"detectionId": self.detection_id, "sourceBox": list(self.source_box),
                "keypoints": [point.as_record() for point in self.keypoints],
                "sourceToInput": [list(row) for row in self.source_to_input],
                "inputSize": {"width": self.input_size[0], "height": self.input_size[1]}, "source": "MODEL_POSE"}
