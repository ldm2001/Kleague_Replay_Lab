from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from ..domain.models import VideoMetadata


class MediaError(RuntimeError):
    # 지원 영상 확인 오류
    pass


# 수치 변환
def number(value: Any, default: float = 0.0) -> float:
    # 숫자 변환 시도
    try:
        return float(value)
    except (TypeError, ValueError):
        # 기본값 반환
        return default


# 프레임 속도 계산
def fps(value: Any) -> float:
    # 프레임 속도 형식 확인
    if not isinstance(value, str) or not value:
        return 0.0
    # 단일 숫자 처리
    if "/" not in value:
        return number(value)
    # 분자와 분모 분리
    numerator, denominator = value.split("/", 1)
    # 분모 변환
    denominator_value = number(denominator)
    # 프레임 속도 계산
    return number(numerator) / denominator_value if denominator_value else 0.0


# 영상 메타데이터 확인
def probe(source: Path | str) -> VideoMetadata:
    # 영상 경로 정규화
    path = Path(source).expanduser().resolve()
    # 파일 존재 확인
    if not path.is_file():
        raise MediaError("media-not-found")

    # 미디어 조회 명령 구성
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
    # 미디어 조회 실행
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
    except FileNotFoundError as error:
        # 도구 없음 변환
        raise MediaError("media-tool-missing") from error
    except subprocess.TimeoutExpired as error:
        # 조회 시간 초과 변환
        raise MediaError("media-probe-timeout") from error

    # 조회 상태 확인
    if result.returncode != 0:
        raise MediaError("media-probe-failed")
    # 조회 JSON 해석
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        # JSON 오류 변환
        raise MediaError("media-probe-invalid") from error

    # 스트림 목록 확인
    streams = payload.get("streams")
    if not isinstance(streams, list):
        raise MediaError("video-stream-missing")
    # 영상 스트림 선택
    stream = next((item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"), None)
    if not isinstance(stream, dict):
        raise MediaError("video-stream-missing")

    # 영상 너비 변환
    width = int(number(stream.get("width")))
    # 영상 높이 변환
    height = int(number(stream.get("height")))
    # 프레임 속도 변환
    frame_rate = fps(stream.get("avg_frame_rate") or stream.get("r_frame_rate"))
    # 포맷 정보 선택
    format_payload = payload.get("format") if isinstance(payload.get("format"), dict) else {}
    # 재생 시간 계산
    duration = number(stream.get("duration"), number(format_payload.get("duration")))
    # 프레임 수 계산
    frame_count = int(number(stream.get("nb_frames"), duration * frame_rate))
    # 코덱 이름 추출
    codec = str(stream.get("codec_name") or "unknown")
    # 메타데이터 유효성 확인
    if width <= 0 or height <= 0 or frame_rate <= 0 or duration <= 0 or frame_count <= 0:
        raise MediaError("video-metadata-invalid")

    # 메타데이터 결과 반환
    return VideoMetadata(
        source=path,
        duration_ms=round(duration * 1000),
        width=width,
        height=height,
        fps=frame_rate,
        frame_count=frame_count,
        codec=codec,
    )
