from __future__ import annotations
import json
import math
import os
import selectors
import subprocess
import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable
import numpy as np


# 한 음향 측정 표본의 밀리초 길이 정의
FRAME_DURATION_MS = 100
# 분석용 음향의 초당 표본 수 정의
DECODE_SAMPLE_RATE_HZ = 48_000
# 휘슬 유사 다중 주파수 탐색 대역의 하한 정의
MIN_BAND_FREQUENCY_HZ = 3_500
# 휘슬 유사 다중 주파수 탐색 대역의 상한 정의
MAX_BAND_FREQUENCY_HZ = 4_500
# 분석에 필요한 최소 음향 진폭 기준 정의
MIN_RMS = 1e-4
# 전체 음향 에너지에서 검사 대역이 차지할 최소 비율 정의
MIN_BAND_POWER_RATIO = 0.15
# 대역 에너지가 넓게 흩어지지 않을 최대 엔트로피 기준 정의
MAX_NORMALIZED_SPECTRAL_ENTROPY = 0.65
# 가장 강한 주파수 대비 피크로 인정할 최소 전력 비율 정의
MIN_PEAK_RELATIVE_POWER = 0.1
# 서로 다른 피크로 셀 최소 주파수 간격 정의
MIN_PEAK_SEPARATION_HZ = 150
# 소리 단서로 기록할 최소 연속 양성 표본 수 정의
MIN_CUE_FRAMES = 2
# 과도한 원본 길이의 디코딩을 방지할 최대 시간 범위 정의
MAX_DECODED_SPAN_MS = 4 * 60 * 60 * 1_000
# 메타데이터 조회와 출력 대기 한 번의 시간 상한 정의
PROCESS_TIMEOUT_SECONDS = 30
# 전체 음향 디코딩 실행 시간 상한 정의
MAX_DECODE_RUNTIME_SECONDS = 15 * 60


class UnsupportedAudioError(ValueError):
    pass


class AudioScanStatus(str, Enum):
    # 요청한 디코딩 과정의 정상 완료 상태이며 사건 판정 완료 아님
    COMPLETE = "COMPLETE"
    # 원본에 음향 스트림 자체가 없는 상태 정의
    ABSENT = "ABSENT"
    # 원본 음향 형식 또는 시간축을 지원하지 못하는 상태 정의
    UNSUPPORTED = "UNSUPPORTED"
    # 음향 처리 실패를 소리 단서 부재와 구별하는 상태 정의
    FAILED = "FAILED"


@dataclass(frozen=True, slots=True)
class AudioFrameMeasures:
    # 고정 주파수 패턴 충족 여부이며 실제 심판 휘슬 확정 아님
    is_whistle_like: bool
    # 직류 성분을 제거한 음향 진폭 크기 보존
    rms: float
    # 전체 전력 대비 검사 주파수 대역의 전력 비율 보존
    band_power_ratio: float
    # 검사 대역의 전력이 분산된 정도 보존
    normalized_spectral_entropy: float
    # 서로 떨어진 국소 전력 피크의 주파수 목록 보존
    peak_frequencies_hz: tuple[float, ...]
    # 최소 간격을 만족하는 독립 피크 수 보존
    local_peak_count: int


@dataclass(frozen=True, slots=True)
class AudioCue:
    # 원본 영상 시간축에서 소리 단서 시작 시각 보존
    start_ms: int
    # 원본 영상 시간축에서 소리 단서 종료 시각 보존
    end_ms: int
    # 서로 떨어진 국소 전력 피크의 주파수 목록 보존
    peak_frequencies_hz: tuple[float, ...]
    # 단서에 포함된 연속 음향 표본 수 보존
    frame_count: int
    # 휘슬과 비슷한 소리라는 중립 관측 종류 명시
    kind: str = "WHISTLE_LIKE_AUDIO"
    # 주파수·다중 피크 기반 고정 측정 방법 판본 보존
    method: str = "spectral-multitone-v1"


@dataclass(frozen=True, slots=True)
class AudioScan:
    # 완료·원본 없음·미지원·실패 상태를 구별해 보존
    status: AudioScanStatus
    # 미지원 또는 실패의 구체적인 처리 사유 보존
    reason: str | None
    # 관측한 연속 소리 단서 목록 보존
    cues: tuple[AudioCue, ...]
    # 분석용 변환 이전 원본 표본 주파수 보존
    source_audio_sample_rate_hz: int | None
    # 원본 음향 채널 수 보존
    source_audio_channels: int | None
    # 음향 시각을 대응할 원본 영상 시간 원점 보존
    video_origin_seconds: float | None
    # 영상 시작과 음향 시작의 원래 밀리초 차이 보존
    audio_offset_ms: int | None
    # 실제로 분석한 원본 시간 범위의 시작 보존
    scanned_start_ms: int | None
    # 실제로 분석한 원본 시간 범위의 종료 보존
    scanned_end_ms: int | None
    # 실제로 측정한 음향 표본 수 보존
    decoded_frame_count: int

# 빈 관측 결과와 처리 불가 사유 명시
def emptyScan(status: AudioScanStatus, reason: str) -> AudioScan:
    # 소리 단서와 처리 상태 및 원본 시간 대응 정보를 함께 반환
    return AudioScan(
        status=status,
        reason=reason,
        cues=(),
        source_audio_sample_rate_hz=None,
        source_audio_channels=None,
        video_origin_seconds=None,
        audio_offset_ms=None,
        scanned_start_ms=None,
        scanned_end_ms=None,
        decoded_frame_count=0,
    )

# 입력에서 유효한 유한 수치만 추출
def finiteNumber(value: Any) -> float | None:
    try:
        # 외부 메타데이터 값을 실수로 변환
        number = float(value)
    # 수치로 해석할 수 없는 메타데이터 값 처리
    except (TypeError, ValueError):
        # 사용 가능한 수치 또는 완성된 소리 단서가 없음을 반환
        return None
    # 유한한 수치만 반환하고 비정상 수치는 미확인으로 유지
    return number if math.isfinite(number) else None

# 프레임 입력 검사
def frameValidation(waveform: np.ndarray, sample_rate_hz: int) -> np.ndarray:
    # 음향 표본 주파수가 불리언이 아닌 양의 정수인지 확인
    if type(sample_rate_hz) is not int or sample_rate_hz <= 0:
        # 유효하지 않은 표본 주파수 거부
        raise ValueError("invalid-sample-rate")
    # 원본 표본 주파수로 검사 대역을 표현할 수 있는지 확인
    if sample_rate_hz / 2 < MAX_BAND_FREQUENCY_HZ:
        # 표현 가능한 한계를 넘는 주파수 대역의 분석 거부
        raise UnsupportedAudioError("analysis-band-above-nyquist")
    # 입력이 표본과 채널의 두 축을 가진 배열인지 확인
    if not isinstance(waveform, np.ndarray) or waveform.ndim != 2:
        # 채널 구분을 잃은 음향 입력 거부
        raise ValueError("audio-frame-must-be-n-by-c-array")
    # 고정 시간 표본에 필요한 표본 수의 밀리초 비례값 계산
    expected_samples = sample_rate_hz * FRAME_DURATION_MS
    # 정확한 고정 시간 길이와 한 개 이상의 채널을 가진 표본인지 확인
    if (
        expected_samples % 1_000
        or waveform.shape[0] != expected_samples // 1_000
        or waveform.shape[1] < 1
    ):
        # 정확한 고정 표본 길이와 채널 수를 갖추지 못한 입력 거부
        raise ValueError("audio-frame-must-be-100ms")
    # 실수로 표현 가능한 수치 파형인지 확인
    if not np.issubdtype(waveform.dtype, np.number) or np.iscomplexobj(waveform):
        # 문자열 또는 복소수 파형 입력 거부
        raise ValueError("audio-frame-must-be-real-numeric")
    # 후속 전력 계산에 사용할 실수 정밀도로 변환
    frame = waveform.astype(np.float64, copy=False)
    # 모든 음향 표본이 유한한 수치인지 확인
    if not np.isfinite(frame).all():
        # 비정상 수치가 포함된 파형 거부
        raise ValueError("audio-frame-must-be-finite")
    # 검증된 표본·채널 배열 반환
    return frame

# 검사 대역에서 서로 충분히 떨어진 국소 전력 피크를 검색
def peakIndices(
    band_power: np.ndarray,
    band_frequencies_hz: np.ndarray,
) -> tuple[float, ...]:
    # 양쪽 이웃을 비교할 최소 주파수 칸 수 확인
    if band_power.size < 3:
        # 분리된 전력 피크를 찾을 수 없는 경우 빈 목록 반환
        return ()
    # 검사 대역의 가장 강한 전력값 계산
    maximum = float(np.max(band_power))
    # 검사 대역에 양의 에너지가 존재하는지 확인
    if maximum <= 0:
        # 분리된 전력 피크를 찾을 수 없는 경우 빈 목록 반환
        return ()
    # 양쪽 이웃보다 높고 상대 전력 기준을 넘는 주파수 칸 선택
    local = (
        np.flatnonzero(
            (band_power[1:-1] > band_power[:-2])
            & (band_power[1:-1] >= band_power[2:])
            & (band_power[1:-1] >= maximum * MIN_PEAK_RELATIVE_POWER)
        )
        + 1
    )
    # 강한 피크부터 고르되 동률에서는 주파수 위치 순서 유지
    ranked = sorted(local, key=lambda index: (-float(band_power[index]), int(index)))
    # 주파수 간격 기준을 만족한 피크 위치 목록 생성
    selected: list[int] = []
    # 강한 순서대로 주변 피크와의 간격 확인
    for index in ranked:
        # 현재 피크 후보의 실제 주파수 읽음
        frequency = float(band_frequencies_hz[index])
        # 이미 선택한 모든 피크와 최소 주파수 간격을 지키는지 확인
        if all(
            abs(frequency - float(band_frequencies_hz[other])) >= MIN_PEAK_SEPARATION_HZ
            for other in selected
        ):
            # 독립 피크로 인정한 주파수 위치 보존
            selected.append(int(index))
    # 선택된 피크를 낮은 주파수부터 정렬해 반환
    return tuple(sorted(float(band_frequencies_hz[index]) for index in selected))

# 음향 프레임의 주파수 전력과 엔트로피 및 피크를 측정
def frameMeasures(waveform: np.ndarray, sample_rate_hz: int) -> AudioFrameMeasures:
    """채널 혼합·사건 판정 없이 100밀리초 표본×채널 프레임 측정"""
    # 고정 길이와 채널 구조 및 수치 유효성 검사
    frame = frameValidation(waveform, sample_rate_hz)
    # 각 채널의 평균을 빼서 직류 성분 제거
    centered = frame - np.mean(frame, axis=0, keepdims=True)
    # 채널을 상쇄 혼합하지 않고 전체 진폭의 제곱평균제곱근 계산
    rms = float(np.sqrt(np.mean(np.square(centered))))
    # 표본 양 끝의 급격한 절단으로 생기는 주파수 누설 완화
    windowed = centered * np.hanning(frame.shape[0])[:, None]
    # 채널별 실수 파형을 주파수 성분으로 변환
    spectrum = np.fft.rfft(windowed, axis=0)
    # 파형 대신 채널별 전력을 평균하여 위상 상쇄 방지
    power = np.mean(np.square(np.abs(spectrum)), axis=1)
    # 각 주파수 칸에 대응하는 실제 주파수 계산
    frequencies_hz = np.fft.rfftfreq(frame.shape[0], d=1 / sample_rate_hz)
    # 직류 성분을 제외한 전체 음향 전력 계산
    non_dc_power = float(np.sum(power[1:]))
    # 휘슬 유사 패턴을 검사할 고정 주파수 범위 선택
    band_mask = (frequencies_hz >= MIN_BAND_FREQUENCY_HZ) & (
        frequencies_hz <= MAX_BAND_FREQUENCY_HZ
    )
    # 검사 대역의 전력값만 추출
    band_power = power[band_mask]
    # 검사 대역에 해당하는 실제 주파수 목록 추출
    band_frequencies_hz = frequencies_hz[band_mask]
    # 검사 대역에 모인 전체 전력 계산
    band_sum = float(np.sum(band_power))
    # 전체 전력에서 검사 대역이 차지하는 비중 계산
    band_power_ratio = band_sum / non_dc_power if non_dc_power > 0 else 0.0
    # 대역 전력 분포를 정규화할 조건이 있는지 확인
    if band_sum > 0 and band_power.size > 1:
        # 주파수별 전력을 합이 일인 분포로 정규화
        probabilities = band_power / band_sum
        # 로그 계산을 위해 영인 전력 비중 제외
        nonzero = probabilities[probabilities > 0]
        # 대역 전력의 분산 정도를 영과 일 사이 엔트로피로 계산
        entropy = float(-np.sum(nonzero * np.log(nonzero)) / math.log(band_power.size))
    else:
        # 에너지가 없어 집중도를 계산하지 못하면 조건 불충족 값 사용
        entropy = 1.0
    # 충분히 떨어진 주파수 전력 피크 탐색
    peaks = peakIndices(band_power, band_frequencies_hz)
    # 진폭·대역 비율·집중도·다중 피크 조건의 동시 충족 확인
    positive = (
        rms >= MIN_RMS
        and band_power_ratio >= MIN_BAND_POWER_RATIO
        and entropy <= MAX_NORMALIZED_SPECTRAL_ENTROPY
        and len(peaks) in (2, 3)
    )
    # 휘슬 사실이 아닌 현재 음향 표본의 패턴 측정 결과 반환
    return AudioFrameMeasures(
        is_whistle_like=positive,
        rms=rms,
        band_power_ratio=band_power_ratio,
        normalized_spectral_entropy=entropy,
        peak_frequencies_hz=peaks,
        local_peak_count=len(peaks),
    )


class WhistleCueDetector:

    # 초기 상태·입력 계약 구성
    def __init__(self, media_end_ms: int | None = None) -> None:
        # 제공된 영상 종료 시각이 영 이상 정수인지 확인
        if media_end_ms is not None and (type(media_end_ms) is not int or media_end_ms < 0):
            # 잘못된 영상 끝 시각을 가진 단서 누적기 거부
            raise ValueError("invalid-media-end")
        # 소리 단서가 원본 끝을 넘지 않도록 영상 종료 시각 보존
        self._media_end_ms = media_end_ms
        # 현재 연속 양성 소리 구간의 시작 초기화
        self._start_ms: int | None = None
        # 직전 양성 음향 표본 시각 초기화
        self._last_start_ms: int | None = None
        # 현재 연속 소리 구간의 표본 수 초기화
        self._frame_count = 0
        # 대표 주파수 근거로 사용할 가장 큰 진폭 표본 초기화
        self._representative: AudioFrameMeasures | None = None

    # 음향 프레임을 연속 구간으로 누적하고 종료된 휘슬 유사 단서를 반환
    def update(self, measures: AudioFrameMeasures, frame_start_ms: int) -> AudioCue | None:
        # 음향 측정 자료와 원본 표본 시각의 입력 형식 확인
        if not isinstance(measures, AudioFrameMeasures) or type(frame_start_ms) is not int:
            # 올바른 측정 결과와 정수 시각이 아닌 입력 거부
            raise ValueError("invalid-audio-frame-observation")
        # 이번 표본에서 끝나는 소리 단서 반환값 초기화
        emitted = None
        # 직전 표본과 고정 시간 간격으로 이어지는지 확인
        contiguous = (
            self._last_start_ms is None or frame_start_ms == self._last_start_ms + FRAME_DURATION_MS
        )
        # 양성 패턴 종료 또는 표본 공백으로 현재 구간이 끊겼는지 확인
        if self._start_ms is not None and (not measures.is_whistle_like or not contiguous):
            # 끊긴 이전 소리 구간을 최소 지속 조건으로 마감
            emitted = self.emission()
        # 현재 표본이 고정 휘슬 유사 주파수 조건에 맞는지 확인
        if measures.is_whistle_like:
            # 새 연속 소리 구간의 첫 양성 표본인지 확인
            if self._start_ms is None:
                # 새 소리 단서의 원본 시작 시각 보존
                self._start_ms = frame_start_ms
                # 현재 연속 소리 구간의 표본 수 초기화
                self._frame_count = 0
                # 이전 소리 구간의 대표 주파수 표본 해제
                self._representative = None
            # 연속 양성 소리 표본 수 누적
            self._frame_count += 1
            # 현재 양성 표본의 원본 시각 보존
            self._last_start_ms = frame_start_ms
            # 현재 표본이 소리 구간에서 가장 큰 진폭을 갖는지 확인
            if self._representative is None or measures.rms > self._representative.rms:
                # 가장 강한 표본의 주파수 피크를 대표 근거로 보존
                self._representative = measures
        else:
            # 양성 패턴이 끊겨 이전 표본 시간 연결 해제
            self._last_start_ms = None
        # 이번 표본 도착으로 끝난 이전 소리 단서 반환
        return emitted

    # 남은 연속 관측을 마감하고 최종 결과를 반환
    def finish(self) -> AudioCue | None:
        # 입력 종료 시 아직 누적 중인 마지막 소리 구간 마감
        return self.emission()

    # 최소 연속 조건을 만족하는 누적 음향 구간을 반환
    def emission(self) -> AudioCue | None:
        # 마감할 소리 구간의 시작 시각 읽음
        start_ms = self._start_ms
        # 마지막 양성 표본의 시작 시각 읽음
        last_start_ms = self._last_start_ms
        # 마감할 소리 구간의 연속 표본 수 읽음
        frame_count = self._frame_count
        # 대표 주파수 측정값 읽음
        representative = self._representative
        # 마감 후 다음 소리 구간을 위해 시작 시각 해제
        self._start_ms = None
        # 양성 패턴이 끊겨 이전 표본 시간 연결 해제
        self._last_start_ms = None
        # 현재 연속 소리 구간의 표본 수 초기화
        self._frame_count = 0
        # 이전 소리 구간의 대표 주파수 표본 해제
        self._representative = None
        # 구간 시작·마지막 표본·대표 측정과 최소 연속 수가 모두 있는지 확인
        if (
            start_ms is None
            or last_start_ms is None
            or representative is None
            or frame_count < MIN_CUE_FRAMES
        ):
            # 사용 가능한 수치 또는 완성된 소리 단서가 없음을 반환
            return None
        # 영상 시작 전 음향 구간을 원본 영상 시작으로 제한
        start_ms = max(0, start_ms)
        # 마지막 표본의 길이까지 포함한 소리 단서 종료 시각 계산
        end_ms = last_start_ms + FRAME_DURATION_MS
        # 원본 영상 끝 시각이 제공되었는지 확인
        if self._media_end_ms is not None:
            # 소리 단서가 영상 원본 끝을 넘지 않도록 제한
            end_ms = min(end_ms, self._media_end_ms)
        # 원본 범위로 제한한 뒤에도 최소 지속 길이를 만족하는지 확인
        if end_ms - start_ms < MIN_CUE_FRAMES * FRAME_DURATION_MS:
            # 사용 가능한 수치 또는 완성된 소리 단서가 없음을 반환
            return None
        # 최소 지속 조건을 충족한 휘슬 유사 소리 구간 반환
        return AudioCue(
            start_ms=start_ms,
            end_ms=end_ms,
            peak_frequencies_hz=representative.peak_frequencies_hz,
            frame_count=frame_count,
        )


@dataclass(frozen=True, slots=True)
class _MediaAudioMetadata:
    # 디코딩 대상으로 선택한 원본 음향 스트림 번호 보존
    stream_index: int
    # 변환 전 원본 음향 표본 주파수 보존
    sample_rate_hz: int
    # 혼합 없이 디코딩할 원본 채널 수 보존
    channels: int
    # 소리 구간의 기준이 될 영상 절대 원점 보존
    video_origin_seconds: float
    # 영상 시작 대비 원본 음향의 시간 차이 보존
    audio_offset_ms: int
    # 음향 분석을 연결할 원본 영상 길이 보존
    video_duration_ms: int

# 음향 스트림과 공통 시간 원점을 확인하고 미지원 상태를 구분
def audioMetadata(path: Path, duration_ms: int | None) -> _MediaAudioMetadata | AudioScan:
    # 원본 메타데이터 조회 또는 음향 디코딩의 외부 도구 인자 구성
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
        # 실행 상한 안에서 미디어 스트림과 컨테이너 정보 조회
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=PROCESS_TIMEOUT_SECONDS, check=False
        )
    # 미디어 검사 도구 부재 또는 실행 권한 실패 처리
    except (FileNotFoundError, PermissionError):
        # 도구를 실행하지 못한 상태를 음향 없음과 구별해 반환
        return emptyScan(AudioScanStatus.FAILED, "DECODER_UNAVAILABLE")
    # 미디어 조회 또는 디코더 종료 대기 시간 초과 처리
    except subprocess.TimeoutExpired:
        # 메타데이터 조회 시간 초과 상태 반환
        return emptyScan(AudioScanStatus.FAILED, "PROBE_TIMEOUT")
    # 미디어 검사 실행 중 운영체제 오류 처리
    except OSError:
        # 메타데이터 조회 실패 사유와 빈 관측 반환
        return emptyScan(AudioScanStatus.FAILED, "PROBE_FAILED")
    # 외부 검사기의 종료 상태 확인
    if result.returncode != 0:
        # 메타데이터 조회 실패 사유와 빈 관측 반환
        return emptyScan(AudioScanStatus.FAILED, "PROBE_FAILED")
    try:
        # 스트림과 컨테이너의 구조화된 메타데이터 읽음
        payload = json.loads(result.stdout)
    # 검사기 출력이 올바른 구조화 자료가 아닌 경우 처리
    except json.JSONDecodeError:
        # 잘못된 메타데이터 형식을 처리 실패로 반환
        return emptyScan(AudioScanStatus.FAILED, "PROBE_INVALID")
    # 원본 파일에 포함된 스트림 목록 읽음
    streams = payload.get("streams")
    # 스트림 목록이 배열 구조인지 확인
    if not isinstance(streams, list):
        # 잘못된 메타데이터 형식을 처리 실패로 반환
        return emptyScan(AudioScanStatus.FAILED, "PROBE_INVALID")
    # 표지 그림을 제외한 첫 실제 영상 스트림 선택
    video = next(
        (
            stream
            for stream in streams
            if isinstance(stream, dict)
            and stream.get("codec_type") == "video"
            and not bool((stream.get("disposition") or {}).get("attached_pic"))
        ),
        None,
    )
    # 음향 관측을 연결할 영상 스트림 존재 여부 확인
    if video is None:
        # 영상 시간축이 없는 원본을 미지원으로 반환
        return emptyScan(AudioScanStatus.UNSUPPORTED, "VIDEO_STREAM_ABSENT")
    # 관측 대상으로 삼을 첫 원본 음향 스트림 선택
    audio = next(
        (
            stream
            for stream in streams
            if isinstance(stream, dict) and stream.get("codec_type") == "audio"
        ),
        None,
    )
    # 원본에 음향 스트림 자체가 없는지 확인
    if audio is None:
        # 원본 음향 없음을 디코딩 실패와 구별해 반환
        return emptyScan(AudioScanStatus.ABSENT, "AUDIO_STREAM_ABSENT")
    # 원본 표본 주파수를 유한 수치로 읽음
    sample_rate_value = finiteNumber(audio.get("sample_rate"))
    # 원본 채널 수를 유한 수치로 읽음
    channels_value = finiteNumber(audio.get("channels"))
    # 분석에 필요한 원본 음향 형식 정보 존재 여부 확인
    if sample_rate_value is None or channels_value is None:
        # 해석하지 못한 음향 형식을 미지원으로 반환
        return emptyScan(AudioScanStatus.UNSUPPORTED, "AUDIO_METADATA_UNSUPPORTED")
    # 원본 표본 주파수를 정수로 변환
    sample_rate_hz = int(sample_rate_value)
    # 원본 음향 채널 수를 정수로 변환
    channels = int(channels_value)
    # 원본 표본 주파수로 검사 대역을 표현할 수 있는지 확인
    if sample_rate_hz / 2 < MAX_BAND_FREQUENCY_HZ:
        # 검사 주파수 대역을 담지 못하는 원본을 미지원으로 반환
        return emptyScan(AudioScanStatus.UNSUPPORTED, "ANALYSIS_BAND_ABOVE_NYQUIST")
    # 디코딩에서 지원하는 원본 채널 수 범위 확인
    if channels < 1 or channels > 32:
        # 지원 채널 수 밖의 음향을 임의 혼합하지 않고 미지원 반환
        return emptyScan(AudioScanStatus.UNSUPPORTED, "CHANNEL_COUNT_UNSUPPORTED")
    # 영상 길이 보완에 사용할 컨테이너 메타데이터 선택
    format_payload = payload.get("format") if isinstance(payload.get("format"), dict) else {}
    # 원본 영상 스트림의 실제 시작 시각 읽음
    video_start = finiteNumber(video.get("start_time"))
    # 원본 음향 스트림의 실제 시작 시각 읽음
    audio_start = finiteNumber(audio.get("start_time"))
    # 두 스트림의 시간 원점을 모두 알 수 있는지 확인
    if video_start is None or audio_start is None:
        # 시간 간격을 임의로 추정하지 않고 미지원 반환
        return emptyScan(AudioScanStatus.UNSUPPORTED, "TIMELINE_ORIGIN_UNAVAILABLE")
    # 원본 영상 시작을 관측 공통 시간 원점으로 선택
    video_origin = video_start
    # 영상보다 빠르거나 늦은 음향 시작 차이를 밀리초로 계산
    audio_offset_ms = round((audio_start - video_origin) * 1_000)
    # 호출자가 검증된 영상 길이를 전달했는지 확인
    if duration_ms is not None:
        # 지정된 영상 길이가 양의 정수 밀리초인지 확인
        if type(duration_ms) is not int or duration_ms <= 0:
            # 분석 종료 시각을 정할 수 없는 원본을 미지원으로 반환
            return emptyScan(AudioScanStatus.UNSUPPORTED, "NO_TIME_TARGET")
        # 호출자가 전달한 원본 길이를 분석 종료 기준으로 사용
        target_duration_ms = duration_ms
    else:
        # 영상 스트림 자체의 재생 길이 읽음
        duration_seconds = finiteNumber(video.get("duration"))
        # 스트림 길이가 없으면 컨테이너 길이로 보완할지 확인
        if duration_seconds is None:
            # 컨테이너가 제공하는 전체 재생 길이 읽음
            duration_seconds = finiteNumber(format_payload.get("duration"))
        # 분석 종료 기준이 될 양의 원본 길이 존재 여부 확인
        if duration_seconds is None or duration_seconds <= 0:
            # 분석 종료 시각을 정할 수 없는 원본을 미지원으로 반환
            return emptyScan(AudioScanStatus.UNSUPPORTED, "NO_TIME_TARGET")
        # 초 단위 원본 길이를 밀리초 종료 시각으로 변환
        target_duration_ms = round(duration_seconds * 1_000)
    # 음향 시작 차이를 반영한 실제 디코딩 시간 범위 계산
    decoded_span_ms = target_duration_ms - audio_offset_ms
    # 영상 길이와 디코딩 길이가 모두 처리 상한 안인지 확인
    if target_duration_ms > MAX_DECODED_SPAN_MS or decoded_span_ms > MAX_DECODED_SPAN_MS:
        # 과도한 전체 디코딩 범위를 미지원으로 반환
        return emptyScan(AudioScanStatus.UNSUPPORTED, "DECODED_SPAN_LIMIT_EXCEEDED")
    # 검증된 스트림 선택과 원본 시간 대응 자료 반환
    return _MediaAudioMetadata(
        stream_index=int(audio.get("index")),
        sample_rate_hz=sample_rate_hz,
        channels=channels,
        video_origin_seconds=video_origin,
        audio_offset_ms=audio_offset_ms,
        video_duration_ms=target_duration_ms,
    )


class _AudioCancelled(Exception):

    # 초기 상태·입력 계약 구성
    def __init__(self, cause: Exception) -> None:
        # 작업 취소의 원래 예외를 재전달하기 위해 보존
        self.cause = cause

# 연속 원시 음향 프레임의 음향 관측·디코딩 범위 수집
def pcmScan(
    path: Path, metadata: _MediaAudioMetadata, check_cancelled: Callable[[], None] | None = None
) -> AudioScan:

    # 취소 여부 확인
    def checkpoint() -> None:
        # 외부 작업 취소 검사 존재 여부 확인
        if check_cancelled is not None:
            try:
                # 음향 처리 경계에서 작업 취소 요청 확인
                check_cancelled()
            # 취소 검사에서 발생한 중단 신호를 디코딩 실패와 구별
            except Exception as error:
                # 취소 예외를 보존한 내부 중단 신호 전달
                raise _AudioCancelled(error) from error
    # 음향 시작 이후 원본 영상 끝까지 필요한 디코딩 길이 계산
    decode_duration_ms = max(0, metadata.video_duration_ms - metadata.audio_offset_ms)
    # 원본 영상 안에 디코딩할 음향 시간 범위가 없는지 확인
    if decode_duration_ms == 0:
        # 소리 단서와 처리 상태 및 원본 시간 대응 정보를 함께 반환
        return AudioScan(
            status=AudioScanStatus.COMPLETE,
            reason=None,
            cues=(),
            source_audio_sample_rate_hz=metadata.sample_rate_hz,
            source_audio_channels=metadata.channels,
            video_origin_seconds=metadata.video_origin_seconds,
            audio_offset_ms=metadata.audio_offset_ms,
            scanned_start_ms=metadata.video_duration_ms,
            scanned_end_ms=metadata.video_duration_ms,
            decoded_frame_count=0,
        )
    # 원본 메타데이터 조회 또는 음향 디코딩의 외부 도구 인자 구성
    command = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-i",
        str(path),
        "-map",
        f"0:{metadata.stream_index}",
        "-vn",
        "-sn",
        "-dn",
        "-af",
        (
            f"asetpts=PTS-STARTPTS,aresample={DECODE_SAMPLE_RATE_HZ}:"
            "async=1:first_pts=0:min_hard_comp=0"
        ),
        "-t",
        f"{decode_duration_ms / 1_000:.3f}",
        "-ac",
        str(metadata.channels),
        "-ar",
        str(DECODE_SAMPLE_RATE_HZ),
        "-c:a",
        "pcm_f32le",
        "-f",
        "f32le",
        "pipe:1",
    ]
    # 디코더 실행 자원의 정리 기준 초기화
    process: subprocess.Popen[bytes] | None = None
    # 표준 출력 준비 대기 자원의 정리 기준 초기화
    selector: selectors.BaseSelector | None = None
    # 고정 길이 다채널 실수 표본 하나에 필요한 바이트 수 계산
    frame_bytes = DECODE_SAMPLE_RATE_HZ // 10 * metadata.channels * 4
    # 아직 완전한 음향 표본 길이가 되지 않은 디코딩 바이트 보관
    pending = bytearray()
    # 원본 영상 끝에 맞춰 소리 구간을 누적할 고정 패턴 검출기 생성
    detector = WhistleCueDetector(media_end_ms=metadata.video_duration_ms)
    # 완성된 휘슬 유사 음향 단서 목록 생성
    cues: list[AudioCue] = []
    # 분석한 고정 길이 음향 표본 수 초기화
    decoded_frames = 0
    # 디코딩 실패 사유 초기화
    failure_reason: str | None = None
    try:
        # 다음 음향 처리 전에 외부 취소 요청 확인
        checkpoint()
        # 원본 채널과 시간 간격을 보존하는 음향 디코더 실행
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        # 디코딩된 파형을 읽을 출력 파이프 존재 여부 확인
        if process.stdout is None:
            # 파형 출력 통로가 없는 디코더 실행 중단
            raise RuntimeError("decode-output-unavailable")
        # 디코더 출력 대기를 제한할 운영체제 선택기 생성
        selector = selectors.DefaultSelector()
        # 파형 출력이 준비되는 사건을 대기 대상으로 등록
        selector.register(process.stdout, selectors.EVENT_READ)
        # 전체 음향 디코딩의 종료 기한 계산
        deadline = time.monotonic() + MAX_DECODE_RUNTIME_SECONDS
        # 디코더 출력 끝 또는 목표 길이 도달 상태 초기화
        reached_eof = False
        # 목표 원본 시간 범위까지 파형을 순차적으로 읽음
        while not reached_eof:
            # 다음 음향 처리 전에 외부 취소 요청 확인
            checkpoint()
            # 전체 디코딩 기한까지 남은 실행 시간 계산
            remaining_seconds = deadline - time.monotonic()
            # 전체 디코딩 기한 초과 여부 확인
            if remaining_seconds <= 0:
                # 음향 읽기 또는 종료 대기의 시간 초과 사유 기록
                failure_reason = "DECODE_TIMEOUT"
                # 목표 길이 도달 또는 읽기 종료·실패로 현재 반복 중단
                break
            # 개별 대기와 전체 기한 중 짧은 한도까지 파형 출력 대기
            events = selector.select(min(PROCESS_TIMEOUT_SECONDS, remaining_seconds))
            # 기한 안에 읽을 파형 출력이 준비되지 않았는지 확인
            if not events:
                # 출력이 없는데 디코더가 아직 실행 중인지 확인
                if process.poll() is None:
                    # 음향 읽기 또는 종료 대기의 시간 초과 사유 기록
                    failure_reason = "DECODE_TIMEOUT"
                # 목표 길이 도달 또는 읽기 종료·실패로 현재 반복 중단
                break
            # 디코더에서 준비된 파형 바이트를 제한된 크기로 읽음
            chunk = os.read(process.stdout.fileno(), 64 * 1_024)
            # 디코더 표준 출력의 끝에 도달했는지 확인
            if not chunk:
                # 추가 파형 읽기를 종료할 상태 기록
                reached_eof = True
                # 현재 읽기 반복을 끝내고 종료 조건 재확인
                continue
            # 읽은 파형 바이트를 표본 분리 버퍼에 누적
            pending.extend(chunk)
            # 완전한 고정 길이 표본을 만들 수 있는 동안 분석
            while len(pending) >= frame_bytes:
                # 다음 음향 처리 전에 외부 취소 요청 확인
                checkpoint()
                # 다음 고정 길이 음향 표본의 바이트 추출
                frame_data = bytes(pending[:frame_bytes])
                # 이미 분리한 표본 바이트를 대기 버퍼에서 제거
                del pending[:frame_bytes]
                # 작은 바이트 순서 실수 파형을 표본·원본 채널 배열로 복원
                waveform = np.frombuffer(frame_data, dtype="<f4").reshape(-1, metadata.channels)
                # 현재 표본의 진폭과 주파수 패턴 측정
                measures = frameMeasures(waveform, DECODE_SAMPLE_RATE_HZ)
                # 원본 음향 시작 차이를 반영한 영상 상대 표본 시각 계산
                timestamp_ms = metadata.audio_offset_ms + decoded_frames * FRAME_DURATION_MS
                # 현재 패턴 측정을 연속 소리 구간에 연결
                cue = detector.update(measures, timestamp_ms)
                # 현재 표본으로 마감된 소리 단서 존재 여부 확인
                if cue is not None:
                    # 마감된 휘슬 유사 소리 구간 보존
                    cues.append(cue)
                # 실제로 측정한 음향 표본 수 누적
                decoded_frames += 1
                # 요청한 음향 디코딩 길이를 채웠는지 확인
                if decoded_frames * FRAME_DURATION_MS >= decode_duration_ms:
                    # 추가 파형 읽기를 종료할 상태 기록
                    reached_eof = True
                    # 목표 길이 도달 또는 읽기 종료·실패로 현재 반복 중단
                    break
        # 앞선 처리 실패가 없을 때만 종료 상태 확인 또는 마지막 단서 마감
        if failure_reason is None:
            try:
                # 디코더 종료를 기다릴 남은 전체 시간 계산
                remaining_seconds = max(0.001, deadline - time.monotonic())
                # 제한된 기한 안에서 디코더 종료 코드 확인
                return_code = process.wait(timeout=min(PROCESS_TIMEOUT_SECONDS, remaining_seconds))
            # 미디어 조회 또는 디코더 종료 대기 시간 초과 처리
            except subprocess.TimeoutExpired:
                # 음향 읽기 또는 종료 대기의 시간 초과 사유 기록
                failure_reason = "DECODE_TIMEOUT"
            else:
                # 디코더가 오류로 종료했는지 확인
                if return_code != 0:
                    # 실패한 디코딩을 정상 무음과 구별해 기록
                    failure_reason = "DECODE_FAILED"
        # 앞선 처리 실패가 없을 때만 종료 상태 확인 또는 마지막 단서 마감
        if failure_reason is None:
            # 디코딩 끝에 남아 있는 마지막 연속 소리 구간 마감
            final_cue = detector.finish()
            # 마지막 구간이 최소 지속 조건을 만족했는지 확인
            if final_cue is not None:
                # 입력 끝에서 마감된 소리 단서 추가
                cues.append(final_cue)
    # 음향 디코딩 오류와 구별한 외부 작업 취소 처리
    except _AudioCancelled as error:
        # 원래 작업 취소 예외를 호출자에게 그대로 전달
        raise error.cause
    # 디코더 실행 파일 누락 처리
    except FileNotFoundError:
        # 음향 디코더를 실행하지 못한 사유 기록
        failure_reason = "DECODER_UNAVAILABLE"
    # 출력 읽기 또는 파형 해석 실패를 디코딩 실패로 통합
    except (OSError, RuntimeError, ValueError):
        # 실패한 디코딩을 정상 무음과 구별해 기록
        failure_reason = "DECODE_FAILED"
    # 성공·실패·취소와 관계없이 디코더와 대기 자원 정리
    finally:
        # 출력 대기 선택기가 생성되었는지 확인
        if selector is not None:
            # 파형 읽기 준비 감시 자원 해제
            selector.close()
        # 아직 실행 중인 디코더 자식 프로세스가 있는지 확인
        if process is not None and process.poll() is None:
            # 남아 있는 디코더에 정상 종료 요청
            process.terminate()
            try:
                # 디코더 종료 뒤 자식 프로세스 자원 회수
                process.wait(timeout=5)
            # 미디어 조회 또는 디코더 종료 대기 시간 초과 처리
            except subprocess.TimeoutExpired:
                # 정상 종료 기한을 넘긴 디코더 강제 종료
                process.kill()
                # 디코더 종료 뒤 자식 프로세스 자원 회수
                process.wait(timeout=5)
        # 디코더 프로세스가 생성되었는지 확인
        if process is not None:
            # 열려 있는 파형 출력 스트림 존재 여부 확인
            if process.stdout is not None:
                # 디코더 표준 출력 파이프 해제
                process.stdout.close()
            # 열려 있는 오류 출력 스트림 존재 여부 확인
            if process.stderr is not None:
                # 디코더 오류 출력 파이프 해제
                process.stderr.close()
    # 디코딩 실패를 정상 처리 결과와 분리할지 확인
    if failure_reason is not None:
        # 소리 단서와 처리 상태 및 원본 시간 대응 정보를 함께 반환
        return AudioScan(
            status=AudioScanStatus.FAILED,
            reason=failure_reason,
            cues=(),
            source_audio_sample_rate_hz=metadata.sample_rate_hz,
            source_audio_channels=metadata.channels,
            video_origin_seconds=metadata.video_origin_seconds,
            audio_offset_ms=metadata.audio_offset_ms,
            scanned_start_ms=None,
            scanned_end_ms=None,
            decoded_frame_count=decoded_frames,
        )
    # 원본 영상 내부에 한정한 실제 음향 분석 시작 시각 계산
    scanned_start_ms = min(metadata.video_duration_ms, max(0, metadata.audio_offset_ms))
    # 실제로 디코딩한 표본 수로 분석 종료 시각 계산
    scanned_end_ms = min(
        metadata.video_duration_ms,
        max(0, metadata.audio_offset_ms + decoded_frames * FRAME_DURATION_MS),
    )
    # 소리 단서와 처리 상태 및 원본 시간 대응 정보를 함께 반환
    return AudioScan(
        status=AudioScanStatus.COMPLETE,
        reason=None,
        cues=tuple(cues),
        source_audio_sample_rate_hz=metadata.sample_rate_hz,
        source_audio_channels=metadata.channels,
        video_origin_seconds=metadata.video_origin_seconds,
        audio_offset_ms=metadata.audio_offset_ms,
        scanned_start_ms=scanned_start_ms,
        scanned_end_ms=scanned_end_ms,
        decoded_frame_count=decoded_frames,
    )

# 원본 음향을 고정 디지털 신호 처리로 분석해 휘슬 유사 구간을 기록
def audioCues(
    source: Path | str,
    duration_ms: int | None = None,
    *,
    check_cancelled: Callable[[], None] | None = None,
) -> AudioScan:
    """제한된 음향 트랙 스트리밍과 영상 시간축의 휘슬 유사 관측 반환"""
    # 음향 분석 원본 경로를 실제 절대 경로로 정규화
    path = Path(source).expanduser().resolve()
    # 외부 작업 취소 검사 존재 여부 확인
    if check_cancelled is not None:
        # 음향 처리 경계에서 작업 취소 요청 확인
        check_cancelled()
    # 원본 영상 파일이 존재하는지 확인
    if not path.is_file():
        # 원본 파일 누락을 음향 부재가 아닌 실패로 반환
        return emptyScan(AudioScanStatus.FAILED, "SOURCE_NOT_FOUND")
    # 원본 음향 지원 여부와 영상 상대 시간축 검사
    metadata = audioMetadata(path, duration_ms)
    # 외부 작업 취소 검사 존재 여부 확인
    if check_cancelled is not None:
        # 음향 처리 경계에서 작업 취소 요청 확인
        check_cancelled()
    # 사전 검사에서 부재·미지원·실패 결과가 이미 정해졌는지 확인
    if isinstance(metadata, AudioScan):
        # 디코딩 없이 사전 검사에서 확인한 처리 상태 반환
        return metadata
    # 검증된 원본 음향을 채널과 시간 간격을 보존하며 분석
    return pcmScan(path, metadata, check_cancelled)
