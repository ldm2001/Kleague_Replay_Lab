from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from ..domain.models import VideoMetadata


class MediaError(RuntimeError):
    """Raised when a source cannot be inspected as a supported video."""


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _fps(value: Any) -> float:
    if not isinstance(value, str) or not value:
        return 0.0
    if "/" not in value:
        return _number(value)
    numerator, denominator = value.split("/", 1)
    denominator_value = _number(denominator)
    return _number(numerator) / denominator_value if denominator_value else 0.0


def probe(source: Path | str) -> VideoMetadata:
    path = Path(source).expanduser().resolve()
    if not path.is_file():
        raise MediaError("media-not-found")

    command = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_streams",
        "-show_format",
        str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
    except FileNotFoundError as error:
        raise MediaError("media-tool-missing") from error
    except subprocess.TimeoutExpired as error:
        raise MediaError("media-probe-timeout") from error

    if result.returncode != 0:
        raise MediaError("media-probe-failed")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise MediaError("media-probe-invalid") from error

    streams = payload.get("streams")
    if not isinstance(streams, list):
        raise MediaError("video-stream-missing")
    stream = next((item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"), None)
    if not isinstance(stream, dict):
        raise MediaError("video-stream-missing")

    width = int(_number(stream.get("width")))
    height = int(_number(stream.get("height")))
    fps = _fps(stream.get("avg_frame_rate") or stream.get("r_frame_rate"))
    format_payload = payload.get("format") if isinstance(payload.get("format"), dict) else {}
    duration = _number(stream.get("duration"), _number(format_payload.get("duration")))
    frame_count = int(_number(stream.get("nb_frames"), duration * fps))
    codec = str(stream.get("codec_name") or "unknown")
    if width <= 0 or height <= 0 or fps <= 0 or duration <= 0 or frame_count <= 0:
        raise MediaError("video-metadata-invalid")

    return VideoMetadata(
        source=path,
        duration_ms=round(duration * 1000),
        width=width,
        height=height,
        fps=fps,
        frame_count=frame_count,
        codec=codec,
    )
