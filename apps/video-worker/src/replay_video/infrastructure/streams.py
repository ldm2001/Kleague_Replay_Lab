"""영상·음향 증거 클립의 최소 스트림·시간축 계약"""

from __future__ import annotations
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ClipStreams:
    # 클립으로 추출할 원본 영상 스트림 번호 보존
    video_index: int
    # 영상 상대 시각을 원본 절대 시각으로 바꿀 영상 원점 보존
    video_origin_seconds: float
    # 영상과 음향 중 먼저 시작하는 미디어 원점 보존
    media_origin_seconds: float
    # 클립에 보존할 원본 음향 스트림 번호 또는 없음 보존
    audio_index: int | None
    # 혼합하지 않고 보존할 원본 음향 채널 수 기록
    audio_channels: int | None
    # 음향 스트림을 선택하지 못한 지원 제한 사유 보존
    audio_issue: str | None = None


@dataclass(frozen=True, slots=True)
class ClipAudioResult:
    # 클립 음향의 보존·원본 없음·처리 생략 상태 보존
    status: str
    # 음향이 보존되지 못한 구체적인 사유 보존
    reason: str | None = None

# 영상·음향 스트림 메타데이터 읽음
def mediaStreams(path: Path) -> list[dict]:
    try:
        # 제한된 시간 안에 원본 스트림 메타데이터 조회
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(path)],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    # 미디어 검사 실행 파일 누락 처리
    except FileNotFoundError as error:
        # 검사 도구가 없어 스트림을 확인할 수 없음을 알림
        raise RuntimeError("media-tool-missing") from error
    # 스트림 조회 실행 기한 초과 처리
    except subprocess.TimeoutExpired as error:
        # 스트림 검사 시간 초과를 작업 오류로 전달
        raise RuntimeError("media-probe-timeout") from error
    # 미디어 검사기 종료 상태 확인
    if result.returncode != 0:
        # 스트림을 확인하지 못한 입력 거부
        raise RuntimeError("media-probe-failed")
    try:
        # 검사기의 구조화 출력에서 스트림 목록 읽음
        streams = json.loads(result.stdout)["streams"]
    # 조회 출력의 자료 구조 오류 처리
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        # 원래 파싱 오류를 보존하여 잘못된 조회 결과 알림
        raise RuntimeError("media-probe-invalid") from error
    # 스트림 목록이 예상한 배열 구조인지 확인
    if not isinstance(streams, list):
        # 해석할 수 없는 스트림 목록 거부
        raise RuntimeError("media-probe-invalid")
    # 검사기에서 확인한 원본 스트림 목록 반환
    return streams

# 스트림의 원본 시작 시각을 확인하고 초 단위로 반환
def origin(stream: dict) -> float:
    try:
        # 스트림의 실제 시작 시각을 초 단위 실수로 읽음
        value = float(stream["start_time"])
    except (KeyError, TypeError, ValueError) as error:
        # 누락되거나 숫자가 아닌 시간 원점 거부
        raise RuntimeError("clip-timeline-origin-unavailable") from error
    # 시간 원점이 유한한 수치인지 확인
    if not math.isfinite(value):
        # 유한하지 않은 스트림 시간 원점 거부
        raise RuntimeError("clip-timeline-origin-unavailable")
    # 확인한 원본 스트림 시작 시각 반환
    return value

# 첫 실제 영상과 음향 스트림의 클립 생성 정보를 구성
def clipStreams(path: Path) -> ClipStreams:
    # 영상 파일에 포함된 실제 스트림 자료 읽음
    streams = mediaStreams(path)
    # 표지 그림을 제외한 첫 실제 영상 스트림 선택
    video = next(
        (
            item
            for item in streams
            if isinstance(item, dict)
            and item.get("codec_type") == "video"
            and not bool((item.get("disposition") or {}).get("attached_pic"))
        ),
        None,
    )
    # 실제 영상 스트림이 존재하는지 확인
    if video is None:
        # 클립으로 추출할 영상 스트림이 없는 원본 거부
        raise RuntimeError("video-stream-missing")
    # 원본에 포함된 첫 음향 스트림 선택
    audio = next(
        (item for item in streams if isinstance(item, dict) and item.get("codec_type") == "audio"),
        None,
    )
    try:
        # 영상 스트림 선택에 필요한 정수 번호 읽음
        video_index = int(video["index"])
    except (KeyError, TypeError, ValueError) as error:
        # 영상 스트림 번호가 없거나 잘못된 입력 거부
        raise RuntimeError("clip-stream-metadata-invalid") from error
    # 원본 영상의 절대 시간 원점 확인
    video_origin = origin(video)
    # 음향 스트림이 없는 원본인지 확인
    if audio is None:
        # 영상 원점만 사용하며 원본 음향 없음 상태 반환
        return ClipStreams(video_index, video_origin, video_origin, None, None)
    try:
        # 원본 음향 스트림의 정수 번호 읽음
        audio_index = int(audio["index"])
        # 원본 음향 채널 수 읽음
        channels = int(audio["channels"])
    # 음향 형식 정보가 없거나 수치가 아닌 경우 처리
    except (KeyError, TypeError, ValueError):
        # 음향 형식 정보가 부족한 경우 영상만 선택하고 미지원 사유 반환
        return ClipStreams(
            video_index, video_origin, video_origin, None, None, "AUDIO_METADATA_UNSUPPORTED"
        )
    # 강제 혼합 없이 보존할 수 있는 음향 채널 범위 확인
    if not 1 <= channels <= 8:
        # 원본 근거 상쇄나 재배치를 유발할 강제 채널 혼합 금지
        return ClipStreams(
            video_index, video_origin, video_origin, None, None, "CHANNEL_COUNT_UNSUPPORTED"
        )
    try:
        # 음향의 원본 시작 시각을 영상과 독립적으로 확인
        audio_origin = origin(audio)
    # 음향 시간 원점을 확인하지 못한 경우 생략 사유로 보존
    except RuntimeError:
        # 음향 원점을 알 수 없으면 임의 정렬하지 않고 영상만 선택
        return ClipStreams(
            video_index, video_origin, video_origin, None, None, "AUDIO_TIMELINE_ORIGIN_UNAVAILABLE"
        )
    # 두 스트림의 실제 선후 간격을 유지할 공통 탐색 원점 계산
    media_origin = min(video_origin, audio_origin)
    # 원본 시간 간격과 음향 채널을 보존할 추출 정보 반환
    return ClipStreams(video_index, video_origin, media_origin, audio_index, channels)

# 생성된 클립의 길이와 음향 스트림 존재 여부를 확인
def outputStreams(path: Path) -> tuple[float, bool]:
    # 영상 파일에 포함된 실제 스트림 자료 읽음
    streams = mediaStreams(path)
    # 표지 그림을 제외한 첫 실제 영상 스트림 선택
    video = next(
        (
            item
            for item in streams
            if isinstance(item, dict)
            and item.get("codec_type") == "video"
            and not bool((item.get("disposition") or {}).get("attached_pic"))
        ),
        None,
    )
    # 실제 영상 스트림이 존재하는지 확인
    if video is None:
        # 완성된 증거 파일에 실제 영상이 없으면 거부
        raise RuntimeError("clip-video-missing")
    try:
        # 출력 클립의 실제 영상 재생 길이 읽음
        duration = float(video["duration"])
    except (KeyError, TypeError, ValueError) as error:
        # 실제 클립 길이를 검증할 수 없는 결과 거부
        raise RuntimeError("clip-duration-unavailable") from error
    # 생성된 영상의 길이가 유한한 양수인지 확인
    if not math.isfinite(duration) or duration <= 0:
        # 비정상적인 길이의 증거 클립 거부
        raise RuntimeError("clip-duration-unavailable")
    # 생성된 클립에 음향 스트림이 실제로 존재하는지 검사
    audio_present = any(
        isinstance(item, dict) and item.get("codec_type") == "audio" for item in streams
    )
    # 출력 영상의 길이와 음향 포함 여부 반환
    return duration, audio_present
