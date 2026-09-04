from __future__ import annotations

import subprocess
from pathlib import Path

import cv2

from ..domain.models import Candidate, Evidence, VideoMetadata


# 증거 프레임 생성
def frame(source: Path, destination: Path, timestamp_ms: int) -> None:
    # 영상 캡처 열기
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise RuntimeError("video-open-failed")
    try:
        # 프레임 위치 이동
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp_ms)
        # 프레임 읽기
        ok, image = capture.read()
        if not ok:
            raise RuntimeError("frame-read-failed")
        # 프레임 파일 기록
        if not cv2.imwrite(str(destination), image, [cv2.IMWRITE_JPEG_QUALITY, 92]):
            raise RuntimeError("frame-write-failed")
    finally:
        capture.release()


# 증거 클립 생성
def clip(source: Path, destination: Path, start_ms: int, end_ms: int) -> None:
    # 클립 길이 계산
    duration = max(0.2, (end_ms - start_ms) / 1000)
    # FFmpeg 명령 구성
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
        "-vf",
        "scale=-2:min(720\\,ih)",
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
    # 클립 생성 실행
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=60, check=False)
    except FileNotFoundError as error:
        # 도구 없음 변환
        raise RuntimeError("media-tool-missing") from error
    except subprocess.TimeoutExpired as error:
        # 생성 시간 초과 변환
        raise RuntimeError("clip-timeout") from error
    # 생성 상태 확인
    if result.returncode != 0:
        raise RuntimeError("clip-write-failed")


# 후보 증거 묶음 생성
def evidence(
    source: Path | str,
    output: Path | str,
    metadata: VideoMetadata,
    candidate_list: tuple[Candidate, ...],
    *,
    max_clips: int = 8,
) -> tuple[Evidence, ...]:
    # 입력 경로 정규화
    source_path = Path(source).resolve()
    # 출력 경로 정규화
    root = Path(output).resolve()
    # 프레임 폴더 준비
    frame_root = root / "frames"
    # 클립 폴더 준비
    clip_root = root / "clips"
    # 프레임 폴더 생성
    frame_root.mkdir(parents=True, exist_ok=True)
    # 클립 폴더 생성
    clip_root.mkdir(parents=True, exist_ok=True)

    # 증거 결과 초기화
    result: list[Evidence] = []
    # 모든 후보에 프레임 생성
    targets = sorted(candidate_list, key=lambda item: item.index)
    # 클립 생성 후보 제한
    clips = {item.index for item in sorted(candidate_list, key=lambda item: item.confidence, reverse=True)[:max_clips]}
    # 후보별 증거 생성
    for candidate in targets:
        # 프레임 파일 경로 구성
        destination = frame_root / f"candidate-{candidate.index:04d}-frame-01.jpg"
        # 프레임 저장
        frame(source_path, destination, candidate.anchor_ms)
        # 프레임 결과 추가
        result.append(Evidence(candidate.index, "FRAME", destination, candidate.anchor_ms, candidate.start_ms, candidate.end_ms))

        if candidate.index in clips:
            # 클립 파일 경로 구성
            clip_destination = clip_root / f"candidate-{candidate.index:04d}.mp4"
            # 클립 저장
            clip(source_path, clip_destination, candidate.start_ms, candidate.end_ms)
            # 클립 결과 추가
            result.append(Evidence(candidate.index, "CLIP", clip_destination, candidate.anchor_ms, candidate.start_ms, candidate.end_ms))
    # 증거 결과 반환
    return tuple(result)
