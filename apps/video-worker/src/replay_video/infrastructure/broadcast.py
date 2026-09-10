"""Recognize the upper-left Coupang-style GOAL banner without trained models.

Only this 16:9 broadcast layout is supported. White glyphs, their topology and
shape, a red/blue banner and its navy clock strip must agree. Animations,
occlusion and other layouts can be missed. This is neither OCR for arbitrary
text nor evidence of an awarded goal, scorer, VAR use, or any football decision.
All reference glyphs are drawn by OpenCV, never copied from source footage.
"""

from functools import lru_cache

import cv2
import numpy as np


def _normalized(mask: np.ndarray) -> np.ndarray:
    points = cv2.findNonZero(mask)
    if points is None:
        return np.zeros((32, 32), dtype=bool)
    x, y, width, height = cv2.boundingRect(points)
    return cv2.resize(mask[y:y + height, x:x + width], (32, 32), interpolation=cv2.INTER_AREA) >= 128


@lru_cache(maxsize=8)
def _templates(letter: str) -> tuple[np.ndarray, ...]:
    masks = []
    for font in (cv2.FONT_HERSHEY_SIMPLEX, cv2.FONT_HERSHEY_DUPLEX):
        for thickness in (2, 3, 4, 5, 6):
            mask = np.zeros((60, 60), dtype=np.uint8)
            cv2.putText(mask, letter, (5, 45), font, 1.5, 255, thickness, cv2.LINE_AA)
            masks.append(_normalized(mask))
    return tuple(masks)


def _glyph(mask: np.ndarray, letter: str) -> bool:
    normalized = _normalized(mask)
    if not normalized.any():
        return False
    padded = cv2.copyMakeBorder(normalized.astype(np.uint8), 1, 1, 1, 1, cv2.BORDER_CONSTANT)
    count, _, stats, centers = cv2.connectedComponentsWithStats(1 - padded)
    holes = [(stat[cv2.CC_STAT_AREA], center) for stat, center in zip(stats[2:], centers[2:])]
    large_holes = [(area, center) for area, center in holes if area >= 12]
    if letter in "OA":
        if len(large_holes) != 1:
            return False
        area, center = large_holes[0]
        if letter == "O" and not (area >= 85 and 11 <= center[1] <= 22):
            return False
        if letter == "A" and not (center[1] < 20 and area < 360):
            return False
    elif large_holes:
        return False
    if letter == "G" and normalized[14:20, 18:31].mean() < 0.28:
        return False
    if letter == "L":
        if normalized[2:21, 16:30].mean() > 0.12:
            return False
        if normalized[28:32, 4:29].mean() < 0.6:
            return False
    def similarity(candidate: str) -> float:
        return max(2 * np.logical_and(normalized, template).sum() / (normalized.sum() + template.sum())
                   for template in _templates(candidate))

    score = similarity(letter)
    alternatives = {"O": "0Q", "A": "4"}.get(letter, "")
    return score >= 0.66 and all(score > similarity(alternative) for alternative in alternatives)


def _joined_word(mask: np.ndarray, letters: str = "GOAL") -> bool:
    """Try bounded vertical glyph divisions when bold adjacent letters touch.

    The divisions are proportional typographic ranges, not screenshot assets.
    Every resulting glyph must independently satisfy its topology and shape.
    """
    width = mask.shape[1]
    weights = [0.72 if letter == "L" else 1.0 for letter in letters]
    divisions = [sum(weights[:index]) / sum(weights) for index in range(1, len(letters))]

    def match(index: int, left: int, previous_height: int | None) -> bool:
        candidates = ([width] if index == len(letters) - 1 else
                      range(round(width * (divisions[index] - 0.07)), round(width * (divisions[index] + 0.07)) + 1))
        for right in candidates:
            part = mask[:, left:right]
            points = cv2.findNonZero(part)
            if points is None:
                continue
            _, _, w, h = cv2.boundingRect(points)
            if not 16 <= h <= 31 or not 0.45 <= w / h <= 1.25:
                continue
            if previous_height is not None and not 0.72 <= h / previous_height <= 1.4:
                continue
            if _glyph(part, letters[index]) and (index == len(letters) - 1 or match(index + 1, right, h)):
                return True
        return False

    return match(0, 0, None)


def _component_word(components: list[tuple[int, int, int, int, int]], labels: np.ndarray) -> bool:
    def match(index: int, offset: int) -> bool:
        if index == len(components):
            return offset == 4
        x, y, width, height, label = components[index]
        mask = np.where(labels[y:y + height, x:x + width] == label, 255, 0).astype(np.uint8)
        # Preserve real component boundaries. Splitting the whole word could
        # move part of a G onto a neighbouring zero and manufacture an O.
        counts = [1] if width / height <= 1.25 else range(2, 5 - offset)
        for count in counts:
            if offset + count > 4:
                continue
            letters = "GOAL"[offset:offset + count]
            accepted = _glyph(mask, letters) if count == 1 else _joined_word(mask, letters)
            if accepted and match(index + 1, offset + count):
                return True
        return False

    return match(0, 0)


def _goal_box(frame: np.ndarray) -> tuple[int, int, int, int] | None:
    if frame.ndim != 3 or frame.shape[2] != 3 or frame.shape[0] < 180:
        return None
    height, width = frame.shape[:2]
    if not 1.65 <= width / height <= 1.9:
        return None
    # Normalize only the bounded scorebug crop; never scan pitch or adverts.
    crop = frame[round(height * 20 / 540):round(height * 70 / 540),
                 round(width * 28 / 960):round(width * 264 / 960)]
    image = cv2.resize(crop, (236, 50), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hue, saturation, value = cv2.split(hsv)
    colored = (saturation >= 95) & (value >= 45)
    red = colored & ((hue <= 12) | (hue >= 145))
    blue = colored & (hue >= 95) & (hue <= 140)
    navy = blue & (value <= 160)
    if red[2:30].mean() < 0.05 or navy[32:47].mean() < 0.55:
        return None
    mask = cv2.inRange(hsv[:32], np.array([0, 0, 190]), np.array([179, 85, 255]))
    mask[:2] = 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    components = []
    for index in range(1, count):
        x, y, w, h, area = (int(value) for value in stats[index])
        if 16 <= h <= 31 and w >= 7 and area >= 40:
            components.append((x, y, w, h, index))
    components.sort()
    if not 1 <= len(components) <= 4:
        return None
    x = components[0][0]
    y = min(item[1] for item in components)
    right = max(item[0] + item[2] for item in components)
    bottom = max(item[1] + item[3] for item in components)
    if not 55 <= right - x <= 150:
        return None
    box = x + 28, y + 20, right - x, bottom - y
    if len(components) != 4:
        return box if _component_word(components, labels) else None
    heights = [item[3] for item in components]
    centers = [item[1] + item[3] / 2 for item in components]
    if max(heights) / min(heights) > 1.4 or max(centers) - min(centers) > 6:
        return None
    for left, right in zip(components, components[1:]):
        gap = right[0] - left[0] - left[2]
        if not -3 <= gap <= max(heights) * 0.65:
            return None
    for component, letter in zip(components, "GOAL"):
        x, y, w, h, index = component
        glyph = np.where(labels[y:y + h, x:x + w] == index, 255, 0).astype(np.uint8)
        if not _glyph(glyph, letter):
            return None
    return box


def goal_graphic(frame: np.ndarray) -> bool:
    """Whether one frame has a legible supported GOAL graphic, not a goal."""
    return _goal_box(frame) is not None


class BroadcastCueRecognizer:
    """Confirm stable glyph observations and emit once until 2 s of absence.

    Unconfirmed observations never bridge a shot cut or >1.2 s sample gap.
    An already emitted overlay may persist across cuts without being emitted
    again. Its reported span is the observed confirmation span, not the full
    graphic duration or the underlying football incident duration.
    """

    def __init__(self):
        self._last_ms: int | None = None
        self._continuity_id: int | None = None
        self._start_ms: int | None = None
        self._box: tuple[int, int, int, int] | None = None
        self._evidence: list[int] = []
        self._emitted = False
        self._absent_since_ms: int | None = None

    def _clear_pending(self):
        self._start_ms = None
        self._box = None
        self._evidence = []

    def update(self, frame: np.ndarray, timestamp_ms: int, continuity_id: int) -> dict | None:
        if timestamp_ms < 0 or (self._last_ms is not None and timestamp_ms <= self._last_ms):
            return None
        if self._last_ms is not None and (timestamp_ms - self._last_ms > 1200 or continuity_id != self._continuity_id):
            self._clear_pending()
        self._last_ms = timestamp_ms
        self._continuity_id = continuity_id
        box = _goal_box(frame)
        if box is None:
            self._clear_pending()
            if self._absent_since_ms is None:
                self._absent_since_ms = timestamp_ms
            elif timestamp_ms - self._absent_since_ms >= 2000:
                self._emitted = False
            return None
        self._absent_since_ms = None
        if self._emitted:
            return None
        if self._box is not None:
            before_x, before_y, before_w, before_h = self._box
            x, y, w, h = box
            if (abs(x + w / 2 - before_x - before_w / 2) > 12
                    or abs(y + h / 2 - before_y - before_h / 2) > 6
                    or not 0.75 <= w / before_w <= 1.33):
                self._clear_pending()
        if self._start_ms is None:
            self._start_ms = timestamp_ms
            self._box = box
        self._evidence.append(timestamp_ms)
        if timestamp_ms - self._start_ms >= 300 and len(self._evidence) >= 2:
            self._emitted = True
            return {
                "kind": "GOAL_GRAPHIC",
                "method": "broadcast-goal-glyphs-v1",
                "startMs": self._start_ms,
                "endMs": timestamp_ms,
                "evidenceTimestampsMs": self._evidence.copy(),
            }
        return None

    def finish(self) -> dict | None:
        """No deferred emission: a confirmed interval was already returned."""
        return None
