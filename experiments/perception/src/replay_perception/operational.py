from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
from typing import Any, Callable

from .continuity import AppearanceContinuity
from .diagnostic_artifact import DiagnosticArtifact
from .incident_links import IncidentLinker, InteractionTracker
from .inspect import Detector, _failure_reason, _fingerprint, _runtime_versions
from .media import VideoReader
from .observe import PoseModel, RoleModel
from .observations import PoseObservation
from .official_objects import OfficialObserver
from .recorded_frames import RecordedFrame
from .role_matching import assign_roles
from .tracking import TrackAssociator


PIPELINE_VERSION = "video-local-observers-v1"
SCHEMA_VERSION = "perception-run-v1"
SAMPLE_INTERVAL_MS = 100
MAX_RUNTIME_SECONDS = 1800
MAX_PROCESSED_FRAMES = 30_000
MAX_PEOPLE_PER_FRAME = 64
MAX_RETAINED_EPISODES = 128
MAX_INDEXED_EPISODES = 30_000
MAX_RETAINED_AUDIO_CUES = 256


@dataclass(frozen=True, slots=True)
class ObserverModels:
    detector: Detector
    role: RoleModel
    pose: PoseModel


def _hash_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def _models(models: ObserverModels) -> list[dict[str, str]]:
    result = []
    for component, model, filename in (("detector", models.detector, "model.safetensors"),
                                      ("role", models.role, "yolo-football-player-detection.pt"),
                                      ("pose", models.pose, "model.safetensors")):
        data = model.provenance
        model_id, revision = data.get("model_id"), data.get("revision")
        weights = data.get("files", {}).get(filename)
        if (not isinstance(model_id, str) or not 1 <= len(model_id) <= 160
                or not isinstance(revision, str) or not 1 <= len(revision) <= 64
                or not isinstance(weights, str) or re.fullmatch(r"[0-9a-f]{64}", weights) is None):
            raise ValueError("MODEL_PROVENANCE_INVALID")
        result.append({"component": component, "modelId": model_id, "revision": revision,
                       "weightsSha256": weights})
    return result


def _implementation() -> dict[str, Any]:
    directory = Path(__file__).parent
    sources = sorted(path for path in directory.rglob("*") if path.is_file() and path.suffix in (".py", ".json"))
    return {"pipelineVersion": PIPELINE_VERSION, "runtimeVersions": _runtime_versions(),
            "sourceFilesSha256": {path.relative_to(directory).as_posix(): _hash_file(path) for path in sources}}


def _audio_input(value: dict[str, Any], source_sha256: str, duration_ms: int) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    if not isinstance(value, dict) or not isinstance(value.get("observations"), dict):
        raise ValueError("AUDIO_INPUT_INVALID")
    observations = value["observations"]
    source = observations.get("sourceSha256")
    if not isinstance(source, str) or re.fullmatch(r"[0-9a-f]{64}", source) is None:
        raise ValueError("AUDIO_INPUT_INVALID")
    if source != source_sha256:
        raise ValueError("AUDIO_SOURCE_MISMATCH")
    implementation = value.get("implementation")
    hashes = implementation.get("sourceFilesSha256") if isinstance(implementation, dict) else None
    if (not isinstance(hashes, dict) or not {"audio.py", "audio_observations.py"}.issubset(hashes) or any(
            not isinstance(name, str) or not name or len(name) > 256
            or Path(name).is_absolute() or ".." in Path(name).parts
            or not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            for name, digest in hashes.items())):
        raise ValueError("AUDIO_INPUT_INVALID")
    cues = observations.get("cues")
    reasons = observations.get("reasons")
    timeline = observations.get("timeline")
    if (observations.get("version") != "audio-observations-v1"
            or observations.get("status") not in ("COMPLETE", "ABSENT", "UNSUPPORTED", "FAILED")
            or observations.get("method") != "spectral-multitone-v1"
            or observations.get("speechStatus") != "NOT_ANALYZED"
            or type(observations.get("cueCount")) is not int
            or not isinstance(cues, list) or observations["cueCount"] != len(cues)
            or observations.get("associations") != [] or observations.get("truncated") is not False
            or not isinstance(reasons, list) or any(not isinstance(reason, str) for reason in reasons)
            or not isinstance(timeline, dict)):
        raise ValueError("AUDIO_INPUT_INVALID")
    timeline_keys = ("videoOriginSeconds", "audioOffsetMs", "scannedStartMs", "scannedEndMs",
                     "decodedFrameCount", "frameDurationMs", "gapPolicy")
    def nullable_nonnegative_int(item: Any) -> bool:
        return item is None or (type(item) is int and item >= 0)

    origin = timeline.get("videoOriginSeconds")
    sample_rate = observations.get("sourceSampleRateHz")
    channels = observations.get("sourceChannels")
    if (any(key not in timeline for key in timeline_keys)
            or timeline["frameDurationMs"] != 100
            or timeline["gapPolicy"] != "PRESERVED_WITH_SYNTHETIC_SILENCE"
            or type(timeline["decodedFrameCount"]) is not int or timeline["decodedFrameCount"] < 0
            or (origin is not None and (type(origin) not in (int, float) or not math.isfinite(origin)))
            or (timeline["audioOffsetMs"] is not None and type(timeline["audioOffsetMs"]) is not int)
            or not all(nullable_nonnegative_int(timeline[key]) for key in (
                "scannedStartMs", "scannedEndMs"))
            or (timeline["scannedStartMs"] is not None and timeline["scannedEndMs"] is not None
                and timeline["scannedStartMs"] > timeline["scannedEndMs"])
            or (timeline["scannedStartMs"] is None) != (timeline["scannedEndMs"] is None)
            or (timeline["scannedEndMs"] is not None and timeline["scannedEndMs"] > duration_ms)
            or (sample_rate is not None and (type(sample_rate) is not int or sample_rate <= 0))
            or (channels is not None and (type(channels) is not int or channels <= 0))):
        raise ValueError("AUDIO_INPUT_INVALID")
    cue_fields = ("id", "startMs", "endMs", "peakFrequenciesHz", "frameCount")
    if any(not isinstance(cue, dict) or any(field not in cue for field in cue_fields)
           or not isinstance(cue["id"], str) or not cue["id"]
           or type(cue["startMs"]) is not int or type(cue["endMs"]) is not int
           or cue["startMs"] < 0 or cue["endMs"] <= cue["startMs"] or cue["endMs"] > duration_ms
           or timeline["scannedStartMs"] is None or cue["startMs"] < timeline["scannedStartMs"]
           or cue["endMs"] > timeline["scannedEndMs"]
           or type(cue["frameCount"]) is not int or cue["frameCount"] <= 0
           or not isinstance(cue["peakFrequenciesHz"], list)
           or any(type(frequency) not in (int, float) or not math.isfinite(frequency) or frequency < 0
                  for frequency in cue["peakFrequenciesHz"]) for cue in cues):
        raise ValueError("AUDIO_INPUT_INVALID")
    metadata = {key: observations[key] for key in (
        "version", "sourceSha256", "status", "method", "speechStatus", "sourceSampleRateHz",
        "sourceChannels", "timeline", "cueCount", "associations", "truncated", "reasons") if key in observations}
    if "sourceSampleRateHz" not in metadata or "sourceChannels" not in metadata:
        raise ValueError("AUDIO_INPUT_INVALID")
    metadata["timeline"] = {key: timeline[key] for key in timeline_keys}
    raw_cues = [{key: cue[key] for key in cue_fields} for cue in cues]
    return metadata, {"sourceFilesSha256": dict(hashes)}, raw_cues


class _Retained:
    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.seen: set[str] = set()
        self.count = 0
        self.truncated = False

    def update(self, rows) -> None:
        current = {row["id"] for row in rows}
        added = current - self.seen
        if len(self.seen) + len(added) > MAX_INDEXED_EPISODES:
            raise ValueError("EPISODE_INDEX_LIMIT")
        self.count += len(added)
        self.seen.update(added)
        for row in rows:
            if row["id"] in self.rows or len(self.rows) < MAX_RETAINED_EPISODES:
                self.rows[row["id"]] = row
            else:
                self.truncated = True


def _official_episode(value: dict[str, Any], source_sha256: str) -> dict[str, Any]:
    identity = [source_sha256, value["continuityId"], value["trackId"], value["startMs"],
                value["signalKind"], value["signalSide"]]
    digest = hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()
    return {"id": f"official-{digest}", "startMs": value["startMs"], "endMs": value["timestampMs"],
            "continuityId": value["continuityId"], "actorTrackIds": [value["trackId"]],
            "officialRole": value["officialRole"], "signalKind": value["signalKind"],
            "signalSide": value["signalSide"], "supportFrameCount": value["supportFrameCount"],
            "lastFrame": value["lastFrame"], "contact": "UNVERIFIED", "originalDecision": "UNKNOWN",
            "restart": "UNVERIFIED", "admission": "NOT_ADMITTED",
            "reasons": ["OFFICIAL_METHOD_UNVALIDATED", "SIGNAL_MEANING_UNVALIDATED", "RESTART_NOT_VISIBLE"]}


def run_observers(source: Path | str, output: Path | str, models: ObserverModels, *, duration_ms: int,
                  start_ms: int = 0, end_ms: int | None = None,
                  progress: Callable[[dict[str, Any]], None] | None = None,
                  check_cancelled: Callable[[], None] | None = None,
                  audio_input: dict[str, Any] | None = None) -> dict[str, Any]:
    source_path = Path(source).expanduser().resolve()
    output_path = Path(output).expanduser().absolute()
    if os.path.lexists(output_path):
        raise FileExistsError("REPORT_PATH_EXISTS")
    if not source_path.is_file():
        raise ValueError("SOURCE_NOT_FOUND")
    requested_end = duration_ms if end_ms is None else end_ms
    if (type(duration_ms) is not int or duration_ms <= 0 or type(start_ms) is not int or start_ms < 0
            or type(requested_end) is not int or not start_ms < requested_end <= duration_ms):
        raise ValueError("SCAN_RANGE_INVALID")
    before = _fingerprint(source_path)
    source_sha256 = _hash_file(source_path)
    if _fingerprint(source_path) != before:
        raise ValueError("VIDEO_SOURCE_CHANGED")
    audio_metadata = audio_implementation = audio_cues = None
    if audio_input is not None:
        audio_metadata, audio_implementation, audio_cues = _audio_input(audio_input, source_sha256, duration_ms)
    schema_version = "perception-run-v2" if audio_metadata is not None else SCHEMA_VERSION
    pipeline_version = "video-local-observers-av-v1" if audio_metadata is not None else PIPELINE_VERSION
    compact_models = _models(models)
    tracker = TrackAssociator(frame_rate=1000 / SAMPLE_INTERVAL_MS)
    continuity, official_observer = AppearanceContinuity(), OfficialObserver()
    interaction_tracker, linker = InteractionTracker(), IncidentLinker()
    officials_retained, interactions_retained, links_retained = _Retained(), _Retained(), _Retained()
    expected = math.ceil((requested_end - start_ms) / SAMPLE_INTERVAL_MS)
    processed, role_count, pose_count = 0, 0, 0
    failure = None
    started = time.perf_counter()
    reader = VideoReader(source_path, start_ms=start_ms, end_ms=requested_end, interval_ms=SAMPLE_INTERVAL_MS)
    frame_record: dict[str, Any] | None = None
    stage = "OPEN_VIDEO"

    def deadline() -> None:
        if check_cancelled is not None:
            check_cancelled()
        if time.perf_counter() - started > MAX_RUNTIME_SECONDS:
            raise ValueError("OBSERVATION_RUNTIME_LIMIT")

    def checkpoint(name: str) -> None:
        nonlocal stage
        stage = name
        deadline()
        if processed >= MAX_PROCESSED_FRAMES:
            raise ValueError("OBSERVATION_SAMPLE_LIMIT")

    with DiagnosticArtifact(output_path / "perception.jsonl.gz") as artifact:
        implementation = _implementation()
        implementation["pipelineVersion"] = pipeline_version
        if audio_implementation is not None:
            implementation["audio"] = audio_implementation
        header = {"kind": "HEADER", "schemaVersion": schema_version, "sourceSha256": source_sha256,
                         "implementation": implementation, "models": {
                             "detector": models.detector.provenance, "role": models.role.provenance,
                             "pose": models.pose.provenance}, "tracker": tracker.provenance,
                         "sampling": {"startMs": start_ms, "endMs": requested_end,
                                      "intervalMs": SAMPLE_INTERVAL_MS}, "admission": "NOT_ADMITTED"}
        if audio_metadata is not None:
            header["audio"] = audio_metadata
        artifact.append(header)
        if audio_cues is not None:
            for cue in audio_cues:
                artifact.append({"kind": "AUDIO_CUE", "sourceSha256": source_sha256, **cue})
        try:
            with reader:
                stage = "DECODING"
                for sample in reader:
                    frame_record = {"kind": "FRAME", "frame": sample.as_record(),
                                    "sourceSha256": source_sha256, "replayState": "UNKNOWN"}
                    checkpoint("DETECTOR")
                    context = continuity.update(sample.rgb)
                    frame_record["continuityId"] = context
                    detections = models.detector.predict(sample.rgb)
                    checkpoint("TRACKING")
                    detections = tracker.update(detections, sample.timestamp_ms, context)
                    frame_record["detections"] = [item.as_record() for item in detections]
                    frame = RecordedFrame(sample, detections, context, processed)
                    checkpoint("ROLE")
                    raw_roles = models.role.predict(sample.rgb)
                    roles = assign_roles(detections, raw_roles)
                    frame_record["roleDetections"] = [item.as_record() for item in raw_roles]
                    frame_record["roles"] = [item.as_record() for item in roles]
                    frame_record["roleInputTransform"] = models.role.last_transform
                    selected = {item.detection_id for item in roles if item.status == "MATCHED"}
                    people = tuple(item for item in detections if item.detection_id in selected)
                    if len(people) > MAX_PEOPLE_PER_FRAME:
                        raise ValueError("OBSERVATION_PERSON_LIMIT")
                    checkpoint("POSE")
                    poses = models.pose.predict(sample.rgb, people) if people else ()
                    if (not isinstance(poses, tuple) or any(not isinstance(pose, PoseObservation) for pose in poses)
                            or tuple(pose.detection_id for pose in poses) != tuple(item.detection_id for item in people)
                            or any(pose.source_box != person.box for pose, person in zip(poses, people))):
                        raise ValueError("POSE_OUTPUT_MISMATCH")
                    frame_record["poses"] = [item.as_record() for item in poses]
                    checkpoint("OBSERVATION_LINKS")
                    officials = official_observer.update(frame, roles, poses)
                    interactions = interaction_tracker.update(frame, roles)
                    links = linker.update(frame, interactions, officials)
                    frame_record.update(officials=list(officials), interactions=list(interactions), links=list(links))
                    deadline()
                    artifact.append(frame_record)
                    processed += 1
                    role_count += len(selected)
                    pose_count += len(poses)
                    stage = "SUMMARY"
                    officials_retained.update([_official_episode(item, source_sha256) for item in officials if item["sustained"]])
                    interactions_retained.update(interactions)
                    links_retained.update(links)
                    if progress is not None:
                        stage = "PROGRESS"
                        progress({"processedSamples": processed, "expectedSamples": expected,
                                  "timestampMs": sample.timestamp_ms})
                    frame_record = None
                    stage = "DECODING"
            stage = "FINALIZING"
            deadline()
        except Exception as error:
            artifact.note_failure(error)
            failure = _failure_reason(error)
            failed_record = {**(frame_record or {}), "kind": "FRAME_FAILURE" if frame_record else "RUN_FAILURE",
                             "failedStage": stage, "failureReason": failure}
            try:
                artifact.append(failed_record)
            except (ValueError, OSError):
                # A size/disk failure cannot justify dropping the bound to append diagnostics.
                pass
    if _fingerprint(source_path) != before or _hash_file(source_path) != source_sha256:
        raise ValueError("VIDEO_SOURCE_CHANGED")
    truncated = any(item.truncated for item in (officials_retained, interactions_retained, links_retained))
    reasons = ["OFFICIAL_METHOD_UNVALIDATED", "CONTACT_METHOD_UNVALIDATED", "SIGNAL_MEANING_UNVALIDATED",
               "RESTART_METHOD_UNVALIDATED", "LIVE_REPLAY_UNVERIFIED"]
    if failure is not None:
        reasons.append(failure)
    if processed != expected:
        reasons.append("SAMPLING_COVERAGE_INCOMPLETE")
    if truncated:
        reasons.append("SUMMARY_TRUNCATED_RAW_PRESERVED")
    if audio_metadata is not None and audio_metadata["status"] in ("FAILED", "UNSUPPORTED"):
        reasons.append(f"AUDIO_{audio_metadata['status']}")
    result = {
        "schemaVersion": schema_version, "pipelineVersion": pipeline_version, "sourceSha256": source_sha256,
        "processingStatus": "COMPLETE" if failure is None and processed == expected
                            and (audio_metadata is None or audio_metadata["status"] not in ("FAILED", "UNSUPPORTED"))
                            else "PARTIAL",
        "coverage": {"startMs": start_ms, "endMs": requested_end, "sampleIntervalMs": SAMPLE_INTERVAL_MS,
                     "expectedSamples": expected, "processedSamples": processed, "failedSamples": max(0, expected - processed)},
        "models": compact_models, "artifact": artifact.metadata(),
        "summary": {"roleObservationCount": role_count, "poseObservationCount": pose_count,
                    "officialCueCount": officials_retained.count, "interactionCount": interactions_retained.count,
                    "linkCount": links_retained.count, "truncated": truncated, "reasons": reasons},
        "observations": list(officials_retained.rows.values()),
        "interactions": list(interactions_retained.rows.values()), "links": list(links_retained.rows.values()),
    }
    if audio_metadata is not None and audio_cues is not None:
        audio_truncated = len(audio_cues) > MAX_RETAINED_AUDIO_CUES
        result["audio"] = {**audio_metadata, "cues": audio_cues[:MAX_RETAINED_AUDIO_CUES],
                           "truncated": audio_truncated,
                           "reasons": [*audio_metadata["reasons"], *(
                               ["AUDIO_SUMMARY_TRUNCATED_RAW_PRESERVED"] if audio_truncated else [])]}
    with (output_path / "summary.json").open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, allow_nan=False, indent=2)
    return result
