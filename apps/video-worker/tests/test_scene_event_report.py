import json
from pathlib import Path

from replay_video.application.pipeline import candidate
from replay_video.domain.models import Candidate
from replay_video.runner import report


def test_scene_event_survives_pipeline_and_api_serialization(tmp_path: Path) -> None:
    event = {
        "kind": "CORNER_KICK", "status": "OBSERVED", "startMs": 600, "endMs": 1400,
        "restartMs": 1000, "evidenceTimestampsMs": [600, 900, 1100, 1400],
        "method": "corner-geometry-motion-v1",
    }
    item = Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), (), scene_event=event)
    path = tmp_path / "report.json"
    path.write_text(json.dumps({
        "pipeline_version": "video-baseline-v1", "limitations": [], "shots": [],
        "candidates": [candidate(item)], "evidence": [],
    }), encoding="utf-8")
    payload = report(None, {}, path)
    assert payload["candidates"][0]["sceneEvent"] == event
    assert payload["candidates"][0]["category"] == "OTHER"


def test_old_report_without_scene_event_remains_readable(tmp_path: Path) -> None:
    item = candidate(Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), ()))
    item.pop("scene_event")
    path = tmp_path / "report.json"
    path.write_text(json.dumps({
        "pipeline_version": "video-baseline-v1", "limitations": [], "shots": [],
        "candidates": [item], "evidence": [],
    }), encoding="utf-8")
    assert report(None, {}, path)["candidates"][0]["sceneEvent"] is None
