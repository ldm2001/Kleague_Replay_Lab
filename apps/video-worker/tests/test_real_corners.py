import hashlib
import json
import os
from pathlib import Path

import cv2
import pytest

from replay_video.infrastructure.corners import CornerRecognizer


LABELS = json.loads((Path(__file__).resolve().parents[3] / "datasets/labeled-cases/코너개발.json").read_text())


@pytest.fixture(scope="module")
def real_video():
    source = os.environ.get("REPLAY_CORNER_VIDEO")
    if not source:
        pytest.skip("REPLAY_CORNER_VIDEO not provided for optional development regression")
    path = Path(source)
    with path.open("rb") as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest() == LABELS["source_sha256"]
    return path


@pytest.mark.parametrize("case", LABELS["cases"], ids=lambda case: case["id"])
def test_reviewed_development_corner_sequences(real_video, case):
    capture = cv2.VideoCapture(str(real_video))
    assert capture.isOpened()
    events = []
    detector = CornerRecognizer()
    try:
        fps = capture.get(cv2.CAP_PROP_FPS)
        stride = max(1, round(fps / 15))
        capture.set(cv2.CAP_PROP_POS_MSEC, case["start_ms"])
        for index in range(round((case["end_ms"] - case["start_ms"]) * fps / 1000)):
            ok, image = capture.read()
            assert ok
            if index % stride:
                continue
            event = detector.update(image, round(capture.get(cv2.CAP_PROP_POS_MSEC)), 0)
            if event is not None:
                events.append(event)
    finally:
        capture.release()
    assert len(events) == case["expected_count"]
    for event in events:
        assert event["kind"] == "CORNER_KICK"
        assert case["restart_range_ms"][0] <= event["restartMs"] <= case["restart_range_ms"][1]
