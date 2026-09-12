from __future__ import annotations

from copy import deepcopy
from fractions import Fraction
import json
import math
import os
from pathlib import Path

import numpy as np
import pytest

from replay_perception.media import VideoSample
from replay_perception.models import Detection
from replay_perception.observation_report import ObservationReport
from replay_perception.observations import (
    KEYPOINT_NAMES,
    Keypoint,
    PoseObservation,
    RoleDetection,
    RoleHypothesis,
)
from replay_perception.recorded_frames import RecordedFrame


def _sample(index: int, *, width: int = 160, height: int = 120) -> VideoSample:
    return VideoSample(
        decoded_index=index * 3,
        stream_index=2,
        pts=9000 + index * 4500,
        time_base=Fraction(1, 90000),
        origin_pts=9000,
        origin_time_base=Fraction(1, 90000),
        timestamp_ms=index * 50,
        rgb=np.zeros((height, width, 3), dtype=np.uint8),
    )


def _frame(index: int = 0) -> RecordedFrame:
    detections = (
        Detection(7, "person", (10, 12, 80, 110), 0.91, "0:person:17"),
        Detection(8, "sports ball", (100, 30, 112, 42), 0.73),
    )
    return RecordedFrame(_sample(index), detections, continuity_id=3, record_index=40 + index)


def _pose() -> PoseObservation:
    points = tuple(
        Keypoint(index, name, 20.0 + index * 2, 30.0 + index, 0.9)
        for index, name in enumerate(KEYPOINT_NAMES)
    )
    return PoseObservation(7, (10, 12, 80, 110), points, ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0)))


def _metadata(tmp_path: Path) -> dict:
    source_path = tmp_path / "source.mp4"
    source_path.write_bytes(b"original-source")
    upstream_summary = tmp_path / "upstream-summary.json"
    upstream_rows = tmp_path / "upstream-frames.jsonl"
    upstream_summary.write_bytes(b'{"unchanged":true}\n')
    upstream_rows.write_bytes(b'{"unchanged":true}\n')
    return {
        "source": {"path": str(source_path), "sha256": "a" * 64, "sizeBytes": 15},
        "upstream": {
            "summaryPath": str(upstream_summary),
            "framesJsonlPath": str(upstream_rows),
            "summarySha256": "b" * 64,
            "framesJsonlSha256": "c" * 64,
        },
        "models": {
            "role": {"id": "fixed-role", "sha256": "d" * 64},
            "pose": {"id": "fixed-pose", "sha256": "e" * 64},
        },
        "settings": {"roleThreshold": 0.5, "poseJointThreshold": 0.5},
    }


def _inputs():
    raw = (
        RoleDetection(20, "ball", (100, 30, 112, 42), 0.8),
        RoleDetection(21, "referee", (11, 13, 79, 109), 0.82),
    )
    matched = (RoleHypothesis(7, "MATCHED", "referee", 0.82, 21, 0.9),)
    arms = (
        {"detectionId": 7, "side": "LEFT", "state": "ARM_RAISED", "reasonCode": "FIXTURE"},
        {"detectionId": 7, "side": "RIGHT", "state": "NOT_RAISED", "reasonCode": "FIXTURE"},
    )
    episode = {
        "kind": "ARM_RAISED",
        "actorRoleHypothesis": "referee",
        "admission": "NOT_ADMITTED",
        "continuityId": 3,
        "trackId": "0:person:17",
        "side": "LEFT",
        "startMs": 0,
        "endMs": 250,
        "confirmedMs": 200,
        "supportFrameCount": 3,
        "startFrame": {"pts": 9000, "timeBase": {"numerator": 1, "denominator": 90000}},
        "endFrame": {"pts": 31500, "timeBase": {"numerator": 1, "denominator": 90000}},
        "confirmedFrame": {"pts": 27000, "timeBase": {"numerator": 1, "denominator": 90000}},
        "episodeId": "3:0:person:17:LEFT:9000",
        "scope": "TRACK_FRAGMENT_NOT_VERIFIED_IDENTITY",
    }
    return raw, matched, arms, episode


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_complete_report_writes_exact_observation_and_separate_episode_streams(tmp_path):
    metadata = _metadata(tmp_path)
    originals = deepcopy(metadata)
    source_before = Path(metadata["source"]["path"]).read_bytes()
    upstream_before = {
        key: Path(metadata["upstream"][key]).read_bytes()
        for key in ("summaryPath", "framesJsonlPath")
    }
    raw, matched, arms, episode = _inputs()
    source_detection_record = _frame().detections[0].as_record()
    output = tmp_path / "observation-output"

    with ObservationReport(output, **metadata, max_previews=2) as report:
        # Prove metadata was cloned at construction, not read lazily at finish.
        metadata["models"]["role"]["id"] = "mutated-after-start"
        report.append(
            _frame(), raw, matched, (_pose(),), arms, (episode,),
            {"roleSeconds": 0.01, "poseSeconds": 0.02},
            role_input_transform={"source": {"width": 160, "height": 120}, "letterbox": {"padX": 0}},
        )
        summary = report.finish(
            "COMPLETE",
            replay={"selectedRecordCount": 1, "replayedFrameCount": 1},
            timings={"totalSeconds": 0.04},
        )

    rows = [json.loads(line) for line in (output / "observations.jsonl").read_text().splitlines()]
    candidates = [json.loads(line) for line in (output / "arm-candidates.jsonl").read_text().splitlines()]
    assert rows == [{
        "sourceSha256": "a" * 64,
        **_sample(0).as_record(),
        "upstreamRecordIndex": 40,
        "continuityId": 3,
        "replayState": "UNKNOWN",
        "sourceDetections": [item.as_record() for item in _frame().detections],
        "roleDetections": [item.as_record() for item in raw],
        "roleHypotheses": [item.as_record() for item in matched],
        "poses": [_pose().as_record()],
        "arms": list(arms),
        "roleInputTransform": {"source": {"width": 160, "height": 120}, "letterbox": {"padX": 0}},
        "stageTimings": {"roleSeconds": 0.01, "poseSeconds": 0.02},
    }]
    assert candidates == [episode]
    assert rows[0]["sourceDetections"][0] == source_detection_record
    assert rows[0]["sourceDetections"][0]["actorRole"] == "UNPROVEN"
    assert rows[0]["roleDetections"][0]["role"] == "ball"
    assert summary == _read_json(output / "summary.json")
    assert summary["schemaVersion"] == 1
    assert summary["reportType"] == "REFEREE_OBSERVATIONS"
    assert summary["scope"] == "ROLE_POSE_AND_ARM_OBSERVATION_ONLY"
    assert summary["status"] == "COMPLETE"
    assert summary["admission"] == "NOT_ADMITTED"
    assert summary["source"] == originals["source"]
    assert summary["upstream"] == originals["upstream"]
    assert summary["models"] == originals["models"]
    assert summary["settings"] == originals["settings"]
    assert summary["replay"] == {"selectedRecordCount": 1, "replayedFrameCount": 1}
    assert summary["counts"] == {
        "recordedFrameCount": 1,
        "sourcePersonCount": 1,
        "rawRoleDetectionCount": 2,
        "rawRolesByLabel": {"ball": 1, "goalkeeper": 0, "player": 0, "referee": 1},
        "matchedRoleCount": 1,
        "matchedRolesByLabel": {"goalkeeper": 0, "player": 0, "referee": 1},
        "unmatchedRoleCount": 0,
        "ambiguousRoleCount": 0,
        "poseCount": 1,
        "armStatesByState": {"ARM_RAISED": 1, "NOT_RAISED": 1, "UNOBSERVABLE": 0},
        "candidateCount": 1,
    }
    assert summary["notAssessed"] == [
        "mainVsAssistantReferee", "flagObject", "cards", "declaredDecision",
        "contact", "foul", "restarts", "liveReplay",
    ]
    assert Path(metadata["source"]["path"]).read_bytes() == source_before
    assert all(Path(metadata["upstream"][key]).read_bytes() == value for key, value in upstream_before.items())


def test_zero_observations_are_not_reported_as_no_foul(tmp_path):
    metadata = _metadata(tmp_path)
    output = tmp_path / "empty"
    with ObservationReport(output, **metadata) as report:
        summary = report.finish("COMPLETE", replay={"replayedFrameCount": 0}, timings={"totalSeconds": 0.0})

    assert summary["counts"]["recordedFrameCount"] == 0
    assert summary["counts"]["candidateCount"] == 0
    assert summary["admission"] == "NOT_ADMITTED"
    assert not any(key in summary for key in ("foul", "hasFoul", "noFoul", "declaredDecision"))


def test_unfinished_context_persists_only_successful_prefix_and_failed_summary(tmp_path):
    metadata = _metadata(tmp_path)
    raw, matched, arms, episode = _inputs()
    output = tmp_path / "failed"

    with pytest.raises(RuntimeError, match="pose stopped"):
        with ObservationReport(output, **metadata) as report:
            report.append(_frame(), raw, matched, (_pose(),), arms, (episode,), {})
            raise RuntimeError("pose stopped")

    assert len((output / "observations.jsonl").read_text().splitlines()) == 1
    assert len((output / "arm-candidates.jsonl").read_text().splitlines()) == 1
    summary = _read_json(output / "summary.json")
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "RuntimeError"
    assert summary["counts"]["recordedFrameCount"] == 1
    assert summary["counts"]["candidateCount"] == 1
    assert summary["replay"] == {}
    assert summary["timings"] == {}


class _PartialFailingStream:
    def __init__(self, wrapped):
        self.wrapped = wrapped
        self.failed = False

    @property
    def closed(self):
        return self.wrapped.closed

    def tell(self):
        return self.wrapped.tell()

    def seek(self, *args):
        return self.wrapped.seek(*args)

    def truncate(self, *args):
        return self.wrapped.truncate(*args)

    def flush(self):
        return self.wrapped.flush()

    def close(self):
        return self.wrapped.close()

    def write(self, value):
        if not self.failed:
            self.failed = True
            self.wrapped.write(value[: max(1, len(value) // 2)])
            raise OSError("disk stopped")
        return self.wrapped.write(value)


class _CloseFailsOnce:
    def __init__(self, wrapped):
        self.wrapped = wrapped
        self.close_calls = 0

    @property
    def closed(self):
        return self.wrapped.closed

    def __getattr__(self, name):
        return getattr(self.wrapped, name)

    def close(self):
        self.close_calls += 1
        self.wrapped.close()
        raise OSError("trace close failed")


def test_failed_partial_line_is_rolled_back_and_not_counted(tmp_path):
    metadata = _metadata(tmp_path)
    output = tmp_path / "partial-line"
    raw, matched, arms, _ = _inputs()

    with pytest.raises(OSError, match="disk stopped"):
        with ObservationReport(output, **metadata) as report:
            report._observations = _PartialFailingStream(report._observations)
            report.append(_frame(), raw, matched, (_pose(),), arms, (), {})

    assert (output / "observations.jsonl").read_bytes() == b""
    summary = _read_json(output / "summary.json")
    assert summary["counts"]["recordedFrameCount"] == 0
    assert summary["counts"]["sourcePersonCount"] == 0


def test_preview_collision_during_finish_preserves_valid_replay_and_timings(tmp_path):
    metadata = _metadata(tmp_path)
    output = tmp_path / "preview-collision"
    replay = {"selectedRecordCount": 1, "replayedFrameCount": 1}
    timings = {"totalSeconds": 1.25, "roleSeconds": 0.4}

    with ObservationReport(output, **metadata, max_previews=2) as report:
        report.append(_frame(), (), (), (), (), (), {})
        collision = output / "frames" / "preview-0000-frame-00000000.jpg"
        collision.write_bytes(b"existing-child")
        summary = report.finish("COMPLETE", replay=replay, timings=timings)

    assert collision.read_bytes() == b"existing-child"
    assert summary == _read_json(output / "summary.json")
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "FileExistsError"
    assert summary["replay"] == replay
    assert summary["timings"] == timings


def test_complete_is_not_published_when_observation_stream_close_fails(tmp_path):
    metadata = _metadata(tmp_path)
    output = tmp_path / "close-failure"
    replay = {"selectedRecordCount": 1, "replayedFrameCount": 1}
    timings = {"totalSeconds": 0.25}

    with ObservationReport(output, **metadata) as report:
        report.append(_frame(), (), (), (), (), (), {})
        failing = _CloseFailsOnce(report._observations)
        report._observations = failing
        summary = report.finish("COMPLETE", replay=replay, timings=timings)

    assert failing.close_calls == 1
    assert summary == _read_json(output / "summary.json")
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "OSError"
    assert summary["replay"] == replay
    assert summary["timings"] == timings
    assert summary["counts"]["recordedFrameCount"] == 1


def test_failed_run_keeps_primary_reason_when_preview_finalization_also_fails(tmp_path):
    metadata = _metadata(tmp_path)
    output = tmp_path / "primary-failure"
    replay = {"selectedRecordCount": 2, "replayedFrameCount": 2}
    timings = {"roleInferredFrameCount": 1, "totalSeconds": 0.5}

    with ObservationReport(output, **metadata, max_previews=2) as report:
        report.append(_frame(), (), (), (), (), (), {})
        collision = output / "frames" / "preview-0000-frame-00000000.jpg"
        collision.write_bytes(b"existing-child")
        summary = report.finish(
            "FAILED",
            replay=replay,
            timings=timings,
            failure_reason="TEST_ROLE_FAILED",
        )

    assert collision.read_bytes() == b"existing-child"
    assert summary == _read_json(output / "summary.json")
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "TEST_ROLE_FAILED"
    assert summary["finalizationFailureReason"] == "FileExistsError"
    assert summary["replay"] == replay
    assert summary["timings"] == timings
    assert summary["counts"]["recordedFrameCount"] == 1


def test_failed_run_keeps_primary_reason_when_timing_json_is_invalid(tmp_path):
    metadata = _metadata(tmp_path)
    output = tmp_path / "invalid-final-timings"
    replay = {"selectedRecordCount": 1, "replayedFrameCount": 1}

    with ObservationReport(output, **metadata) as report:
        report.append(_frame(), (), (), (), (), (), {})
        summary = report.finish(
            "FAILED",
            replay=replay,
            timings={"roleSeconds": math.nan},
            failure_reason="TEST_ROLE_FAILED",
        )

    assert summary == _read_json(output / "summary.json")
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "TEST_ROLE_FAILED"
    assert summary["finalizationFailureReason"] == "ValueError"
    assert summary["replay"] == replay
    assert summary["timings"] == {}
    assert "NaN" not in (output / "summary.json").read_text(encoding="utf-8")


def test_nonfinite_metadata_and_rows_never_emit_json_nan(tmp_path):
    metadata = _metadata(tmp_path)
    with pytest.raises(ValueError):
        ObservationReport(tmp_path / "invalid-metadata", **{**metadata, "settings": {"bad": math.nan}})
    assert not (tmp_path / "invalid-metadata").exists()

    output = tmp_path / "invalid-row"
    with pytest.raises(ValueError):
        with ObservationReport(output, **metadata) as report:
            report.append(_frame(), (), (), (), ({"state": "ARM_RAISED", "bad": math.inf},), (), {})
    assert "NaN" not in (output / "observations.jsonl").read_text()
    assert "Infinity" not in (output / "summary.json").read_text()


@pytest.mark.parametrize("bad_sha", ["", "a" * 63, "g" * 64, 123])
def test_source_sha256_must_be_exact_lower_or_upper_hex(tmp_path, bad_sha):
    metadata = _metadata(tmp_path)
    metadata["source"]["sha256"] = bad_sha
    with pytest.raises(ValueError, match="SOURCE_SHA256_INVALID"):
        ObservationReport(tmp_path / "bad-sha", **metadata)


@pytest.mark.parametrize("max_previews", [True, 1, 25])
def test_preview_limit_is_strict_before_creating_output(tmp_path, max_previews):
    metadata = _metadata(tmp_path)
    output = tmp_path / f"bad-limit-{max_previews}"
    with pytest.raises(ValueError, match="MAX_PREVIEWS_INVALID"):
        ObservationReport(output, **metadata, max_previews=max_previews)
    assert not output.exists()


def test_existing_output_dangling_symlink_and_worktree_paths_are_refused(tmp_path):
    metadata = _metadata(tmp_path)
    existing = tmp_path / "existing"
    existing.mkdir()
    marker = existing / "keep"
    marker.write_bytes(b"keep")
    with pytest.raises(FileExistsError):
        with ObservationReport(existing, **metadata):
            pass
    assert marker.read_bytes() == b"keep"

    dangling = tmp_path / "dangling"
    dangling.symlink_to(tmp_path / "missing-target", target_is_directory=True)
    assert os.path.lexists(dangling)
    with pytest.raises(FileExistsError):
        with ObservationReport(dangling, **metadata):
            pass

    checkout = tmp_path / "checkout"
    checkout.mkdir()
    (checkout / ".git").write_text("gitdir: elsewhere", encoding="utf-8")
    with pytest.raises(ValueError, match="OUTPUT_INSIDE_GIT_WORKTREE"):
        with ObservationReport(checkout / "output", **metadata):
            pass


def test_concurrently_created_summary_is_not_overwritten(tmp_path):
    metadata = _metadata(tmp_path)
    output = tmp_path / "summary-collision"
    with pytest.raises(FileExistsError):
        with ObservationReport(output, **metadata) as report:
            marker = output / "summary.json"
            marker.write_text("somebody else's data", encoding="utf-8")
            report.finish("COMPLETE", replay={}, timings={})
    assert marker.read_text(encoding="utf-8") == "somebody else's data"


def test_append_episodes_supports_finish_flush_without_fabricating_completion(tmp_path):
    metadata = _metadata(tmp_path)
    _, _, _, episode = _inputs()
    output = tmp_path / "finish-episodes"
    with ObservationReport(output, **metadata) as report:
        report.append_episodes((episode,))
        summary = report.finish("COMPLETE", replay={}, timings={})

    assert summary["counts"]["recordedFrameCount"] == 0
    assert summary["counts"]["candidateCount"] == 1
    assert json.loads((output / "arm-candidates.jsonl").read_text()) == episode
    assert "declaredDecision" not in episode


def test_invalid_episode_is_not_written_or_counted(tmp_path):
    metadata = _metadata(tmp_path)
    _, _, _, episode = _inputs()
    output = tmp_path / "invalid-episode"
    invalid = {**episode, "admission": "ADMITTED"}
    with pytest.raises(ValueError, match="EPISODE_ADMISSION_INVALID"):
        with ObservationReport(output, **metadata) as report:
            report.append_episodes((invalid,))

    assert (output / "arm-candidates.jsonl").read_bytes() == b""
    assert _read_json(output / "summary.json")["counts"]["candidateCount"] == 0


@pytest.mark.parametrize("actor_role", [None, "player", "goalkeeper"])
def test_episode_requires_referee_role_hypothesis(tmp_path, actor_role):
    metadata = _metadata(tmp_path)
    _, _, _, episode = _inputs()
    output = tmp_path / f"invalid-episode-role-{actor_role}"
    invalid = dict(episode)
    if actor_role is None:
        invalid.pop("actorRoleHypothesis")
    else:
        invalid["actorRoleHypothesis"] = actor_role

    with pytest.raises(ValueError, match="EPISODE_ACTOR_ROLE_INVALID"):
        with ObservationReport(output, **metadata) as report:
            report.append_episodes((invalid,))

    assert (output / "arm-candidates.jsonl").read_bytes() == b""
    assert _read_json(output / "summary.json")["counts"]["candidateCount"] == 0
