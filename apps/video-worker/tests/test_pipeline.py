from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from replay_video.application.pipeline import run
from replay_video.infrastructure.probe import MediaError, probe
from replay_video.infrastructure.shots import shots


def video(path: Path) -> None:
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        10.0,
        (320, 180),
    )
    assert writer.isOpened()
    try:
        for index in range(40):
            background = (36, 92, 48) if index < 20 else (48, 48, 112)
            frame = np.full((180, 320, 3), background, dtype=np.uint8)
            if 8 <= index < 16:
                left = 22 + (index - 8) * 28
                cv2.rectangle(frame, (left, 58), (left + 75, 125), (242, 242, 242), -1)
                cv2.circle(frame, (left + 65, 92), 17, (30, 220, 240), -1)
            writer.write(frame)
    finally:
        writer.release()


def test_probe_reads_real_video_metadata(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    video(source)

    metadata = probe(source)

    assert metadata.width == 320
    assert metadata.height == 180
    assert metadata.fps == pytest.approx(10.0, abs=0.1)
    assert metadata.frame_count == 40
    assert metadata.duration_ms == pytest.approx(4000, abs=150)
    assert metadata.codec


def test_shots_split_a_broadcast_hard_cut(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    video(source)

    result = shots(source, probe(source))

    assert len(result) == 2
    assert result[0].start_ms == 0
    assert result[0].end_ms < result[1].start_ms
    assert result[1].end_ms == pytest.approx(4000, abs=150)


def test_run_creates_candidates_and_evidence_assets(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    output = tmp_path / "result"
    video(source)

    result = run(source, output)

    assert result.schema_version == 1
    assert result.video.width == 320
    assert len(result.shots) >= 1
    assert result.candidates
    assert all(0.0 <= candidate.confidence <= 1.0 for candidate in result.candidates)
    assert all(candidate.category == "OTHER" for candidate in result.candidates)
    assert result.evidence
    assert result.report_path == output / "report.json"
    assert result.report_path.exists()
    assert result.report_path.stat().st_size > 0
    report = json.loads(result.report_path.read_text(encoding="utf-8"))
    assert report["limitations"] == [
        "replay_detection_pending",
        "incident_category_classification_pending",
        "pose_tracking_pending",
    ]
    for item in result.evidence:
        assert item.path.exists()
        assert item.path.stat().st_size > 0


def test_probe_rejects_missing_media(tmp_path: Path) -> None:
    with pytest.raises(MediaError, match="media-not-found"):
        probe(tmp_path / "missing.mp4")
