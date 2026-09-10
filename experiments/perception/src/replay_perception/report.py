from __future__ import annotations

import json
import os
from dataclasses import dataclass
from math import isfinite
from numbers import Real
from pathlib import Path
from typing import Any, TextIO

from .media import VideoSample
from .models import Detection, LABELS
from .preview import render_preview


_NOT_ASSESSED = ["actorRoles", "refereeSignals", "contact", "foul", "restarts", "liveReplay"]


def _json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _json_clone(value: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError("REPORT_METADATA_INVALID")
    return json.loads(_json_text(value))


def _path_exists(path: Path) -> bool:
    return os.path.lexists(path)


def _inside_git_worktree(path: Path) -> bool:
    parent = path.parent.resolve(strict=False)
    return any(_path_exists(ancestor / ".git") for ancestor in (parent, *parent.parents))


@dataclass(frozen=True, slots=True)
class _PreviewCandidate:
    recorded_index: int
    jpeg: bytes
    record: dict[str, Any]


class ReportWriter:
    def __init__(
        self,
        output: Path,
        *,
        source: dict[str, Any],
        model: dict[str, Any],
        tracker: dict[str, Any],
        settings: dict[str, Any],
        max_previews: int = 24,
    ) -> None:
        if type(max_previews) is not int or not 2 <= max_previews <= 24:
            raise ValueError("MAX_PREVIEWS_INVALID")
        self.output = Path(output).expanduser().absolute()
        self.source = _json_clone(source)
        self.model = _json_clone(model)
        self.tracker = _json_clone(tracker)
        self.settings = _json_clone(settings)
        if not isinstance(self.source.get("sha256"), str) or not self.source["sha256"]:
            raise ValueError("SOURCE_SHA256_MISSING")
        self.max_previews = max_previews

        self._entered = False
        self._finish_called = False
        self._summary_written = False
        self._trace: TextIO | None = None
        self._recorded_frame_count = 0
        self._detection_counts = {label: 0 for label in LABELS}
        self._frames_with_detection = {label: 0 for label in LABELS}
        self._tracked_observation_count = 0
        self._track_ids = {label: set() for label in LABELS}
        self._preview_stride = 1
        self._preview_grid: list[_PreviewCandidate] = []
        self._last_preview: _PreviewCandidate | None = None
        self._written_previews: dict[int, dict[str, Any]] = {}
        self._finalization_video: dict[str, Any] = {}
        self._finalization_timings: dict[str, Any] = {}

    def __enter__(self) -> ReportWriter:
        if self._entered:
            raise RuntimeError("REPORT_WRITER_ALREADY_ENTERED")
        if _path_exists(self.output):
            raise FileExistsError(self.output)
        if _inside_git_worktree(self.output):
            raise ValueError("OUTPUT_INSIDE_GIT_WORKTREE")
        self.output.mkdir(parents=True, exist_ok=False)
        (self.output / "frames").mkdir(exist_ok=False)
        self._trace = (self.output / "frames.jsonl").open("x", encoding="utf-8", newline="\n")
        self._entered = True
        return self

    def _require_active(self) -> TextIO:
        if not self._entered or self._trace is None or self._trace.closed:
            raise RuntimeError("REPORT_WRITER_NOT_ACTIVE")
        if self._finish_called:
            raise RuntimeError("REPORT_ALREADY_FINISHED")
        return self._trace

    def append(
        self,
        frame: VideoSample,
        detections: tuple[Detection, ...],
        continuity_id: int,
        inference_seconds: float,
    ) -> None:
        trace = self._require_active()
        if not isinstance(frame, VideoSample):
            raise TypeError("REPORT_FRAME_INVALID")
        if not isinstance(detections, tuple) or not all(isinstance(value, Detection) for value in detections):
            raise TypeError("REPORT_DETECTIONS_INVALID")
        if type(continuity_id) is not int or continuity_id < 0:
            raise ValueError("CONTINUITY_ID_INVALID")
        if (
            not isinstance(inference_seconds, Real)
            or isinstance(inference_seconds, bool)
            or not isfinite(inference_seconds)
            or inference_seconds < 0
        ):
            raise ValueError("INFERENCE_SECONDS_INVALID")

        row = {
            "sourceSha256": self.source["sha256"],
            **frame.as_record(),
            "continuityId": continuity_id,
            "replayState": "UNKNOWN",
            "detections": [detection.as_record() for detection in detections],
            "inferenceSeconds": float(inference_seconds),
        }
        line = _json_text(row) + "\n"
        position = trace.tell()
        try:
            trace.write(line)
            trace.flush()
        except Exception:
            try:
                trace.seek(position)
                trace.truncate()
                trace.flush()
            except Exception:
                pass
            raise

        recorded_index = self._recorded_frame_count
        self._recorded_frame_count += 1
        present_labels = set()
        for detection in detections:
            self._detection_counts[detection.label] += 1
            present_labels.add(detection.label)
            if detection.track_id is not None:
                self._tracked_observation_count += 1
                self._track_ids[detection.label].add(detection.track_id)
        for label in present_labels:
            self._frames_with_detection[label] += 1
        self._retain_preview(recorded_index, frame, detections)

    def _retain_preview(self, recorded_index: int, frame: VideoSample, detections: tuple[Detection, ...]) -> None:
        jpeg, record = render_preview(frame, detections)
        candidate = _PreviewCandidate(recorded_index, jpeg, record)
        if recorded_index % self._preview_stride == 0:
            self._preview_grid.append(candidate)
        grid_limit = self.max_previews - 1
        while len(self._preview_grid) > grid_limit:
            self._preview_stride *= 2
            self._preview_grid = [
                retained
                for retained in self._preview_grid
                if retained.recorded_index % self._preview_stride == 0
            ]
        self._last_preview = candidate

    def _selected_previews(self) -> list[_PreviewCandidate]:
        selected = list(self._preview_grid)
        if self._last_preview is not None and all(
            item.recorded_index != self._last_preview.recorded_index for item in selected
        ):
            selected.append(self._last_preview)
        selected.sort(key=lambda item: item.recorded_index)
        return selected[: self.max_previews]

    def _materialize_previews(self, *, strict: bool) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        for ordinal, candidate in enumerate(self._selected_previews()):
            existing = self._written_previews.get(candidate.recorded_index)
            if existing is not None:
                records.append(existing)
                continue
            relative_path = Path("frames") / f"preview-{ordinal:04d}-frame-{candidate.recorded_index:08d}.jpg"
            try:
                with (self.output / relative_path).open("xb") as destination:
                    destination.write(candidate.jpeg)
                    destination.flush()
            except Exception:
                if strict:
                    raise
                continue
            record = {"path": relative_path.as_posix(), **candidate.record}
            self._written_previews[candidate.recorded_index] = record
            records.append(record)
        records.sort(key=lambda value: value["timestampMs"])
        return records

    def _counts(self) -> dict[str, Any]:
        unique_by_label = {label: len(self._track_ids[label]) for label in LABELS}
        all_track_ids = set().union(*self._track_ids.values())
        return {
            "recordedFrameCount": self._recorded_frame_count,
            "detectionCount": sum(self._detection_counts.values()),
            "detectionsByLabel": dict(self._detection_counts),
            "framesWithDetectionByLabel": dict(self._frames_with_detection),
            "trackedObservationCount": self._tracked_observation_count,
            "uniqueTrackIdCount": len(all_track_ids),
            "uniqueTrackIdCountByLabel": unique_by_label,
        }

    def _summary(
        self,
        status: str,
        *,
        video: dict[str, Any],
        timings: dict[str, Any],
        previews: list[dict[str, Any]],
        failure_reason: str | None,
    ) -> dict[str, Any]:
        value: dict[str, Any] = {
            "schemaVersion": 1,
            "status": status,
            "admission": "NOT_ADMITTED",
            "source": self.source,
            "model": self.model,
            "tracker": self.tracker,
            "settings": self.settings,
            "video": video,
            "timings": timings,
            "counts": self._counts(),
            "previews": previews,
            "scope": "OBJECT_DETECTION_AND_TRACKING_ONLY",
            "notAssessed": list(_NOT_ASSESSED),
        }
        if failure_reason is not None:
            value["failureReason"] = failure_reason
        return value

    def _write_summary(self, summary: dict[str, Any]) -> None:
        serialized = _json_text(summary) + "\n"
        with (self.output / "summary.json").open("x", encoding="utf-8", newline="\n") as destination:
            destination.write(serialized)
            destination.flush()
        self._summary_written = True

    def finish(
        self,
        status: str,
        *,
        video: dict[str, Any],
        timings: dict[str, Any],
        failure_reason: str | None = None,
    ) -> dict[str, Any]:
        self._require_active()
        self._finish_called = True
        if status not in {"COMPLETE", "FAILED"}:
            raise ValueError("REPORT_STATUS_INVALID")
        if status == "FAILED" and (not isinstance(failure_reason, str) or not failure_reason.strip()):
            raise ValueError("FAILED_REQUIRES_FAILURE_REASON")
        if status == "COMPLETE" and failure_reason is not None:
            raise ValueError("COMPLETE_FORBIDS_FAILURE_REASON")
        normalized_video = _json_clone(video)
        normalized_timings = _json_clone(timings)
        self._finalization_video = normalized_video
        self._finalization_timings = normalized_timings
        previews = self._materialize_previews(strict=True)
        summary = self._summary(
            status,
            video=normalized_video,
            timings=normalized_timings,
            previews=previews,
            failure_reason=failure_reason,
        )
        self._write_summary(summary)
        return summary

    def _persist_failure(self, reason: str) -> None:
        try:
            previews = self._materialize_previews(strict=False)
            summary = self._summary(
                "FAILED",
                video=self._finalization_video,
                timings=self._finalization_timings,
                previews=previews,
                failure_reason=reason,
            )
            self._write_summary(summary)
        except Exception:
            # Failure persistence is best effort and must not replace the original error.
            pass

    def __exit__(self, exception_type, exception, _traceback) -> bool:
        close_error: Exception | None = None
        if self._trace is not None and not self._trace.closed:
            try:
                self._trace.close()
            except Exception as error:
                close_error = error
        if not self._summary_written:
            if exception_type is not None:
                reason = exception_type.__name__
            elif close_error is not None:
                reason = type(close_error).__name__
            else:
                reason = "REPORT_FINISH_NOT_CALLED"
            self._persist_failure(reason)
        if exception_type is None and close_error is not None:
            raise close_error
        return False
