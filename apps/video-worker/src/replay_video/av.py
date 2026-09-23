"""출처가 알려진 제한된 합성 신호의 영상·음향 증거 비교

실제 휘슬·발화·접촉·파울·심판 판정 인식 평가 제외
인코더와 독립된 원시 음향 디코딩 사용"""

# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 명령행 인자 읽기와 검증 도구 가져옴
import argparse
# 직렬화 자료 읽기와 기록 도구 가져옴
import json
# 거리 계산과 수치 유효성 확인 도구 가져옴
import math
# 해시 문자열의 형식 검사 도구 가져옴
import re
# 외부 미디어 명령 실행 도구 가져옴
import subprocess
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 다양한 보고서 값의 타입 표기 가져옴
from typing import Any
# 음향 배열과 에너지 계산 도구 가져옴
import numpy as np
# 고정 주파수 음향 단서 관측 함수 가져옴
from .infrastructure.audio import audioCues
# 음향 보존 증거 클립 생성 함수 가져옴
from .infrastructure.evidence import clip


# 독립 음향 디코딩의 초당 표본 수 설정
SAMPLE_RATE = 48_000
# 합성 평가 클립의 최대 길이를 60초로 제한
MAX_CLIP_MS = 60_000
# 합성 원본 파일의 최대 크기를 256메비바이트로 제한
MAX_SOURCE_BYTES = 256 * 1024 * 1024
# 독립 측정 시작 시각의 허용 오차 설정
ONSET_TOLERANCE_MS = 50
# 음향 단서 연결의 시작 시각 허용 오차 설정
CUE_TOLERANCE_MS = 100

# 미디어 명령을 제한 시간 안에 실행하고 실패 출력을 진단 오류로 변환
def process(command: list[str], *, timeout: int = 30) -> subprocess.CompletedProcess[bytes]:
    # 외부 미디어 명령의 제한 시간 실행 시도
    try:
        # 표준 출력과 오류를 모아 명령 실행
        result = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    # 실행 도구 부재 또는 제한 시간 초과 분기
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        # 미디어 도구 실행 실패 오류 전달
        raise RuntimeError("evaluation-media-tool-failed") from error
    # 명령 종료 코드의 실패 여부 확인
    if result.returncode:
        # 도구 오류 출력 일부를 포함한 실패 전달
        raise RuntimeError(
            f"evaluation-media-tool-failed: {result.stderr.decode(errors='replace')[:300]}"
        )
    # 명령의 종료 상태와 출력 반환
    return result

# 영상·음향 스트림 메타데이터 읽음
def mediaStreams(path: Path) -> list[dict[str, Any]]:
    # 미디어 스트림 메타데이터 조회 명령 실행
    result = process(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)])
    # 조회 결과의 직렬화 본문 해석 시도
    try:
        # 응답의 스트림 목록 읽음
        streams = json.loads(result.stdout)["streams"]
    # 본문 형식이나 필드 오류 분기
    except (ValueError, KeyError, TypeError) as error:
        # 스트림 조회 결과 형식 오류 전달
        raise RuntimeError("evaluation-probe-invalid") from error
    # 스트림 결과가 목록인지 확인
    if not isinstance(streams, list):
        # 잘못된 스트림 자료 타입 오류 전달
        raise RuntimeError("evaluation-probe-invalid")
    # 조회한 스트림 목록 반환
    return streams

# 파일에서 첫 실제 영상과 선택 가능한 음향 스트림을 선택
def tracks(path: Path) -> tuple[dict[str, Any], dict[str, Any] | None]:
    # 파일의 모든 스트림 메타데이터 읽음
    streams = mediaStreams(path)
    # 첨부 그림이 아닌 첫 실제 영상 스트림 선택
    video = next(
        (
            stream
            for stream in streams
            if stream.get("codec_type") == "video"
            and not stream.get("disposition", {}).get("attached_pic")
        ),
        None,
    )
    # 영상 스트림의 부재 확인
    if video is None:
        # 평가할 영상 스트림 부재 오류 전달
        raise RuntimeError("evaluation-video-absent")
    # 첫 음향 스트림 선택과 부재 시 빈 값 유지
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    # 영상 스트림과 선택적 음향 스트림 반환
    return video, audio

# 스트림의 원본 시작 시각을 확인하고 초 단위로 반환
def origin(stream: dict[str, Any]) -> float:
    # 스트림 시작 시각을 초 단위 실수로 변환
    value = float(stream["start_time"])
    # 시작 시각의 유한성 확인
    if not math.isfinite(value):
        # 유효하지 않은 시작 시각 오류 전달
        raise ValueError("evaluation-origin-invalid")
    # 유효한 스트림 시작 시각 반환
    return value

# 영상 스트림의 유효한 재생 길이를 밀리초로 계산
def duration(video: dict[str, Any]) -> float | None:
    # 메타데이터의 재생 길이 변환 시도
    try:
        # 초 단위 재생 길이를 밀리초로 변환
        measured = float(video["duration"]) * 1000
    # 누락되거나 수치가 아닌 길이 분기
    except (KeyError, TypeError, ValueError):
        # 길이를 확인하지 못한 빈 값 반환
        return None
    # 양의 유한한 재생 길이만 반환
    return measured if math.isfinite(measured) and measured > 0 else None

# 출력 영상에서 실제 프레임을 디코딩할 수 있는지 확인
def decodability(path: Path, video: dict[str, Any]) -> bool:
    # 첫 영상 프레임의 디코딩 시도
    try:
        # 첫 프레임을 가로 세로 두 픽셀의 원시 색상 자료로 디코딩
        decoded = process(
            [
                "ffmpeg",
                "-nostdin",
                "-v",
                "error",
                "-i",
                str(path),
                "-map",
                f"0:{int(video['index'])}",
                "-an",
                "-sn",
                "-dn",
                "-frames:v",
                "1",
                "-vf",
                "scale=2:2",
                "-pix_fmt",
                "rgb24",
                "-c:v",
                "rawvideo",
                "-f",
                "rawvideo",
                "pipe:1",
            ],
            timeout=10,
        ).stdout
    # 도구 실행 또는 영상 메타데이터 오류 분기
    except (RuntimeError, KeyError, TypeError, ValueError):
        # 디코딩 불가 결과 반환
        return False
    # 네 픽셀의 세 색상 채널 바이트 수 일치 확인
    return len(decoded) == 12

# 영상 전체를 디코딩해 프레임 수와 시간 범위를 검사
def decoding(path: Path, video: dict[str, Any], duration_ms: float) -> tuple[int, float] | None:
    """헤더뿐 아니라 모든 출력 프레임 디코딩과 실제 종료 확인"""
    # 전체 영상 디코딩과 종료 범위 확인 시도
    try:
        # 모든 영상 프레임을 디코딩하고 진행 기록 읽음
        progress = process(
            [
                "ffmpeg",
                "-nostdin",
                "-xerror",
                "-v",
                "error",
                "-i",
                str(path),
                "-map",
                f"0:{int(video['index'])}",
                "-an",
                "-sn",
                "-dn",
                "-f",
                "null",
                "-",
                "-progress",
                "pipe:1",
            ],
            timeout=90,
        ).stdout.decode("ascii", errors="replace")
        # 정상 종료 진행 표식의 존재 확인
        if "progress=end" not in progress:
            # 전체 디코딩 종료 미확인 결과 반환
            return None
        # 진행 기록의 키와 값 사전 생성
        fields = dict(line.split("=", 1) for line in progress.splitlines() if "=" in line)
        # 실제 디코딩 프레임 수 읽음
        frames = int(fields["frame"])
        # 디코딩 종료 시각을 마이크로초에서 밀리초로 변환
        decoded_end_ms = int(fields["out_time_us"]) / 1000
    # 도구 실패나 진행 필드 오류 분기
    except (RuntimeError, KeyError, TypeError, ValueError):
        # 디코딩 범위 미확인 결과 반환
        return None
    # 프레임 존재와 유한한 종료 시각 및 길이 부족 확인
    if frames <= 0 or not math.isfinite(decoded_end_ms) or decoded_end_ms < duration_ms - 100:
        # 영상 범위를 충족하지 못한 결과 반환
        return None
    # 검증한 프레임 수와 디코딩 종료 시각 반환
    return frames, decoded_end_ms

# 독립 원시 음향 디코딩으로 음향 시작 시각을 측정
def onset(path: Path, video: dict[str, Any], audio: dict[str, Any] | None) -> int | None:
    # 음향 스트림의 부재 확인
    if audio is None:
        # 음향 시작 시각 없음 반환
        return None
    # 음향 채널 수 읽음
    channels = int(audio["channels"])
    # 지원하는 한 개부터 여덟 개의 채널 범위 확인
    if not 1 <= channels <= 8:
        # 지원하지 않는 채널 수 오류 전달
        raise ValueError("evaluation-channel-count-unsupported")
    # 운영 재표본화·시각 필터와 독립된 디코더 사용
    # 제한된 합성 입력만 디코딩하고 채널별 에너지 유지
    decoded = process(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(path),
            "-map",
            f"0:{int(audio['index'])}",
            "-vn",
            "-sn",
            "-dn",
            "-t",
            f"{MAX_CLIP_MS / 1000:.3f}",
            "-ar",
            str(SAMPLE_RATE),
            "-c:a",
            "pcm_f32le",
            "-f",
            "f32le",
            "pipe:1",
        ],
        timeout=30,
    ).stdout
    # 디코딩 바이트가 길이와 채널 기준 상한을 넘는지 확인
    if len(decoded) > MAX_CLIP_MS * SAMPLE_RATE // 1000 * channels * 4:
        # 과다 원시 음향 자료 오류 전달
        raise ValueError("evaluation-pcm-limit")
    # 바이트를 리틀 엔디언 32비트 실수 표본으로 읽음
    samples = np.frombuffer(decoded, dtype="<f4")
    # 표본 수의 채널별 균등 배치 가능 여부 확인
    if samples.size % channels:
        # 불완전한 채널 표본 오류 전달
        raise RuntimeError("evaluation-pcm-invalid")
    # 표본을 시간과 채널의 이차원 배열로 구성
    samples = samples.reshape(-1, channels)
    # 에너지 측정 창을 20밀리초 표본 수로 설정
    window = SAMPLE_RATE // 50
    # 완전한 음향 창을 시간 순서대로 순회
    for start in range(0, len(samples) - window + 1, window):
        # 채널을 유지한 음향 제곱평균제곱근 에너지 계산
        level = float(np.sqrt(np.mean(np.square(samples[start:start + window].astype(np.float64)))))
        # 소리 시작으로 볼 최소 에너지 초과 확인
        if level > 0.025:
            # 첫 유효 음향 창의 상대 밀리초 시각 계산
            relative_ms = start * 1000 // SAMPLE_RATE
            # 영상과 음향 스트림 시작 시각 차이 계산
            offset_ms = round((origin(audio) - origin(video)) * 1000)
            # 영상 원점에 정렬한 음향 시작 시각 반환
            return offset_ms + relative_ms
    # 에너지 기준을 넘는 소리 시작 없음 반환
    return None

# 합성 시험 자료 구성
def fixture(
    path: Path,
    *,
    video_origin: float,
    audio_origin: float | None,
    pulse_local: float | None,
    kind: str,
    duration: float = 1.5,
) -> None:
    """합성 정답 생성과 원본 미디어·라벨 추론 제외"""
    # 기존 파일 존재와 합성 길이 허용 범위 확인
    if path.exists() or duration <= 0 or duration > MAX_CLIP_MS / 1000:
        # 유효하지 않은 합성 출력 또는 길이 오류 전달
        raise ValueError("evaluation-fixture-target-invalid")
    # 지정한 시작 시각의 검은 합성 영상 입력 인자 생성
    video_args = [
        "-itsoffset",
        str(video_origin),
        "-f",
        "lavfi",
        "-i",
        f"color=c=black:s=64x64:r=20:d={duration}",
    ]
    # 음향 없는 시험 사례 여부 확인
    if kind == "no_audio":
        # 음향 스트림 없이 무손실 합성 영상 생성
        process(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-n",
                *video_args,
                "-an",
                "-c:v",
                "ffv1",
                str(path),
            ]
        )
        # 음향 없는 사례 생성 종료
        return
    # 음향 시작 시각의 누락 확인
    if audio_origin is None:
        # 음향 시작 시각 필수 입력 오류 전달
        raise ValueError("evaluation-audio-origin-required")
    # 무음 스트림 시험 사례 여부 확인
    if kind == "silent":
        # 표본값 영의 무음 신호식 설정
        expression = "0"
    # 소리가 있는 펄스 합성 사례 분기
    else:
        # 400밀리초 음향 펄스의 시작과 길이 범위 확인
        if pulse_local is None or not 0 <= pulse_local <= duration - 0.4:
            # 유효하지 않은 합성 펄스 시각 오류 전달
            raise ValueError("evaluation-pulse-invalid")
        # 다중 주파수 또는 역상 채널 사례 여부 확인
        if kind in ("multitone", "antiphase"):
            # 두 고주파 정현파를 합친 합성 음향식 생성
            signal = "0.15*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
        # 단일 대역 주파수 시험 사례 여부 확인
        elif kind == "single_band":
            # 하나의 고주파 정현파 음향식 생성
            signal = "0.25*sin(2*PI*4000*t)"
        # 검사 대역 밖 주파수 시험 사례 여부 확인
        elif kind == "outside_band":
            # 대역 밖 정현파 음향식 생성
            signal = "0.25*sin(2*PI*2000*t)"
        # 정의되지 않은 합성 신호 종류 분기
        else:
            # 지원하지 않는 합성 음향 종류 오류 전달
            raise ValueError("evaluation-fixture-kind-invalid")
        # 지정 구간에만 400밀리초 펄스를 내는 음향식 구성
        expression = f"({signal})*between(t\\,{pulse_local}\\,{pulse_local + 0.4})"
        # 좌우 채널 역상 시험 사례 여부 확인
        if kind == "antiphase":
            # 같은 신호와 부호 반대 신호의 두 채널 구성
            expression = f"{expression}|-({expression})"
    # 시간차를 가진 합성 영상과 음향을 파일로 생성
    process(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            *video_args,
            "-itsoffset",
            str(audio_origin),
            "-f",
            "lavfi",
            "-i",
            f"aevalsrc={expression}:s={SAMPLE_RATE}:d={duration}",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "ffv1",
            "-c:a",
            "pcm_s16le",
            str(path),
        ]
    )

# 비교 기준으로 사용할 무음 영상 클립을 생성
def baselineClip(source: Path, destination: Path, start_ms: int, end_ms: int) -> None:
    """음향 제거 옵션을 명시한 변경 전 고정 증거 클립 생성식"""
    # 비교 기준 클립 길이를 초 단위로 계산
    duration = max(0.2, (end_ms - start_ms) / 1000)
    # 파일 크기 목표와 상한을 고려한 비트율 계산
    rate = min(6_000_000, int(45 * 1024 * 1024 * 8 / (duration + 2)))
    # 기준 클립 출력 파일의 기존 존재 확인
    if destination.exists():
        # 기존 기준 클립 덮어쓰기 오류 전달
        raise FileExistsError(destination)
    # 변경 전 방식의 음향 제거 비교 기준 클립 생성
    process(
        [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
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
            "veryfast",
            "-crf",
            "23",
            "-maxrate",
            str(rate),
            "-bufsize",
            str(rate * 2),
            "-threads",
            "2",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            str(destination),
        ],
        timeout=60,
    )

# 클립 음향 차이 비교
def audioComparison(
    source: Path,
    baseline: Path,
    av: Path,
    start_ms: int,
    end_ms: int,
    *,
    expected_onset_ms: int | None,
) -> dict[str, Any]:
    """60초 이하 합성 원본·클립의 정답과 원시 음향 비교"""
    # 평가 시작과 종료 순서 및 최대 60초 범위 확인
    if not 0 <= start_ms < end_ms or end_ms - start_ms > MAX_CLIP_MS:
        # 허용 범위 밖 평가 시간 구간 오류 전달
        raise ValueError("evaluation-window-limit")
    # 원본 바이트 크기 상한 확인
    if source.stat().st_size > MAX_SOURCE_BYTES:
        # 과다 원본 크기 오류 전달
        raise ValueError("evaluation-source-size-limit")
    # 요청한 클립의 기대 밀리초 길이 계산
    expected_duration_ms = end_ms - start_ms
    # 원본 음향 스트림 초기화
    source_audio = None
    # 원본 영상 검증 상태 초기화
    source_valid_video = False
    # 원본 스트림과 독립 음향 시작 측정 시도
    try:
        # 원본의 영상과 음향 스트림 읽음
        source_video, source_audio = tracks(source)
        # 원본 영상의 실제 디코딩 가능 여부 확인
        source_valid_video = decodability(source, source_video)
        # 유효한 원본 영상에 한해 음향 시작 시각 측정
        source_onset = onset(source, source_video, source_audio) if source_valid_video else None
    # 원본 파일과 디코딩 오류 분기
    except (OSError, RuntimeError, ValueError):
        # 실패한 원본 음향 시작 시각을 미확인으로 유지
        source_onset = None
        # 원본 영상 검증 실패 기록
        source_valid_video = False
    # 비교 기준 영상 검증 상태 초기화
    baseline_valid_video = False
    # 비교 기준 영상 길이 초기화
    baseline_duration_ms = None
    # 비교 기준 전체 디코딩 결과 초기화
    baseline_decoded = None
    # 비교 기준 클립의 스트림과 디코딩 검사 시도
    try:
        # 비교 기준 영상과 음향 스트림 읽음
        baseline_video, baseline_audio = tracks(baseline)
        # 비교 기준 영상 길이 읽음
        baseline_duration_ms = duration(baseline_video)
        # 유효한 길이가 있을 때 기준 클립 전체 디코딩 확인
        baseline_decoded = (
            decoding(baseline, baseline_video, baseline_duration_ms)
            if baseline_duration_ms is not None
            else None
        )
        # 기준 클립 전체 디코딩 성공 여부 저장
        baseline_valid_video = baseline_decoded is not None
        # 영상 검증 성공 때만 기준 음향 존재 여부 저장
        baseline_has_audio: bool | None = (
            baseline_audio is not None if baseline_valid_video else None
        )
    # 기준 클립 읽기 또는 디코딩 오류 분기
    except (OSError, RuntimeError, ValueError):
        # 기준 음향 존재를 부재가 아닌 미확인으로 유지
        baseline_has_audio = None
    # 음향 보존 클립의 영상 검증 상태 초기화
    av_valid_video = False
    # 음향 보존 클립의 길이 초기화
    av_duration_ms = None
    # 음향 보존 클립의 전체 디코딩 결과 초기화
    av_decoded = None
    # 음향 보존 클립의 요청 길이 충족 상태 초기화
    av_duration_pass = False
    # 음향 보존 클립의 길이와 스트림 및 디코딩 검사 시도
    try:
        # 음향 보존 클립의 영상과 음향 스트림 읽음
        av_video, av_audio = tracks(av)
        # 음향 보존 클립의 재생 길이 읽음
        av_duration_ms = duration(av_video)
        # 기대 길이와 실제 길이의 100밀리초 이내 일치 확인
        av_duration_pass = (
            av_duration_ms is not None and abs(av_duration_ms - expected_duration_ms) <= 100
        )
        # 유효한 길이의 음향 보존 클립 전체 디코딩 확인
        av_decoded = decoding(av, av_video, av_duration_ms) if av_duration_ms is not None else None
        # 길이 일치와 전체 디코딩 성공을 함께 확인
        av_valid_video = av_duration_pass and av_decoded is not None
        # 유효한 영상에서만 음향 존재 여부 기록
        av_has_audio: bool | None = av_audio is not None if av_valid_video else None
        # 유효한 영상에서 음향 시작 시각 독립 측정
        output_onset = onset(av, av_video, av_audio) if av_valid_video else None
    # 음향 보존 클립의 읽기와 디코딩 오류 분기
    except (OSError, RuntimeError, ValueError):
        # 출력 영상 검증 실패 기록
        av_valid_video = False
        # 출력 음향 존재 여부를 미확인으로 유지
        av_has_audio = None
        # 출력 음향 시작 시각을 미확인으로 유지
        output_onset = None
    # 원본 정답 시작 시각을 클립 상대 시각으로 변환
    expected_relative = expected_onset_ms - start_ms if expected_onset_ms is not None else None
    # 출력 음향 시작 시각과 정답의 차이 계산
    onset_error = (
        output_onset - expected_relative
        if output_onset is not None and expected_relative is not None
        else None
    )
    # 원본 음향 시작 측정과 정답의 차이 계산
    source_error = (
        source_onset - expected_onset_ms
        if source_onset is not None and expected_onset_ms is not None
        else None
    )
    # 원본과 출력의 정답 오차 및 상호 시간 정렬 허용 범위 확인
    alignment_pass = (
        onset_error is not None
        and source_error is not None
        and abs(onset_error) <= ONSET_TOLERANCE_MS
        and abs(source_error) <= ONSET_TOLERANCE_MS
        and abs((output_onset + start_ms) - source_onset) <= ONSET_TOLERANCE_MS
    )
    # 합성 신호의 보존과 시간 정렬 비교 결과 반환
    return {
        # 원본 영상 디코딩 가능 여부 기록
        "sourceValidVideo": source_valid_video,
        # 기준 영상 전체 디코딩 검증 여부 기록
        "baselineValidVideo": baseline_valid_video,
        # 음향 보존 영상의 길이와 디코딩 검증 기록
        "avValidVideo": av_valid_video,
        # 요청한 클립의 기대 길이 기록
        "expectedClipDurationMs": expected_duration_ms,
        # 기준 클립의 측정 길이 기록
        "baselineDurationMs": baseline_duration_ms,
        # 음향 보존 클립의 측정 길이 기록
        "avDurationMs": av_duration_ms,
        # 기준 클립 길이의 기대값 일치 여부 기록
        "baselineDurationPass": (
            baseline_duration_ms is not None
            and abs(baseline_duration_ms - expected_duration_ms) <= 100
        ),
        # 음향 보존 클립의 기대 길이 일치 기록
        "avDurationPass": av_duration_pass,
        # 기준 클립 전체 디코딩 검증 기록
        "baselineDecodedCoveragePass": baseline_decoded is not None,
        # 음향 보존 클립 전체 디코딩 검증 기록
        "avDecodedCoveragePass": av_decoded is not None,
        # 기준 클립의 실제 디코딩 프레임 수 기록
        "baselineDecodedFrameCount": baseline_decoded[0] if baseline_decoded else None,
        # 음향 보존 클립의 실제 디코딩 프레임 수 기록
        "avDecodedFrameCount": av_decoded[0] if av_decoded else None,
        # 기준 클립의 디코딩 종료 시각 기록
        "baselineDecodedEndMs": baseline_decoded[1] if baseline_decoded else None,
        # 음향 보존 클립의 디코딩 종료 시각 기록
        "avDecodedEndMs": av_decoded[1] if av_decoded else None,
        # 검증된 기준 영상의 음향 존재 여부 기록
        "baselineHasAudio": baseline_has_audio,
        # 검증된 음향 보존 영상의 음향 존재 여부 기록
        "avHasAudio": av_has_audio,
        # 유효한 원본과 출력 양쪽에 음향이 남았는지 기록
        "audioRetained": source_valid_video
        and source_audio is not None
        and av_valid_video
        and av_has_audio is True,
        # 원본에서 독립 측정한 음향 시작 시각 기록
        "sourceDecodedOnsetMs": source_onset,
        # 출력에서 독립 측정한 음향 시작 시각 기록
        "avDecodedOnsetMs": output_onset,
        # 합성 생성식으로 알려진 음향 시작 정답 기록
        "expectedOnsetMs": expected_onset_ms,
        # 원본 시작 측정의 정답 대비 오차 기록
        "sourceOnsetErrorMs": source_error,
        # 출력 시작 측정의 클립 정답 대비 오차 기록
        "onsetErrorMs": onset_error,
        # 음향 시작 시각의 허용 오차 기록
        "alignmentToleranceMs": ONSET_TOLERANCE_MS,
        # 원본과 클립의 음향 시간 정렬 통과 여부 기록
        "alignmentPass": alignment_pass,
    }

# 예상 음향 구간과 측정 구간의 일치도를 계산
def cueScores(expected: list[tuple[int, int]], predicted: list[tuple[int, int]]) -> dict[str, Any]:
    """시작 차이 100밀리초 이하와 유효 중첩률을 요구하는 일대일 연결"""
    # 정답 구간과 예측 구간의 연결 목록 생성
    matches: list[tuple[int, int, int]] = []
    # 중복 연결을 막을 예측 번호 집합 생성
    used: set[int] = set()
    # 알려진 정답 음향 구간 순회
    for expected_start, expected_end in expected:
        # 현재 정답과 연결 가능한 예측 목록 생성
        eligible = []
        # 예측 음향 구간별 비교 순회
        for index, (start, end) in enumerate(predicted):
            # 정답과 예측이 겹치는 시간 길이 계산
            intersection = max(0, min(end, expected_end) - max(start, expected_start))
            # 정답과 예측을 덮는 전체 시간 길이 계산
            union = max(end, expected_end) - min(start, expected_start)
            # 전체 길이 대비 교집합 길이 비율 계산
            iou = intersection / union if union > 0 else 0
            # 미사용 예측과 시작 허용 오차 및 최소 겹침 비율 확인
            if (
                index not in used
                and abs(start - expected_start) <= CUE_TOLERANCE_MS
                and iou >= 0.25
            ):
                # 시작 오차와 예측 번호를 연결 후보로 저장
                eligible.append((abs(start - expected_start), index, start - expected_start))
        # 연결 가능한 예측 존재 확인
        if eligible:
            # 시작 오차가 가장 작은 예측 선택
            _, index, error = min(eligible)
            # 선택한 예측을 사용한 번호로 기록
            used.add(index)
            # 정답 시작 시각과 예측 번호 및 부호 있는 오차 기록
            matches.append((expected_start, index, error))
    # 일대일 적중 수와 남은 오탐 및 누락 수 계산
    tp, fp, fn = len(matches), len(predicted) - len(matches), len(expected) - len(matches)
    # 합성 음향 구간의 연결 평가 지표 반환
    return {
        # 정답과 연결된 음향 단서 수 기록
        "truePositive": tp,
        # 정답과 연결되지 않은 예측 단서 수 기록
        "falsePositive": fp,
        # 예측과 연결되지 않은 정답 단서 수 기록
        "falseNegative": fn,
        # 전체 예측 중 정답 적중 비율 기록
        "precision": tp / (tp + fp) if tp + fp else None,
        # 전체 정답 중 예측 적중 비율 기록
        "recall": tp / (tp + fn) if tp + fn else None,
        # 연결된 단서의 평균 절대 시작 오차 기록
        "meanAbsoluteOnsetErrorMs": sum(abs(error) for _, _, error in matches) / tp if tp else None,
        # 단서 연결의 시작 시각 허용 오차 기록
        "onsetToleranceMs": CUE_TOLERANCE_MS,
        # 단서 연결의 최소 시간 겹침 비율 기록
        "minimumIoU": 0.25,
    }

# 시각 보고서 차이 비교
def visualComparison(
    baseline: dict[str, Any], av: dict[str, Any], *, baseline_reused: bool = False
) -> dict[str, Any]:
    """음향·경로·버전 필드만 제외한 시각 자료의 정확한 일치 확인"""

    # 시각 비교에 필요한 보고서 구조가 갖춰졌는지 확인
    def validReport(report: Any) -> bool:
        # 비교 보고서가 객체인지 확인
        if not isinstance(report, dict):
            # 객체가 아닌 보고서의 검증 실패 반환
            return False
        # 보고서의 영상 메타데이터 읽음
        video = report.get("video")
        # 보고서의 인식 관측 자료 읽음
        perception = report.get("perception")
        # 영상과 인식 자료의 객체 형태 확인
        if not isinstance(video, dict) or not isinstance(perception, dict):
            # 필수 자료 구조 누락의 검증 실패 반환
            return False
        # 양의 유한한 수여야 하는 영상 필드 목록 생성
        positive = ("duration_ms", "width", "height", "fps", "frame_count")
        # 영상 수치와 코덱 및 원본 이름의 필수 형식 확인
        if (
            any(
                type(video.get(key)) not in (int, float)
                or not math.isfinite(video[key])
                or video[key] <= 0
                for key in positive
            )
            or not isinstance(video.get("codec"), str)
            or not video["codec"]
            or not isinstance(video.get("source_name"), str)
            or not video["source_name"]
        ):
            # 잘못된 영상 메타데이터의 검증 실패 반환
            return False
        # 여러 계약 위치에 기록된 원본 해시 수집
        source_hashes = [
            value
            for value in (
                report.get("sourceSha256"),
                report.get("source_sha256"),
                perception.get("sourceSha256"),
            )
            if value is not None
        ]
        # 해시 존재와 형식 및 중복 위치 간 일치 확인
        if (
            not source_hashes
            or any(
                not isinstance(value, str) or re.fullmatch(r"[0-9a-fA-F]{64}", value) is None
                for value in source_hashes
            )
            or len(set(source_hashes)) != 1
        ):
            # 원본 식별이 불가능한 보고서의 검증 실패 반환
            return False
        # 샷과 후보 및 증거가 객체 목록인지 확인
        if any(
            not isinstance(report.get(key), list)
            or any(not isinstance(item, dict) for item in report[key])
            for key in ("shots", "candidates", "evidence")
        ):
            # 잘못된 시각 자료 목록의 검증 실패 반환
            return False
        # 인식 사건이 객체 목록인지 확인
        if not isinstance(perception.get("incidents"), list) or any(
            not isinstance(item, dict) for item in perception["incidents"]
        ):
            # 잘못된 사건 목록의 검증 실패 반환
            return False
        # 인식 처리 범위와 관측 요약 읽음
        coverage, summary = perception.get("coverage"), perception.get("summary")
        # 처리 범위와 요약이 객체인지 확인
        if not isinstance(coverage, dict) or not isinstance(summary, dict):
            # 필수 처리 요약 부재의 검증 실패 반환
            return False
        # 정수로 요구하는 처리 범위 필드 목록 생성
        coverage_fields = (
            "startMs",
            "endMs",
            "sampleIntervalMs",
            "expectedSamples",
            "processedSamples",
            "failedSamples",
        )
        # 처리 범위 필드의 정확한 정수 타입 확인
        if any(type(coverage.get(key)) is not int for key in coverage_fields):
            # 잘못된 처리 범위 타입의 검증 실패 반환
            return False
        # 시각 범위와 표본 간격 및 처리 수량의 일관성 확인
        if (
            coverage["startMs"] < 0
            or coverage["endMs"] <= coverage["startMs"]
            or coverage["sampleIntervalMs"] <= 0
            or coverage["expectedSamples"] <= 0
            or not 0 <= coverage["processedSamples"] <= coverage["expectedSamples"]
            or coverage["failedSamples"]
            != coverage["expectedSamples"] - coverage["processedSamples"]
        ):
            # 모순된 처리 범위의 검증 실패 반환
            return False
        # 음수가 아니어야 하는 관측 개수 필드 목록 생성
        summary_fields = (
            "roleObservationCount",
            "poseObservationCount",
            "officialCueCount",
            "interactionCount",
            "linkCount",
        )
        # 관측 개수의 정수 타입과 비음수 범위 확인
        if any(type(summary.get(key)) is not int or summary[key] < 0 for key in summary_fields):
            # 잘못된 관측 개수의 검증 실패 반환
            return False
        # 완료 또는 부분 완료의 허용 처리 상태 여부 반환
        return perception.get("processingStatus") in ("COMPLETE", "PARTIAL")

    # 보고서에서 비교 대상 원본의 해시를 추출
    def sourceHash(report: dict[str, Any]) -> Any:
        # 보고서의 인식 객체 읽음
        perception = report.get("perception")
        # 인식 객체 안의 원본 해시 선택
        nested = perception.get("sourceSha256") if isinstance(perception, dict) else None
        # 지원하는 최상위 또는 중첩 원본 해시 반환
        return report.get("sourceSha256") or report.get("source_sha256") or nested
    # 기준과 음향 결합 보고서의 구조 각각 검증
    baseline_valid, av_valid = validReport(baseline), validReport(av)
    # 검증을 통과한 양쪽 보고서의 원본 해시 추출
    hashes = (
        sourceHash(baseline) if baseline_valid else None,
        sourceHash(av) if av_valid else None,
    )
    # 유효한 보고서끼리 동일 원본을 비교하는지 확인
    comparable = (
        baseline_valid
        and av_valid
        and isinstance(hashes[0], str)
        and re.fullmatch(r"[0-9a-fA-F]{64}", hashes[0]) is not None
        and hashes[0] == hashes[1]
    )
    # 유효한 기준 인식 자료 또는 빈 객체 선택
    baseline_perception = baseline.get("perception", {}) if baseline_valid else {}
    # 유효한 음향 결합 인식 자료 또는 빈 객체 선택
    av_perception = av.get("perception", {}) if av_valid else {}
    # 두 보고서의 인식 처리 상태 변경 여부 확인
    status_changed = baseline_perception.get("processingStatus") != av_perception.get(
        "processingStatus"
    )
    # 음향 결합 보고서의 음향 관측 자료 읽음
    av_audio = av_perception.get("audio")
    # 시각 범위는 같고 음향 실패만으로 부분 완료가 됐는지 확인
    audio_only_status = bool(
        comparable
        and status_changed
        and baseline_perception.get("processingStatus") == "COMPLETE"
        and av_perception.get("processingStatus") == "PARTIAL"
        and isinstance(av_audio, dict)
        and av_audio.get("status") in ("FAILED", "UNSUPPORTED")
        and baseline_perception.get("coverage") == av_perception.get("coverage")
    )
    # 시각 비교에서 제외할 최상위 음향과 경로 및 판본 필드 설정
    root_ignored = {
        "audioObservations",
        "audio_observations",
        "reportVersion",
        "artifactRoot",
        "artifact_root",
        "schema_version",
        "pipeline_version",
        "version",
    }
    # 시각 비교에서 제외할 증거 경로와 음향 상태 필드 설정
    evidence_ignored = {
        "path",
        "artifactPath",
        "artifact_path",
        "audioStatus",
        "audioReason",
        "audio_status",
        "audio_reason",
    }
    # 시각 비교에서 제외할 인식 음향과 실행 메타데이터 필드 설정
    perception_ignored = {
        "audio",
        "schemaVersion",
        "pipelineVersion",
        "processingStatus",
        "artifact",
    }
    # 시각 비교에서 제외할 음향 전용 한계 항목 설정
    audio_limitations = {
        "speech_not_analyzed",
        "audio_cue_method_unverified",
        "audiovisual_association_temporal_only",
        "audio_evidence_incomplete",
    }

    # 음향 차이를 제외하고 시각 보고서의 비교 대상 필드를 정규화
    def visual(value: Any, location: tuple[str, ...] = ()) -> Any:
        # 현재 비교값이 객체인지 확인
        if isinstance(value, dict):
            # 객체 위치에 따라 제외할 필드 집합 선택
            ignored = (
                root_ignored
                if not location
                else (
                    evidence_ignored
                    if location[:1] == ("evidence",)
                    else perception_ignored if location == ("perception",) else set()
                )
            )
            # 제외 필드를 뺀 자식 값을 재귀 정규화하여 반환
            return {
                key: visual(item, location + (key,))
                for key, item in value.items()
                if key not in ignored
            }
        # 현재 비교값이 목록인지 확인
        if isinstance(value, list):
            # 정규화할 원래 목록 보존
            values = value
            # 최상위 한계 목록인지 확인
            if location == ("limitations",):
                # 음향 전용 한계만 제외한 목록 생성
                values = [item for item in value if item not in audio_limitations]
            # 인식 요약의 사유 목록인지 확인
            elif location == ("perception", "summary", "reasons"):
                # 음향 전용 접두어 사유만 제외한 목록 생성
                values = [
                    item
                    for item in value
                    if not (isinstance(item, str) and item.startswith("AUDIO_"))
                ]
            # 각 목록 항목의 시각 비교값을 재귀 정규화하여 반환
            return [visual(item, location + ("[]",)) for item in values]
        # 객체와 목록이 아닌 원래 값 반환
        return value
    # 기준 보고서에서 시각 비교 자료 추출
    baseline_visual = visual(baseline) if isinstance(baseline, dict) else {}
    # 음향 결합 보고서에서 시각 비교 자료 추출
    av_visual = visual(av) if isinstance(av, dict) else {}
    # 두 보고서에서 값이 다른 최상위 항목 이름 정렬
    changed = sorted(
        key
        for key in baseline_visual.keys() | av_visual.keys()
        if baseline_visual.get(key) != av_visual.get(key)
    )
    # 음향 실패만으로 설명되지 않는 인식 상태 변경 확인
    if status_changed and not audio_only_status and "perception" not in changed:
        # 다른 값이 같더라도 인식 상태 변경 항목 보존
        changed.append("perception")
    # 원본 비교 가능성과 시각 자료 변화 결과 반환
    return {
        # 같은 원본의 유효한 보고서 비교 가능 여부 기록
        "comparable": comparable,
        # 비교 가능하고 변경 항목이 없을 때만 완전 동일 기록
        "exactVisualUnchanged": comparable and not changed,
        # 달라진 시각 자료 영역 목록 기록
        "changedVisualSections": changed,
        # 음향만으로 발생한 처리 상태 차이 여부 기록
        "audioOnlyProcessingStatusDifference": audio_only_status,
        # 음향 실패에 따른 부분 완료의 설명 기록
        "processingStatusNote": (
            "AV_PARTIAL_FROM_AUDIO_FAILED_OR_UNSUPPORTED_VISUAL_COVERAGE_UNCHANGED"
            if audio_only_status
            else None
        ),
        # 비교 기준 보고서 재사용 여부 기록
        "baselineReused": baseline_reused,
        # 독립 시각 정답 없는 인식 정확도 향상 측정 불가 명시
        "accuracyImprovement": "NOT_MEASURABLE_WITHOUT_INDEPENDENT_VISUAL_GROUND_TRUTH",
    }

# 새 비교 폴더의 합성 영상 생성과 음향 보존·시간 정렬 평가
def synthetic(output: Path) -> dict[str, Any]:
    """배타적이고 영구 보존되는 합성 비교 디렉터리 생성"""
    # 합성 시험 출력 폴더의 절대 경로 계산
    output = Path(output).resolve()
    # 기존 폴더를 재사용하지 않는 새 시험 폴더 생성
    output.mkdir(parents=True, exist_ok=False)
    # 시작 시각 차이와 무음 및 역상 등의 고정 시험 사례 생성
    cases = [
        ("positive_offset", 0.0, 0.3, 0.1, "multitone", 0, 1000, 400),
        ("negative_offset", 0.0, -0.2, 0.4, "multitone", 0, 1000, 200),
        ("nonzero_origin", 5.0, 5.3, 0.1, "multitone", 0, 1000, 400),
        ("middle_window", 5.0, 5.3, 0.8, "multitone", 500, 1400, 1100),
        ("stereo_antiphase", 0.0, 0.0, 0.2, "antiphase", 0, 1000, 200),
        ("silent_tracked", 0.0, 0.0, None, "silent", 0, 1000, None),
        ("no_audio", 0.0, None, None, "no_audio", 0, 1000, None),
        ("single_band", 0.0, 0.0, 0.2, "single_band", 0, 1000, 200),
        ("outside_band", 0.0, 0.0, 0.2, "outside_band", 0, 1000, 200),
    ]
    # 사례별 평가 결과 목록 생성
    results = []
    # 각 사례의 시간차와 음향 종류 및 평가 구간 순회
    for (
        name,
        video_origin,
        audio_origin,
        pulse_local,
        kind,
        start_ms,
        end_ms,
        expected_onset,
    ) in cases:
        # 개별 사례의 출력 폴더 경로 생성
        directory = output / name
        # 개별 사례 폴더 생성
        directory.mkdir()
        # 원본과 무음 기준 및 음향 보존 클립 경로 생성
        source, baseline, av = (
            directory / name for name in ("source.mkv", "baseline.mp4", "av.mp4")
        )
        # 정답 시각이 알려진 합성 원본 생성
        fixture(
            source,
            video_origin=video_origin,
            audio_origin=audio_origin,
            pulse_local=pulse_local,
            kind=kind,
        )
        # 변경 전 방식의 무음 기준 클립 생성
        baselineClip(source, baseline, start_ms, end_ms)
        # 운영 증거 생성 함수를 사용한 음향 보존 클립 생성
        audio_result = clip(source, av, start_ms, end_ms)
        # 두 클립의 음향 보존과 독립 시간 정렬 비교
        audio_metrics = audioComparison(
            source, baseline, av, start_ms, end_ms, expected_onset_ms=expected_onset
        )
        # 다중 주파수와 역상 사례에만 기대 단서 구간 설정
        expected_cues = (
            [(expected_onset, expected_onset + 400)] if kind in ("multitone", "antiphase") else []
        )
        # 합성 원본의 고정 신호 음향 단서 분석
        scan = audioCues(source, duration_ms=1500)
        # 관측 음향 단서를 시간 구간 목록으로 변환
        predicted = [(cue.start_ms, cue.end_ms) for cue in scan.cues]
        # 기대 단서와 관측 단서의 일대일 일치도 계산
        cue_metrics = cueScores(expected_cues, predicted)
        # 사례별 음향 보존과 단서 검출 결과 추가
        results.append(
            {
                # 합성 시험 사례 이름 기록
                "name": name,
                # 생성한 합성 음향 종류 기록
                "kind": kind,
                # 합성 영상 시작 시각 기록
                "videoOriginSeconds": video_origin,
                # 합성 음향 시작 시각 기록
                "audioOriginSeconds": audio_origin,
                # 클립으로 추출한 원본 시간 범위 기록
                "windowMs": [start_ms, end_ms],
                # 생성식에서 알려진 정답 음향 구간 기록
                "expectedCueIntervalsMs": [list(item) for item in expected_cues],
                # 분석기가 관측한 음향 구간 기록
                "observedCueIntervalsMs": [list(item) for item in predicted],
                # 원본 음향 분석의 완료 상태 기록
                "audioScanStatus": scan.status.value,
                # 원본 음향 분석 상태의 사유 기록
                "audioScanReason": scan.reason,
                # 클립의 음향 보존 상태 기록
                "clipAudioStatus": audio_result.status,
                # 클립의 음향 보존 상태 사유 기록
                "clipAudioReason": audio_result.reason,
                # 클립 보존과 시간 정렬 비교 지표 기록
                "clipAudioMetrics": audio_metrics,
                # 정답 대비 음향 구간 검출 지표 기록
                "cueMetrics": cue_metrics,
            }
        )
    # 모든 사례의 적중 단서 수 합산
    tp = sum(case["cueMetrics"]["truePositive"] for case in results)
    # 모든 사례의 오탐 단서 수 합산
    fp = sum(case["cueMetrics"]["falsePositive"] for case in results)
    # 모든 사례의 누락 단서 수 합산
    fn = sum(case["cueMetrics"]["falseNegative"] for case in results)
    # 평균 시작 오차의 가중치로 적중 수 합산
    onset_weight = sum(case["cueMetrics"]["truePositive"] for case in results)
    # 사례별 평균 시작 오차에 적중 수를 곱해 합산
    onset_error_sum = sum(
        case["cueMetrics"]["meanAbsoluteOnsetErrorMs"] * case["cueMetrics"]["truePositive"]
        for case in results
        if case["cueMetrics"]["truePositive"]
    )
    # 모든 사례의 영상과 음향 보존 및 정렬과 검출 통과 확인
    checks_pass = all(
        case["clipAudioMetrics"]["sourceValidVideo"] is True
        and case["clipAudioMetrics"]["baselineValidVideo"] is True
        and case["clipAudioMetrics"]["avValidVideo"] is True
        and case["clipAudioMetrics"]["baselineHasAudio"] is False
        and case["clipAudioMetrics"]["avHasAudio"] is (case["kind"] != "no_audio")
        and case["clipAudioStatus"] == ("ABSENT" if case["kind"] == "no_audio" else "PRESERVED")
        and case["audioScanStatus"] == ("ABSENT" if case["kind"] == "no_audio" else "COMPLETE")
        and (
            case["clipAudioMetrics"]["alignmentPass"]
            if case["clipAudioMetrics"]["expectedOnsetMs"] is not None
            else (
                case["clipAudioMetrics"]["sourceDecodedOnsetMs"] is None
                and (
                    case["kind"] != "silent" or case["clipAudioMetrics"]["avDecodedOnsetMs"] is None
                )
            )
        )
        and case["cueMetrics"]["falsePositive"] == 0
        and case["cueMetrics"]["falseNegative"] == 0
        for case in results
    )
    # 합성 검증 범위와 총괄 지표 보고서 생성
    report = {
        # 합성 음향 증거 비교 시험 판본 기록
        "benchmark": "synthetic-av-evidence-v1",
        # 정답 범위를 알려진 합성 다중 주파수로 한정
        "groundTruthScope": "KNOWN_SYNTHETIC_MULTITONE_SIGNALS",
        # 합성 사례 전체 통과 여부 기록
        "syntheticChecksPass": checks_pass,
        # 경기 의미 인식 정확도 향상 미입증 명시
        "semanticAccuracyImprovement": "NOT_ESTABLISHED",
        # 실제 경기 정답과 승인 발화 모델의 부재 등 한계 기록
        "semanticLimitations": [
            "NO_INDEPENDENT_REAL_MATCH_GROUND_TRUTH",
            "NO_APPROVED_SPEECH_MODEL",
            "SYNTHETIC_TONES_ARE_NOT_FOOTBALL_WHISTLES_OR_REFEREE_DECISIONS",
        ],
        # 기준 클립이 음향 제거 방식임을 기록
        "baselineRecipe": "FROZEN_PRECHANGE_FFMPEG_AN",
        # 기존 기준 결과를 재사용하지 않았음을 기록
        "baselineReused": False,
        # 기대 길이와 다른 무음 기준 클립 사례 목록 기록
        "baselineVisualDurationMismatchCases": [
            case["name"] for case in results if not case["clipAudioMetrics"]["baselineDurationPass"]
        ],
        # 모든 합성 사례의 음향 단서 지표 묶음 생성
        "cueMetrics": {
            # 전체 적중 단서 수 기록
            "truePositive": tp,
            # 전체 오탐 단서 수 기록
            "falsePositive": fp,
            # 전체 누락 단서 수 기록
            "falseNegative": fn,
            # 전체 예측 대비 적중 비율 기록
            "precision": tp / (tp + fp) if tp + fp else None,
            # 전체 정답 대비 적중 비율 기록
            "recall": tp / (tp + fn) if tp + fn else None,
            # 합성 원본 총 재생 분량당 오탐 수 계산
            "falsePositivesPerSourceMinute": fp / (len(results) * 1.5 / 60),
            # 적중 수로 가중한 평균 절대 시작 오차 기록
            "meanAbsoluteOnsetErrorMs": onset_error_sum / onset_weight if onset_weight else None,
        },
        # 음향 스트림 보존 개수 비교 묶음 생성
        "audioRetention": {
            # 무음 기준 클립 중 음향이 있는 개수 기록
            "baselineWithAudio": sum(
                case["clipAudioMetrics"]["baselineHasAudio"] is True for case in results
            ),
            # 음향 보존 클립 중 음향이 있는 개수 기록
            "avWithAudio": sum(case["clipAudioMetrics"]["avHasAudio"] is True for case in results),
            # 합성 원본 중 음향이 있는 개수 기록
            "sourceWithAudio": sum(case["kind"] != "no_audio" for case in results),
        },
        # 사례별 상세 결과 보존
        "cases": results,
    }
    # 한글과 유한한 수를 보존한 평가 보고서 파일 저장
    (output / "metrics.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    # 합성 비교 보고서 반환
    return report

# 명령행 인자 검증과 진단·영상 작업 실행
def main() -> None:
    # 제한된 합성 증거 평가용 명령행 해석기 생성
    parser = argparse.ArgumentParser(description="Bounded synthetic AV evidence evaluation")
    # 필수 합성 시험 출력 폴더 인자 등록
    parser.add_argument("--synthetic", required=True, type=Path, metavar="OUTPUT_DIR")
    # 명령행 경로 인자 읽음과 형식 확인
    args = parser.parse_args()
    # 새 출력 폴더에서 합성 비교 실행
    report = synthetic(args.synthetic)
    # 평가 보고서 위치와 핵심 결과 출력
    print(
        json.dumps(
            {
                # 저장된 평가 지표 파일의 절대 경로 기록
                "metricsPath": str(args.synthetic.resolve() / "metrics.json"),
                # 전체 음향 단서 평가 지표 기록
                "cueMetrics": report["cueMetrics"],
                # 합성 시험 전체 통과 여부 기록
                "syntheticChecksPass": report["syntheticChecksPass"],
                # 경기 의미 정확도 향상의 미입증 상태 기록
                "semanticAccuracyImprovement": report["semanticAccuracyImprovement"],
            },
            ensure_ascii=False,
            allow_nan=False,
        )
    )
    # 합성 시험의 하나 이상 실패 여부 확인
    if not report["syntheticChecksPass"]:
        # 실패를 명령행 종료 코드로 전달
        raise SystemExit(1)


# 파일의 직접 실행 여부 확인
if __name__ == "__main__":
    # 합성 평가 명령행 진입점 실행
    main()
