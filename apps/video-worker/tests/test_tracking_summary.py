from pathlib import Path
import json

from replay_video.domain.models import Candidate, VideoMetadata
from replay_video.infrastructure.tracking import tracking, tracking_summaries


def test_tracking_summary_only_includes_observations_in_its_scene():
    candidate = Candidate(1, "OTHER", 500, 1500, 1000, 0.4, "MEDIUM", (), ())
    samples = [{"timestamp_ms": time, "ball_track": {
        "candidate": {"x": 50, "y": 50}, "compensated_displacement_px": 4,
        "motion_onset_ms": 900 if time == 1000 else None,
    }} for time in (0, 500, 1000, 1500, 2000)]
    result, = tracking_summaries(samples, (candidate,), complete=True)
    assert result.tracking == {
        "version": "ball-path-v1", "coverage": "COMPLETE", "sampleCount": 3,
        "selectedCount": 3, "cameraCount": 3, "motionOnsetsMs": [900],
    }


def test_unknown_and_partial_tracking_do_not_invent_measurements():
    candidate = Candidate(1, "OTHER", 0, 200, 100, 0.4, "MEDIUM", (), ())
    result, = tracking_summaries([], (candidate,), complete=False)
    assert result.tracking["coverage"] == "PARTIAL"
    assert result.tracking["selectedCount"] == 0
    assert result.tracking["motionOnsetsMs"] == []


def test_corner_enrichment_preserves_the_overlapping_candidate_interval(tmp_path, monkeypatch):
    event = {"kind": "CORNER_KICK", "status": "OBSERVED", "startMs": 2300,
             "endMs": 2802, "restartMs": 2600, "evidenceTimestampsMs": [2300, 2600, 2801],
             "method": "corner-geometry-motion-v1"}
    summary = tmp_path / "context-summary.json"
    summary.write_text(json.dumps({"scene_events": [event], "coverage_status": "MATCHES_METADATA"}))
    (tmp_path / "context.jsonl").write_text("")
    monkeypatch.setattr("replay_video.inspect.inspect_video", lambda source, output: summary)
    metadata = VideoMetadata(Path("source.mp4"), 15000, 960, 540, 15, 225, "h264")
    original = Candidate(1, "OTHER", 0, 2400, 1200, 0.9, "MEDIUM", (), ())
    enriched, = tracking(metadata.source, tmp_path, metadata, (original,))
    assert enriched.start_ms <= original.start_ms
    assert enriched.end_ms >= original.end_ms
    assert enriched.start_ms <= original.anchor_ms <= enriched.end_ms
    assert enriched.end_ms == 10600
    assert enriched.scene_event == event


def test_goal_graphic_adds_a_scope_candidate_without_a_motion_peak(tmp_path, monkeypatch):
    cue = {"kind": "GOAL_GRAPHIC", "method": "broadcast-goal-glyphs-v1", "startMs": 25000,
           "endMs": 25400, "evidenceTimestampsMs": [25000, 25200, 25400]}
    summary = tmp_path / "context-summary.json"
    summary.write_text(json.dumps({"broadcast_cues": [cue], "coverage_status": "MATCHES_METADATA"}))
    (tmp_path / "context.jsonl").write_text("")
    monkeypatch.setattr("replay_video.inspect.inspect_video", lambda source, output: summary)
    metadata = VideoMetadata(Path("source.mp4"), 40000, 960, 540, 15, 600, "h264")
    result = tracking(metadata.source, tmp_path, metadata, ())
    assert len(result) == 1
    assert result[0].broadcast_cue == cue
    assert result[0].scene_event is None
    assert result[0].category == "OTHER"
    assert result[0].start_ms == 5000
    assert result[0].end_ms == 37400
    assert result[0].anchor_ms == 25000
