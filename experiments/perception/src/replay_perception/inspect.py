from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import sys
import time
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Callable, Protocol

import numpy as np

from .continuity import AppearanceContinuity
from .media import VideoReader
from .models import Detection
from .report import ReportWriter
from .tracking import TrackAssociator


MAX_RUNTIME_SECONDS = 1800
MAX_PROCESSED_FRAMES = 30_000


class Detector(Protocol):
    provenance: dict[str, Any]

    def predict(self, rgb: np.ndarray) -> tuple[Detection, ...]: ...


def _fingerprint(path: Path) -> tuple[int, int, int, int]:
    stat = path.stat()
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns


def _runtime_versions() -> dict[str, str | None]:
    versions = {"python": platform.python_version(), "platform": platform.platform(), "machine": platform.machine()}
    for name in ("torch", "torchvision", "transformers", "trackers", "supervision", "av", "numpy", "opencv-python"):
        try:
            versions[name] = version(name)
        except PackageNotFoundError:
            versions[name] = None
    return versions


def _peak_process_rss_bytes() -> int | None:
    try:
        import resource
    except ImportError:
        return None
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(peak if sys.platform == "darwin" else peak * 1024)


def _failure_reason(error: Exception) -> str:
    text = str(error)
    return text if re.fullmatch(r"[A-Z][A-Z0-9_]{0,100}", text) else type(error).__name__


def inspect(
    source: Path | str,
    output: Path | str,
    detector: Detector,
    tracker: TrackAssociator | None = None,
    *,
    start_ms: int = 0,
    end_ms: int | None = None,
    interval_ms: int = 500,
    max_previews: int = 24,
    model_load_seconds: float = 0.0,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    reader = VideoReader(source, start_ms=start_ms, end_ms=end_ms, interval_ms=interval_ms)
    source_path = reader.source
    output_path = Path(output).expanduser().absolute()
    if os.path.lexists(output_path):
        raise FileExistsError("REPORT_PATH_EXISTS")
    if not source_path.is_file():
        raise ValueError("SOURCE_NOT_FOUND")
    initial_fingerprint = _fingerprint(source_path)
    with source_path.open("rb") as stream:
        source_sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    if _fingerprint(source_path) != initial_fingerprint:
        raise ValueError("VIDEO_SOURCE_CHANGED")
    associator = tracker if tracker is not None else TrackAssociator(frame_rate=1000 / interval_ms)
    continuity = AppearanceContinuity()
    settings = {
        "sampleIntervalMs": interval_ms,
        "startMs": start_ms,
        "endMs": end_ms,
        "continuity": continuity.provenance,
        "runtimeVersions": _runtime_versions(),
        "maximumRuntimeSeconds": MAX_RUNTIME_SECONDS,
        "runtimeLimitEnforcement": "BETWEEN_SAMPLES",
        "maximumProcessedFrames": MAX_PROCESSED_FRAMES,
        "memoryMetric": "PROCESS_RSS_HIGH_WATER_NOT_GPU_MEMORY",
    }
    source_info = {"path": str(source_path), "sha256": source_sha256, "sizeBytes": initial_fingerprint[2]}
    inferred = 0
    associated = 0
    inference_seconds = 0.0
    association_seconds = 0.0

    def timings() -> dict[str, Any]:
        return {
            "modelLoadSeconds": model_load_seconds,
            "inspectionSecondsBeforeFinalization": time.perf_counter() - started,
            "inferenceSeconds": inference_seconds,
            "associationSeconds": association_seconds,
            "inferredFrameCount": inferred,
            "associatedFrameCount": associated,
            "appearanceBoundaryCount": continuity.boundary_count,
            "peakProcessRssBytes": _peak_process_rss_bytes(),
        }

    with ReportWriter(output_path, source=source_info, model=detector.provenance, tracker=associator.provenance, settings=settings, max_previews=max_previews) as report:
        try:
            with reader:
                for frame in reader:
                    if time.perf_counter() - started > MAX_RUNTIME_SECONDS:
                        raise ValueError("INSPECTION_RUNTIME_LIMIT")
                    if inferred >= MAX_PROCESSED_FRAMES:
                        raise ValueError("INSPECTION_SAMPLE_LIMIT")
                    context_id = continuity.update(frame.rgb)
                    inference_started = time.perf_counter()
                    detections = detector.predict(frame.rgb)
                    inference_elapsed = time.perf_counter() - inference_started
                    inference_seconds += inference_elapsed
                    inferred += 1
                    tracking_started = time.perf_counter()
                    observed = associator.update(detections, frame.timestamp_ms, context_id)
                    association_seconds += time.perf_counter() - tracking_started
                    associated += 1
                    report.append(frame, observed, context_id, inference_elapsed)
                    if progress is not None:
                        progress({"inferredFrameCount": inferred, "timestampMs": frame.timestamp_ms})
            if _fingerprint(source_path) != initial_fingerprint:
                raise ValueError("VIDEO_SOURCE_CHANGED")
        except Exception as error:
            return report.finish("FAILED", video=reader.as_record(), timings=timings(), failure_reason=_failure_reason(error))
        return report.finish("COMPLETE", video=reader.as_record(), timings=timings())


def main() -> int:
    from .model_assets import default_model_dir

    parser = argparse.ArgumentParser(description="RT-DETR 검출과 ByteTrack 추적의 독립 진단")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--model-dir", type=Path, default=default_model_dir())
    parser.add_argument("--device", choices=("cpu", "mps"), default="cpu")
    parser.add_argument("--start-ms", type=int, default=0)
    parser.add_argument("--end-ms", type=int)
    args = parser.parse_args()

    def progress(value: dict[str, Any]) -> None:
        if value["inferredFrameCount"] == 1 or value["inferredFrameCount"] % 100 == 0:
            print(f"frames={value['inferredFrameCount']} sourceMs={value['timestampMs']}", file=sys.stderr, flush=True)

    try:
        from .detector import RtdetrDetector

        started = time.perf_counter()
        detector = RtdetrDetector(args.model_dir, device=args.device)
        loaded = time.perf_counter() - started
        summary = inspect(args.source, args.output, detector, start_ms=args.start_ms, end_ms=args.end_ms, model_load_seconds=loaded, progress=progress)
    except Exception as error:
        print(json.dumps({"status": "FAILED", "failureReason": _failure_reason(error)}), file=sys.stderr)
        return 1
    print(f"status={summary['status']} output={args.output.resolve()}")
    return 0 if summary["status"] == "COMPLETE" else 1


if __name__ == "__main__":
    raise SystemExit(main())
