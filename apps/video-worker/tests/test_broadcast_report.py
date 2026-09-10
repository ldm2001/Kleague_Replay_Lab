import json
from dataclasses import asdict
from pathlib import Path

from replay_video.application.pipeline import candidate
from replay_video.domain.models import Candidate
from replay_video.runner import report


def test_candidate_serialization_preserves_broadcast_cue() -> None:
    cue = {
        "kind": "GOAL_GRAPHIC", "method": "broadcast-goal-glyphs-v1",
        "startMs": 600, "endMs": 1100, "evidenceTimestampsMs": [600, 1100],
    }
    item = Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), (), broadcast_cue=cue)

    assert asdict(item)["broadcast_cue"] == cue
    assert candidate(item)["broadcast_cue"] == cue


def test_candidate_broadcast_cue_defaults_to_none() -> None:
    item = Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), ())

    assert asdict(item)["broadcast_cue"] is None


def test_report_preserves_broadcast_cue_without_changing_scene_or_tracking(tmp_path: Path) -> None:
    cue = {
        "kind": "GOAL_GRAPHIC", "method": "broadcast-goal-glyphs-v1",
        "startMs": 600, "endMs": 1100, "evidenceTimestampsMs": [600, 1100],
    }
    event = {
        "kind": "CORNER_KICK", "status": "OBSERVED", "startMs": 600, "endMs": 1400,
        "restartMs": 1000, "evidenceTimestampsMs": [600, 900, 1100, 1400],
        "method": "corner-geometry-motion-v1",
    }
    tracking = {"sampleCount": 10, "selectedCount": 8, "cameraCount": 6, "motionOnsetsMs": [1000]}
    item = candidate(Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), (),
                               tracking=tracking, scene_event=event))
    item["broadcast_cue"] = cue
    path = tmp_path / "report.json"
    path.write_text(json.dumps({
        "pipeline_version": "video-baseline-v1", "limitations": [], "shots": [],
        "candidates": [item], "evidence": [],
    }), encoding="utf-8")

    actual = report(None, {}, path)["candidates"][0]

    assert actual["broadcastCue"] == cue
    assert actual["sceneEvent"] == event
    assert actual["tracking"] == tracking
    assert actual["category"] == "OTHER"


def test_old_report_without_broadcast_cue_returns_null(tmp_path: Path) -> None:
    item = candidate(Candidate(1, "OTHER", 500, 1500, 1000, 0.5, "MEDIUM", (), ()))
    item.pop("broadcast_cue", None)
    path = tmp_path / "report.json"
    path.write_text(json.dumps({
        "pipeline_version": "video-baseline-v1", "limitations": [], "shots": [],
        "candidates": [item], "evidence": [],
    }), encoding="utf-8")

    assert report(None, {}, path)["candidates"][0]["broadcastCue"] is None
