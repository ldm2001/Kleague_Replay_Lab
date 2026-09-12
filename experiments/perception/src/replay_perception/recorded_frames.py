from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from fractions import Fraction
from math import isfinite
from numbers import Real
from pathlib import Path
from typing import Any, BinaryIO, Iterator

from .media import MAX_FRAME_PIXELS, VideoReader, VideoSample
from .models import Detection, LABELS


MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_RECORDS = 30_000
_SHA256 = re.compile(r"[0-9a-f]{64}")
_FRAME_KEYS = {
    "sourceSha256",
    "decodedIndex",
    "streamIndex",
    "pts",
    "timeBase",
    "originPts",
    "originTimeBase",
    "timestampMs",
    "width",
    "height",
    "timestampSource",
    "continuityId",
    "replayState",
    "detections",
    "inferenceSeconds",
}
_DETECTION_KEYS = {
    "detectionId",
    "label",
    "box",
    "score",
    "trackId",
    "actorRole",
    "source",
}


@dataclass(frozen=True, slots=True)
class RecordedFrame:
    sample: VideoSample
    detections: tuple[Detection, ...]
    continuity_id: int
    record_index: int

    def __post_init__(self) -> None:
        if not isinstance(self.sample, VideoSample):
            raise TypeError("RECORDED_SAMPLE_INVALID")
        if not isinstance(self.detections, tuple) or not all(
            isinstance(detection, Detection) for detection in self.detections
        ):
            raise TypeError("RECORDED_DETECTIONS_INVALID")
        if type(self.continuity_id) is not int or self.continuity_id < 0:
            raise ValueError("CONTINUITY_ID_INVALID")
        if type(self.record_index) is not int or self.record_index < 0:
            raise ValueError("RECORD_INDEX_INVALID")


@dataclass(frozen=True, slots=True)
class _Fingerprint:
    device: int
    inode: int
    size: int
    modified_ns: int
    sha256: str


@dataclass(frozen=True, slots=True)
class _ValidatedRow:
    value: dict[str, Any]
    detections: tuple[Detection, ...]
    time: Fraction


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate key")
        value[key] = item
    return value


def _reject_constant(_value: str) -> None:
    raise ValueError("non-finite number")


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not isfinite(parsed):
        raise ValueError("non-finite number")
    return parsed


def _strict_json(data: bytes) -> Any:
    try:
        text = data.decode("utf-8")
        return json.loads(
            text,
            object_pairs_hook=_strict_object,
            parse_constant=_reject_constant,
            parse_float=_finite_float,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise ValueError("JSON_INVALID") from error


def _json_clone(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _fingerprint(path: Path, missing_reason: str) -> _Fingerprint:
    try:
        before = path.stat()
        if not path.is_file():
            raise ValueError(missing_reason)
        sha256 = _sha256_file(path)
        after = path.stat()
    except (FileNotFoundError, NotADirectoryError, OSError) as error:
        raise ValueError(missing_reason) from error
    before_identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    after_identity = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if before_identity != after_identity:
        raise ValueError("INPUT_CHANGED_DURING_REPLAY")
    return _Fingerprint(*after_identity, sha256)


def _nonnegative_int(value: object) -> bool:
    return type(value) is int and value >= 0


def _positive_int(value: object) -> bool:
    return type(value) is int and value > 0


def _label_counts(value: object) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == set(LABELS)
        and all(_nonnegative_int(value[label]) for label in LABELS)
    )


def _finite_nonnegative(value: object) -> bool:
    return isinstance(value, Real) and not isinstance(value, bool) and isfinite(value) and value >= 0


def _fraction(value: object) -> Fraction:
    if not isinstance(value, dict) or set(value) != {"numerator", "denominator"}:
        raise ValueError("UPSTREAM_ROW_INVALID")
    numerator = value["numerator"]
    denominator = value["denominator"]
    if type(numerator) is not int or not _positive_int(denominator):
        raise ValueError("UPSTREAM_ROW_INVALID")
    result = Fraction(numerator, denominator)
    if result <= 0 or result.numerator != numerator or result.denominator != denominator:
        raise ValueError("UPSTREAM_ROW_INVALID")
    return result


def _detection(value: object, width: int, height: int) -> Detection:
    if not isinstance(value, dict) or set(value) != _DETECTION_KEYS:
        raise ValueError("UPSTREAM_ROW_INVALID")
    if value["source"] != "MODEL_DETECTION" or value["actorRole"] != "UNPROVEN":
        raise ValueError("UPSTREAM_ROW_INVALID")
    if not isinstance(value["box"], list):
        raise ValueError("UPSTREAM_ROW_INVALID")
    try:
        result = Detection(
            value["detectionId"],
            value["label"],
            tuple(value["box"]),
            value["score"],
            value["trackId"],
        )
    except (TypeError, ValueError) as error:
        raise ValueError("UPSTREAM_ROW_INVALID") from error
    _, _, x2, y2 = result.box
    if x2 > width or y2 > height:
        raise ValueError("UPSTREAM_ROW_INVALID")
    return result


def _validated_row(value: object, source_sha256: str) -> _ValidatedRow:
    if not isinstance(value, dict) or set(value) != _FRAME_KEYS:
        raise ValueError("UPSTREAM_ROW_INVALID")
    if value["sourceSha256"] != source_sha256:
        raise ValueError("UPSTREAM_ROW_INVALID")
    if not _nonnegative_int(value["decodedIndex"]) or not _nonnegative_int(value["streamIndex"]):
        raise ValueError("UPSTREAM_ROW_INVALID")
    if type(value["pts"]) is not int or type(value["originPts"]) is not int:
        raise ValueError("UPSTREAM_ROW_INVALID")
    time_base = _fraction(value["timeBase"])
    _fraction(value["originTimeBase"])
    if not _nonnegative_int(value["timestampMs"]):
        raise ValueError("UPSTREAM_ROW_INVALID")
    width, height = value["width"], value["height"]
    if not _positive_int(width) or not _positive_int(height) or width * height > MAX_FRAME_PIXELS:
        raise ValueError("UPSTREAM_ROW_INVALID")
    if value["timestampSource"] != "DECODER_PTS" or value["replayState"] != "UNKNOWN":
        raise ValueError("UPSTREAM_ROW_INVALID")
    if not _nonnegative_int(value["continuityId"]):
        raise ValueError("UPSTREAM_ROW_INVALID")
    if not _finite_nonnegative(value["inferenceSeconds"]):
        raise ValueError("UPSTREAM_ROW_INVALID")
    raw_detections = value["detections"]
    if not isinstance(raw_detections, list):
        raise ValueError("UPSTREAM_ROW_INVALID")
    detections = tuple(_detection(item, width, height) for item in raw_detections)
    detection_ids = [item.detection_id for item in detections]
    if len(detection_ids) != len(set(detection_ids)):
        raise ValueError("UPSTREAM_ROW_INVALID")
    return _ValidatedRow(value, detections, value["pts"] * time_base)


def _read_limited_line(source: BinaryIO) -> bytes:
    line = source.readline(MAX_JSON_BYTES + 2)
    payload_size = len(line) - 1 if line.endswith(b"\n") else len(line)
    if payload_size > MAX_JSON_BYTES:
        raise ValueError("UPSTREAM_ROW_TOO_LARGE")
    return line


class RecordedFrames:
    def __init__(self, source: Path | str, run_dir: Path | str) -> None:
        self.source = Path(source).expanduser().resolve()
        self.run_dir = Path(run_dir).expanduser().resolve()
        self._summary_path = self.run_dir / "summary.json"
        self._frames_path = self.run_dir / "frames.jsonl"
        self._entered = False
        self._closed = False
        self._iterated = False
        self._iterator: Iterator[RecordedFrame] | None = None
        self._summary: dict[str, Any] | None = None
        self._settings: dict[str, int | None] | None = None
        self._provenance: dict[str, Any] | None = None
        self._source_fingerprint: _Fingerprint | None = None
        self._summary_fingerprint: _Fingerprint | None = None
        self._frames_fingerprint: _Fingerprint | None = None
        self._selected_record_count = 0
        self._replayed_frame_count = 0
        self._video_record: dict[str, Any] = {}
        self._source_record: dict[str, Any] = {}

    @property
    def provenance(self) -> dict[str, Any]:
        if self._provenance is None:
            raise RuntimeError("RECORDED_FRAMES_NOT_ENTERED")
        return _json_clone(self._provenance)

    def _load_summary(self) -> dict[str, Any]:
        assert self._summary_fingerprint is not None
        if self._summary_fingerprint.size > MAX_JSON_BYTES:
            raise ValueError("UPSTREAM_SUMMARY_TOO_LARGE")
        try:
            data = self._summary_path.read_bytes()
        except OSError as error:
            raise ValueError("UPSTREAM_SUMMARY_NOT_FOUND") from error
        value = _strict_json(data)
        if not isinstance(value, dict):
            raise ValueError("UPSTREAM_SUMMARY_INVALID")
        return value

    def _validate_summary(self, summary: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int | None], int]:
        if summary.get("schemaVersion") != 1 or type(summary.get("schemaVersion")) is not int:
            raise ValueError("UPSTREAM_SCHEMA_INVALID")
        if summary.get("status") != "COMPLETE":
            raise ValueError("UPSTREAM_STATUS_INVALID")
        if summary.get("admission") != "NOT_ADMITTED":
            raise ValueError("UPSTREAM_ADMISSION_INVALID")
        if summary.get("scope") != "OBJECT_DETECTION_AND_TRACKING_ONLY":
            raise ValueError("UPSTREAM_SCOPE_INVALID")

        source = summary.get("source")
        if not isinstance(source, dict):
            raise ValueError("UPSTREAM_SOURCE_INVALID")
        source_sha256 = source.get("sha256")
        if not isinstance(source.get("path"), str) or not source["path"]:
            raise ValueError("UPSTREAM_SOURCE_INVALID")
        if not isinstance(source_sha256, str) or _SHA256.fullmatch(source_sha256) is None:
            raise ValueError("UPSTREAM_SOURCE_INVALID")
        if not _nonnegative_int(source.get("sizeBytes")):
            raise ValueError("UPSTREAM_SOURCE_INVALID")

        settings = summary.get("settings")
        if not isinstance(settings, dict):
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        start_ms = settings.get("startMs")
        end_ms = settings.get("endMs")
        interval_ms = settings.get("sampleIntervalMs")
        if not _nonnegative_int(start_ms) or not _positive_int(interval_ms):
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        if end_ms is not None and (type(end_ms) is not int or end_ms <= start_ms):
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        replay_settings: dict[str, int | None] = {
            "startMs": start_ms,
            "endMs": end_ms,
            "sampleIntervalMs": interval_ms,
        }

        counts = summary.get("counts")
        video = summary.get("video")
        if not isinstance(counts, dict) or not isinstance(video, dict):
            raise ValueError("UPSTREAM_COUNT_MISMATCH")
        scalar_count_keys = (
            "recordedFrameCount",
            "detectionCount",
            "trackedObservationCount",
            "uniqueTrackIdCount",
        )
        label_count_keys = (
            "detectionsByLabel",
            "framesWithDetectionByLabel",
            "uniqueTrackIdCountByLabel",
        )
        if any(not _nonnegative_int(counts.get(key)) for key in scalar_count_keys) or any(
            not _label_counts(counts.get(key)) for key in label_count_keys
        ):
            raise ValueError("UPSTREAM_COUNT_MISMATCH")
        recorded_count = counts.get("recordedFrameCount")
        sample_count = video.get("sampleCount")
        if (
            not _nonnegative_int(sample_count)
            or recorded_count > MAX_RECORDS
            or sample_count != recorded_count
        ):
            raise ValueError("UPSTREAM_COUNT_MISMATCH")
        if (
            video.get("requestedStartMs") != start_ms
            or video.get("requestedEndMs") != end_ms
            or video.get("sampleIntervalMs") != interval_ms
        ):
            raise ValueError("UPSTREAM_SETTINGS_INVALID")
        return source, replay_settings, recorded_count

    def _scan_rows(self, summary: dict[str, Any], source_sha256: str, expected_count: int) -> None:
        counts_by_label = {label: 0 for label in LABELS}
        frames_by_label = {label: 0 for label in LABELS}
        tracked_count = 0
        track_ids = {label: set() for label in LABELS}
        previous_time: Fraction | None = None
        actual_count = 0
        try:
            with self._frames_path.open("rb") as source:
                while True:
                    line = _read_limited_line(source)
                    if not line:
                        break
                    actual_count += 1
                    if actual_count > MAX_RECORDS:
                        raise ValueError("UPSTREAM_RECORD_LIMIT_EXCEEDED")
                    row = _validated_row(_strict_json(line), source_sha256)
                    if previous_time is not None and row.time <= previous_time:
                        raise ValueError("UPSTREAM_ROW_OUT_OF_ORDER")
                    previous_time = row.time
                    present = set()
                    for detection in row.detections:
                        counts_by_label[detection.label] += 1
                        present.add(detection.label)
                        if detection.track_id is not None:
                            tracked_count += 1
                            track_ids[detection.label].add(detection.track_id)
                    for label in present:
                        frames_by_label[label] += 1
        except OSError as error:
            raise ValueError("UPSTREAM_FRAMES_NOT_FOUND") from error
        if actual_count != expected_count:
            raise ValueError("UPSTREAM_COUNT_MISMATCH")

        counts = summary["counts"]
        all_track_ids = set().union(*track_ids.values())
        expected_values = {
            "detectionCount": sum(counts_by_label.values()),
            "detectionsByLabel": counts_by_label,
            "framesWithDetectionByLabel": frames_by_label,
            "trackedObservationCount": tracked_count,
            "uniqueTrackIdCount": len(all_track_ids),
            "uniqueTrackIdCountByLabel": {label: len(track_ids[label]) for label in LABELS},
        }
        if any(counts.get(key) != expected for key, expected in expected_values.items()):
            raise ValueError("UPSTREAM_COUNT_MISMATCH")

    def __enter__(self) -> RecordedFrames:
        if self._entered or self._closed:
            raise RuntimeError("RECORDED_FRAMES_ALREADY_USED")
        self._source_fingerprint = _fingerprint(self.source, "SOURCE_NOT_FOUND")
        self._summary_fingerprint = _fingerprint(self._summary_path, "UPSTREAM_SUMMARY_NOT_FOUND")
        self._frames_fingerprint = _fingerprint(self._frames_path, "UPSTREAM_FRAMES_NOT_FOUND")
        summary = self._load_summary()
        source, settings, selected_count = self._validate_summary(summary)
        if source["sha256"] != self._source_fingerprint.sha256:
            raise ValueError("SOURCE_HASH_MISMATCH")
        if source["sizeBytes"] != self._source_fingerprint.size:
            raise ValueError("SOURCE_SIZE_MISMATCH")
        self._scan_rows(summary, source["sha256"], selected_count)
        self._assert_inputs_unchanged()

        self._summary = summary
        self._settings = settings
        self._selected_record_count = selected_count
        self._source_record = {
            "path": str(self.source),
            "sha256": self._source_fingerprint.sha256,
            "sizeBytes": self._source_fingerprint.size,
        }
        self._provenance = {
            "source": _json_clone(source),
            "upstream": {
                "schemaVersion": 1,
                "summarySha256": self._summary_fingerprint.sha256,
                "framesJsonlSha256": self._frames_fingerprint.sha256,
            },
            "settings": dict(settings),
        }
        self._entered = True
        return self

    def _assert_inputs_unchanged(self) -> None:
        if self._source_fingerprint is None or self._summary_fingerprint is None or self._frames_fingerprint is None:
            raise RuntimeError("RECORDED_FRAMES_NOT_ENTERED")
        current = (
            _fingerprint(self.source, "SOURCE_NOT_FOUND"),
            _fingerprint(self._summary_path, "UPSTREAM_SUMMARY_NOT_FOUND"),
            _fingerprint(self._frames_path, "UPSTREAM_FRAMES_NOT_FOUND"),
        )
        expected = (self._source_fingerprint, self._summary_fingerprint, self._frames_fingerprint)
        if current != expected:
            raise ValueError("INPUT_CHANGED_DURING_REPLAY")

    def __iter__(self) -> Iterator[RecordedFrame]:
        if not self._entered or self._closed:
            raise RuntimeError("RECORDED_FRAMES_NOT_ACTIVE")
        if self._iterated:
            raise RuntimeError("RECORDED_FRAMES_ALREADY_ITERATED")
        self._iterated = True
        self._iterator = self._replay()
        return self._iterator

    def _read_replay_row(self, source: BinaryIO, index: int) -> _ValidatedRow:
        assert self._summary is not None
        line = _read_limited_line(source)
        if not line:
            raise ValueError("REPLAY_SOURCE_EARLY_EOF")
        row = _validated_row(_strict_json(line), self._summary["source"]["sha256"])
        return row

    @staticmethod
    def _matches(sample: VideoSample, row: dict[str, Any]) -> bool:
        time_base = _fraction(row["timeBase"])
        origin_time_base = _fraction(row["originTimeBase"])
        return (
            sample.decoded_index == row["decodedIndex"]
            and sample.stream_index == row["streamIndex"]
            and sample.pts == row["pts"]
            and sample.time_base == time_base
            and sample.origin_pts == row["originPts"]
            and sample.origin_time_base == origin_time_base
            and sample.timestamp_ms == row["timestampMs"]
            and sample.rgb.shape[1] == row["width"]
            and sample.rgb.shape[0] == row["height"]
        )

    def _replay(self) -> Iterator[RecordedFrame]:
        assert self._settings is not None
        self._assert_inputs_unchanged()
        reader: VideoReader | None = None
        try:
            with self._frames_path.open("rb") as records:
                with VideoReader(
                    self.source,
                    start_ms=self._settings["startMs"],
                    end_ms=self._settings["endMs"],
                    interval_ms=self._settings["sampleIntervalMs"],
                ) as reader:
                    samples = iter(reader)
                    for index in range(self._selected_record_count):
                        row = self._read_replay_row(records, index)
                        try:
                            sample = next(samples)
                        except StopIteration as error:
                            raise ValueError("REPLAY_SOURCE_EARLY_EOF") from error
                        if not self._matches(sample, row.value):
                            raise ValueError("REPLAY_FRAME_MISMATCH")
                        self._replayed_frame_count += 1
                        yield RecordedFrame(sample, row.detections, row.value["continuityId"], index)
                    if _read_limited_line(records):
                        raise ValueError("REPLAY_SOURCE_EARLY_EOF")
                    try:
                        next(samples)
                    except StopIteration:
                        pass
                    else:
                        raise ValueError("REPLAY_RECORD_MISSING")
        finally:
            if reader is not None:
                self._video_record = reader.as_record()
        self._assert_inputs_unchanged()

    def as_record(self) -> dict[str, Any]:
        if not self._entered:
            raise RuntimeError("RECORDED_FRAMES_NOT_ENTERED")
        return {
            "selectedRecordCount": self._selected_record_count,
            "replayedFrameCount": self._replayed_frame_count,
            "source": dict(self._source_record),
            "video": _json_clone(self._video_record),
        }

    def __exit__(self, exception_type, _exception, _traceback) -> bool:
        close_error: Exception | None = None
        integrity_error: Exception | None = None
        if self._iterator is not None:
            try:
                close = getattr(self._iterator, "close", None)
                if close is not None:
                    close()
            except Exception as error:
                close_error = error
        try:
            self._assert_inputs_unchanged()
        except Exception as error:
            integrity_error = error
        self._closed = True
        if exception_type is None:
            if close_error is not None:
                raise close_error
            if integrity_error is not None:
                raise integrity_error
        return False
