import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from replay_video.infrastructure.context import frame_context
from replay_video.inspect import inspect_video


def pitch():
    # 텍스처와 선분이 있는 합성 경기장으로 전역 평행 이동의 정답을 제어한다
    rng = np.random.default_rng(17)
    image = np.full((180, 320, 3), (35, 110, 35), dtype=np.uint8)
    noise = rng.integers(0, 45, (180, 320), dtype=np.uint8)
    image[:, :, 1] += noise
    cv2.line(image, (20, 120), (300, 120), (240, 240, 240), 3)
    cv2.line(image, (160, 20), (160, 160), (240, 240, 240), 3)
    return image


def test_color_and_line_measurements_have_image_coordinates():
    result = frame_context(pitch())
    assert result.grass_ratio > 0.8
    assert result.line_segments
    assert result.camera_dx is None
    assert result.quality_reason == "NO_PREVIOUS_FRAME"
    assert (result.width, result.height) == (320, 180)


def test_camera_pan_is_separated_from_frame_difference():
    before = pitch()
    after = cv2.warpAffine(before, np.float32([[1, 0, 6], [0, 1, 3]]), (320, 180))
    result = frame_context(after, before)
    assert result.quality_reason is None
    assert result.camera_dx == pytest.approx(6, abs=0.7)
    assert result.camera_dy == pytest.approx(3, abs=0.7)
    assert result.residual_motion < 0.02


def test_local_change_remains_after_camera_alignment():
    before = pitch()
    after = before.copy()
    cv2.rectangle(after, (180, 20), (235, 80), (230, 230, 230), -1)
    result = frame_context(after, before)
    assert result.quality_reason is None
    assert result.residual_motion > 0.02


def test_textureless_and_nonfield_images_are_unknown_not_zero_motion():
    flat = np.full((180, 320, 3), (35, 110, 35), dtype=np.uint8)
    result = frame_context(flat, flat)
    assert result.camera_dx is None
    assert result.residual_motion is None
    assert result.quality_reason == "INSUFFICIENT_FEATURES"
    dark = np.zeros_like(flat)
    assert frame_context(dark, flat).quality_reason == "LOW_GRASS_COVERAGE"


def test_resizes_consistently_and_rejects_invalid_frames():
    large = cv2.resize(pitch(), (1280, 720))
    assert frame_context(large).width == 640
    with pytest.raises(ValueError, match="invalid-context-frame"):
        frame_context(np.zeros((10, 10), dtype=np.uint8))


def test_diagnostic_video_records_raw_signals_without_semantic_invention(tmp_path: Path):
    source = tmp_path / "fixture.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (320, 180))
    assert writer.isOpened()
    try:
        for _ in range(10):
            writer.write(pitch())
        for _ in range(10):
            writer.write(np.full((180, 320, 3), (180, 40, 40), dtype=np.uint8))
    finally:
        writer.release()
    report = inspect_video(source, tmp_path / "output")
    summary = json.loads(report.read_text())
    samples = [json.loads(line) for line in (report.parent / "context.jsonl").read_text().splitlines()]
    assert summary["sample_count"] == 20
    assert summary["set_piece_status"] == "UNKNOWN"
    assert summary["coverage_status"] == "MATCHES_METADATA"
    assert any(sample["cut_candidate"] for sample in samples)
    assert all(sample["dead_ball"] is None and sample["ball_position"] is None for sample in samples)
    assert all(sample["camera_dx"] is None for sample in samples if sample["cut_candidate"])
    assert [sample["timestamp_ms"] for sample in samples] == sorted(set(sample["timestamp_ms"] for sample in samples))
    with pytest.raises(FileExistsError):
        inspect_video(source, report.parent)


def test_diagnostic_extracts_broadcast_cue_from_decoded_frames(tmp_path: Path):
    image = np.full((540, 960, 3), (45, 112, 48), dtype=np.uint8)
    cv2.rectangle(image, (29, 22), (260, 50), (125, 53, 9), -1)
    cv2.rectangle(image, (190, 22), (260, 50), (20, 12, 175), -1)
    cv2.rectangle(image, (29, 51), (260, 68), (83, 20, 18), -1)
    cv2.putText(image, "GOAL", (88, 46), cv2.FONT_HERSHEY_DUPLEX, 0.9, (250, 250, 250), 2, cv2.LINE_AA)
    source = tmp_path / "goal.mp4"
    writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 15.0, (960, 540))
    assert writer.isOpened()
    try:
        for _ in range(20):
            writer.write(image)
    finally:
        writer.release()
    report = inspect_video(source, tmp_path / "output")
    summary = json.loads(report.read_text())
    assert len(summary.get("broadcast_cues", [])) == 1
    assert summary["broadcast_cues"][0]["kind"] == "GOAL_GRAPHIC"
    assert summary["broadcast_cues"][0]["endMs"] - summary["broadcast_cues"][0]["startMs"] >= 300
    samples = [json.loads(line) for line in (report.parent / "context.jsonl").read_text().splitlines()]
    assert all(sample["dead_ball"] is None and sample["ball_restarted"] is None for sample in samples)
