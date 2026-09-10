"""Optional, source-hash-bound development regression; footage is never bundled.

REPLAY_BROADCAST_VIDEO must point to the reviewed K League highlight original.
Labels mean only visible GOAL broadcast graphics, not goals awarded or VAR use.
These fixed QA times are deliberately absent from the production detector.
"""

import hashlib
import os
from pathlib import Path

import cv2
import pytest

from replay_video.infrastructure.broadcast import BroadcastCueRecognizer, goal_graphic


@pytest.fixture(scope="module")
def broadcast_video():
    source = os.environ.get("REPLAY_BROADCAST_VIDEO")
    if not source:
        pytest.skip("REPLAY_BROADCAST_VIDEO not provided for optional development regression")
    path = Path(source)
    with path.open("rb") as stream:
        assert hashlib.file_digest(stream, "sha256").hexdigest() == "2242f5fc1b0e61e7b6ef9e184aab7ef4ff3dc13bfc9e03f9a16ab0e015b00857"
    return path


@pytest.mark.parametrize("timestamp", [533500, 533600, 533700, 533800, 702000, 702500])
def test_visible_goal_glyphs_include_joined_animation_letters(broadcast_video, timestamp):
    capture = cv2.VideoCapture(str(broadcast_video))
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp)
        ok, frame = capture.read()
        assert ok
        assert goal_graphic(frame)
    finally:
        capture.release()


@pytest.mark.parametrize("timestamp", [60000, 240000, 400000, 535000, 687000, 731000])
def test_regular_scorebugs_and_final_score_are_not_goal_glyphs(broadcast_video, timestamp):
    capture = cv2.VideoCapture(str(broadcast_video))
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp)
        ok, frame = capture.read()
        assert ok
        assert not goal_graphic(frame)
    finally:
        capture.release()


@pytest.mark.parametrize("start,end", [(260000, 264000), (381000, 385000), (532000, 536000), (642000, 646000), (701000, 705000)])
def test_reviewed_goal_graphic_sequence_emits_one_cue(broadcast_video, start, end):
    capture = cv2.VideoCapture(str(broadcast_video))
    detector = BroadcastCueRecognizer()
    events = []
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, start)
        fps = capture.get(cv2.CAP_PROP_FPS)
        stride = max(1, round(fps / 15))
        for index in range(round((end - start) * fps / 1000)):
            ok, frame = capture.read()
            assert ok
            if index % stride:
                continue
            event = detector.update(frame, round(capture.get(cv2.CAP_PROP_POS_MSEC)), 0)
            if event is not None:
                events.append(event)
    finally:
        capture.release()
    assert len(events) == 1
    assert start <= events[0]["startMs"] < events[0]["endMs"] <= end
    assert len(set(events[0]["evidenceTimestampsMs"])) >= 2
