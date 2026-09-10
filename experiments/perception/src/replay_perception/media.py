from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Any, Iterator

import numpy as np


ATTACHED_PICTURE = 1024
MAX_FRAME_PIXELS = 4096 * 2160


def _time(pts: int | None, base: Fraction | None, *, origin: bool = False) -> Fraction:
    if type(pts) is not int:
        raise ValueError("TIMELINE_ORIGIN_MISSING" if origin else "TIMELINE_PTS_MISSING")
    if not isinstance(base, Fraction) or base <= 0:
        raise ValueError("TIMELINE_TIMEBASE_INVALID")
    return pts * base


def timestamp_ms(pts: int | None, base: Fraction | None, origin_pts: int | None, origin_base: Fraction | None) -> int:
    return round((_time(pts, base) - _time(origin_pts, origin_base, origin=True)) * 1000)


def select_video_stream(streams):
    for stream in streams:
        if stream.type != "video":
            continue
        disposition = getattr(stream, "disposition", 0)
        disposition = getattr(disposition, "value", disposition)
        if not int(disposition) & ATTACHED_PICTURE:
            return stream
    raise ValueError("VIDEO_STREAM_ABSENT")


def _fraction_record(value: Fraction | None) -> dict[str, int] | None:
    return None if value is None else {"numerator": value.numerator, "denominator": value.denominator}


@dataclass(frozen=True, slots=True)
class VideoSample:
    decoded_index: int
    stream_index: int
    pts: int
    time_base: Fraction
    origin_pts: int
    origin_time_base: Fraction
    timestamp_ms: int
    rgb: np.ndarray

    def as_record(self) -> dict[str, Any]:
        return {
            "decodedIndex": self.decoded_index,
            "streamIndex": self.stream_index,
            "pts": self.pts,
            "timeBase": _fraction_record(self.time_base),
            "originPts": self.origin_pts,
            "originTimeBase": _fraction_record(self.origin_time_base),
            "timestampMs": self.timestamp_ms,
            "width": int(self.rgb.shape[1]),
            "height": int(self.rgb.shape[0]),
            "timestampSource": "DECODER_PTS",
        }


class VideoReader:
    def __init__(self, source: Path | str, *, start_ms: int = 0, end_ms: int | None = None, interval_ms: int = 500) -> None:
        if type(start_ms) is not int or start_ms < 0 or type(interval_ms) is not int or interval_ms <= 0:
            raise ValueError("SCAN_RANGE_INVALID")
        if end_ms is not None and (type(end_ms) is not int or end_ms <= start_ms):
            raise ValueError("SCAN_RANGE_INVALID")
        self.source = Path(source).expanduser().resolve()
        self.start_ms, self.end_ms, self.interval_ms = start_ms, end_ms, interval_ms
        self._container = None
        self._stream = None
        self._av = None
        self._iterated = False
        self.origin_pts = None
        self.origin_time_base = None
        self.origin_source = None
        self.stream_index = None
        self.decoded_frame_count = 0
        self.sample_count = 0
        self.first_sample_ms = None
        self.last_sample_ms = None
        self.reached_eof = False
        self.seek_applied = False

    def __enter__(self) -> VideoReader:
        import av

        if self._container is not None or self._iterated:
            raise ValueError("VIDEO_READER_ALREADY_USED")
        if not self.source.is_file():
            raise ValueError("SOURCE_NOT_FOUND")
        self._av = av
        try:
            self._container = av.open(str(self.source), mode="r", timeout=(10, 20))
        except (av.error.FFmpegError, OSError) as error:
            raise ValueError("VIDEO_OPEN_FAILED") from error
        try:
            self._stream = select_video_stream(self._container.streams)
            self.stream_index = self._stream.index
            self._stream.codec_context.thread_count = 2
            if self._stream.start_time is not None:
                _time(self._stream.start_time, self._stream.time_base, origin=True)
                self.origin_pts = self._stream.start_time
                self.origin_time_base = self._stream.time_base
                self.origin_source = "STREAM_START_TIME"
                if self.start_ms:
                    target = self.origin_pts + int(Fraction(self.start_ms, 1000) / self.origin_time_base)
                    self._container.seek(target, stream=self._stream, backward=True, any_frame=False)
                    self.seek_applied = True
        except Exception:
            self._container.close()
            self._container = None
            raise
        return self

    def __iter__(self) -> Iterator[VideoSample]:
        if self._container is None or self._iterated:
            raise ValueError("VIDEO_READER_NOT_READY")
        self._iterated = True
        previous_time = None
        due_ms = self.start_ms
        try:
            for frame in self._container.decode(self._stream):
                index = self.decoded_frame_count
                self.decoded_frame_count += 1
                if frame.is_corrupt:
                    raise ValueError("VIDEO_FRAME_CORRUPT")
                actual_time = _time(frame.pts, frame.time_base)
                if previous_time is not None and actual_time <= previous_time:
                    raise ValueError("TIMELINE_NON_MONOTONIC")
                previous_time = actual_time
                if self.origin_pts is None:
                    self.origin_pts, self.origin_time_base = frame.pts, frame.time_base
                    self.origin_source = "FIRST_DECODED_FRAME"
                relative_ms = (actual_time - _time(self.origin_pts, self.origin_time_base, origin=True)) * 1000
                if self.end_ms is not None and relative_ms >= self.end_ms:
                    break
                if relative_ms < due_ms:
                    continue
                if frame.width <= 0 or frame.height <= 0 or frame.width * frame.height > MAX_FRAME_PIXELS:
                    raise ValueError("VIDEO_DIMENSIONS_UNSUPPORTED")
                rgb = frame.to_ndarray(format="rgb24")
                timestamp = round(relative_ms)
                self.sample_count += 1
                if self.first_sample_ms is None:
                    self.first_sample_ms = timestamp
                self.last_sample_ms = timestamp
                due_ms = self.start_ms + (int((relative_ms - self.start_ms) // self.interval_ms) + 1) * self.interval_ms
                yield VideoSample(index, self.stream_index, frame.pts, frame.time_base, self.origin_pts, self.origin_time_base, timestamp, rgb)
            else:
                self.reached_eof = True
        except self._av.error.FFmpegError as error:
            raise ValueError("VIDEO_DECODE_FAILED") from error
        if not self.sample_count:
            raise ValueError("NO_VIDEO_FRAMES_IN_RANGE")

    def __exit__(self, *_args: object) -> None:
        if self._container is not None:
            self._container.close()
            self._container = None

    def as_record(self) -> dict[str, Any]:
        return {
            "streamIndex": self.stream_index,
            "originPts": self.origin_pts,
            "originTimeBase": _fraction_record(self.origin_time_base),
            "originSource": self.origin_source,
            "requestedStartMs": self.start_ms,
            "requestedEndMs": self.end_ms,
            "sampleIntervalMs": self.interval_ms,
            "decodedFrameCount": self.decoded_frame_count,
            "sampleCount": self.sample_count,
            "firstSampleMs": self.first_sample_ms,
            "lastSampleMs": self.last_sample_ms,
            "reachedEof": self.reached_eof,
            "seekApplied": self.seek_applied,
            "decodedIndexScope": "THIS_READER_AFTER_OPTIONAL_SEEK",
        }
