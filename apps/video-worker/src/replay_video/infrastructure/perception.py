from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
import json
import os
from pathlib import Path
from typing import Any, Callable

from ..domain.models import Candidate, PerceptionOutput, Shot, VideoMetadata
from .tracking import tracking_summaries


MAX_NEW_CANDIDATES = 16
MAX_INCIDENTS = 128
MAX_WINDOW_MS = 30_000
EVIDENCE_REASON = "LOCAL_OBSERVER_EVIDENCE_REQUIRED"


def local_observations(source: Path, output: Path, *, duration_ms: int,
                       progress=None, check_cancelled=None) -> dict[str, Any]:
    # Model imports are isolated from validation, legacy diagnostics and ordinary Worker unit tests.
    try:
        from replay_perception.detector import RtdetrDetector
        from replay_perception.model_assets import default_model_dir
        from replay_perception.observer_assets import default_observer_model_dir
        from replay_perception.operational import ObserverModels, run_observers
        from replay_perception.pose import VitPoseEstimator
        from replay_perception.roles import YoloRoleDetector
    except ImportError as error:
        raise RuntimeError("WORKER_MODEL_RUNTIME_UNAVAILABLE") from error
    device = os.environ.get("WORKER_PERCEPTION_DEVICE", "cpu")
    if device not in ("cpu", "mps"):
        raise ValueError("WORKER_PERCEPTION_DEVICE_INVALID")
    def checkpoint():
        if check_cancelled is not None:
            check_cancelled()
    checkpoint()
    detector = RtdetrDetector(default_model_dir(), device=device)
    checkpoint()
    role = YoloRoleDetector(default_observer_model_dir("role"), device=device)
    checkpoint()
    pose = VitPoseEstimator(default_observer_model_dir("pose"), device=device)
    checkpoint()
    return run_observers(source, output, ObserverModels(detector, role, pose), duration_ms=duration_ms,
                         progress=progress, check_cancelled=check_cancelled)


def adapt_observations(raw: dict[str, Any], root: Path, metadata: VideoMetadata,
                       candidates: tuple[Candidate, ...], shots: tuple[Shot, ...]) -> PerceptionOutput:
    root = Path(root).resolve()
    artifact = dict(raw["artifact"])
    path = Path(artifact["path"]).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError("PERCEPTION_ARTIFACT_PATH_INVALID")
    artifact["path"] = path.relative_to(root).as_posix()
    summary = deepcopy(raw["summary"])
    result = list(candidates)
    incidents = []
    next_index = max((item.index for item in candidates), default=-1) + 1
    created = 0
    identifiers = set()

    def omitted(reason: str) -> None:
        summary["truncated"] = True
        if reason not in summary["reasons"]:
            summary["reasons"].append(reason)

    # Semantic links first, then sustained official signals, then image-proximity episodes.
    values = [*raw["links"], *raw["observations"], *(item for item in raw["interactions"]
               if item["supportFrameCount"] >= 3 and item["endMs"] - item["startMs"] >= 200)]
    for item in values:
        if item["id"] in identifiers:
            raise ValueError("PERCEPTION_INCIDENT_ID_DUPLICATE")
        identifiers.add(item["id"])
        if len(incidents) >= MAX_INCIDENTS:
            omitted("INCIDENT_SUMMARY_LIMIT")
            continue
        start, end = item["startMs"], item["endMs"]
        if (type(start) is not int or type(end) is not int or not 0 <= start < end <= metadata.duration_ms
                or type(item["continuityId"]) is not int or item["continuityId"] < 0):
            raise ValueError("PERCEPTION_INTERVAL_INVALID")
        window_start, window_end = max(0, start - 1500), min(metadata.duration_ms, end + 3000)
        if window_end - window_start > MAX_WINDOW_MS:
            omitted("OBSERVATION_WINDOW_TOO_LONG")
            continue
        overlapping = [index for index, candidate in enumerate(result)
                       if candidate.end_ms >= window_start and candidate.start_ms <= window_end
                       and max(candidate.end_ms, window_end) - min(candidate.start_ms, window_start) <= MAX_WINDOW_MS]
        if overlapping:
            position = overlapping[0]
            candidate = result[position]
            candidate = replace(candidate, start_ms=min(candidate.start_ms, window_start),
                                end_ms=max(candidate.end_ms, window_end),
                                reasons=tuple(dict.fromkeys((*candidate.reasons, EVIDENCE_REASON))))
            result[position] = candidate
        else:
            if created >= MAX_NEW_CANDIDATES:
                omitted("INCIDENT_SUMMARY_LIMIT")
                continue
            candidate = Candidate(next_index, "OTHER", window_start, window_end, start, 0., "LOW",
                                  (EVIDENCE_REASON, "UNVERIFIED_MODEL_OBSERVATION"), ())
            result.append(candidate)
            next_index += 1
            created += 1
        incidents.append({"id": item["id"], "candidateIndex": candidate.index,
                          "continuityId": item["continuityId"], "startMs": start, "endMs": end,
                          "evidenceIndices": [], "officialRole": item.get("officialRole", "UNKNOWN"),
                          "signal": item.get("signalKind", "UNKNOWN"), "contact": "UNVERIFIED",
                          "originalDecision": "UNKNOWN", "restart": "UNVERIFIED",
                          "reasons": list(item["reasons"])})
    result = [replace(item, shot_indices=tuple(shot.index for shot in shots
                                               if shot.end_ms >= item.start_ms and shot.start_ms <= item.end_ms))
              for item in result]
    perception = {key: deepcopy(raw[key]) for key in ("schemaVersion", "sourceSha256", "processingStatus", "coverage", "models")}
    perception.update(artifact=artifact, summary=summary, incidents=incidents)
    return PerceptionOutput(tuple(result), perception)


def refresh_tracking(root: Path, result: PerceptionOutput, check_cancelled=None) -> PerceptionOutput:
    # A model episode may extend an existing candidate. Recount the existing full
    # source scan for the NEW window instead of attaching the old window's counts.
    root = Path(root).resolve()
    summary_path, trace_path = root / "tracking/context-summary.json", root / "tracking/context.jsonl"
    if not summary_path.exists() and not trace_path.exists():
        perception = deepcopy(result.perception)
        if "TRACKING_TRACE_UNAVAILABLE" not in perception["summary"]["reasons"]:
            perception["summary"]["reasons"].append("TRACKING_TRACE_UNAVAILABLE")
        return PerceptionOutput(tuple(replace(item, tracking=None) for item in result.candidates), perception)
    if any(not path.resolve().is_relative_to(root) or not path.is_file() for path in (summary_path, trace_path)):
        raise ValueError("TRACKING_TRACE_PATH_INVALID")
    if summary_path.stat().st_size > 8 * 1024 * 1024 or trace_path.stat().st_size > 512 * 1024 * 1024:
        raise ValueError("TRACKING_TRACE_SIZE_LIMIT")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if summary.get("source_sha256") != result.perception["sourceSha256"]:
        raise ValueError("TRACKING_SOURCE_MISMATCH")
    with trace_path.open(encoding="utf-8") as stream:
        def samples():
            count = 0
            actual_bytes = 0
            while line := stream.readline(8 * 1024 * 1024 + 1):
                size = len(line.encode("utf-8"))
                actual_bytes += size
                if size > 8 * 1024 * 1024:
                    raise ValueError("TRACKING_TRACE_ROW_LIMIT")
                if actual_bytes > 512 * 1024 * 1024:
                    raise ValueError("TRACKING_TRACE_SIZE_LIMIT")
                if check_cancelled is not None and count % 256 == 0:
                    check_cancelled()
                count += 1
                yield json.loads(line)
        candidates = tracking_summaries(samples(), result.candidates, summary.get("coverage_status") == "MATCHES_METADATA")
    return PerceptionOutput(candidates, result.perception)


class PerceptionAdapter:
    def __init__(self, *, progress: Callable[[str, int, str], None] | None = None,
                 check_cancelled: Callable[[], None] | None = None, observe=None) -> None:
        self.progress = progress
        self.check_cancelled = check_cancelled
        self.observe = observe or local_observations

    def __call__(self, source, root, metadata, candidates, shots) -> PerceptionOutput:
        def progress(value):
            if self.progress is not None:
                percent = 55 + min(14, int(14 * value["processedSamples"] / max(1, value["expectedSamples"])))
                self.progress("EXTRACTING_FACTS", percent, "local-observer-processing")
        raw = self.observe(Path(source), Path(root) / "perception", duration_ms=metadata.duration_ms,
                           progress=progress, check_cancelled=self.check_cancelled)
        if self.check_cancelled is not None:
            self.check_cancelled()
        result = refresh_tracking(Path(root), adapt_observations(raw, Path(root), metadata, candidates, shots), self.check_cancelled)
        if self.check_cancelled is not None:
            self.check_cancelled()
        return result
