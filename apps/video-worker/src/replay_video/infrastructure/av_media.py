"""Minimal FFprobe stream/timeline contract for audiovisual evidence clips."""

from __future__ import annotations

import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ClipStreams:
    video_index: int
    video_origin_seconds: float
    media_origin_seconds: float
    audio_index: int | None
    audio_channels: int | None
    audio_issue: str | None = None


@dataclass(frozen=True, slots=True)
class ClipAudioResult:
    status: str
    reason: str | None = None


def probe_streams(path: Path) -> list[dict]:
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=20, check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError("media-tool-missing") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("media-probe-timeout") from error
    if result.returncode != 0:
        raise RuntimeError("media-probe-failed")
    try:
        streams = json.loads(result.stdout)["streams"]
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise RuntimeError("media-probe-invalid") from error
    if not isinstance(streams, list):
        raise RuntimeError("media-probe-invalid")
    return streams


def _origin(stream: dict) -> float:
    try:
        value = float(stream["start_time"])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("clip-timeline-origin-unavailable") from error
    if not math.isfinite(value):
        raise RuntimeError("clip-timeline-origin-unavailable")
    return value


def clip_streams(path: Path) -> ClipStreams:
    streams = probe_streams(path)
    video = next((item for item in streams if isinstance(item, dict)
                  and item.get("codec_type") == "video"
                  and not bool((item.get("disposition") or {}).get("attached_pic"))), None)
    if video is None:
        raise RuntimeError("video-stream-missing")
    audio = next((item for item in streams if isinstance(item, dict)
                  and item.get("codec_type") == "audio"), None)
    try:
        video_index = int(video["index"])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("clip-stream-metadata-invalid") from error
    video_origin = _origin(video)
    if audio is None:
        return ClipStreams(video_index, video_origin, video_origin, None, None)
    try:
        audio_index = int(audio["index"])
        channels = int(audio["channels"])
    except (KeyError, TypeError, ValueError):
        return ClipStreams(video_index, video_origin, video_origin, None, None, "AUDIO_METADATA_UNSUPPORTED")
    if not 1 <= channels <= 8:
        # Do not force a downmix that could cancel or reassign source evidence.
        return ClipStreams(video_index, video_origin, video_origin, None, None, "CHANNEL_COUNT_UNSUPPORTED")
    try:
        audio_origin = _origin(audio)
    except RuntimeError:
        return ClipStreams(video_index, video_origin, video_origin, None, None, "AUDIO_TIMELINE_ORIGIN_UNAVAILABLE")
    media_origin = min(video_origin, audio_origin)
    return ClipStreams(video_index, video_origin, media_origin, audio_index, channels)


def output_streams(path: Path) -> tuple[float, bool]:
    streams = probe_streams(path)
    video = next((item for item in streams if isinstance(item, dict)
                  and item.get("codec_type") == "video"
                  and not bool((item.get("disposition") or {}).get("attached_pic"))), None)
    if video is None:
        raise RuntimeError("clip-video-missing")
    try:
        duration = float(video["duration"])
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("clip-duration-unavailable") from error
    if not math.isfinite(duration) or duration <= 0:
        raise RuntimeError("clip-duration-unavailable")
    audio_present = any(isinstance(item, dict) and item.get("codec_type") == "audio" for item in streams)
    return duration, audio_present
