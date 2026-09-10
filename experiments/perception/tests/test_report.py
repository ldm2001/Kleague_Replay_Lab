from __future__ import annotations

import json
import math
from fractions import Fraction

import numpy as np
import pytest

from replay_perception.media import VideoSample
from replay_perception.models import Detection
from replay_perception.report import ReportWriter


def sample(index: int, *, width: int = 80, height: int = 60) -> VideoSample:
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


def metadata(source_path):
    return {
        "source": {"path": str(source_path), "sha256": "a" * 64, "sizeBytes": 12},
        "model": {"id": "PekingU/rtdetr_r18vd", "revision": "fixed", "sha256": "b" * 64},
        "tracker": {"name": "ByteTrackTracker", "version": "fixed"},
        "settings": {"intervalMs": 500, "device": "cpu", "dtype": "float32"},
    }


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_existing_output_is_refused_without_changing_source_or_target(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"original-video")
    output = tmp_path / "existing-output"
    output.mkdir()
    marker = output / "keep.txt"
    marker.write_text("existing", encoding="utf-8")

    with pytest.raises(FileExistsError):
        with ReportWriter(output, **metadata(source)):
            pass

    assert source.read_bytes() == b"original-video"
    assert marker.read_text(encoding="utf-8") == "existing"


def test_preview_limit_above_hard_cap_is_rejected_before_output_io(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "must-not-exist"

    with pytest.raises(ValueError, match="MAX_PREVIEWS_INVALID"):
        ReportWriter(output, **metadata(source), max_previews=25)

    assert not output.exists()


def test_output_inside_git_worktree_is_refused(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    repository = tmp_path / "checkout"
    repository.mkdir()
    (repository / ".git").write_text("gitdir: elsewhere", encoding="utf-8")

    with pytest.raises(ValueError, match="OUTPUT_INSIDE_GIT_WORKTREE"):
        with ReportWriter(repository / "diagnostics", **metadata(source)):
            pass


def test_complete_report_streams_observations_and_separates_scope(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"original-video")
    output = tmp_path / "run"
    person = Detection(0, "person", (1, 2, 20, 40), 0.9, "0:person:7")
    ball = Detection(1, "sports ball", (30, 10, 38, 18), 0.7)

    with ReportWriter(output, **metadata(source), max_previews=2) as writer:
        writer.append(sample(0), (person, ball), continuity_id=0, inference_seconds=0.125)
        writer.append(
            sample(1),
            (Detection(0, "person", (2, 2, 21, 40), 0.8, "0:person:7"),),
            continuity_id=0,
            inference_seconds=0.1,
        )
        result = writer.finish(
            "COMPLETE",
            video={"decodedFrameCount": 8, "sampleCount": 2},
            timings={"totalSeconds": 0.5, "inferenceSeconds": 0.225},
        )

    rows = [json.loads(line) for line in (output / "frames.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[0] == {
        "sourceSha256": "a" * 64,
        **sample(0).as_record(),
        "continuityId": 0,
        "replayState": "UNKNOWN",
        "detections": [person.as_record(), ball.as_record()],
        "inferenceSeconds": 0.125,
    }
    assert rows[1]["detections"][0]["box"] == [2.0, 2.0, 21.0, 40.0]
    assert result == read_json(output / "summary.json")
    assert result["schemaVersion"] == 1
    assert result["status"] == "COMPLETE"
    assert result["admission"] == "NOT_ADMITTED"
    assert result["scope"] == "OBJECT_DETECTION_AND_TRACKING_ONLY"
    assert result["notAssessed"] == [
        "actorRoles", "refereeSignals", "contact", "foul", "restarts", "liveReplay",
    ]
    assert result["counts"] == {
        "recordedFrameCount": 2,
        "detectionCount": 3,
        "detectionsByLabel": {"person": 2, "sports ball": 1},
        "framesWithDetectionByLabel": {"person": 2, "sports ball": 1},
        "trackedObservationCount": 2,
        "uniqueTrackIdCount": 1,
        "uniqueTrackIdCountByLabel": {"person": 1, "sports ball": 0},
    }
    assert result["video"] == {"decodedFrameCount": 8, "sampleCount": 2}
    assert result["timings"] == {"totalSeconds": 0.5, "inferenceSeconds": 0.225}
    assert len(result["previews"]) == 2
    assert source.read_bytes() == b"original-video"


def test_empty_detections_are_not_promoted_to_negative_foul_judgments(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with ReportWriter(output, **metadata(source)) as writer:
        writer.append(sample(0), (), continuity_id=0, inference_seconds=0.01)
        summary = writer.finish("COMPLETE", video={"sampleCount": 1}, timings={"totalSeconds": 0.02})

    row = json.loads((output / "frames.jsonl").read_text(encoding="utf-8"))
    assert row["detections"] == []
    assert summary["counts"]["detectionCount"] == 0
    assert summary["admission"] == "NOT_ADMITTED"
    assert not any(key in summary for key in ("foul", "hasFoul", "noFoul", "contact", "isReplay"))


def test_exception_persists_partial_trace_as_failed_without_masking_error(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with pytest.raises(RuntimeError, match="detector stopped"):
        with ReportWriter(output, **metadata(source)) as writer:
            writer.append(sample(0), (), continuity_id=4, inference_seconds=0.01)
            raise RuntimeError("detector stopped")

    summary = read_json(output / "summary.json")
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "RuntimeError"
    assert summary["counts"]["recordedFrameCount"] == 1
    assert summary["video"] == {}
    assert summary["timings"] == {}


def test_complete_forbids_failure_reason_and_failed_requires_one(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")

    with pytest.raises(ValueError, match="COMPLETE_FORBIDS_FAILURE_REASON"):
        with ReportWriter(tmp_path / "complete", **metadata(source)) as writer:
            writer.finish("COMPLETE", video={}, timings={}, failure_reason="not really complete")
    assert read_json(tmp_path / "complete" / "summary.json")["status"] == "FAILED"

    with pytest.raises(ValueError, match="FAILED_REQUIRES_FAILURE_REASON"):
        with ReportWriter(tmp_path / "failed", **metadata(source)) as writer:
            writer.finish("FAILED", video={}, timings={}, failure_reason="  ")
    assert read_json(tmp_path / "failed" / "summary.json")["status"] == "FAILED"


def test_nonfinite_frame_value_is_not_written_or_counted(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with pytest.raises(ValueError):
        with ReportWriter(output, **metadata(source)) as writer:
            writer.append(sample(0), (), continuity_id=0, inference_seconds=math.nan)

    assert (output / "frames.jsonl").read_bytes() == b""
    summary = read_json(output / "summary.json")
    assert summary["counts"]["recordedFrameCount"] == 0
    assert summary["status"] == "FAILED"


def test_nonfinite_summary_value_cannot_be_serialized_as_json_nan(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with pytest.raises(ValueError):
        with ReportWriter(output, **metadata(source)) as writer:
            writer.finish("COMPLETE", video={}, timings={"totalSeconds": math.inf})

    text = (output / "summary.json").read_text(encoding="utf-8")
    assert "Infinity" not in text
    assert "NaN" not in text
    assert json.loads(text)["status"] == "FAILED"


def test_preview_finalization_failure_preserves_validated_video_and_timings(tmp_path, monkeypatch):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"
    video = {"decodedFrameCount": 12, "sampleCount": 3}
    timings = {"inferredFrameCount": 3, "totalSeconds": 1.25}

    with pytest.raises(OSError, match="jpeg destination unavailable"):
        with ReportWriter(output, **metadata(source)) as writer:
            writer.append(sample(0), (), continuity_id=0, inference_seconds=0.01)
            materialize = writer._materialize_previews

            def fail_complete_preview_write(*, strict):
                if strict:
                    raise OSError("jpeg destination unavailable")
                return materialize(strict=False)

            monkeypatch.setattr(writer, "_materialize_previews", fail_complete_preview_write)
            writer.finish("COMPLETE", video=video, timings=timings)

    summary = read_json(output / "summary.json")
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "OSError"
    assert summary["video"] == video
    assert summary["timings"] == timings
    assert summary["counts"]["recordedFrameCount"] == 1


def test_concurrently_created_summary_is_never_overwritten(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with pytest.raises(FileExistsError):
        with ReportWriter(output, **metadata(source)) as writer:
            marker = output / "summary.json"
            marker.write_text("somebody else's file", encoding="utf-8")
            writer.finish("COMPLETE", video={}, timings={})

    assert (output / "summary.json").read_text(encoding="utf-8") == "somebody else's file"


def test_finish_is_allowed_only_once(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"video")
    output = tmp_path / "run"

    with ReportWriter(output, **metadata(source)) as writer:
        writer.finish("COMPLETE", video={}, timings={})
        with pytest.raises(RuntimeError, match="REPORT_ALREADY_FINISHED"):
            writer.finish("COMPLETE", video={}, timings={})
