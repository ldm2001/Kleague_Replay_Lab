from __future__ import annotations

import subprocess
import time
from pathlib import Path

import cv2

from ..domain.models import Candidate, Evidence, VideoMetadata
from .av_media import ClipAudioResult, clip_streams, output_streams


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
def clip(source: Path, destination: Path, start_ms: int, end_ms: int) -> ClipAudioResult:
    # 클립 길이 계산
    duration = max(0.2, (end_ms - start_ms) / 1000)
    selected = clip_streams(source)
    source_start = selected.video_origin_seconds + start_ms / 1000
    source_end = source_start + duration
    # Leave container/headroom inside the 50 MiB upload cap. VBV limits quality,
    # not duration: -fs would silently truncate the claimed evidence interval.
    audio_rate = max(128_000, 64_000 * (selected.audio_channels or 0)) if selected.audio_index is not None else 0
    rate = min(6_000_000, int(44 * 1024 * 1024 * 8 / (duration + 2)) - audio_rate)
    if rate <= 0:
        raise ValueError("clip-duration-invalid")
    # Both selected streams retain their original separation by using the same
    # absolute PTS window. Audio resampling fills source packet PTS holes.
    video_filter = (
        f"[0:{selected.video_index}]trim=start={source_start:.6f}:end={source_end:.6f},"
        f"setpts=PTS-{source_start:.6f}/TB,scale=-2:min(720\\,ih)[v]"
    )
    audio_filter = (
        f";[0:{selected.audio_index}]atrim=start={source_start:.6f}:end={source_end:.6f},"
        f"asetpts=PTS-{source_start:.6f}/TB,aresample=async=1:first_pts=0[a]"
        if selected.audio_index is not None else ""
    )
    def command_for(include_audio: bool) -> list[str]:
        return [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-xerror", "-copyts",
            *(["-ss", f"{source_start - selected.media_origin_seconds - 2.0:.3f}"]
              if start_ms > 2_000 else []),
            "-i", str(source),
            "-filter_complex", video_filter + (audio_filter if include_audio else ""),
            "-map", "[v]",
            *(["-map", "[a]", "-c:a", "aac", "-b:a", str(audio_rate)]
              if include_audio else ["-an"]),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-maxrate", str(rate), "-bufsize", str(rate * 2),
            "-threads", "2", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", "-t", f"{duration:.3f}", str(destination),
        ]

    deadline = time.monotonic() + 60
    def encode(include_audio: bool) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(command_for(include_audio), capture_output=True, text=True,
                                  timeout=max(0.001, deadline - time.monotonic()), check=False)
        except FileNotFoundError as error:
            raise RuntimeError("media-tool-missing") from error
        except subprocess.TimeoutExpired as error:
            raise RuntimeError("clip-timeout") from error

    include_audio = selected.audio_index is not None
    result = encode(include_audio)
    retried_video_only = False
    if result.returncode != 0 and include_audio:
        # Only a successful, complete visual retry permits an audio-omission
        # classification. An independent video failure still fails the clip.
        result = encode(False)
        retried_video_only = True
    if result.returncode != 0:
        raise RuntimeError("clip-write-failed")
    if not destination.is_file() or destination.stat().st_size <= 0:
        raise RuntimeError("clip-write-failed")
    if destination.stat().st_size > 50 * 1024 * 1024:
        raise RuntimeError("clip-size-limit")
    video_duration, output_has_audio = output_streams(destination)
    if video_duration < duration - 0.10:
        raise RuntimeError("clip-duration-short")
    if selected.audio_issue is not None:
        return ClipAudioResult("OMITTED_UNSUPPORTED", selected.audio_issue)
    if selected.audio_index is None:
        return ClipAudioResult("ABSENT", "SOURCE_AUDIO_ABSENT")
    if retried_video_only:
        return ClipAudioResult("OMITTED_DECODE_FAILED", "AV_ENCODE_FAILED_VIDEO_RETRY_SUCCEEDED")
    if not output_has_audio:
        return ClipAudioResult("OMITTED_DECODE_FAILED", "AUDIO_OUTPUT_EMPTY")
    return ClipAudioResult("PRESERVED")


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
    # 관찰된 사건은 전후 근거 클립을 보장하고 일반 후보만 남은 예산으로 제한한다
    clips = {item.index for item in candidate_list if item.scene_event is not None or item.broadcast_cue is not None
             or "LOCAL_OBSERVER_EVIDENCE_REQUIRED" in item.reasons}
    remaining = max(0, max_clips - len(clips))
    clips.update(item.index for item in sorted((item for item in candidate_list if item.index not in clips),
                                               key=lambda item: item.confidence, reverse=True)[:remaining])
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
            audio_result = clip(source_path, clip_destination, candidate.start_ms, candidate.end_ms)
            # 클립 결과 추가
            result.append(Evidence(candidate.index, "CLIP", clip_destination, candidate.anchor_ms,
                                   candidate.start_ms, candidate.end_ms,
                                   audio_status=audio_result.status if isinstance(audio_result, ClipAudioResult) else None,
                                   audio_reason=audio_result.reason if isinstance(audio_result, ClipAudioResult) else None))
    # 증거 결과 반환
    return tuple(result)
