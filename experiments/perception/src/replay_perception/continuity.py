from __future__ import annotations

import cv2
import numpy as np


class AppearanceContinuity:
    """Conservative sampled-frame appearance contexts, not verified broadcast shots."""

    def __init__(self) -> None:
        self._previous = None
        self._shape = None
        self.boundary_count = 0
        self.provenance = {
            "method": "sampled-appearance-delta-v1",
            "thumbnailWidth": 96,
            "thumbnailHeight": 54,
            "meanRgbDifferenceThreshold": .20,
            "resolutionChangeResets": True,
            "scope": "SAMPLED_APPEARANCE_ONLY",
            "limitations": ["May miss cuts or reset on large motion; does not establish actor identity or live/replay status."],
        }

    def update(self, rgb: np.ndarray) -> int:
        if not isinstance(rgb, np.ndarray) or rgb.dtype != np.uint8 or rgb.ndim != 3 or rgb.shape[2] != 3 or min(rgb.shape[:2]) <= 0:
            raise ValueError("FRAME_INVALID")
        current = cv2.resize(rgb, (96, 54), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
        if self._previous is not None:
            difference = float(np.mean(np.abs(current - self._previous)))
            if rgb.shape != self._shape or difference > .20:
                self.boundary_count += 1
        self._previous = current
        self._shape = rgb.shape
        return self.boundary_count
