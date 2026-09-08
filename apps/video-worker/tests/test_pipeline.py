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


# 테스트 영상 생성
def fixture(path: Path) -> None:
    # 테스트용 영상 인코더 생성
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        10.0,
        (320, 180),
    )
    assert writer.isOpened()
    try:
        # 테스트 프레임 생성
        for index in range(40):
            # 구간별 배경색 선택
            background = (36, 92, 48) if index < 20 else (48, 48, 112)
            # 단색 프레임 생성
            frame = np.full((180, 320, 3), background, dtype=np.uint8)
            if 8 <= index < 16:
                # 움직이는 사각형 위치 계산
                left = 22 + (index - 8) * 28
                # 움직이는 도형 그리기
                cv2.rectangle(frame, (left, 58), (left + 75, 125), (242, 242, 242), -1)
                cv2.circle(frame, (left + 65, 92), 17, (30, 220, 240), -1)
            # 프레임 기록
            writer.write(frame)
    finally:
        # 인코더 종료
        writer.release()


# 영상 메타데이터 확인
def test_probe(tmp_path: Path) -> None:
    # 테스트 영상 경로 준비
    source = tmp_path / "sample.mp4"
    # 테스트 영상 생성
    fixture(source)

    # 영상 메타데이터 조회
    metadata = probe(source)

    # 기본 영상 크기 확인
    assert metadata.width == 320
    assert metadata.height == 180
    assert metadata.fps == pytest.approx(10.0, abs=0.1)
    assert metadata.frame_count == 40
    assert metadata.duration_ms == pytest.approx(4000, abs=150)
    assert metadata.codec


# 샷 경계 확인
def test_shots(tmp_path: Path) -> None:
    # 테스트 영상 준비
    source = tmp_path / "sample.mp4"
    fixture(source)

    # 샷 경계 계산
    result = shots(source, probe(source))

    assert len(result) == 2
    assert result[0].start_ms == 0
    assert result[0].end_ms < result[1].start_ms
    assert result[1].end_ms == pytest.approx(4000, abs=150)


# 파이프라인 산출물 확인
def test_assets(tmp_path: Path) -> None:
    # 입력과 출력 경로 준비
    source = tmp_path / "sample.mp4"
    output = tmp_path / "result"
    fixture(source)

    # 전체 파이프라인 실행
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
    # 보고서 파일 확인
    report = json.loads(result.report_path.read_text(encoding="utf-8"))
    assert report["limitations"] == [
        "replay_detection_pending",
        "incident_category_classification_pending",
        "pose_tracking_pending",
    ]
    for item in result.evidence:
        assert item.path.exists()
        assert item.path.stat().st_size > 0


# 없는 영상 오류 확인
def test_missing(tmp_path: Path) -> None:
    # 존재하지 않는 입력 검증
    with pytest.raises(MediaError, match="media-not-found"):
        probe(tmp_path / "missing.mp4")


# 포트 조립 확인
def test_ports(tmp_path: Path) -> None:
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

    # 포트 조립 파이프라인 실행
    result = pipeline(source, output, ports=ports)

    assert calls == ["probe", "shots", "candidates", "evidence"]
    assert result.video == metadata
    assert result.report_path.exists()
    assert "infrastructure" not in (Path(__file__).parents[1] / "src/replay_video/application/pipeline.py").read_text()


def test_pipeline_never_loads_a_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("VISION_MODEL", "gemma3:12b")
    ports = media()
    assert not hasattr(ports, "observations")
    source = tmp_path / "sample.mp4"
    fixture(source)
    result = pipeline(source, tmp_path / "output", ports=ports)
    payload = json.loads(result.report_path.read_text())
    assert all("observation" not in item for item in payload["candidates"])


# 단계 보고 확인
def test_stages(tmp_path: Path) -> None:
    # 단계 보고용 입력 준비
    source = tmp_path / "input.mp4"
    output = tmp_path / "result"
    metadata = VideoMetadata(source, 1000, 320, 180, 10.0, 10, "test")
    events: list[tuple[str, int]] = []
    ports = PipelinePorts(
        probe=lambda _value: metadata,
        shots=lambda _value, _item: (Shot(0, 0, 1000),),
        candidates=lambda _value, _item, _shots: (Candidate(1, "OTHER", 0, 1000, 500, 0.4, "MEDIUM", ("test",), (0,)),),
        evidence=lambda _value, _target, _item, _candidates: (),
    )

    # 단계 보고를 포함한 파이프라인 실행
    pipeline(source, output, ports=ports, progress=lambda stage, percent, _message: events.append((stage, percent)))

    # 단계 순서 확인
    assert [stage for stage, _percent in events] == ["SEGMENTING", "DETECTING", "EXTRACTING_FACTS", "BUILDING_EVIDENCE"]


# 후보 개수 제한 확인
def test_candidates(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # 후보 제한용 메타데이터 준비
    source = tmp_path / "long.mp4"
    metadata = VideoMetadata(source, 400_000, 320, 180, 10.0, 4000, "test")
    shot_list = (Shot(0, 0, 400_000),)
    values = tuple(Signal(index, index * 3000, 0.5) for index in range(1, 101))
    monkeypatch.setattr("replay_video.infrastructure.candidates.signals", lambda *_args: values)

    # 후보 탐지 실행
    result = candidates(source, metadata, shot_list)

    # 최대 후보 수 확인
    assert len(result) == 40


# 증거 개수 제한 확인
def test_evidence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # 증거 생성용 입력 준비
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

    # 증거 묶음 생성
    result = evidence(source, tmp_path / "result", metadata, items)

    # 프레임과 상위 확신도 클립 수 확인
    assert len(result) == 20
    assert {item.candidate_index for item in result} == set(range(1, 13))
    assert sum(item.kind == "FRAME" for item in result) == 12
    assert sum(item.kind == "CLIP" for item in result) == 8
