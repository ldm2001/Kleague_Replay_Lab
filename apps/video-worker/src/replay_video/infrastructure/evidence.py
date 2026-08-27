from __future__ import annotations

import subprocess
from pathlib import Path

import cv2

from ..domain.models import Candidate, Evidence, VideoMetadata


def frame(source: Path, destination: Path, timestamp_ms: int) -> None:
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError("video-open-failed")
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp_ms)
        ok, image = capture.read()
        if not ok:
            raise RuntimeError("frame-read-failed")
        if not cv2.imwrite(str(destination), image, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise RuntimeError("frame-write-failed")
    finally:
        capture.release()


def clip(source: Path, destination: Path, start_ms: int, end_ms: int) -> None:
    duration = max(0.2, (end_ms - start_ms) / 1000)
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-i",
        str(source),
        "-t",
        f"{duration:.3f}",
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(destination),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    except FileNotFoundError as error:
        raise RuntimeError("media-tool-missing") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("clip-timeout") from error
    if result.returncode != 0:
        raise RuntimeError("clip-write-failed")


def evidence(
    source: Path | str,
    output: Path | str,
    metadata: VideoMetadata,
    candidate_list: tuple[Candidate, ...],
) -> tuple[Evidence, ...]:
    source_path = Path(source).resolve()
    root = Path(output).resolve()
    frame_root = root / "frames"
    clip_root = root / "clips"
    frame_root.mkdir(parents=True, exist_ok=True)
    clip_root.mkdir(parents=True, exist_ok=True)

    result: list[Evidence] = []
    for candidate in candidate_list:
        points = (candidate.start_ms, candidate.anchor_ms, min(candidate.end_ms, max(0, metadata.duration_ms - 1)))
        for frame_index, timestamp_ms in enumerate(dict.fromkeys(points), start=1):
            destination = frame_root / f"candidate-{candidate.index:04d}-frame-{frame_index:02d}.jpg"
            frame(source_path, destination, timestamp_ms)
            result.append(Evidence(candidate.index, "FRAME", destination, timestamp_ms, candidate.start_ms, candidate.end_ms))

        clip_destination = clip_root / f"candidate-{candidate.index:04d}.mp4"
        clip(source_path, clip_destination, candidate.start_ms, candidate.end_ms)
        result.append(Evidence(candidate.index, "CLIP", clip_destination, candidate.anchor_ms, candidate.start_ms, candidate.end_ms))
    return tuple(result)
