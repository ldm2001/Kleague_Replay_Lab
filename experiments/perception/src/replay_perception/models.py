from __future__ import annotations

from dataclasses import dataclass
from math import isfinite
from numbers import Real
from typing import Any


LABELS = ("person", "sports ball")


def _finite_real(value: object) -> bool:
    return isinstance(value, Real) and not isinstance(value, bool) and isfinite(value)


@dataclass(frozen=True, slots=True)
class Detection:
    detection_id: int
    label: str
    box: tuple[float, float, float, float]
    score: float
    track_id: str | None = None

    def __post_init__(self) -> None:
        if type(self.detection_id) is not int or self.detection_id < 0:
            raise ValueError("DETECTION_ID_INVALID")
        if self.label not in LABELS:
            raise ValueError("DETECTION_LABEL_INVALID")
        if not isinstance(self.box, tuple) or len(self.box) != 4 or not all(_finite_real(value) for value in self.box):
            raise ValueError("DETECTION_BOX_INVALID")
        normalized_box = tuple(float(value) for value in self.box)
        x1, y1, x2, y2 = normalized_box
        if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
            raise ValueError("DETECTION_BOX_INVALID")
        if not _finite_real(self.score) or not 0 <= self.score <= 1:
            raise ValueError("DETECTION_SCORE_INVALID")
        if self.track_id is not None and (not isinstance(self.track_id, str) or not self.track_id):
            raise ValueError("TRACK_ID_INVALID")
        object.__setattr__(self, "box", normalized_box)
        object.__setattr__(self, "score", float(self.score))

    def as_record(self) -> dict[str, Any]:
        return {
            "detectionId": self.detection_id,
            "label": self.label,
            "box": list(self.box),
            "score": self.score,
            "trackId": self.track_id,
            "actorRole": "UNPROVEN",
            "source": "MODEL_DETECTION",
        }
