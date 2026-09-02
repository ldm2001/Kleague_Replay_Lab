from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from replay_video.application.pipeline import pipeline
from replay_video.application.ports import PipelinePorts
from replay_video.domain.models import Candidate, Evidence, Shot, VideoMetadata
from replay_video.infrastructure.ports import media
from replay_video.infrastructure.probe import MediaError, probe
from replay_video.infrastructure.shots import shots
from replay_video.infrastructure.candidates import candidates
from replay_video.infrastructure.evidence import evidence
from replay_video.infrastructure.signals import Signal


def fixture(path: Path) -> None:
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


def test_probe_metadata(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    fixture(source)

    metadata = probe(source)

    assert metadata.width == 320
    assert metadata.height == 180
    assert metadata.fps == pytest.approx(10.0, abs=0.1)
    assert metadata.frame_count == 40
    assert metadata.duration_ms == pytest.approx(4000, abs=150)
    assert metadata.codec


def test_shots_cut(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    fixture(source)

    result = shots(source, probe(source))

    assert len(result) == 2
    assert result[0].start_ms == 0
    assert result[0].end_ms < result[1].start_ms
    assert result[1].end_ms == pytest.approx(4000, abs=150)


def test_pipeline_assets(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    output = tmp_path / "result"
    fixture(source)

    result = pipeline(source, output, ports=media())

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


def test_probe_missing(tmp_path: Path) -> None:
    with pytest.raises(MediaError, match="media-not-found"):
        probe(tmp_path / "missing.mp4")


def test_pipeline_ports(tmp_path: Path) -> None:
    # 가짜 포트 준비
    source = tmp_path / "input.mp4"
    output = tmp_path / "result"
    metadata = VideoMetadata(source, 1000, 320, 180, 10.0, 10, "test")
    shot_list = (Shot(0, 0, 1000),)
    candidate_list = (Candidate(1, "OTHER", 0, 1000, 500, 0.4, "MEDIUM", ("test",), (0,)),)
    evidence_list = (Evidence(1, "FRAME", output / "frame.jpg", 500, 0, 1000),)
    calls: list[str] = []

    ports = PipelinePorts(
        probe=lambda value: calls.append("probe") or metadata,
        shots=lambda value, item: calls.append("shots") or shot_list,
        candidates=lambda value, item, items: calls.append("candidates") or candidate_list,
        evidence=lambda value, target, item, items: calls.append("evidence") or evidence_list,
    )

    result = pipeline(source, output, ports=ports)

    assert calls == ["probe", "shots", "candidates", "evidence"]
    assert result.video == metadata
    assert result.report_path.exists()
    assert "infrastructure" not in (Path(__file__).parents[1] / "src/replay_video/application/pipeline.py").read_text()


def test_candidate_count_is_bounded(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source = tmp_path / "long.mp4"
    metadata = VideoMetadata(source, 400_000, 320, 180, 10.0, 4000, "test")
    shot_list = (Shot(0, 0, 400_000),)
    values = tuple(Signal(index, index * 3000, 0.5) for index in range(1, 101))
    monkeypatch.setattr("replay_video.infrastructure.candidates.signals", lambda *_args: values)

    result = candidates(source, metadata, shot_list)

    assert len(result) == 40


def test_evidence_count_is_bounded(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    metadata = VideoMetadata(source, 60_000, 1920, 1080, 30.0, 1800, "h264")
    items = tuple(
        Candidate(
            index=index,
            category="OTHER",
            start_ms=index * 1000,
            end_ms=index * 1000 + 800,
            anchor_ms=index * 1000 + 400,
            confidence=index / 20,
            camera_sufficiency="MEDIUM",
            reasons=("motion_spike",),
            shot_indices=(0,),
        )
        for index in range(1, 13)
    )
    monkeypatch.setattr(
        "replay_video.infrastructure.evidence.frame",
        lambda _source, destination, _timestamp: destination.write_bytes(b"frame"),
    )
    monkeypatch.setattr(
        "replay_video.infrastructure.evidence.clip",
        lambda _source, destination, _start, _end: destination.write_bytes(b"clip"),
    )

    result = evidence(source, tmp_path / "result", metadata, items)

    assert len(result) == 16
    assert {item.candidate_index for item in result} == set(range(5, 13))
    assert sum(item.kind == "FRAME" for item in result) == 8
    assert sum(item.kind == "CLIP" for item in result) == 8
