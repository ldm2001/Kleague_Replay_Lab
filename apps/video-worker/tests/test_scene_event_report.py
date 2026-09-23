import json
from pathlib import Path
from replay_video.application.pipeline import candidate
from replay_video.domain.models import Candidate
from replay_video.runner import report

# 파이프라인·호출 규약 직렬화의 장면 사건 보존 확인
def test_scene_event_survives_pipeline_and_api_serialization(tmp_path: Path) -> None:
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
    # 변화 구간과 대표 시각을 가진 시험 후보 생성
    item = Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), (), scene_event=event)
    # 파일 경로를 시험용 기준 경로에서 구성
    path = tmp_path / "report.json"
    # 파일 경로에 시험 내용을 기록
    path.write_text(
        json.dumps(
            {
                "pipeline_version": "video-baseline-v1",
                "limitations": [],
                "shots": [],
                "candidates": [candidate(item)],
                "evidence": [],
            }
        ),
        encoding="utf-8",
    )
    # 로컬 보고서와 연결 산출물을 검증하여 제출 자료 구성
    payload = report(None, {}, path)
    # 장면 사건이 시험 사건과 일치하는지 확인
    assert payload["candidates"][0]["sceneEvent"] == event
    # 후보 범주가 예상 계약과 일치하는지 확인
    assert payload["candidates"][0]["category"] == "OTHER"

# 장면 사건 없는 구형 보고서의 읽기 호환 확인
def test_old_report_without_scene_event_remains_readable(tmp_path: Path) -> None:
    # 장면 사건이 없는 기존 후보를 보고서 형식으로 변환
    item = candidate(Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), ()))
    # 선택 사건 필드가 없는 구형 자료 형태 재현
    item.pop("scene_event")
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
    # 장면 사건이 비어 있는지 확인
    assert report(None, {}, path)["candidates"][0]["sceneEvent"] is None
