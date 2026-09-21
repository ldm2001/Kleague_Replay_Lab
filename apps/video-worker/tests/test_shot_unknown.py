from dataclasses import asdict
import json

from replay_video.domain.models import Shot
from replay_video.runner import report


def test_unclassified_shot_does_not_claim_live_broadcast():
    shot = Shot(index=0, start_ms=0, end_ms=1000)
    assert shot.is_replay is None
    assert asdict(shot)["is_replay"] is None


def test_confirmed_replay_states_remain_distinct():
    assert Shot(0, 0, 1000, is_replay=True).is_replay is True
    assert Shot(0, 0, 1000, is_replay=False).is_replay is False


def test_runner_preserves_unknown_replay_in_wire_payload(tmp_path):
    path = tmp_path / "report.json"
    path.write_text(json.dumps({
        "pipeline_version": "video-baseline-v1", "limitations": ["replay_detection_pending"],
        "shots": [asdict(Shot(0, 0, 1000))], "candidates": [], "evidence": [],
    }), encoding="utf-8")
    value = report(None, {}, path)
    assert value["shots"][0]["isReplay"] is None
