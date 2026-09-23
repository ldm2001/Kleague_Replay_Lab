import json
from dataclasses import asdict
from pathlib import Path
from replay_video.application.pipeline import candidate
from replay_video.domain.models import Candidate
from replay_video.runner import report

# 후보 직렬화의 방송 단서 보존 확인
def test_candidate_serialization_preserves_broadcast_cue() -> None:
    # 관측 단서를 비교에 사용할 고정 시험 자료로 구성
    cue = {
        "kind": "GOAL_GRAPHIC",
        "method": "broadcast-goal-glyphs-v1",
        "startMs": 600,
        "endMs": 1100,
        "evidenceTimestampsMs": [600, 1100],
    }
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    item = Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), (), broadcast_cue=cue)

    # 방송 표시 단서가 관측 단서와 일치하는지 확인
    assert asdict(item)["broadcast_cue"] == cue
    # 방송 표시 단서가 관측 단서와 일치하는지 확인
    assert candidate(item)["broadcast_cue"] == cue

# 후보 방송 단서의 기본 빈 값 확인
def test_candidate_broadcast_cue_defaults_to_none() -> None:
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    item = Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), ())

    # 방송 표시 단서가 비어 있는지 확인
    assert asdict(item)["broadcast_cue"] is None

# 장면·추적 변경 없는 방송 단서 보고 보존 확인
def test_report_preserves_broadcast_cue_without_changing_scene_or_tracking(tmp_path: Path) -> None:
    # 관측 단서를 비교에 사용할 고정 시험 자료로 구성
    cue = {
        "kind": "GOAL_GRAPHIC",
        "method": "broadcast-goal-glyphs-v1",
        "startMs": 600,
        "endMs": 1100,
        "evidenceTimestampsMs": [600, 1100],
    }
    # 시험 사건을 비교에 사용할 고정 시험 자료로 구성
    event = {
        "kind": "CORNER_KICK",
        "status": "OBSERVED",
        "startMs": 600,
        "endMs": 1400,
        "restartMs": 1000,
        "evidenceTimestampsMs": [600, 900, 1100, 1400],
        "method": "corner-geometry-motion-v1",
    }
    # 추적 정보를 비교에 사용할 고정 시험 자료로 구성
    tracking = {"sampleCount": 10, "selectedCount": 8, "cameraCount": 6, "motionOnsetsMs": [1000]}
    # 방송 표시가 포함된 후보를 전송 계약으로 직렬화
    item = candidate(
        Candidate(
            1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), (), tracking=tracking, scene_event=event
        )
    )
    # 관측 단서를 후속 비교에 사용할 값으로 보관
    item["broadcast_cue"] = cue
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(
        json.dumps(
            {
                "pipeline_version": "video-baseline-v1",
                "limitations": [],
                "shots": [],
                "candidates": [item],
                "evidence": [],
            }
        ),
        encoding="utf-8",
    )

    # 변화 후보 목록의 선택 항목을 후속 비교에 사용할 값으로 보관
    actual = report(None, {}, path)["candidates"][0]

    # 방송 표시 단서가 관측 단서와 일치하는지 확인
    assert actual["broadcastCue"] == cue
    # 장면 사건이 시험 사건과 일치하는지 확인
    assert actual["sceneEvent"] == event
    # 추적 정보가 추적 정보와 일치하는지 확인
    assert actual["tracking"] == tracking
    # 후보 범주가 예상 계약과 일치하는지 확인
    assert actual["category"] == "OTHER"

# 방송 단서 없는 구형 보고서의 빈 값 반환 확인
def test_old_report_without_broadcast_cue_returns_null(tmp_path: Path) -> None:
    # 방송 단서가 없는 기존 후보의 직렬화 결과 준비
    item = candidate(Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), ()))
    # 선택 필드가 빠진 구형 보고서 형태 재현
    item.pop("broadcast_cue", None)
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(
        json.dumps(
            {
                "pipeline_version": "video-baseline-v1",
                "limitations": [],
                "shots": [],
                "candidates": [item],
                "evidence": [],
            }
        ),
        encoding="utf-8",
    )

    # 방송 표시 단서가 비어 있는지 확인
    assert report(None, {}, path)["candidates"][0]["broadcastCue"] is None
