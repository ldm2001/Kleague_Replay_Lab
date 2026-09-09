from pathlib import Path
import json

import cv2
import numpy as np
import pytest

from replay_video.domain.ball import BallCandidate, BallTracker
from replay_video.infrastructure.ball import ball_candidates
from replay_video.inspect import inspect_video
from test_context import pitch


IDENTITY = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0)


def point(x=50, y=50):
    return BallCandidate(x, y, 4, 0.85)


def update(tracker, time, x=50, *, candidates=None, affine=IDENTITY, continuity=0):
    return tracker.update(time, continuity, 320, 180, candidates if candidates is not None else (point(x),), affine)


def test_detects_small_round_candidate_and_rejects_lines_and_large_objects():
    image = pitch()
    cv2.circle(image, (50, 50), 4, (240, 240, 240), -1)
    cv2.rectangle(image, (200, 25), (220, 70), (240, 240, 240), -1)
    candidates = ball_candidates(image)
    assert len(candidates) == 1
    assert candidates[0].x == pytest.approx(50, abs=1)
    assert candidates[0].y == pytest.approx(50, abs=1)
    assert ball_candidates(np.zeros_like(image)) == ()


def test_multiple_blobs_are_not_silently_resolved():
    tracker = BallTracker()
    result = update(tracker, 0, candidates=(point(40), point(60)))
    assert result.status == "UNKNOWN"
    assert result.candidate is None
    assert result.reason == "AMBIGUOUS_BALL_CANDIDATES"


def test_low_grass_closeup_does_not_seed_a_ball_track():
    image = np.full((180, 320, 3), (40, 40, 40), dtype=np.uint8)
    cv2.rectangle(image, (0, 140), (319, 170), (35, 110, 35), -1)
    cv2.circle(image, (50, 150), 4, (240, 240, 240), -1)
    assert ball_candidates(image) == ()


def test_airborne_ball_just_above_pitch_is_included_as_a_candidate():
    image = pitch()
    image[:65] = (50, 40, 45)
    cv2.circle(image, (70, 50), 4, (240, 240, 240), -1)
    assert any(abs(candidate.x - 70) < 1 and abs(candidate.y - 50) < 1 for candidate in ball_candidates(image))


def test_stationary_then_moving_is_only_a_candidate_motion_event():
    tracker = BallTracker()
    for time in (0, 200, 400, 600):
        result = update(tracker, time)
    assert result.status == "STATIONARY"
    assert result.stationary_ms == 600
    assert update(tracker, 800, 55).motion_onset_ms is None
    onset = update(tracker, 1000, 60)
    assert onset.motion_onset_ms == 800
    assert update(tracker, 1200, 65).motion_onset_ms is None
    assert not hasattr(onset, "dead_ball")


def test_camera_pan_does_not_generate_motion_onset():
    tracker = BallTracker()
    for frame in range(8):
        result = update(tracker, frame * 200, 50 + frame * 5, affine=(1, 0, 5, 0, 1, 0))
        assert result.motion_onset_ms is None
    assert result.status == "STATIONARY"
    assert result.compensated_displacement_px == 0


def test_camera_scale_does_not_generate_motion_onset():
    tracker = BallTracker()
    for frame in range(6):
        scale = 1.02 ** frame
        result = tracker.update(frame * 200, 0, 320, 180,
            (BallCandidate(50 * scale, 50 * scale, 4 * scale, 0.85),), (1.02, 0, 0, 0, 1.02, 0))
        assert result.motion_onset_ms is None
    assert result.status == "STATIONARY"


@pytest.mark.parametrize("failure", ["occlusion", "cut", "gap", "camera", "ambiguous"])
def test_discontinuity_clears_previous_stationary_history(failure):
    tracker = BallTracker()
    for time in (0, 200, 400, 600):
        update(tracker, time)
    time = 1400 if failure == "gap" else 800
    continuity = 1 if failure == "cut" else 0
    candidates = () if failure == "occlusion" else (point(51), point(52)) if failure == "ambiguous" else (point(55),)
    result = update(tracker, time, candidates=candidates, continuity=continuity, affine=None if failure == "camera" else IDENTITY)
    assert result.motion_onset_ms is None
    assert update(tracker, time + 200, 60, continuity=continuity).motion_onset_ms is None


def test_no_motion_trigger_on_gradual_drift_or_a_single_jump():
    tracker = BallTracker()
    for frame in range(8):
        assert update(tracker, frame * 200, 50 + frame).motion_onset_ms is None
    tracker = BallTracker()
    for time in (0, 200, 400, 600):
        update(tracker, time)
    assert update(tracker, 800, 55).motion_onset_ms is None
    assert update(tracker, 1000, 55).motion_onset_ms is None


def test_unknown_transform_and_out_of_order_input():
    tracker = BallTracker()
    update(tracker, 0)
    assert update(tracker, 200, affine=None).reason == "CAMERA_TRANSFORM_UNAVAILABLE"
    with pytest.raises(ValueError, match="ball-time-not-increasing"):
        update(tracker, 100)


def test_video_diagnostic_records_a_candidate_release_without_claiming_a_setpiece(tmp_path: Path):
    source = tmp_path / "ball.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10, (320, 180))
    assert writer.isOpened()
    try:
        for index in range(20):
            image = pitch()
            x = 50 if index < 10 else 50 + (index - 9) * 3
            cv2.circle(image, (x, 50), 4, (240, 240, 240), -1)
            writer.write(image)
    finally:
        writer.release()
    summary_path = inspect_video(source, tmp_path / "diagnostic")
    summary = json.loads(summary_path.read_text())
    samples = [json.loads(line) for line in (summary_path.parent / "context.jsonl").read_text().splitlines()]
    assert summary["ball_tracked_samples"] >= 8
    assert len(summary["candidate_motion_onsets"]) == 1
    assert 900 <= summary["candidate_motion_onsets"][0]["timestamp_ms"] <= 1200
    assert summary["set_piece_status"] == "UNKNOWN"
    assert all(sample["dead_ball"] is None and sample["ball_restarted"] is None for sample in samples)
