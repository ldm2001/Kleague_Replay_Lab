from __future__ import annotations
from fractions import Fraction
import math
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory
import cv2
from .streams import mediaStreams

# 원본 스트림의 정수 시각과 시간 단위를 읽고 정확한 원점 반환
def timeline(source: Path) -> tuple[int, Fraction, Fraction]:
    streams = mediaStreams(source)
    video = next(
        (
            item
            for item in streams
            if isinstance(item, dict)
            and item.get("codec_type") == "video"
            and isinstance(item.get("disposition") or {}, dict)
            and not (item.get("disposition") or {}).get("attached_pic")
        ),
        None,
    )
    if video is None:
        raise RuntimeError("video-stream-missing")
    try:
        index = video["index"]
        start = video["start_pts"]
        if type(index) is not int or index < 0:
            raise ValueError("index")
        if type(start) is not int or start == -(2 ** 63):
            raise ValueError("start")
        if not isinstance(video["time_base"], str):
            raise ValueError("time_base")
        scale = Fraction(video["time_base"])
        if scale <= 0:
            raise ValueError("time_base")
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        raise RuntimeError("frame-timeline-origin-unavailable") from None
    return index, scale, Fraction(start) * scale

# 같은 디코딩 실행에서 나온 단일 프레임의 정확한 시각 반환
def timestamp(log: str, origin: Fraction, requested_ms: int) -> int:
    lines = [line for line in log.splitlines() if "[showinfo@evidence @" in line]
    scales = [
        match.group(1)
        for line in lines
        if (match := re.search(r"config in time_base:\s*(\S+)", line))
    ]
    records = [line for line in lines if re.search(r"\bn:\s*\S+", line)]
    if len(scales) != 1 or len(records) != 1:
        raise RuntimeError("frame-timestamp-unavailable")
    try:
        scale = Fraction(scales[0].rstrip(","))
        match = re.search(r"\bn:\s*0\s+pts:\s*(-?\d+)\s", records[0])
        if scale <= 0 or match is None:
            raise ValueError("timestamp")
        pts = int(match.group(1))
        if pts == -(2 ** 63):
            raise ValueError("timestamp")
    except (ValueError, ZeroDivisionError):
        raise RuntimeError("frame-timestamp-unavailable") from None
    actual = pts * scale - origin
    if actual < 0 or actual < Fraction(requested_ms, 1000):
        raise RuntimeError("frame-timestamp-out-of-bounds")
    return round(actual * 1000)

# 요청 이후 첫 원본 프레임과 실제 정규화 시각을 원자적으로 생성
def frame(source: Path, destination: Path, timestamp_ms: int) -> int:
    if type(timestamp_ms) is not int or timestamp_ms < 0:
        raise ValueError("frame-request-invalid")
    index, scale, origin = timeline(source)
    target = origin + Fraction(timestamp_ms, 1000)
    filters = (
        f"trim=start_pts={math.ceil(target / scale)},"
        "trim=end_frame=1,showinfo@evidence=checksum=0"
    )
    try:
        with TemporaryDirectory(prefix=".frame-", dir=destination.parent) as directory:
            output = Path(directory) / "frame.jpg"
            result = subprocess.run(
                [
                    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "level+info",
                    "-nostats", "-xerror", "-copyts", "-threads", "2",
                    *(
                        [
                            "-seek_timestamp", "1", "-ss", str(math.floor(target - 2)),
                            "-noaccurate_seek",
                        ]
                        if timestamp_ms > 2000 else []
                    ),
                    "-i", str(source), "-map", f"0:{index}", "-an", "-sn", "-dn",
                    "-filter_threads", "1", "-vf", filters,
                    "-frames:v", "1", "-fps_mode", "passthrough",
                    "-c:v", "mjpeg", "-q:v", "2", "-threads", "2",
                    "-f", "image2", "-update", "1", str(output),
                ],
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            if result.returncode != 0 or re.search(r"\[(error|fatal|panic)\]", result.stderr):
                raise RuntimeError("frame-decode-failed")
            actual_ms = timestamp(result.stderr, origin, timestamp_ms)
            if not output.is_file() or not 0 < output.stat().st_size <= 50 * 1024 * 1024:
                raise RuntimeError("frame-write-failed")
            with output.open("rb") as stream:
                if stream.read(2) != b"\xff\xd8":
                    raise RuntimeError("frame-write-failed")
            image = cv2.imread(str(output))
            if image is None or not image.size:
                raise RuntimeError("frame-write-failed")
            output.replace(destination)
            return actual_ms
    except FileNotFoundError:
        raise RuntimeError("media-tool-missing") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError("frame-timeout") from None
    except OSError:
        raise RuntimeError("frame-write-failed") from None
