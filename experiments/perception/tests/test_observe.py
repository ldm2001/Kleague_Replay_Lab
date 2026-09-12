import hashlib
import importlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest

from replay_perception.media import VideoReader
from replay_perception.models import Detection
from replay_perception.observations import KEYPOINT_NAMES, Keypoint, PoseObservation, RoleDetection
from replay_perception.report import ReportWriter


PEOPLE = (
    Detection(1, "person", (20, 20, 80, 150), .9, "0:0:person:1"),
    Detection(2, "person", (120, 20, 180, 150), .9, "0:0:person:2"),
)


def api():
    return importlib.import_module("replay_perception.observe")


def pose_for(person):
    shift = person.box[0] - 20
    positions = {5: (35 + shift, 50), 7: (35 + shift, 30), 9: (35 + shift, 5), 11: (35 + shift, 110),
                 6: (65 + shift, 50), 8: (65 + shift, 80), 10: (65 + shift, 110), 12: (65 + shift, 110)}
    points = tuple(Keypoint(index, name, *positions.get(index, (50 + shift, 80)), .9)
                   for index, name in enumerate(KEYPOINT_NAMES))
    return PoseObservation(person.detection_id, person.box, points, ((1., 0., 0.), (0., 1., 0.)))


class RoleModel:
    provenance = {"id": "test-role", "kind": "TEST_DOUBLE"}

    def __init__(self, *, empty=False, fail_on=None, effect=None):
        self.calls = 0
        self.empty = empty
        self.fail_on = fail_on
        self.effect = effect
        self.last_transform = None

    def predict(self, rgb):
        self.calls += 1
        if self.effect is not None:
            self.effect(self.calls)
        if self.calls == self.fail_on:
            raise ValueError("TEST_ROLE_FAILED")
        self.last_transform = {"sourceWidth": rgb.shape[1], "sourceHeight": rgb.shape[0], "kind": "TEST_DOUBLE"}
        if self.empty:
            return ()
        return (RoleDetection(10, "referee", PEOPLE[0].box, .8),
                RoleDetection(20, "goalkeeper", PEOPLE[1].box, .9))


class PoseModel:
    provenance = {"id": "test-pose", "kind": "TEST_DOUBLE"}

    def __init__(self, *, fail_on=None, missing=False):
        self.calls = 0
        self.fail_on = fail_on
        self.missing = missing

    def predict(self, _rgb, detections):
        self.calls += 1
        if self.calls == self.fail_on:
            raise ValueError("TEST_POSE_FAILED")
        values = tuple(pose_for(person) for person in detections)
        return values[:-1] if self.missing else values


@pytest.fixture
def inputs(tmp_path):
    if shutil.which("ffmpeg") is None:
        pytest.skip("FFmpeg required for original-PTS integration fixture")
    source = tmp_path / "source.mkv"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=green:size=200x160:rate=10:duration=0.4",
                    "-c:v", "ffv1", str(source)], check=True)
    upstream = tmp_path / "upstream"
    source_info = {"path": str(source), "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "sizeBytes": source.stat().st_size}
    with ReportWriter(upstream, source=source_info, model={"id": "TEST_DOUBLE"}, tracker={},
                      settings={"startMs": 0, "endMs": None, "sampleIntervalMs": 100}) as writer:
        with VideoReader(source, interval_ms=100) as reader:
            for frame in reader:
                writer.append(frame, PEOPLE, 0, .001)
        writer.finish("COMPLETE", video=reader.as_record(), timings={})
    return source, upstream, tmp_path / "observed"


def read_summary(output):
    return json.loads((output / "summary.json").read_text())


def test_real_decode_to_derivative_report_keeps_raw_detections_and_separate_referee_candidate(inputs):
    source, upstream, output = inputs
    source_before = source.read_bytes()
    upstream_before = (upstream / "frames.jsonl").read_bytes()
    summary = api().observe(source, upstream, output, RoleModel(), PoseModel(), max_previews=3)
    assert summary == read_summary(output)
    assert summary["status"] == "COMPLETE"
    assert summary["admission"] == "NOT_ADMITTED"
    assert summary["reportType"] == "REFEREE_OBSERVATIONS"
    assert summary["counts"]["recordedFrameCount"] == 4
    assert summary["counts"]["poseCount"] == 8
    assert summary["counts"]["candidateCount"] == 1
    assert summary["timings"]["roleInferredFrameCount"] == 4
    assert summary["timings"]["poseInferredPersonCount"] == 8
    assert summary["replay"]["replayedFrameCount"] == 4
    rows = [json.loads(line) for line in (output / "observations.jsonl").read_text().splitlines()]
    assert [row["timestampMs"] for row in rows] == [0, 100, 200, 300]
    assert all(item["actorRole"] == "UNPROVEN" for row in rows for item in row["sourceDetections"])
    assert rows[0]["roleInputTransform"]["sourceWidth"] == 200
    assert source.read_bytes() == source_before
    assert (upstream / "frames.jsonl").read_bytes() == upstream_before
    candidates = [json.loads(line) for line in (output / "arm-candidates.jsonl").read_text().splitlines()]
    assert candidates[0]["trackId"] == PEOPLE[0].track_id
    assert candidates[0]["startMs"] == 0
    assert candidates[0]["confirmedMs"] == 200
    assert candidates[0]["endMs"] == 300
    assert candidates[0]["supportFrameCount"] == 4


def test_empty_roles_are_not_no_foul_and_do_not_run_pose_model(inputs):
    source, upstream, output = inputs
    pose = PoseModel()
    result = api().observe(source, upstream, output, RoleModel(empty=True), pose)
    assert result["status"] == "COMPLETE"
    assert result["counts"]["candidateCount"] == 0
    assert result["counts"]["unmatchedRoleCount"] == 8
    assert "foul" in result["notAssessed"]
    assert pose.calls == 0
    assert result["timings"]["poseInferredPersonCount"] == 0


def test_existing_output_is_rejected_before_inference(inputs):
    source, upstream, output = inputs
    output.mkdir()
    marker = output / "owned.txt"
    marker.write_text("preserve")
    role = RoleModel()
    with pytest.raises(FileExistsError):
        api().observe(source, upstream, output, role, PoseModel())
    assert role.calls == 0
    assert marker.read_text() == "preserve"


def test_dangling_output_symlink_is_not_followed(inputs):
    source, upstream, output = inputs
    target = output.parent / "missing-target"
    output.symlink_to(target)
    with pytest.raises(FileExistsError):
        api().observe(source, upstream, output, RoleModel(), PoseModel())
    assert output.is_symlink()
    assert not target.exists()


@pytest.mark.parametrize("failed_stage", ["role", "pose"])
def test_model_failure_records_partial_work_not_complete(inputs, failed_stage):
    source, upstream, output = inputs
    role = RoleModel(fail_on=2 if failed_stage == "role" else None)
    pose = PoseModel(fail_on=2 if failed_stage == "pose" else None)
    result = api().observe(source, upstream, output, role, pose)
    assert result["status"] == "FAILED"
    assert result["failureReason"] == f"TEST_{failed_stage.upper()}_FAILED"
    assert result["counts"]["recordedFrameCount"] == 1
    assert result["timings"]["roleInferredFrameCount"] == (1 if failed_stage == "role" else 2)
    assert result["timings"]["poseInferredPersonCount"] == 2
    assert result["replay"]["replayedFrameCount"] == 2


def test_failed_pose_batch_keeps_attempted_people_separate_from_valid_outputs(inputs):
    source, upstream, output = inputs
    result = api().observe(source, upstream, output, RoleModel(), PoseModel(fail_on=2))
    assert result["status"] == "FAILED"
    assert result["timings"]["poseAttemptedPersonCount"] == 4
    assert result["timings"]["poseInferredPersonCount"] == 2


def test_missing_pose_output_fails_instead_of_silently_omitting_person(inputs):
    source, upstream, output = inputs
    result = api().observe(source, upstream, output, RoleModel(), PoseModel(missing=True))
    assert result["status"] == "FAILED"
    assert result["failureReason"] == "POSE_OUTPUT_MISMATCH"
    assert result["counts"]["recordedFrameCount"] == 0


def test_input_change_during_model_execution_prevents_complete_summary(inputs):
    source, upstream, output = inputs

    def touch_source(call):
        if call == 4:
            source.touch()

    result = api().observe(source, upstream, output, RoleModel(effect=touch_source), PoseModel())
    assert result["status"] == "FAILED"
    assert result["failureReason"] == "INPUT_CHANGED_DURING_REPLAY"
    assert result["counts"]["recordedFrameCount"] == 4


def test_runtime_budget_is_checked_before_model_execution(inputs, monkeypatch):
    source, upstream, output = inputs
    monkeypatch.setattr(api(), "MAX_RUNTIME_SECONDS", 0)
    role = RoleModel()
    result = api().observe(source, upstream, output, role, PoseModel())
    assert result["status"] == "FAILED"
    assert result["failureReason"] == "OBSERVATION_RUNTIME_LIMIT"
    assert role.calls == 0


def test_sample_budget_keeps_valid_written_prefix(inputs, monkeypatch):
    source, upstream, output = inputs
    monkeypatch.setattr(api(), "MAX_PROCESSED_FRAMES", 1)
    result = api().observe(source, upstream, output, RoleModel(), PoseModel())
    assert result["status"] == "FAILED"
    assert result["failureReason"] == "OBSERVATION_SAMPLE_LIMIT"
    assert result["counts"]["recordedFrameCount"] == 1


def test_progress_failure_keeps_already_recorded_frame_count(inputs):
    source, upstream, output = inputs

    def fail_progress(_event):
        raise ValueError("TEST_PROGRESS_FAILED")

    result = api().observe(source, upstream, output, RoleModel(), PoseModel(), progress=fail_progress)
    assert result["status"] == "FAILED"
    assert result["failureReason"] == "TEST_PROGRESS_FAILED"
    assert result["counts"]["recordedFrameCount"] == 1


def test_renamed_original_is_accepted_using_content_and_pts(inputs):
    source, upstream, output = inputs
    renamed = source.with_name("renamed.mkv")
    source.rename(renamed)
    result = api().observe(renamed, upstream, output, RoleModel(), PoseModel())
    assert result["status"] == "COMPLETE"
    assert result["source"]["path"] == str(renamed.resolve())
