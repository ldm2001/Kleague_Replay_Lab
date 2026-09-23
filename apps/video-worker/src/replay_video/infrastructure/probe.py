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
        # 문자열 또는 수치 메타데이터를 실수로 변환하여 반환
        return float(value)
    # 없는 값이나 숫자가 아닌 입력의 변환 실패 처리
    except (TypeError, ValueError):
        # 기본값 반환
        return default

# 프레임 속도 계산
def fps(value: Any) -> float:
    # 프레임 속도 형식 확인
    if not isinstance(value, str) or not value:
        # 읽을 수 없는 프레임 속도를 영으로 반환하여 후속 유효성 검사에 전달
        return 0.0
    # 단일 숫자 처리
    if "/" not in value:
        # 분수 표기가 아닌 프레임 속도를 실수로 반환
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
        # 원본 파일이 없으면 메타데이터 검사 중단
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
        # 제한된 시간 안에 미디어 검사기의 출력과 종료 상태 수집
        result = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
    # 미디어 검사 실행 파일이 설치되지 않은 경우 처리
    except FileNotFoundError as error:
        # 도구 없음 변환
        raise MediaError("media-tool-missing") from error
    # 원본 메타데이터 조회가 실행 기한을 넘긴 경우 처리
    except subprocess.TimeoutExpired as error:
        # 조회 시간 초과 변환
        raise MediaError("media-probe-timeout") from error

    # 조회 상태 확인
    if result.returncode != 0:
        # 검사기 실행 실패를 지원 가능한 영상으로 인정하지 않음
        raise MediaError("media-probe-failed")
    # 조회 직렬화 자료 해석
    try:
        # 검사기의 구조화된 스트림과 컨테이너 자료 읽음
        payload = json.loads(result.stdout)
    # 검사기 출력이 예상한 구조화 형식이 아닌 경우 처리
    except json.JSONDecodeError as error:
        # 직렬화 자료 오류 변환
        raise MediaError("media-probe-invalid") from error

    # 스트림 목록 확인
    streams = payload.get("streams")
    # 검사 결과의 스트림 목록 형식 확인
    if not isinstance(streams, list):
        # 사용 가능한 영상 스트림이 없는 원본 거부
        raise MediaError("video-stream-missing")
    # 영상 스트림 선택
    stream = next(
        (item for item in streams if isinstance(item, dict) and item.get("codec_type") == "video"),
        None,
    )
    # 선택된 영상 스트림의 존재와 자료형 확인
    if not isinstance(stream, dict):
        # 사용 가능한 영상 스트림이 없는 원본 거부
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
        # 양수 길이·해상도·프레임 수를 갖추지 못한 영상 거부
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
