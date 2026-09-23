from pathlib import Path
import json
from replay_video.domain.models import Candidate, VideoMetadata
from replay_video.infrastructure.tracking import tracking, summaries

# 해당 장면 관측만 포함하는 추적 요약 확인
def test_tracking_summary_only_includes_observations_in_its_scene():
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    candidate = Candidate(1, "OTHER", 500, 1500, 1000, 0.4, "MEDIUM", (), ())
    # 정지와 움직임 및 재개 단서가 섞인 프레임 관측 준비
    samples = [
        {
            "timestamp_ms": time,
            "ball_track": {
                "candidate": {"x": 50, "y": 50},
                "compensated_displacement_px": 4,
                "motion_onset_ms": 900 if time == 1000 else None,
            },
        }
        for time in (0, 500, 1000, 1500, 2000)
    ]
    # 완료된 관측을 기존 후보 하나에 요약 연결
    result, = summaries(samples, (candidate,), complete=True)
    # 추적 정보가 예상 계약과 일치하는지 확인
    assert result.tracking == {
        "version": "ball-path-v1", "coverage": "COMPLETE", "sampleCount": 3,
        "selectedCount": 3, "cameraCount": 3, "motionOnsetsMs": [900],
    }

# 미확인·부분 추적의 측정값 추정 방지 확인
def test_unknown_and_partial_tracking_do_not_invent_measurements():
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    candidate = Candidate(1, "OTHER", 0, 200, 100, 0.4, "MEDIUM", (), ())
    # 실패한 관측과 빈 표본으로 미완료 요약 생성
    result, = summaries([], (candidate,), complete=False)
    # 처리 범위가 예상 계약과 일치하는지 확인
    assert result.tracking["coverage"] == "PARTIAL"
    # 선택한 후보 수가 0과 일치하는지 확인
    assert result.tracking["selectedCount"] == 0
    # 움직임 시작 시각 목록이 빈 값으로 유지되는지 확인
    assert result.tracking["motionOnsetsMs"] == []

# 코너 확장 시 겹치는 후보 구간 보존 확인
def test_corner_enrichment_preserves_the_overlapping_candidate_interval(tmp_path, monkeypatch):
    # 시험 사건을 비교에 사용할 고정 시험 자료로 구성
    event = {
        "kind": "CORNER_KICK",
        "status": "OBSERVED",
        "startMs": 2300,
        "endMs": 2802,
        "restartMs": 2600,
        "evidenceTimestampsMs": [2300, 2600, 2801],
        "method": "corner-geometry-motion-v1",
    }
    # 요약 정보를 시험용 기준 경로에서 구성
    summary = tmp_path / "context-summary.json"
    # 요약 정보에 시험 내용을 기록
    summary.write_text(json.dumps({"scene_events": [event], "coverage_status": "MATCHES_METADATA"}))
    # 관측 기록 파일에 시험 내용을 기록
    (tmp_path / "context.jsonl").write_text("")
    # 실제 진단 대신 미리 만든 코너 관측 요약 제공
    monkeypatch.setattr('replay_video.inspection.inspection', lambda source, output: summary)
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(Path("source.mp4"), 15000, 960, 540, 15, 225, "h264")
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    original = Candidate(1, "OTHER", 0, 2400, 1200, 0.9, "MEDIUM", (), ())
    # 기존 후보를 코너 구간으로 확장하는 추적 보강 실행
    enriched, = tracking(metadata.source, tmp_path, metadata, (original,))
    # 시작 시각이 허용 경계 조건을 만족하는지 확인
    assert enriched.start_ms <= original.start_ms
    # 종료 시각이 허용 경계 조건을 만족하는지 확인
    assert enriched.end_ms >= original.end_ms
    # 시작 시각이 허용 경계 조건을 만족하는지 확인
    assert enriched.start_ms <= original.anchor_ms <= enriched.end_ms
    # 종료 시각이 10600과 일치하는지 확인
    assert enriched.end_ms == 10600
    # 장면 사건이 시험 사건과 일치하는지 확인
    assert enriched.scene_event == event

# 변화 정점 없는 득점 표시의 범주 후보 추가 확인
def test_goal_graphic_adds_a_scope_candidate_without_a_motion_peak(tmp_path, monkeypatch):
    # 관측 단서를 비교에 사용할 고정 시험 자료로 구성
    cue = {
        "kind": "GOAL_GRAPHIC",
        "method": "broadcast-goal-glyphs-v1",
        "startMs": 25000,
        "endMs": 25400,
        "evidenceTimestampsMs": [25000, 25200, 25400],
    }
    # 요약 정보를 시험용 기준 경로에서 구성
    summary = tmp_path / "context-summary.json"
    # 요약 정보에 시험 내용을 기록
    summary.write_text(json.dumps({"broadcast_cues": [cue], "coverage_status": "MATCHES_METADATA"}))
    # 관측 기록 파일에 시험 내용을 기록
    (tmp_path / "context.jsonl").write_text("")
    # 변화 정점 없이 득점 표시만 있는 진단 요약 제공
    monkeypatch.setattr('replay_video.inspection.inspection', lambda source, output: summary)
    # 영상 길이와 크기 및 시간축의 시험 메타데이터 생성
    metadata = VideoMetadata(Path("source.mp4"), 40000, 960, 540, 15, 600, "h264")
    # 기존 변화 후보가 없는 입력에서 방송 표시 후보 생성
    result = tracking(metadata.source, tmp_path, metadata, ())
    # 실행 결과의 개수가 1과 일치하는지 확인
    assert len(result) == 1
    # 방송 표시 단서가 관측 단서와 일치하는지 확인
    assert result[0].broadcast_cue == cue
    # 장면 사건이 비어 있는지 확인
    assert result[0].scene_event is None
    # 후보 범주가 예상 계약과 일치하는지 확인
    assert result[0].category == "OTHER"
    # 시작 시각이 5000과 일치하는지 확인
    assert result[0].start_ms == 5000
    # 종료 시각이 37400과 일치하는지 확인
    assert result[0].end_ms == 37400
    # 대표 시각이 25000과 일치하는지 확인
    assert result[0].anchor_ms == 25000
