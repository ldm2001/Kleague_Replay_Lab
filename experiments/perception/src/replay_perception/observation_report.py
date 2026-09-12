from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

from .observations import ROLE_LABELS, PoseObservation, RoleDetection, RoleHypothesis
from .observation_preview import render_observation_preview
from .recorded_frames import RecordedFrame


MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_RECORDED_FRAMES = 30_000
_SHA256 = re.compile(r"[0-9a-fA-F]{64}")
_ARM_STATES = ("ARM_RAISED", "NOT_RAISED", "UNOBSERVABLE")
_MATCHED_ROLE_LABELS = ROLE_LABELS[1:]
_NOT_ASSESSED = [
    "mainVsAssistantReferee",
    "flagObject",
    "cards",
    "declaredDecision",
    "contact",
    "foul",
    "restarts",
    "liveReplay",
]
_FORBIDDEN_EPISODE_KEYS = {
    "mainvsassistantreferee",
    "flagobject",
    "card",
    "cards",
    "declareddecision",
    "observeddecision",
    "decision",
    "contact",
    "foul",
    "restart",
    "restarts",
    "livereplay",
}


def _json_text(value: object) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("REPORT_JSON_INVALID") from error


def _json_clone(value: dict[str, Any], reason: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise TypeError(reason)
    try:
        cloned = json.loads(_json_text(value))
    except ValueError as error:
        raise ValueError(reason) from error
    if not isinstance(cloned, dict):
        raise TypeError(reason)
    return cloned


def _path_exists(path: Path) -> bool:
    return os.path.lexists(path)


def _inside_git_worktree(path: Path) -> bool:
    parent = path.parent.resolve(strict=False)
    return any(_path_exists(ancestor / ".git") for ancestor in (parent, *parent.parents))


def _has_forbidden_episode_key(value: object) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            normalized = "".join(character for character in str(key).lower() if character.isalnum())
            if normalized in _FORBIDDEN_EPISODE_KEYS or _has_forbidden_episode_key(item):
                return True
    elif isinstance(value, list):
        return any(_has_forbidden_episode_key(item) for item in value)
    return False


@dataclass(frozen=True, slots=True)
class _PreviewCandidate:
    recorded_index: int
    jpeg: bytes
    record: dict[str, Any]


class ObservationReport:
    def __init__(
        self,
        output: Path | str,
        *,
        source: dict[str, Any],
        upstream: dict[str, Any],
        models: dict[str, Any],
        settings: dict[str, Any],
        max_previews: int = 24,
    ) -> None:
        if type(max_previews) is not int or not 2 <= max_previews <= 24:
            raise ValueError("MAX_PREVIEWS_INVALID")
        self.output = Path(output).expanduser().absolute()
        self.source = _json_clone(source, "REPORT_SOURCE_INVALID")
        self.upstream = _json_clone(upstream, "REPORT_UPSTREAM_INVALID")
        # Provenance is frozen as serialized data at construction. Runtime model
        # objects and later mutations cannot change what the report attributes.
        self.models = _json_clone(models, "REPORT_MODELS_INVALID")
        self.settings = _json_clone(settings, "REPORT_SETTINGS_INVALID")
        source_sha256 = self.source.get("sha256")
        if not isinstance(source_sha256, str) or _SHA256.fullmatch(source_sha256) is None:
            raise ValueError("SOURCE_SHA256_INVALID")
        self.max_previews = max_previews

        self._entered = False
        self._finish_called = False
        self._summary_written = False
        self._observations: TextIO | None = None
        self._episodes: TextIO | None = None
        self._recorded_frame_count = 0
        self._source_person_count = 0
        self._raw_role_detection_count = 0
        self._raw_roles_by_label = {label: 0 for label in ROLE_LABELS}
        self._matched_role_count = 0
        self._matched_roles_by_label = {label: 0 for label in _MATCHED_ROLE_LABELS}
        self._unmatched_role_count = 0
        self._ambiguous_role_count = 0
        self._pose_count = 0
        self._arm_states_by_state = {state: 0 for state in _ARM_STATES}
        self._candidate_count = 0
        self._preview_stride = 1
        self._preview_grid: list[_PreviewCandidate] = []
        self._last_preview: _PreviewCandidate | None = None
        self._written_previews: dict[int, dict[str, Any]] = {}
        self._finalization_replay: dict[str, Any] = {}
        self._finalization_timings: dict[str, Any] = {}
        self._finalization_failure_recovered = False

    def __enter__(self) -> ObservationReport:
        if self._entered:
            raise RuntimeError("REPORT_ALREADY_ENTERED")
        if _path_exists(self.output):
            raise FileExistsError(self.output)
        if _inside_git_worktree(self.output):
            raise ValueError("OUTPUT_INSIDE_GIT_WORKTREE")
        self.output.mkdir(parents=True, exist_ok=False)
        observations: TextIO | None = None
        episodes: TextIO | None = None
        try:
            (self.output / "frames").mkdir(exist_ok=False)
            observations = (self.output / "observations.jsonl").open(
                "x", encoding="utf-8", newline="\n"
            )
            episodes = (self.output / "arm-candidates.jsonl").open(
                "x", encoding="utf-8", newline="\n"
            )
        except Exception:
            if observations is not None:
                observations.close()
            if episodes is not None:
                episodes.close()
            raise
        self._observations = observations
        self._episodes = episodes
        self._entered = True
        return self

    def _require_active(self) -> tuple[TextIO, TextIO]:
        if (
            not self._entered
            or self._observations is None
            or self._episodes is None
            or self._observations.closed
            or self._episodes.closed
        ):
            raise RuntimeError("REPORT_NOT_ACTIVE")
        if self._finish_called:
            raise RuntimeError("REPORT_ALREADY_FINISHED")
        return self._observations, self._episodes

    @staticmethod
    def _write_line(stream: TextIO, value: dict[str, Any]) -> None:
        line = _json_text(value) + "\n"
        if len(line.encode("utf-8")) > MAX_JSON_BYTES:
            raise ValueError("REPORT_ROW_TOO_LARGE")
        position = stream.tell()
        try:
            stream.write(line)
            stream.flush()
        except Exception:
            try:
                stream.seek(position)
                stream.truncate()
                stream.flush()
            except Exception:
                # Disk failure can make rollback impossible. Never count the row.
                pass
            raise

    @staticmethod
    def _validate_frame_inputs(
        frame: RecordedFrame,
        roles_raw: tuple[RoleDetection, ...],
        roles_matched: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
        arms: tuple[dict[str, Any], ...],
    ) -> None:
        if not isinstance(frame, RecordedFrame):
            raise TypeError("REPORT_FRAME_INVALID")
        if not isinstance(roles_raw, tuple) or any(not isinstance(item, RoleDetection) for item in roles_raw):
            raise TypeError("REPORT_ROLE_DETECTIONS_INVALID")
        if not isinstance(roles_matched, tuple) or any(
            not isinstance(item, RoleHypothesis) for item in roles_matched
        ):
            raise TypeError("REPORT_ROLE_HYPOTHESES_INVALID")
        if not isinstance(poses, tuple) or any(not isinstance(item, PoseObservation) for item in poses):
            raise TypeError("REPORT_POSES_INVALID")
        if not isinstance(arms, tuple) or any(not isinstance(item, dict) for item in arms):
            raise TypeError("REPORT_ARMS_INVALID")
        if len({item.role_detection_id for item in roles_raw}) != len(roles_raw):
            raise ValueError("ROLE_DETECTION_ID_DUPLICATE")
        if len({item.detection_id for item in roles_matched}) != len(roles_matched):
            raise ValueError("ROLE_HYPOTHESIS_ID_DUPLICATE")
        if len({item.detection_id for item in poses}) != len(poses):
            raise ValueError("POSE_DETECTION_ID_DUPLICATE")
        source_people = {
            detection.detection_id
            for detection in frame.detections
            if detection.label == "person"
        }
        if any(item.detection_id not in source_people for item in roles_matched):
            raise ValueError("ROLE_HYPOTHESIS_SOURCE_NOT_PERSON")
        if any(item.detection_id not in source_people for item in poses):
            raise ValueError("POSE_SOURCE_NOT_PERSON")
        arm_keys: set[tuple[int, object]] = set()
        for arm in arms:
            detection_id = arm.get("detectionId")
            state = arm.get("state")
            key = (detection_id, arm.get("side"))
            if (
                type(detection_id) is not int
                or detection_id not in source_people
                or state not in _ARM_STATES
                or key in arm_keys
            ):
                raise ValueError("ARM_OBSERVATION_INVALID")
            arm_keys.add(key)

    def append(
        self,
        frame: RecordedFrame,
        roles_raw: tuple[RoleDetection, ...],
        roles_matched: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
        arms: tuple[dict[str, Any], ...],
        episodes: tuple[dict[str, Any], ...],
        timings: dict[str, Any],
        *,
        role_input_transform: dict[str, Any] | None = None,
    ) -> None:
        observations, _ = self._require_active()
        if self._recorded_frame_count >= MAX_RECORDED_FRAMES:
            raise ValueError("REPORT_FRAME_LIMIT_EXCEEDED")
        self._validate_frame_inputs(frame, roles_raw, roles_matched, poses, arms)
        if role_input_transform is not None and not isinstance(role_input_transform, dict):
            raise TypeError("ROLE_INPUT_TRANSFORM_INVALID")
        normalized_transform = (
            None
            if role_input_transform is None
            else _json_clone(role_input_transform, "ROLE_INPUT_TRANSFORM_INVALID")
        )
        normalized_arms = tuple(_json_clone(arm, "ARM_OBSERVATION_INVALID") for arm in arms)
        normalized_timings = _json_clone(timings, "STAGE_TIMINGS_INVALID")
        if not isinstance(episodes, tuple) or any(not isinstance(item, dict) for item in episodes):
            raise TypeError("REPORT_EPISODES_INVALID")

        row = {
            "sourceSha256": self.source["sha256"],
            **frame.sample.as_record(),
            "upstreamRecordIndex": frame.record_index,
            "continuityId": frame.continuity_id,
            "replayState": "UNKNOWN",
            "sourceDetections": [detection.as_record() for detection in frame.detections],
            "roleDetections": [item.as_record() for item in roles_raw],
            "roleHypotheses": [item.as_record() for item in roles_matched],
            "poses": [item.as_record() for item in poses],
            "arms": list(normalized_arms),
            "roleInputTransform": normalized_transform,
            "stageTimings": normalized_timings,
        }
        self._write_line(observations, row)

        self._recorded_frame_count += 1
        self._source_person_count += sum(
            detection.label == "person" for detection in frame.detections
        )
        self._raw_role_detection_count += len(roles_raw)
        for item in roles_raw:
            self._raw_roles_by_label[item.role] += 1
        for item in roles_matched:
            if item.status == "MATCHED":
                self._matched_role_count += 1
                self._matched_roles_by_label[item.role] += 1
            elif item.status == "UNMATCHED":
                self._unmatched_role_count += 1
            else:
                self._ambiguous_role_count += 1
        self._pose_count += len(poses)
        for arm in normalized_arms:
            self._arm_states_by_state[arm["state"]] += 1
        recorded_index = self._recorded_frame_count - 1
        self._retain_preview(recorded_index, frame, roles_raw, roles_matched, poses, normalized_arms)
        self.append_episodes(episodes)

    def _retain_preview(
        self,
        recorded_index: int,
        frame: RecordedFrame,
        roles_raw: tuple[RoleDetection, ...],
        roles_matched: tuple[RoleHypothesis, ...],
        poses: tuple[PoseObservation, ...],
        arms: tuple[dict[str, Any], ...],
    ) -> None:
        jpeg, record = render_observation_preview(
            frame, roles_raw, roles_matched, poses, arms
        )
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

    @staticmethod
    def _normalize_episode(episode: dict[str, Any]) -> dict[str, Any]:
        normalized = _json_clone(episode, "EPISODE_INVALID")
        if normalized.get("kind") != "ARM_RAISED":
            raise ValueError("EPISODE_KIND_INVALID")
        if normalized.get("actorRoleHypothesis") != "referee":
            raise ValueError("EPISODE_ACTOR_ROLE_INVALID")
        if normalized.get("admission") != "NOT_ADMITTED":
            raise ValueError("EPISODE_ADMISSION_INVALID")
        if _has_forbidden_episode_key(normalized):
            raise ValueError("EPISODE_DECISION_FIELDS_FORBIDDEN")
        return normalized

    def append_episodes(self, episodes: tuple[dict[str, Any], ...]) -> None:
        _, destination = self._require_active()
        if not isinstance(episodes, tuple) or any(not isinstance(item, dict) for item in episodes):
            raise TypeError("REPORT_EPISODES_INVALID")
        for episode in episodes:
            normalized = self._normalize_episode(episode)
            self._write_line(destination, normalized)
            self._candidate_count += 1

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
            relative_path = Path("frames") / (
                f"preview-{ordinal:04d}-frame-{candidate.recorded_index:08d}.jpg"
            )
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
        records.sort(key=lambda value: (value["timestampMs"], value["upstreamRecordIndex"]))
        return records

    def _counts(self) -> dict[str, Any]:
        return {
            "recordedFrameCount": self._recorded_frame_count,
            "sourcePersonCount": self._source_person_count,
            "rawRoleDetectionCount": self._raw_role_detection_count,
            "rawRolesByLabel": dict(self._raw_roles_by_label),
            "matchedRoleCount": self._matched_role_count,
            "matchedRolesByLabel": dict(self._matched_roles_by_label),
            "unmatchedRoleCount": self._unmatched_role_count,
            "ambiguousRoleCount": self._ambiguous_role_count,
            "poseCount": self._pose_count,
            "armStatesByState": dict(self._arm_states_by_state),
            "candidateCount": self._candidate_count,
        }

    def _summary(
        self,
        status: str,
        *,
        replay: dict[str, Any],
        timings: dict[str, Any],
        previews: list[dict[str, Any]],
        failure_reason: str | None,
        finalization_failure_reason: str | None = None,
    ) -> dict[str, Any]:
        summary: dict[str, Any] = {
            "schemaVersion": 1,
            "reportType": "REFEREE_OBSERVATIONS",
            "status": status,
            "admission": "NOT_ADMITTED",
            "source": self.source,
            "upstream": self.upstream,
            "models": self.models,
            "settings": self.settings,
            "replay": replay,
            "timings": timings,
            "counts": self._counts(),
            "previews": previews,
            "scope": "ROLE_POSE_AND_ARM_OBSERVATION_ONLY",
            "notAssessed": list(_NOT_ASSESSED),
        }
        if failure_reason is not None:
            summary["failureReason"] = failure_reason
        if finalization_failure_reason is not None:
            summary["finalizationFailureReason"] = finalization_failure_reason
        return summary

    def _close_streams(self) -> Exception | None:
        close_error: Exception | None = None
        for stream in (self._observations, self._episodes):
            if stream is not None and not stream.closed:
                try:
                    stream.close()
                except Exception as error:
                    if close_error is None:
                        close_error = error
        return close_error

    def _write_summary(self, summary: dict[str, Any]) -> None:
        serialized = _json_text(summary) + "\n"
        if len(serialized.encode("utf-8")) > MAX_JSON_BYTES:
            raise ValueError("REPORT_SUMMARY_TOO_LARGE")
        with (self.output / "summary.json").open(
            "x", encoding="utf-8", newline="\n"
        ) as destination:
            destination.write(serialized)
            destination.flush()
        self._summary_written = True

    def finish(
        self,
        status: str,
        *,
        replay: dict[str, Any],
        timings: dict[str, Any],
        failure_reason: str | None = None,
    ) -> dict[str, Any]:
        self._require_active()
        self._finish_called = True
        if status not in {"COMPLETE", "FAILED"}:
            raise ValueError("REPORT_STATUS_INVALID")
        if status == "FAILED" and (
            not isinstance(failure_reason, str) or not failure_reason.strip()
        ):
            raise ValueError("FAILED_REQUIRES_FAILURE_REASON")
        if status == "COMPLETE" and failure_reason is not None:
            raise ValueError("COMPLETE_FORBIDS_FAILURE_REASON")

        try:
            normalized_replay = _json_clone(replay, "REPORT_REPLAY_INVALID")
            self._finalization_replay = normalized_replay
            normalized_timings = _json_clone(timings, "REPORT_TIMINGS_INVALID")
            self._finalization_timings = normalized_timings
        except (TypeError, ValueError) as error:
            if status != "FAILED":
                raise
            self._close_streams()
            return self._recover_finalization_failure(error, failure_reason)
        close_error = self._close_streams()
        if close_error is not None:
            return self._recover_finalization_failure(close_error, failure_reason)
        try:
            previews = self._materialize_previews(strict=True)
        except Exception as error:
            return self._recover_finalization_failure(error, failure_reason)
        summary = self._summary(
            status,
            replay=normalized_replay,
            timings=normalized_timings,
            previews=previews,
            failure_reason=failure_reason,
        )
        self._write_summary(summary)
        return summary

    def _recover_finalization_failure(
        self,
        error: Exception,
        primary_failure_reason: str | None,
    ) -> dict[str, Any]:
        finalization_reason = type(error).__name__
        failure_reason = primary_failure_reason or finalization_reason
        secondary_reason = finalization_reason if primary_failure_reason is not None else None
        previews = self._materialize_previews(strict=False)
        summary = self._summary(
            "FAILED",
            replay=self._finalization_replay,
            timings=self._finalization_timings,
            previews=previews,
            failure_reason=failure_reason,
            finalization_failure_reason=secondary_reason,
        )
        try:
            self._write_summary(summary)
        except Exception:
            # Preserve the first finalization error when durable recovery is impossible.
            raise error
        self._finalization_failure_recovered = True
        return summary

    def _persist_failure(
        self,
        reason: str,
        *,
        finalization_failure_reason: str | None = None,
    ) -> None:
        try:
            previews = self._materialize_previews(strict=False)
            summary = self._summary(
                "FAILED",
                replay=self._finalization_replay,
                timings=self._finalization_timings,
                previews=previews,
                failure_reason=reason,
                finalization_failure_reason=finalization_failure_reason,
            )
            self._write_summary(summary)
        except Exception:
            # Failure persistence is best effort and cannot replace the original error.
            pass

    def __exit__(self, exception_type, exception, _traceback) -> bool:
        close_error = self._close_streams()
        if not self._summary_written:
            if exception_type is not None:
                reason = exception_type.__name__
            elif close_error is not None:
                reason = type(close_error).__name__
            else:
                reason = "REPORT_FINISH_NOT_CALLED"
            self._persist_failure(
                reason,
                finalization_failure_reason=(
                    type(close_error).__name__
                    if exception_type is not None and close_error is not None
                    else None
                ),
            )
        if (
            exception_type is None
            and close_error is not None
            and not self._finalization_failure_recovered
        ):
            raise close_error
        return False
