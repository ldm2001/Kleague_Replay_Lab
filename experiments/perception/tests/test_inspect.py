import hashlib
import importlib
import json
import subprocess

import pytest

from replay_perception.models import Detection


def run_inspection(*args, **kwargs):
    try:
        operation = importlib.import_module("replay_perception.inspect").inspect
    except ModuleNotFoundError:
        pytest.fail("The standalone perception inspection is not implemented")
    return operation(*args, **kwargs)


def make_video(path):
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-n", "-f", "lavfi", "-i", "color=c=red:s=64x48:r=10:d=1.5",
        "-c:v", "ffv1", str(path),
    ], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr


class Detector:
    provenance = {"model_id": "synthetic-test-double", "device": "cpu"}

    def __init__(self, *, fail_after=None, empty=False):
        self.calls = 0
        self.fail_after = fail_after
        self.empty = empty

    def predict(self, rgb):
        if self.fail_after is not None and self.calls >= self.fail_after:
            raise RuntimeError("synthetic inference failure")
        self.calls += 1
        assert rgb.shape == (48, 64, 3)
        if self.empty:
            return ()
        return (Detection(0, "person", (2, 2, 20, 35), .99), Detection(1, "sports ball", (40, 30, 48, 38), .95))


def test_real_decode_runs_detection_tracking_and_durable_diagnostics(tmp_path):
    source, output = tmp_path / "source.mkv", tmp_path / "result"
    make_video(source)
    model = Detector()
    summary = run_inspection(source, output, model, max_previews=3)
    persisted = json.loads((output / "summary.json").read_text())
    rows = [json.loads(line) for line in (output / "frames.jsonl").read_text().splitlines()]
    assert summary == persisted
    assert summary["status"] == "COMPLETE"
    assert summary["admission"] == "NOT_ADMITTED"
    assert summary["source"]["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert [row["timestampMs"] for row in rows] == [0, 500, 1000]
    assert len(rows) == model.calls == summary["counts"]["recordedFrameCount"] == 3
    assert summary["timings"]["inferredFrameCount"] == 3
    assert rows[0]["detections"][0]["trackId"] is None
    assert rows[1]["detections"][0]["trackId"] is not None
    assert rows[1]["detections"][0]["trackId"] == rows[2]["detections"][0]["trackId"]
    assert all(row["replayState"] == "UNKNOWN" for row in rows)
    assert all(d["actorRole"] == "UNPROVEN" for row in rows for d in row["detections"])
    assert 2 <= len(summary["previews"]) <= 3
    assert summary["previews"][0]["timestampMs"] == 0
    assert summary["previews"][-1]["timestampMs"] == 1000
    assert all((output / preview["path"]).is_file() for preview in summary["previews"])


def test_inference_failure_preserves_partial_trace_and_failed_summary(tmp_path):
    source, output = tmp_path / "source.mkv", tmp_path / "partial"
    make_video(source)
    summary = run_inspection(source, output, Detector(fail_after=1))
    assert summary["status"] == "FAILED"
    assert summary["failureReason"]
    assert summary["counts"]["recordedFrameCount"] == 1
    assert summary["timings"]["inferredFrameCount"] == 1
    assert summary["video"]["sampleCount"] == 2
    assert len((output / "frames.jsonl").read_text().splitlines()) == 1


def test_empty_model_output_is_not_a_no_foul_judgment(tmp_path):
    source, output = tmp_path / "source.mkv", tmp_path / "empty"
    make_video(source)
    summary = run_inspection(source, output, Detector(empty=True))
    assert summary["status"] == "COMPLETE"
    assert summary["admission"] == "NOT_ADMITTED"
    assert summary["counts"]["detectionCount"] == 0
    assert "judgment" not in summary
    assert "NO_FOUL" not in json.dumps(summary)


def test_existing_output_is_not_modified_and_does_not_run_model(tmp_path):
    source, output = tmp_path / "source.mkv", tmp_path / "existing"
    make_video(source)
    output.mkdir()
    (output / "keep.txt").write_text("existing owner")
    model = Detector()
    with pytest.raises(FileExistsError):
        run_inspection(source, output, model)
    assert model.calls == 0
    assert (output / "keep.txt").read_text() == "existing owner"
    assert not (output / "summary.json").exists()


def test_corrupt_media_creates_failed_report_not_empty_success(tmp_path):
    source, output = tmp_path / "bad.mp4", tmp_path / "bad-result"
    source.write_bytes(b"not a video")
    summary = run_inspection(source, output, Detector())
    assert summary["status"] == "FAILED"
    assert summary["failureReason"] == "VIDEO_OPEN_FAILED"
    assert summary["counts"]["recordedFrameCount"] == 0
    assert source.read_bytes() == b"not a video"


def test_existing_dangling_output_link_is_rejected_before_side_effects(tmp_path):
    source = tmp_path / "source.mkv"
    make_video(source)
    target, link = tmp_path / "absent-target", tmp_path / "existing-link"
    link.symlink_to(target, target_is_directory=True)
    model = Detector()
    with pytest.raises(FileExistsError):
        run_inspection(source, link, model)
    assert link.is_symlink()
    assert not target.exists()
    assert model.calls == 0
