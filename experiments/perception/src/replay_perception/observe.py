from __future__ import annotations

import argparse
from contextlib import ExitStack
import json
import math
import os
from pathlib import Path
import sys
import time
from typing import Any, Callable, Protocol

import numpy as np

from .inspect import _failure_reason, _peak_process_rss_bytes, _runtime_versions
from .models import Detection
from .observation_report import ObservationReport
from .observations import PoseObservation, RoleDetection
from .recorded_frames import RecordedFrames
from .role_matching import MIN_IOU, MIN_IOU_MARGIN, MIN_ROLE_SCORE, assign_roles
from .signals import ArmSignalTracker, arm_observations


MAX_RUNTIME_SECONDS = 1800
MAX_PROCESSED_FRAMES = 30_000


class RoleModel(Protocol):
    provenance: dict[str, Any]
    last_transform: dict[str, Any] | None

    def predict(self, rgb: np.ndarray) -> tuple[RoleDetection, ...]: ...


class PoseModel(Protocol):
    provenance: dict[str, Any]

    def predict(self, rgb: np.ndarray, detections: tuple[Detection, ...]) -> tuple[PoseObservation, ...]: ...


def observe(
    source: Path | str,
    upstream: Path | str,
    output: Path | str,
    role_detector: RoleModel,
    pose_estimator: PoseModel,
    *,
    max_previews: int = 24,
    progress: Callable[[dict[str, Any]], None] | None = None,
    model_load_seconds: dict[str, float] | None = None,
) -> dict[str, Any]:
    output_path = Path(output).expanduser().absolute()
    if os.path.lexists(output_path):
        raise FileExistsError("REPORT_PATH_EXISTS")
    if type(max_previews) is not int or not 2 <= max_previews <= 24:
        raise ValueError("MAX_PREVIEWS_INVALID")
    loads = dict(model_load_seconds or {})
    if any(type(value) not in (int, float) or not math.isfinite(value) or value < 0 for value in loads.values()):
        raise ValueError("MODEL_LOAD_TIMING_INVALID")
    started = time.perf_counter()
    counts = {"roleAttemptedFrameCount": 0, "roleInferredFrameCount": 0, "roleMatchingFrameCount": 0,
              "poseAttemptedFrameCount": 0, "poseAttemptedPersonCount": 0,
              "poseInferredFrameCount": 0, "poseInferredPersonCount": 0,
              "armObservedFrameCount": 0}
    accumulated = {"roleSeconds": 0., "matchingSeconds": 0., "poseSeconds": 0., "signalSeconds": 0.}
    cleanup_failure: str | None = None

    def timings() -> dict[str, Any]:
        value = {**counts, **accumulated, "modelLoadSeconds": loads,
                 "observationSecondsBeforeFinalization": time.perf_counter() - started,
                 "peakProcessRssBytes": _peak_process_rss_bytes()}
        if cleanup_failure is not None:
            value["cleanupFailureReason"] = cleanup_failure
        return value

    with ExitStack() as resources:
        replay = resources.enter_context(RecordedFrames(source, upstream))
        provenance = replay.provenance
        settings = {
            "upstreamSampling": provenance["settings"],
            "roleMatching": {"minimumRoleScore": MIN_ROLE_SCORE, "minimumIoU": MIN_IOU,
                             "minimumMutualIoUMargin": MIN_IOU_MARGIN, "method": "MUTUAL_UNIQUE_BEST"},
            "armObservation": {
                "minimumKeypointScore": .5, "minimumSourceBoxHeight": 64, "minimumSourceBoxWidth": 12,
                "minimumTorsoPixels": 8, "minimumWristRiseTorsoRatio": .25,
                "minimumElbowAngleDegrees": 150, "maximumVerticalAngleDegrees": 30,
                "minimumSupportFrames": 3, "minimumDurationMs": 200, "maximumGapMs": 250,
            },
            "maximumRuntimeSeconds": MAX_RUNTIME_SECONDS,
            "runtimeLimitEnforcement": "BETWEEN_REPLAYED_FRAMES",
            "maximumProcessedFrames": MAX_PROCESSED_FRAMES,
            "memoryMetric": "PROCESS_RSS_HIGH_WATER_NOT_GPU_MEMORY",
            "runtimeVersions": _runtime_versions(),
        }
        upstream_info = {"path": str(replay.run_dir), **provenance["upstream"],
                         "source": provenance["source"], "settings": provenance["settings"]}
        tracker = ArmSignalTracker()
        with ObservationReport(output_path, source=replay.as_record()["source"], upstream=upstream_info,
                               models={"role": role_detector.provenance, "pose": pose_estimator.provenance},
                               settings=settings, max_previews=max_previews) as report:
            try:
                for frame in replay:
                    if time.perf_counter() - started > MAX_RUNTIME_SECONDS:
                        raise ValueError("OBSERVATION_RUNTIME_LIMIT")
                    if counts["roleAttemptedFrameCount"] >= MAX_PROCESSED_FRAMES:
                        raise ValueError("OBSERVATION_SAMPLE_LIMIT")
                    stage = {}
                    stage_started = time.perf_counter()
                    counts["roleAttemptedFrameCount"] += 1
                    raw_roles = role_detector.predict(frame.sample.rgb)
                    stage["roleSeconds"] = time.perf_counter() - stage_started
                    accumulated["roleSeconds"] += stage["roleSeconds"]
                    counts["roleInferredFrameCount"] += 1

                    stage_started = time.perf_counter()
                    matches = assign_roles(frame.detections, raw_roles)
                    counts["roleMatchingFrameCount"] += 1
                    selected_ids = {match.detection_id for match in matches if match.status == "MATCHED"}
                    people = tuple(detection for detection in frame.detections if detection.detection_id in selected_ids)
                    stage["matchingSeconds"] = time.perf_counter() - stage_started
                    accumulated["matchingSeconds"] += stage["matchingSeconds"]

                    stage_started = time.perf_counter()
                    poses: tuple[PoseObservation, ...] = ()
                    if people:
                        counts["poseAttemptedFrameCount"] += 1
                        counts["poseAttemptedPersonCount"] += len(people)
                        poses = pose_estimator.predict(frame.sample.rgb, people)
                        if (not isinstance(poses, tuple) or any(not isinstance(pose, PoseObservation) for pose in poses)
                                or tuple(pose.detection_id for pose in poses) != tuple(person.detection_id for person in people)
                                or any(pose.source_box != person.box for pose, person in zip(poses, people))):
                            raise ValueError("POSE_OUTPUT_MISMATCH")
                        counts["poseInferredFrameCount"] += 1
                        counts["poseInferredPersonCount"] += len(poses)
                    stage["poseSeconds"] = time.perf_counter() - stage_started
                    accumulated["poseSeconds"] += stage["poseSeconds"]

                    stage_started = time.perf_counter()
                    height, width = frame.sample.rgb.shape[:2]
                    arms = tuple(arm for pose in poses for arm in arm_observations(pose, width, height))
                    episodes = tracker.update(frame, matches, poses)
                    counts["armObservedFrameCount"] += 1
                    stage["signalSeconds"] = time.perf_counter() - stage_started
                    accumulated["signalSeconds"] += stage["signalSeconds"]
                    report.append(frame=frame, roles_raw=raw_roles, roles_matched=matches, poses=poses,
                                  arms=arms, episodes=episodes, timings=stage,
                                  role_input_transform=role_detector.last_transform)
                    if progress is not None:
                        progress({"replayedFrameCount": replay.as_record()["replayedFrameCount"],
                                  "timestampMs": frame.sample.timestamp_ms, "matchedPersonCount": len(people)})
                resources.close()
                report.append_episodes(tracker.finish())
            except Exception as error:
                try:
                    resources.close()
                except Exception as close_error:
                    cleanup_failure = _failure_reason(close_error)
                return report.finish("FAILED", replay=replay.as_record(), timings=timings(), failure_reason=_failure_reason(error))
            return report.finish("COMPLETE", replay=replay.as_record(), timings=timings())


def main() -> int:
    from .observer_assets import default_observer_model_dir

    parser = argparse.ArgumentParser(description="기존 검출 기록과 원본의 역할·자세·팔 동작 독립 관측")
    parser.add_argument("source", type=Path)
    parser.add_argument("upstream", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--device", choices=("cpu", "mps"), default="cpu")
    parser.add_argument("--role-model-dir", type=Path, default=default_observer_model_dir("role"))
    parser.add_argument("--pose-model-dir", type=Path, default=default_observer_model_dir("pose"))
    args = parser.parse_args()

    def report_progress(event: dict[str, Any]) -> None:
        count = event["replayedFrameCount"]
        if count == 1 or count % 50 == 0:
            print(f"frames={count} sourceMs={event['timestampMs']} matched={event['matchedPersonCount']}",
                  file=sys.stderr, flush=True)

    try:
        if os.path.lexists(args.output.expanduser().absolute()):
            raise FileExistsError("REPORT_PATH_EXISTS")
        if not args.source.expanduser().is_file():
            raise ValueError("SOURCE_NOT_FOUND")
        if not all((args.upstream.expanduser() / name).is_file() for name in ("summary.json", "frames.jsonl")):
            raise ValueError("UPSTREAM_INPUT_NOT_FOUND")
        from .roles import YoloRoleDetector
        from .pose import VitPoseEstimator

        started = time.perf_counter()
        role = YoloRoleDetector(args.role_model_dir, device=args.device)
        role_load = time.perf_counter() - started
        started = time.perf_counter()
        pose = VitPoseEstimator(args.pose_model_dir, device=args.device)
        pose_load = time.perf_counter() - started
        summary = observe(args.source, args.upstream, args.output, role, pose,
                          progress=report_progress, model_load_seconds={"role": role_load, "pose": pose_load})
    except Exception as error:
        print(json.dumps({"status": "FAILED", "failureReason": _failure_reason(error)}), file=sys.stderr)
        return 1
    print(f"status={summary['status']} admission=NOT_ADMITTED output={args.output.resolve()}")
    return 0 if summary["status"] == "COMPLETE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
