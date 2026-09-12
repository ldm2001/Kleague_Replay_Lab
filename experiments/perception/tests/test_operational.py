from dataclasses import replace
import gzip
import hashlib
import importlib
import json
import subprocess

import pytest

from replay_perception.models import Detection
from replay_perception.observations import RoleDetection
from test_official_objects import scene


def api():
    return importlib.import_module("replay_perception.operational")


def video(path, duration="0.5", fps="10"):
    result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-n", "-f", "lavfi", "-i",
                             f"color=c=0x2d822d:s=320x360:r={fps}:d={duration}",
                             "-c:v", "ffv1", str(path)], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr


class Detector:
    provenance = {"model_id": "synthetic-detector", "revision": "test",
                  "files": {"model.safetensors": "a" * 64}}
    def __init__(self, empty=False):
        self.calls = 0
        self.empty = empty
    def predict(self, rgb):
        self.calls += 1
        assert rgb.shape == (360, 320, 3)
        return () if self.empty else (Detection(0, "person", (100, 55, 180, 278), .99),)


class Roles:
    provenance = {"model_id": "synthetic-role", "revision": "test",
                  "files": {"yolo-football-player-detection.pt": "b" * 64}}
    last_transform = None
    def __init__(self):
        self.calls = 0
    def predict(self, rgb):
        self.calls += 1
        return (RoleDetection(0, "referee", (100, 55, 180, 278), .99),)


class Poses:
    provenance = {"model_id": "synthetic-pose", "revision": "test",
                  "files": {"model.safetensors": "c" * 64}}
    def __init__(self, fail_after=None):
        self.calls = 0
        self.fail_after = fail_after
    def predict(self, rgb, detections):
        if self.fail_after is not None and self.calls >= self.fail_after:
            raise RuntimeError("POSE_INFERENCE_FAILED")
        self.calls += 1
        prototype = scene(kind="none", boundary=False)[2][0]
        return tuple(replace(prototype, detection_id=item.detection_id, source_box=item.box) for item in detections)


def bundle(**kwargs):
    return api().ObserverModels(Detector(empty=kwargs.get("empty", False)), Roles(),
                                Poses(fail_after=kwargs.get("fail_after")))


def records(result):
    with gzip.open(result["artifact"]["path"], "rt") as stream:
        return [json.loads(line) for line in stream]


def test_same_pts_stream_runs_three_existing_observer_ports_and_private_artifact(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    models = bundle()
    progress = []
    result = api().run_observers(source, tmp_path / "output", models, duration_ms=500, progress=progress.append)
    assert result["processingStatus"] == "COMPLETE"
    assert result["coverage"] == {"startMs": 0, "endMs": 500, "sampleIntervalMs": 100,
                                  "expectedSamples": 5, "processedSamples": 5, "failedSamples": 0}
    assert result["sourceSha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert models.detector.calls == models.role.calls == models.pose.calls == 5
    rows = records(result)
    assert rows[0]["kind"] == "HEADER"
    assert [row["frame"]["timestampMs"] for row in rows if row["kind"] == "FRAME"] == [0, 100, 200, 300, 400]
    assert all(row["replayState"] == "UNKNOWN" for row in rows[1:])
    assert result["summary"]["poseObservationCount"] == 5
    assert result["summary"]["officialCueCount"] == 1
    assert len(result["observations"]) == 1
    assert result["observations"][0]["officialRole"] == "MAIN_CANDIDATE"
    assert result["observations"][0]["admission"] == "NOT_ADMITTED"
    assert progress[-1]["processedSamples"] == 5
    assert "NO_FOUL" not in json.dumps(result)
    assert json.loads((tmp_path / "output" / "summary.json").read_text()) == result


def test_model_stage_failure_preserves_prior_rows_and_explicit_missing_coverage(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    models = bundle(fail_after=2)
    result = api().run_observers(source, tmp_path / "output", models, duration_ms=500)
    assert result["processingStatus"] == "PARTIAL"
    assert result["coverage"]["processedSamples"] == 2
    assert result["coverage"]["failedSamples"] == 3
    assert "POSE_INFERENCE_FAILED" in result["summary"]["reasons"]
    failed = records(result)[-1]
    assert failed["kind"] == "FRAME_FAILURE"
    assert failed["failedStage"] == "POSE"
    assert failed["detections"] and failed["roles"]
    assert models.detector.calls == models.role.calls == 3


def test_lease_loss_check_stops_before_next_inference_and_preserves_partial(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    models = bundle()
    checks = []
    def cancellation():
        checks.append(True)
        if models.detector.calls >= 2:
            raise RuntimeError("WORKER_LEASE_LOST")
    result = api().run_observers(source, tmp_path / "output", models, duration_ms=500, check_cancelled=cancellation)
    assert result["processingStatus"] == "PARTIAL"
    assert "WORKER_LEASE_LOST" in result["summary"]["reasons"]
    assert models.detector.calls == 2
    assert result["coverage"]["processedSamples"] <= 2
    assert len(checks) >= 3
    assert records(result)[0]["kind"] == "HEADER"


def test_sparse_video_cannot_claim_complete_sampling_coverage(tmp_path):
    source = tmp_path / "source.mkv"
    video(source, "1.0", "2")
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True), duration_ms=1000)
    assert result["processingStatus"] == "PARTIAL"
    assert result["coverage"]["expectedSamples"] == 10
    assert result["coverage"]["processedSamples"] == 2
    assert result["coverage"]["failedSamples"] == 8
    assert "SAMPLING_COVERAGE_INCOMPLETE" in result["summary"]["reasons"]


def test_empty_detection_is_valid_processing_not_a_negative_foul_fact(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    models = bundle(empty=True)
    result = api().run_observers(source, tmp_path / "output", models, duration_ms=500)
    assert result["processingStatus"] == "COMPLETE"
    assert result["summary"]["poseObservationCount"] == 0
    assert result["observations"] == result["interactions"] == result["links"] == []
    assert models.pose.calls == 0
    assert not {"facts", "judgment", "contactDetected"}.intersection(result)


def test_existing_output_rejected_before_model_calls(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    output = tmp_path / "output"
    output.mkdir()
    marker = output / "keep.txt"
    marker.write_text("preserve")
    models = bundle()
    with pytest.raises(FileExistsError):
        api().run_observers(source, output, models, duration_ms=500)
    assert marker.read_text() == "preserve"
    assert models.detector.calls == 0


def test_runtime_limit_is_partial_and_does_not_infer_extra_sample(tmp_path, monkeypatch):
    source = tmp_path / "source.mkv"
    video(source)
    models = bundle()
    monkeypatch.setattr(api(), "MAX_RUNTIME_SECONDS", 0)
    result = api().run_observers(source, tmp_path / "output", models, duration_ms=500)
    assert result["processingStatus"] == "PARTIAL"
    assert models.detector.calls == 0
    assert "OBSERVATION_RUNTIME_LIMIT" in result["summary"]["reasons"]


def test_source_change_during_observation_is_not_returned_as_source_bound_result(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    def changed(event):
        if event["processedSamples"] == 1:
            with source.open("ab") as stream:
                stream.write(b"changed")
    with pytest.raises(ValueError, match="VIDEO_SOURCE_CHANGED"):
        api().run_observers(source, tmp_path / "output", bundle(), duration_ms=500, progress=changed)


def test_reappearing_link_id_is_counted_once_not_as_another_episode():
    retained = api()._Retained()
    retained.update([{"id": "link-one", "endMs": 300}])
    retained.update([])
    retained.update([{"id": "link-one", "endMs": 500}])
    assert retained.count == 1
    assert retained.rows["link-one"]["endMs"] == 500


def test_episode_identity_index_is_bounded_and_rejects_before_mutation(monkeypatch):
    monkeypatch.setattr(api(), "MAX_INDEXED_EPISODES", 1)
    retained = api()._Retained()
    retained.update([{"id": "one"}])
    with pytest.raises(ValueError, match="EPISODE_INDEX_LIMIT"):
        retained.update([{"id": "two"}])
    assert retained.count == 1
    assert list(retained.rows) == ["one"]


def test_header_fingerprints_transitive_behavior_sources(tmp_path):
    from pathlib import Path
    source = tmp_path / "source.mkv"
    video(source)
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True), duration_ms=500)
    hashes = records(result)[0]["implementation"]["sourceFilesSha256"]
    for name in ("continuity.py", "signals.py", "observations.py", "recorded_frames.py"):
        assert name in hashes
        assert hashes[name] == hashlib.sha256((Path(api().__file__).parent / name).read_bytes()).hexdigest()


def test_next_decode_failure_does_not_relabel_previously_successful_frame(tmp_path, monkeypatch):
    source = tmp_path / "source.mkv"
    video(source)
    actual_reader = api().VideoReader
    class FailedReader:
        def __init__(self, *args, **kwargs):
            self.actual = actual_reader(*args, **kwargs)
        def __enter__(self):
            self.actual.__enter__()
            return self
        def __iter__(self):
            yield next(iter(self.actual))
            raise ValueError("VIDEO_DECODE_FAILED")
        def __exit__(self, *args):
            self.actual.__exit__(*args)
    monkeypatch.setattr(api(), "VideoReader", FailedReader)
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True), duration_ms=500)
    rows = records(result)
    assert result["processingStatus"] == "PARTIAL"
    assert result["coverage"]["processedSamples"] == 1
    assert rows[-2]["kind"] == "FRAME" and rows[-2]["frame"]["timestampMs"] == 0
    assert rows[-1]["kind"] == "RUN_FAILURE"
    assert rows[-1]["failedStage"] == "DECODING"
    assert "frame" not in rows[-1]


def test_inference_error_survives_simultaneous_artifact_finalize_error(tmp_path, monkeypatch):
    source = tmp_path / "source.mkv"
    video(source, "0.1")
    actual_artifact = api().DiagnosticArtifact
    class BrokenArtifact(actual_artifact):
        def __exit__(self, *args):
            class BrokenCompressor:
                def flush(self, mode):
                    raise OSError("FINALIZE_FAILED")
            self._compressor = BrokenCompressor()
            return super().__exit__(*args)
    monkeypatch.setattr(api(), "DiagnosticArtifact", BrokenArtifact)
    with pytest.raises(RuntimeError, match="POSE_INFERENCE_FAILED") as caught:
        api().run_observers(source, tmp_path / "output", bundle(fail_after=0), duration_ms=100)
    assert isinstance(caught.value.__cause__, OSError)
    assert str(caught.value.__cause__) == "FINALIZE_FAILED"


def test_final_observation_stage_over_deadline_cannot_report_complete(tmp_path, monkeypatch):
    from types import SimpleNamespace
    source = tmp_path / "source.mkv"
    video(source, "0.1")
    clock = [0.]
    monkeypatch.setattr(api(), "time", SimpleNamespace(perf_counter=lambda: clock[0]))
    class SlowLinker:
        def update(self, *args):
            clock[0] = 1801.
            return ()
    monkeypatch.setattr(api(), "IncidentLinker", SlowLinker)
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True), duration_ms=100)
    assert result["processingStatus"] == "PARTIAL"
    assert "OBSERVATION_RUNTIME_LIMIT" in result["summary"]["reasons"]


def test_exact_sample_cap_is_successful_when_no_extra_sample_is_attempted(tmp_path, monkeypatch):
    source = tmp_path / "source.mkv"
    video(source, "0.1")
    monkeypatch.setattr(api(), "MAX_PROCESSED_FRAMES", 1)
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True), duration_ms=100)
    assert result["processingStatus"] == "COMPLETE"
    assert result["coverage"]["processedSamples"] == 1
