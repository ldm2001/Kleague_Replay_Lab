from pathlib import Path
from dataclasses import replace
from unittest.mock import Mock

import pytest

from replay_video.domain.models import Candidate, VideoMetadata
from replay_video.infrastructure.evidence import evidence


def candidate(index: int, *, corner: bool) -> Candidate:
    start = index * 1000
    event = {
        "kind": "CORNER_KICK", "status": "OBSERVED", "startMs": start + 100,
        "endMs": start + 700, "restartMs": start + 400,
        "evidenceTimestampsMs": [start + 100, start + 400, start + 600],
        "method": "corner-geometry-motion-v1",
    } if corner else None
    return Candidate(index, "OTHER", start, start + 800, start + 400,
                     0.0 if corner else index / 100, "MEDIUM", (), (), scene_event=event)


@pytest.mark.parametrize("corner_count", [9, 2, 0])
def test_all_corner_sequences_keep_clips_within_remaining_generic_budget(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, corner_count: int,
) -> None:
    source = tmp_path / "source.mp4"
    metadata = VideoMetadata(source, 60_000, 1920, 1080, 30.0, 1800, "h264")
    corners = tuple(candidate(index, corner=True) for index in range(1, corner_count + 1))
    generic = tuple(candidate(index, corner=False) for index in range(20, 30))
    frame_writer = Mock()
    clip_writer = Mock()
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", frame_writer)
    monkeypatch.setattr("replay_video.infrastructure.evidence.clip", clip_writer)

    result = evidence(source, tmp_path / "result", metadata, corners + generic)

    clips = {item.candidate_index: item for item in result if item.kind == "CLIP"}
    expected_generic = set(range(30 - max(0, 8 - corner_count), 30))
    assert set(clips) == set(range(1, corner_count + 1)) | expected_generic
    assert frame_writer.call_count == len(corners + generic)
    assert clip_writer.call_count == max(8, corner_count)
    for item in corners:
        clip = clips[item.index]
        assert all(clip.start_ms <= time <= clip.end_ms for time in item.scene_event["evidenceTimestampsMs"])
        clip_writer.assert_any_call(source.resolve(), clip.path, item.start_ms, item.end_ms)


def test_goal_graphic_clip_is_not_lost_behind_corner_or_motion_candidates(monkeypatch, tmp_path):
    source = tmp_path / "source.mp4"
    metadata = VideoMetadata(source, 60_000, 1920, 1080, 30.0, 1800, "h264")
    corners = tuple(candidate(index, corner=True) for index in range(1, 10))
    goal = replace(candidate(15, corner=False), confidence=0.0,
                   broadcast_cue={"kind": "GOAL_GRAPHIC", "startMs": 15100, "endMs": 15400,
                                  "method": "broadcast-goal-glyphs-v1", "evidenceTimestampsMs": [15100, 15400]})
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", Mock())
    monkeypatch.setattr("replay_video.infrastructure.evidence.clip", Mock())
    result = evidence(source, tmp_path / "result", metadata, corners + (goal,))
    assert {item.candidate_index for item in result if item.kind == "CLIP"} == set(range(1, 10)) | {15}
