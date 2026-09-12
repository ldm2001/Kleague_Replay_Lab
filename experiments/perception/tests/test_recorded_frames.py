from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from replay_perception.media import VideoReader
from replay_perception.models import Detection
from replay_perception.recorded_frames import RecordedFrame, RecordedFrames
from replay_perception.report import ReportWriter


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _make_video(path: Path, *, color: str = "red") -> None:
    result = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-n",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s=64x48:r=10:d=1",
            "-fps_mode",
            "passthrough",
            "-c:v",
            "ffv1",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr


def _source_record(path: Path) -> dict:
    return {
        "path": str(path.resolve()),
        "sha256": _sha256(path),
        "sizeBytes": path.stat().st_size,
        "identity": {"fixture": "recorded-frames"},
    }


def _create_report(source: Path, run_dir: Path) -> tuple[tuple[Detection, ...], ...]:
    source_record = _source_record(source)
    original: list[tuple[Detection, ...]] = []
    with ReportWriter(
        run_dir,
        source=source_record,
        model={"id": "fixed-test-detector", "sha256": "b" * 64},
        tracker={"name": "fixed-test-tracker"},
        settings={"startMs": 0, "endMs": 1000, "sampleIntervalMs": 200, "fixture": True},
        max_previews=2,
    ) as writer:
        with VideoReader(source, start_ms=0, end_ms=1000, interval_ms=200) as reader:
            for index, sample in enumerate(reader):
                detections = (
                    Detection(index, "person", (1, 2, 20, 40), 0.9, f"0:person:{index}"),
                    Detection(index + 100, "sports ball", (30, 10, 38, 18), 0.7),
                )
                original.append(detections)
                writer.append(sample, detections, continuity_id=index // 3, inference_seconds=0.01)
        writer.finish("COMPLETE", video=reader.as_record(), timings={"totalSeconds": 0.1})
    return tuple(original)


@pytest.fixture
def recorded_run(tmp_path):
    pytest.importorskip("av")
    source = tmp_path / "source.mkv"
    run_dir = tmp_path / "upstream"
    _make_video(source)
    detections = _create_report(source, run_dir)
    return source, run_dir, detections


def _read_summary(run_dir: Path) -> dict:
    return json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))


def _write_summary(run_dir: Path, summary: dict) -> None:
    (run_dir / "summary.json").write_text(
        json.dumps(summary, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _read_rows(run_dir: Path) -> list[dict]:
    return [json.loads(line) for line in (run_dir / "frames.jsonl").read_text(encoding="utf-8").splitlines()]


def _write_rows(run_dir: Path, rows: list[dict]) -> None:
    (run_dir / "frames.jsonl").write_text(
        "".join(json.dumps(row, separators=(",", ":"), allow_nan=False) + "\n" for row in rows),
        encoding="utf-8",
    )


def _adjust_summary_for_rows(run_dir: Path, rows: list[dict]) -> None:
    summary = _read_summary(run_dir)
    summary["counts"]["recordedFrameCount"] = len(rows)
    summary["video"]["sampleCount"] = len(rows)
    all_detections = [detection for row in rows for detection in row["detections"]]
    summary["counts"]["detectionCount"] = len(all_detections)
    for label in ("person", "sports ball"):
        summary["counts"]["detectionsByLabel"][label] = sum(
            detection["label"] == label for detection in all_detections
        )
        summary["counts"]["framesWithDetectionByLabel"][label] = sum(
            any(detection["label"] == label for detection in row["detections"]) for row in rows
        )
    tracked = [detection for detection in all_detections if detection["trackId"] is not None]
    summary["counts"]["trackedObservationCount"] = len(tracked)
    track_ids = {detection["trackId"] for detection in tracked}
    summary["counts"]["uniqueTrackIdCount"] = len(track_ids)
    for label in ("person", "sports ball"):
        summary["counts"]["uniqueTrackIdCountByLabel"][label] = len(
            {detection["trackId"] for detection in tracked if detection["label"] == label}
        )
    _write_summary(run_dir, summary)


def test_replays_original_rgb_metadata_and_detections_without_changing_inputs(recorded_run):
    source, run_dir, original_detections = recorded_run
    original_source = source.read_bytes()
    original_summary = (run_dir / "summary.json").read_bytes()
    original_rows = (run_dir / "frames.jsonl").read_bytes()
    expected_rows = _read_rows(run_dir)

    with RecordedFrames(source, run_dir) as recorded:
        frames = tuple(recorded)
        provenance = recorded.provenance
        replay = recorded.as_record()

    assert len(frames) == len(expected_rows) == 5
    assert [frame.record_index for frame in frames] == list(range(5))
    assert [frame.continuity_id for frame in frames] == [row["continuityId"] for row in expected_rows]
    assert [frame.sample.pts for frame in frames] == [row["pts"] for row in expected_rows]
    assert [frame.sample.timestamp_ms for frame in frames] == [row["timestampMs"] for row in expected_rows]
    assert [frame.detections for frame in frames] == list(original_detections)
    assert frames[0].sample.rgb.shape == (48, 64, 3)
    assert frames[0].sample.rgb[0, 0, 0] > frames[0].sample.rgb[0, 0, 2]
    assert provenance["source"] == _read_summary(run_dir)["source"]
    assert provenance["upstream"]["summarySha256"] == _sha256(run_dir / "summary.json")
    assert provenance["upstream"]["framesJsonlSha256"] == _sha256(run_dir / "frames.jsonl")
    assert provenance["settings"] == {"startMs": 0, "endMs": 1000, "sampleIntervalMs": 200}
    assert replay["selectedRecordCount"] == 5
    assert replay["replayedFrameCount"] == 5
    assert replay["source"]["sha256"] == _sha256(source)
    assert replay["video"]["sampleCount"] == 5
    assert source.read_bytes() == original_source
    assert (run_dir / "summary.json").read_bytes() == original_summary
    assert (run_dir / "frames.jsonl").read_bytes() == original_rows


def test_recorded_frame_is_frozen(recorded_run):
    source, run_dir, _ = recorded_run
    with RecordedFrames(source, run_dir) as recorded:
        frame = next(iter(recorded))
        with pytest.raises(FrozenInstanceError):
            frame.record_index = 9


def test_same_source_bytes_can_be_replayed_after_rename(recorded_run):
    source, run_dir, _ = recorded_run
    renamed = source.with_name("renamed-source.mkv")
    source.rename(renamed)

    with RecordedFrames(renamed, run_dir) as recorded:
        frames = tuple(recorded)

    assert len(frames) == 5
    assert recorded.as_record()["source"]["path"] == str(renamed.resolve())
    assert recorded.provenance["source"]["path"] == str(source.resolve())


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        (lambda value: value.update(schemaVersion=2), "UPSTREAM_SCHEMA_INVALID"),
        (lambda value: value.update(status="FAILED"), "UPSTREAM_STATUS_INVALID"),
        (lambda value: value.update(admission="ADMITTED"), "UPSTREAM_ADMISSION_INVALID"),
        (lambda value: value.update(scope="REFEREE_DECISION"), "UPSTREAM_SCOPE_INVALID"),
        (lambda value: value["settings"].update(startMs=-1), "UPSTREAM_SETTINGS_INVALID"),
        (lambda value: value["settings"].update(endMs=0), "UPSTREAM_SETTINGS_INVALID"),
        (lambda value: value["settings"].update(sampleIntervalMs=0), "UPSTREAM_SETTINGS_INVALID"),
        (lambda value: value["source"].update(sha256="not-a-sha"), "UPSTREAM_SOURCE_INVALID"),
        (lambda value: value["counts"].update(recordedFrameCount=4), "UPSTREAM_COUNT_MISMATCH"),
        (lambda value: value["video"].update(sampleCount=4), "UPSTREAM_COUNT_MISMATCH"),
    ],
)
def test_invalid_summary_contract_is_rejected(recorded_run, change, reason):
    source, run_dir, _ = recorded_run
    summary = _read_summary(run_dir)
    change(summary)
    _write_summary(run_dir, summary)

    with pytest.raises(ValueError, match=reason):
        with RecordedFrames(source, run_dir):
            pass


def test_mismatched_source_is_rejected_by_content_not_stored_filename(recorded_run):
    _, run_dir, _ = recorded_run
    different_source = run_dir.parent / "different.mkv"
    _make_video(different_source, color="blue")

    with pytest.raises(ValueError, match="SOURCE_HASH_MISMATCH"):
        with RecordedFrames(different_source, run_dir):
            pass


@pytest.mark.parametrize("target", ["summary", "row"])
@pytest.mark.parametrize("bad_token", ["duplicate", "nan"])
def test_duplicate_keys_and_nonfinite_json_are_rejected(recorded_run, target, bad_token):
    source, run_dir, _ = recorded_run
    path = run_dir / ("summary.json" if target == "summary" else "frames.jsonl")
    text = path.read_text(encoding="utf-8")
    if bad_token == "duplicate":
        needle = '"schemaVersion":1' if target == "summary" else '"sourceSha256"'
        replacement = '"schemaVersion":1,"schemaVersion":1' if target == "summary" else '"sourceSha256":"x","sourceSha256"'
        text = text.replace(needle, replacement, 1)
    else:
        if target == "summary":
            text = text.replace('"totalSeconds":0.1', '"totalSeconds":NaN', 1)
        else:
            text = text.replace('"score":0.9', '"score":NaN', 1)
    path.write_text(text, encoding="utf-8")

    with pytest.raises(ValueError, match="JSON_INVALID"):
        with RecordedFrames(source, run_dir):
            pass


def test_overflow_exponent_in_unused_summary_metadata_is_rejected_before_full_replay(recorded_run):
    source, run_dir, _ = recorded_run
    path = run_dir / "summary.json"
    text = path.read_text(encoding="utf-8").replace('"totalSeconds":0.1', '"totalSeconds":1e309', 1)
    path.write_text(text, encoding="utf-8")

    with pytest.raises(ValueError, match="JSON_INVALID"):
        with RecordedFrames(source, run_dir) as recorded:
            assert len(tuple(recorded)) == 5


def test_overflow_exponent_in_frame_row_is_rejected_by_strict_json(recorded_run):
    source, run_dir, _ = recorded_run
    path = run_dir / "frames.jsonl"
    text = path.read_text(encoding="utf-8").replace('"inferenceSeconds":0.01', '"inferenceSeconds":1e309', 1)
    path.write_text(text, encoding="utf-8")

    with pytest.raises(ValueError, match="JSON_INVALID"):
        with RecordedFrames(source, run_dir):
            pass


@pytest.mark.parametrize(
    "mutate",
    [
        lambda counts: counts.update(detectionCount=10.0),
        lambda counts: counts["detectionsByLabel"].update(person=5.0),
        lambda counts: counts["framesWithDetectionByLabel"].update(person=5.0),
        lambda counts: counts.update(trackedObservationCount=5.0),
        lambda counts: counts.update(uniqueTrackIdCount=5.0),
        lambda counts: counts["uniqueTrackIdCountByLabel"].update(person=5.0),
        lambda counts: counts["uniqueTrackIdCountByLabel"].update(**{"sports ball": False}),
    ],
)
def test_every_summary_counter_requires_an_exact_nonnegative_integer(recorded_run, mutate):
    source, run_dir, _ = recorded_run
    summary = _read_summary(run_dir)
    mutate(summary["counts"])
    _write_summary(run_dir, summary)

    with pytest.raises(ValueError, match="UPSTREAM_COUNT_MISMATCH"):
        with RecordedFrames(source, run_dir):
            pass


@pytest.mark.parametrize("mutation", ["bounds", "duplicate_detection", "actor_role", "source"])
def test_invalid_detection_or_row_semantics_are_rejected(recorded_run, mutation):
    source, run_dir, _ = recorded_run
    rows = _read_rows(run_dir)
    if mutation == "bounds":
        rows[0]["detections"][0]["box"][2] = rows[0]["width"] + 0.1
    elif mutation == "duplicate_detection":
        rows[0]["detections"].append(dict(rows[0]["detections"][0]))
    elif mutation == "actor_role":
        rows[0]["detections"][0]["actorRole"] = "REFEREE"
    else:
        rows[0]["sourceSha256"] = "f" * 64
    _write_rows(run_dir, rows)

    with pytest.raises(ValueError, match="UPSTREAM_ROW_INVALID"):
        with RecordedFrames(source, run_dir):
            pass


def test_missing_saved_row_is_not_fabricated_as_empty(recorded_run):
    source, run_dir, _ = recorded_run
    rows = _read_rows(run_dir)
    rows.pop()
    _write_rows(run_dir, rows)
    _adjust_summary_for_rows(run_dir, rows)

    with RecordedFrames(source, run_dir) as recorded:
        with pytest.raises(ValueError, match="REPLAY_RECORD_MISSING"):
            tuple(recorded)


def test_extra_saved_row_fails_when_source_samples_end(recorded_run):
    source, run_dir, _ = recorded_run
    rows = _read_rows(run_dir)
    extra = json.loads(json.dumps(rows[-1]))
    extra["decodedIndex"] += 2
    extra["pts"] += 200
    extra["timestampMs"] += 200
    rows.append(extra)
    _write_rows(run_dir, rows)
    _adjust_summary_for_rows(run_dir, rows)

    with RecordedFrames(source, run_dir) as recorded:
        with pytest.raises(ValueError, match="REPLAY_SOURCE_EARLY_EOF"):
            tuple(recorded)


def test_different_pts_is_rejected_even_when_rounded_milliseconds_match(recorded_run):
    source, run_dir, _ = recorded_run
    rows = _read_rows(run_dir)
    rows[0]["pts"] += 1
    original_timestamp = rows[0]["timestampMs"]
    _write_rows(run_dir, rows)

    with RecordedFrames(source, run_dir) as recorded:
        with pytest.raises(ValueError, match="REPLAY_FRAME_MISMATCH"):
            tuple(recorded)
    assert rows[0]["timestampMs"] == original_timestamp


def test_partial_iteration_and_body_exception_close_decoder(recorded_run, monkeypatch):
    source, run_dir, _ = recorded_run
    import replay_perception.recorded_frames as module

    original_reader = module.VideoReader
    closes: list[str] = []

    class TrackingReader:
        def __init__(self, *args, **kwargs):
            self.wrapped = original_reader(*args, **kwargs)

        def __enter__(self):
            self.wrapped.__enter__()
            return self

        def __iter__(self):
            return iter(self.wrapped)

        def __exit__(self, *args):
            closes.append("closed")
            return self.wrapped.__exit__(*args)

        def as_record(self):
            return self.wrapped.as_record()

    monkeypatch.setattr(module, "VideoReader", TrackingReader)
    with pytest.raises(RuntimeError, match="stop downstream"):
        with RecordedFrames(source, run_dir) as recorded:
            next(iter(recorded))
            raise RuntimeError("stop downstream")
    assert closes == ["closed"]


def test_source_and_upstream_changes_during_partial_context_fail_explicitly(recorded_run):
    source, run_dir, _ = recorded_run
    with pytest.raises(ValueError, match="INPUT_CHANGED_DURING_REPLAY"):
        with RecordedFrames(source, run_dir) as recorded:
            next(iter(recorded))
            (run_dir / "frames.jsonl").write_bytes((run_dir / "frames.jsonl").read_bytes() + b"\n")


def test_source_stat_change_is_rejected_even_when_bytes_are_unchanged(recorded_run):
    source, run_dir, _ = recorded_run
    source_stat = source.stat()
    with pytest.raises(ValueError, match="INPUT_CHANGED_DURING_REPLAY"):
        with RecordedFrames(source, run_dir):
            os.utime(source, ns=(source_stat.st_atime_ns, source_stat.st_mtime_ns + 1_000_000))


def test_size_limits_are_checked_before_unbounded_json_reads(recorded_run):
    source, run_dir, _ = recorded_run
    with (run_dir / "summary.json").open("ab") as summary:
        summary.write(b" " * (8 * 1024 * 1024))
    with pytest.raises(ValueError, match="UPSTREAM_SUMMARY_TOO_LARGE"):
        with RecordedFrames(source, run_dir):
            pass


def test_jsonl_accepts_an_exact_eight_mib_final_line_without_newline(recorded_run):
    source, run_dir, _ = recorded_run
    rows = _read_rows(run_dir)
    prefix = "".join(json.dumps(row, separators=(",", ":")) + "\n" for row in rows[:-1]).encode()
    final = json.dumps(rows[-1], separators=(",", ":")).encode()
    assert len(final) < 8 * 1024 * 1024
    final += b" " * (8 * 1024 * 1024 - len(final))
    (run_dir / "frames.jsonl").write_bytes(prefix + final)

    with RecordedFrames(source, run_dir):
        pass


def test_nonfinite_detection_values_cannot_enter_a_recorded_frame(recorded_run):
    source, run_dir, _ = recorded_run
    rows = _read_rows(run_dir)
    rows[0]["detections"][0]["score"] = math.inf
    path = run_dir / "frames.jsonl"
    path.write_text(json.dumps(rows[0], allow_nan=True) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="JSON_INVALID"):
        with RecordedFrames(source, run_dir):
            pass
