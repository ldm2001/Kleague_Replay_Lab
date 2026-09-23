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
    # 시험 영상 인코더를 사용할 수 있는지 확인
    assert writer.isOpened()
    # 도형 생성 중 실패해도 인코더 종료를 보장하는 범위 시작
    try:
        # 테스트 프레임 생성
        for index in range(40):
            # 구간별 배경색 선택
            background = (36, 92, 48) if index < 20 else (48, 48, 112)
            # 단색 프레임 생성
            frame = np.full((180, 320, 3), background, dtype=np.uint8)
            # 일부 프레임에만 물체를 움직여 국소 변화 구간 생성
            if 8 <= index < 16:
                # 움직이는 사각형 위치 계산
                left = 22 + (index - 8) * 28
                # 움직이는 도형 그리기
                cv2.rectangle(frame, (left, 58), (left + 75, 125), (242, 242, 242), -1)
                # 움직이는 사각형에 다른 색의 원을 추가하여 변화 강화
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
    # 영상 높이가 180과 일치하는지 확인
    assert metadata.height == 180
    # 초당 프레임 수가 예상 계약과 일치하는지 확인
    assert metadata.fps == pytest.approx(10.0, abs=0.1)
    # 프레임 수가 40과 일치하는지 확인
    assert metadata.frame_count == 40
    # 재생 길이가 예상 계약과 일치하는지 확인
    assert metadata.duration_ms == pytest.approx(4000, abs=150)
    # 영상 코덱이 참이거나 비어 있지 않은지 확인
    assert metadata.codec

# 샷 경계 확인
def test_shots(tmp_path: Path) -> None:
    # 테스트 영상 준비
    source = tmp_path / "sample.mp4"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)

    # 샷 경계 계산
    result = shots(source, probe(source))

    # 실행 결과의 개수가 2과 일치하는지 확인
    assert len(result) == 2
    # 시작 시각이 0과 일치하는지 확인
    assert result[0].start_ms == 0
    # 종료 시각이 허용 경계 조건을 만족하는지 확인
    assert result[0].end_ms < result[1].start_ms
    # 종료 시각이 예상 계약과 일치하는지 확인
    assert result[1].end_ms == pytest.approx(4000, abs=150)

# 파이프라인 산출물 확인
def test_assets(tmp_path: Path) -> None:
    # 입력과 출력 경로 준비
    source = tmp_path / "sample.mp4"
    # 출력 경로를 시험용 기준 경로에서 구성
    output = tmp_path / "result"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)

    # 전체 파이프라인 실행
    result = pipeline(source, output, ports=media())

    # 자료 형식 판본이 1과 일치하는지 확인
    assert result.schema_version == 1
    # 영상 너비가 320과 일치하는지 확인
    assert result.video.width == 320
    # 샷 구간 목록의 개수가 1 이상인지 확인
    assert len(result.shots) >= 1
    # 변화 후보 목록이 참이거나 비어 있지 않은지 확인
    assert result.candidates
    # 모든 후보 신뢰도가 영에서 일 사이인지 확인
    assert all(0.0 <= candidate.confidence <= 1.0 for candidate in result.candidates)
    # 원시 화면 변화만으로 특정 사건 범주를 확정하지 않는지 확인
    assert all(candidate.category == "OTHER" for candidate in result.candidates)
    # 증거 묶음이 참이거나 비어 있지 않은지 확인
    assert result.evidence
    # 보고서 경로가 시험 보고서 파일과 일치하는지 확인
    assert result.report_path == output / "report.json"
    # 보고서 경로의 존재 여부가 참이거나 비어 있지 않은지 확인
    assert result.report_path.exists()
    # 파일 크기가 0보다 큰지 확인
    assert result.report_path.stat().st_size > 0
    # 보고서 파일 확인
    report = json.loads(result.report_path.read_text(encoding="utf-8"))
    # 분석 한계 목록이 예상 계약과 일치하는지 확인
    assert report["limitations"] == [
        "replay_detection_pending",
        "incident_category_classification_pending",
        "pose_tracking_pending",
    ]
    # 증거 묶음의 각 항목을 순서대로 처리
    for item in result.evidence:
        # 파일 경로의 존재 여부가 참이거나 비어 있지 않은지 확인
        assert item.path.exists()
        # 파일 크기가 0보다 큰지 확인
        assert item.path.stat().st_size > 0

# 없는 영상 오류 확인
def test_missing(tmp_path: Path) -> None:
    # 존재하지 않는 입력 검증
    with pytest.raises(MediaError, match="media-not-found"):
        # 입력 영상의 길이와 크기 및 코덱 조회
        probe(tmp_path / "missing.mp4")

# 포트 조립 확인
def test_ports(tmp_path: Path) -> None:
    # 가짜 포트 준비
    source = tmp_path / "input.mp4"
    # 출력 경로를 시험용 기준 경로에서 구성
    output = tmp_path / "result"
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 1000, 320, 180, 10.0, 10, "test")
    # 샷 구간 목록을 비교에 사용할 고정 시험 자료로 구성
    shot_list = (Shot(0, 0, 1000),)
    # 파이프라인 포트 호출 순서를 확인할 단일 변화 후보 준비
    candidate_list = (Candidate(1, "OTHER", 0, 1000, 500, 0.4, "MEDIUM", ("test",), (0,)),)
    # 해당 후보와 연결된 단일 프레임 증거 준비
    evidence_list = (Evidence(1, "FRAME", output / "frame.jpg", 500, 0, 1000),)
    # 호출 이력을 누적할 빈 자료 구조 준비
    calls: list[str] = []

    # 시험에 필요한 파이프라인 단계별 대역 묶음 생성
    ports = PipelinePorts(
        probe=lambda value: calls.append("probe") or metadata,
        shots=lambda value, item: calls.append("shots") or shot_list,
        candidates=lambda value, item, items: calls.append("candidates") or candidate_list,
        evidence=lambda value, target, item, items: calls.append("evidence") or evidence_list,
    )

    # 포트 조립 파이프라인 실행
    result = pipeline(source, output, ports=ports)

    # 호출 이력이 예상 계약과 일치하는지 확인
    assert calls == ["probe", "shots", "candidates", "evidence"]
    # 시험 영상 정보가 영상 메타데이터와 일치하는지 확인
    assert result.video == metadata
    # 보고서 경로의 존재 여부가 참이거나 비어 있지 않은지 확인
    assert result.report_path.exists()
    # 단계별 포트가 기대한 순서로 호출되는지 확인
    assert (
        "infrastructure"
        not in (Path(__file__).parents[1] / "src/replay_video/application/pipeline.py").read_text()
    )

# 파이프라인의 모델 미사용 확인
def test_pipeline_never_loads_a_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # 실행 환경 변수를 고정하여 주변 환경 영향 차단
    monkeypatch.setenv("VISION_MODEL", "gemma3:12b")
    # 운영 인식과 분리된 기존 미디어 포트 묶음 생성
    ports = media()
    # 기존 미디어 전용 묶음에 사실 관측 포트가 없는지 확인
    assert not hasattr(ports, "observations")
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)
    # 시험 입력으로 전체 영상 처리 단계 실행
    result = pipeline(source, tmp_path / "output", ports=ports)
    # 저장된 문자열을 구조화된 자료로 읽음
    payload = json.loads(result.report_path.read_text())
    # 원시 변화 후보에 규정 사실 관측 필드가 생기지 않는지 확인
    assert all("observation" not in item for item in payload["candidates"])

# 단계 보고 확인
def test_stages(tmp_path: Path) -> None:
    # 단계 보고용 입력 준비
    source = tmp_path / "input.mp4"
    # 출력 경로를 시험용 기준 경로에서 구성
    output = tmp_path / "result"
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 1000, 320, 180, 10.0, 10, "test")
    # 발생 이력을 누적할 빈 자료 구조 준비
    events: list[tuple[str, int]] = []
    # 시험에 필요한 파이프라인 단계별 대역 묶음 생성
    ports = PipelinePorts(
        probe=lambda _value: metadata,
        shots=lambda _value, _item: (Shot(0, 0, 1000),),
        candidates=lambda _value, _item, _shots: (
            Candidate(1, "OTHER", 0, 1000, 500, 0.4, "MEDIUM", ("test",), (0,)),
        ),
        evidence=lambda _value, _target, _item, _candidates: (),
    )

    # 단계 보고를 포함한 파이프라인 실행
    pipeline(
        source,
        output,
        ports=ports,
        progress=lambda stage, percent, _message: events.append((stage, percent)),
    )

    # 단계 순서 확인
    assert [stage for stage, _percent in events] == [
        "SEGMENTING",
        "DETECTING",
        "EXTRACTING_FACTS",
        "BUILDING_EVIDENCE",
    ]

# 후보 개수 제한 확인
def test_candidates(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # 후보 제한용 메타데이터 준비
    source = tmp_path / "long.mp4"
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 400_000, 320, 180, 10.0, 4000, "test")
    # 샷 구간 목록을 비교에 사용할 고정 시험 자료로 구성
    shot_list = (Shot(0, 0, 400_000),)
    # 시각과 화면 변화 점수가 정해진 시험 신호 결과 목록을 후속 비교에 사용할 값으로 보관
    values = tuple(Signal(index, index * 3000, 0.5) for index in range(1, 101))
    # 영상 연산 대신 충분히 많은 변화 신호를 고정 공급
    monkeypatch.setattr("replay_video.infrastructure.candidates.signals", lambda *_args: values)

    # 후보 탐지 실행
    result = candidates(source, metadata, shot_list)

    # 최대 후보 수 확인
    assert len(result) == 40

# 증거 개수 제한 확인
def test_evidence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # 증거 생성용 입력 준비
    source = tmp_path / "source.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"source")
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(source, 60_000, 1920, 1080, 30.0, 1800, "h264")
    # 변화 구간과 대표 시각을 가진 시험 후보 결과 목록을 후속 비교에 사용할 값으로 보관
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
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        "replay_video.infrastructure.evidence.frame",
        lambda _source, destination, _timestamp: destination.write_bytes(b"frame"),
    )
    # 증거 생성 경로를 통제하도록 프레임·클립 처리 대역 연결
    monkeypatch.setattr(
        "replay_video.infrastructure.evidence.clip",
        lambda _source, destination, _start, _end: destination.write_bytes(b"clip"),
    )

    # 증거 묶음 생성
    result = evidence(source, tmp_path / "result", metadata, items)

    # 프레임과 상위 확신도 클립 수 확인
    assert len(result) == 20
    # 변화 후보 번호 목록이 예상 계약과 일치하는지 확인
    assert {item.candidate_index for item in result} == set(range(1, 13))
    # 열두 후보 각각에 프레임 증거가 생성되는지 확인
    assert sum(item.kind == "FRAME" for item in result) == 12
    # 클립은 상위 신뢰도의 여덟 후보에만 생성되는지 확인
    assert sum(item.kind == "CLIP" for item in result) == 8
