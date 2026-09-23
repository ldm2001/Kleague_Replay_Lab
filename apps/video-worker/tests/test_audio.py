from __future__ import annotations
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import asdict
from pathlib import Path
import numpy as np
import pytest
from replay_video import sound
from replay_video.infrastructure.audio import (
    AudioFrameMeasures,
    AudioScanStatus,
    UnsupportedAudioError,
    WhistleCueDetector,
    frameMeasures,
    audioCues,
)


# 음향 표본률을 시험 조건에 맞춰 고정
SAMPLE_RATE = 48_000

# 시험용 음 프레임 반환
def tone_frame(*frequencies_hz: float, sample_rate_hz: int = SAMPLE_RATE) -> np.ndarray:
    # 한 프레임에 해당하는 100밀리초 표본 시각 배열 계산
    time = np.arange(sample_rate_hz // 10, dtype=np.float64) / sample_rate_hz
    # 여러 주파수의 사인파를 겹쳐 시험 파형 생성
    waveform = sum(np.sin(2 * np.pi * frequency * time) for frequency in frequencies_hz)
    # 음 개수에 따라 진폭을 정규화하고 단일 채널 배열로 반환
    return (0.2 * waveform / max(len(frequencies_hz), 1))[:, None]

# 휘슬 대역 두세 음의 감사 가능한 양성 프레임 확인
@pytest.mark.parametrize("frequencies", [(3_700, 4_100), (3_650, 4_000, 4_350)])
def test_two_or_three_whistle_band_tones_are_auditable_positive_frames(frequencies):
    # 음향 프레임의 전력과 다중 주파수 특성 측정
    measures = frameMeasures(tone_frame(*frequencies), SAMPLE_RATE)

    # 휘슬 유사 신호 여부가 참이거나 비어 있지 않은지 확인
    assert measures.is_whistle_like
    # 음향 실효 진폭이 허용 경계 조건을 만족하는지 확인
    assert measures.rms >= 1e-4
    # 분석 대역 전력 비율이 허용 경계 조건을 만족하는지 확인
    assert measures.band_power_ratio >= 0.15
    # 정규화된 주파수 엔트로피가 허용 경계 조건을 만족하는지 확인
    assert measures.normalized_spectral_entropy <= 0.65
    # 주요 주파수 목록의 개수가 합성 주파수 목록의 개수와 일치하는지 확인
    assert len(measures.peak_frequencies_hz) == len(frequencies)
    # 주요 주파수 목록이 예상 계약과 일치하는지 확인
    assert measures.peak_frequencies_hz == pytest.approx(frequencies, abs=12)

# 무음·대역 밖·단일 음의 양성 제외 확인
@pytest.mark.parametrize(
    "waveform",
    [
        np.zeros((4_800, 1), dtype=np.float64),
        tone_frame(2_000),
        tone_frame(4_000),
    ],
    ids=["silence", "outside-band-tone", "single-band-tone"],
)
def test_silence_outside_band_and_single_tone_are_not_positive(waveform):
    # 휘슬 유사 신호 여부가 거짓이거나 비어 있는지 확인
    assert not frameMeasures(waveform, SAMPLE_RATE).is_whistle_like

# 백색·대역 제한 잡음의 다중 음 단서 제외 확인
def test_white_and_band_limited_noise_are_not_multitone_cues():
    # 잡음 시험을 재현할 고정 시드 난수 생성기 준비
    random = np.random.default_rng(20260909)
    # 평균이 영인 백색 잡음으로 넓은 주파수 에너지 분포 재현
    white = random.normal(0, 0.1, (4_800, 1))
    # 주파수별 복소 진폭 배열을 지정 크기와 자료형의 시험 배열로 생성
    spectrum = np.zeros(2_401, dtype=np.complex128)
    # 표본률에 대응하는 양의 주파수 축 계산
    frequencies = np.fft.rfftfreq(4_800, 1 / SAMPLE_RATE)
    # 휘슬 분석 범위인 3500에서 4500헤르츠의 주파수만 선택
    band = (frequencies >= 3_500) & (frequencies <= 4_500)
    # 선택 대역의 실수부와 허수부에 독립 잡음 배치
    spectrum[band] = random.normal(size=band.sum()) + 1j * random.normal(size=band.sum())
    # 시험 주파수 성분을 시간축 잡음 파형으로 복원 결과을 후속 비교에 사용할 값으로 보관
    band_noise = np.fft.irfft(spectrum, n=4_800)[:, None]

    # 휘슬 유사 신호 여부가 거짓이거나 비어 있는지 확인
    assert not frameMeasures(white, SAMPLE_RATE).is_whistle_like
    # 음향 프레임의 전력과 다중 주파수 특성 측정
    band_measures = frameMeasures(band_noise, SAMPLE_RATE)
    # 분석 대역 전력 비율이 허용 경계 조건을 만족하는지 확인
    assert band_measures.band_power_ratio >= 0.15
    # 휘슬 유사 신호 여부가 거짓이거나 비어 있는지 확인
    assert not band_measures.is_whistle_like

# 역위상 스테레오의 파형 상쇄 대신 채널 전력 사용 확인
def test_antiphase_stereo_uses_channel_power_instead_of_cancelling_waveforms():
    # 지정 주파수를 겹친 시험 음향 프레임 생성
    mono = tone_frame(3_700, 4_100)
    # 서로 반대 위상인 파형을 두 채널로 결합
    stereo = np.column_stack((mono[:, 0], -mono[:, 0]))

    # 휘슬 유사 신호 여부가 참이거나 비어 있지 않은지 확인
    assert frameMeasures(stereo, SAMPLE_RATE).is_whistle_like

# 24킬로헤르츠 입력의 100밀리초 프레임과 동일 주파수 대역 확인
def test_24khz_input_uses_a_100ms_frame_and_the_same_frequency_band():
    # 음향 프레임의 전력과 다중 주파수 특성 측정
    measures = frameMeasures(tone_frame(3_700, 4_100, sample_rate_hz=24_000), 24_000)

    # 휘슬 유사 신호 여부가 참이거나 비어 있지 않은지 확인
    assert measures.is_whistle_like
    # 주요 주파수 목록이 예상 계약과 일치하는지 확인
    assert measures.peak_frequencies_hz == pytest.approx((3_700, 4_100), abs=12)

# 단일 프레임 충격 제거 확인
def test_a_single_frame_impulse_is_filtered():
    # 단일 충격 파형을 지정 크기와 자료형의 시험 배열로 생성
    impulse = np.zeros((4_800, 1), dtype=np.float64)
    # 단일 충격 파형을 시험 조건에 맞춰 고정
    impulse[2_400, 0] = 1.0

    # 휘슬 유사 신호 여부가 거짓이거나 비어 있는지 확인
    assert not frameMeasures(impulse, SAMPLE_RATE).is_whistle_like

# 잘못된 형태·타입·비유한 프레임 값 거부 확인
@pytest.mark.parametrize(
    "waveform",
    [
        np.zeros(4_800),
        np.zeros((4_800, 0)),
        np.zeros((4_799, 1)),
        np.zeros((4_800, 1), dtype=np.complex128),
        np.array([[np.nan]] * 4_800),
        np.array([[np.inf]] * 4_800),
        np.array([["audio"]] * 4_800),
    ],
)
def test_bad_shape_type_and_nonfinite_frame_values_are_rejected(waveform):
    # 잘못된 형태·타입·비유한 프레임 값 거부를 위한 예상 예외 확인
    with pytest.raises(ValueError):
        # 음향 프레임의 전력과 다중 주파수 특성 측정
        frameMeasures(waveform, SAMPLE_RATE)

# 전체 분석 대역 미포함 표본률의 미지원 확인
def test_sampling_rate_without_the_full_analysis_band_is_explicitly_unsupported():
    # 전체 분석 대역 미포함 표본률의 미지원을 위한 예상 예외 확인
    with pytest.raises(UnsupportedAudioError):
        # 음향 프레임의 전력과 다중 주파수 특성 측정
        frameMeasures(np.zeros((800, 1)), 8_000)

# 프레임 측정값 반환
def frame_measures(positive: bool, rms: float = 0.1) -> AudioFrameMeasures:
    # 실제 주파수 계산 대신 양성 여부가 정해진 측정값 반환
    return AudioFrameMeasures(
        is_whistle_like=positive,
        rms=rms,
        band_power_ratio=0.9 if positive else 0.0,
        normalized_spectral_entropy=0.2 if positive else 1.0,
        peak_frequencies_hz=(3_700.0, 4_100.0) if positive else (),
        local_peak_count=2 if positive else 0,
    )

# 음향 단서 수집
def collect_cues(sequence: list[bool], *, offset_ms: int = 0, end_ms: int | None = None):
    # 연속 프레임으로 음향 단서를 묶는 검출기 생성
    detector = WhistleCueDetector(media_end_ms=end_ms)
    # 관측 단서 목록을 누적할 빈 자료 구조 준비
    cues = []
    # 양성·음성 순서에 100밀리초 간격을 붙여 검출기에 전달
    for index, positive in enumerate(sequence):
        # 단서 검출기에 입력을 반영하여 상태 갱신
        cue = detector.update(frame_measures(positive), offset_ms + index * 100)
        # 검출기가 종료된 단서를 내놓은 경우에만 수집
        if cue is not None:
            # 관측 단서 목록에 이번 항목 추가
            cues.append(cue)
    # 입력이 끝날 때 아직 열린 양성 구간 마감
    final = detector.finish()
    # 마감 과정에서 마지막 단서가 생겼는지 분기
    if final is not None:
        # 관측 단서 목록에 이번 항목 추가
        cues.append(final)
    # 관측 단서 목록을 호출자에게 반환
    return cues

# 연속 양성 두 프레임의 원본 범위 단서 생성 확인
def test_two_contiguous_positive_frames_form_a_cue_with_original_bounds():
    # 연속 양성 프레임을 음향 단서 구간으로 집계
    cues = collect_cues([False, True, True, False], offset_ms=1_000)

    # 관측 단서 목록이 예상 계약과 일치하는지 확인
    assert [asdict(cue) for cue in cues] == [{
        "start_ms": 1_100,
        "end_ms": 1_300,
        "peak_frequencies_hz": (3_700.0, 4_100.0),
        "frame_count": 2,
        "kind": "WHISTLE_LIKE_AUDIO",
        "method": "spectral-multitone-v1",
    }]

# 비양성 프레임의 양성 구간 연결 차단과 짧은 구간 제거 확인
def test_negative_frame_does_not_bridge_positive_runs_and_short_runs_are_dropped():
    # 연속 양성 프레임을 음향 단서 구간으로 집계
    cues = collect_cues([True, False, True, True, False, True])

    # 시작 시각 · 종료 시각 목록이 예상 계약과 일치하는지 확인
    assert [(cue.start_ms, cue.end_ms) for cue in cues] == [(200, 400)]

# 단서 종료의 메타데이터 종료 범위 제한 확인
def test_cue_end_is_clamped_to_the_metadata_end():
    # 연속 양성 프레임을 음향 단서 구간으로 집계
    cues = collect_cues([True, True, True], offset_ms=900, end_ms=1_150)

    # 시작 시각 · 종료 시각 · 프레임 수 목록이 예상 계약과 일치하는지 확인
    assert [(cue.start_ms, cue.end_ms, cue.frame_count) for cue in cues] == [(900, 1_150, 3)]

# 단서 시작의 영상 원점 제한 확인
def test_cue_start_is_clamped_to_the_video_origin():
    # 연속 양성 프레임을 음향 단서 구간으로 집계
    cues = collect_cues([True, True, True], offset_ms=-100)

    # 시작 시각 · 종료 시각 · 프레임 수 목록이 예상 계약과 일치하는지 확인
    assert [(cue.start_ms, cue.end_ms, cue.frame_count) for cue in cues] == [(0, 200, 3)]

# 영상 시작의 200밀리초 미만 구간의 단서 승격 방지 확인
def test_clamping_cannot_turn_less_than_200ms_at_video_start_into_a_cue():
    # 연속 양성 프레임을 음향 단서 구간으로 집계 결과이 빈 값으로 유지되는지 확인
    assert collect_cues([True, True], offset_ms=-150) == []

# 영상 끝의 200밀리초 미만 구간의 단서 승격 방지 확인
def test_clamping_cannot_turn_less_than_200ms_at_video_end_into_a_cue():
    # 연속 양성 프레임을 음향 단서 구간으로 집계 결과이 빈 값으로 유지되는지 확인
    assert collect_cues([True, True], offset_ms=900, end_ms=1_050) == []

# 미디어 명령 실행
def run_ffmpeg(*arguments: str) -> None:
    # 시험 미디어 명령을 실행하고 종료 상태와 출력을 수집
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    # 외부 명령 종료 코드가 0과 일치하는지 확인
    assert result.returncode == 0, result.stderr

# 음향 지연 영상 구성
def make_delayed_audio_video(path: Path) -> None:
    # 합성 신호 생성식을 시험 조건에 맞춰 고정
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=10:d=1",
        "-itsoffset",
        "0.3",
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expression}:s=48000:d=0.4",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(path),
    )

# 무음 트랙 영상 구성
def make_silent_audio_video(path: Path) -> None:
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=10:d=0.5",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=24000:cl=stereo:d=0.5",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-shortest",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(path),
    )

# 영상 시간축의 음향 시각 차이 보존 확인
def test_ffmpeg_scan_preserves_audio_offset_on_the_video_timeline(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "delayed.mkv"
    # 영상보다 소리가 늦게 시작하는 시험 파일 생성
    make_delayed_audio_video(source)

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.COMPLETE
    # 사유가 비어 있는지 확인
    assert scan.reason is None
    # 원본 음향 표본률이 48000과 일치하는지 확인
    assert scan.source_audio_sample_rate_hz == 48_000
    # 원본 음향 채널 수가 1과 일치하는지 확인
    assert scan.source_audio_channels == 1
    # 영상 대비 음향 시각 차이가 300과 일치하는지 확인
    assert scan.audio_offset_ms == 300
    # 음향 탐색 시작 시각이 300과 일치하는지 확인
    assert scan.scanned_start_ms == 300
    # 음향 탐색 종료 시각이 700과 일치하는지 확인
    assert scan.scanned_end_ms == 700
    # 시작 시각 · 종료 시각 목록이 예상 계약과 일치하는지 확인
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(300, 700)]

# 영상 끝까지 이어진 음향의 시각 보정 중복 방지 확인
def test_ffmpeg_scan_does_not_double_apply_offset_when_audio_runs_to_video_end(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "delayed-to-end.mkv"
    # 합성 신호 생성식을 시험 조건에 맞춰 고정
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=10:d=1",
        "-itsoffset",
        "0.6",
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expression}:s=48000:d=0.4",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(source),
    )

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.COMPLETE
    # 영상 대비 음향 시각 차이가 600과 일치하는지 확인
    assert scan.audio_offset_ms == 600
    # 음향 탐색 시작 시각이 600과 일치하는지 확인
    assert scan.scanned_start_ms == 600
    # 음향 탐색 종료 시각이 1000과 일치하는지 확인
    assert scan.scanned_end_ms == 1_000
    # 시작 시각 · 종료 시각 목록이 예상 계약과 일치하는지 확인
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(600, 1_000)]

# 패킷 시각 공백의 무음 보충 확인
def test_ffmpeg_scan_inserts_silence_for_packet_pts_gaps_instead_of_bridging(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "packet-gap.mkv"
    # 합성 신호 생성식을 시험 조건에 맞춰 고정
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=10:d=1",
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expression}:s=48000:n=4800:d=0.4",
        "-filter_complex",
        "[1:a]asetpts=PTS+gte(N\\,9600)*0.5/TB[a]",
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(source),
    )

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.COMPLETE
    # 음향 탐색 시작 시각이 0과 일치하는지 확인
    assert scan.scanned_start_ms == 0
    # 음향 탐색 종료 시각이 900과 일치하는지 확인
    assert scan.scanned_end_ms == 900
    # 시작 시각 · 종료 시각 목록이 예상 계약과 일치하는지 확인
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(0, 200), (700, 900)]

# 100밀리초 패킷 시각 간격의 정확한 보존 확인
def test_ffmpeg_scan_preserves_an_exact_100ms_packet_pts_gap(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "packet-gap-100ms.mkv"
    # 합성 신호 생성식을 시험 조건에 맞춰 고정
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=10:d=1",
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expression}:s=48000:n=4800:d=0.4",
        "-filter_complex",
        "[1:a]asetpts=PTS+gte(N\\,9600)*0.1/TB[a]",
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        str(source),
    )

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.COMPLETE
    # 디코딩한 프레임 수가 5과 일치하는지 확인
    assert scan.decoded_frame_count == 5
    # 음향 탐색 종료 시각이 500과 일치하는지 확인
    assert scan.scanned_end_ms == 500
    # 시작 시각 · 종료 시각 목록이 예상 계약과 일치하는지 확인
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(0, 200), (300, 500)]

# 무음 음향의 단서 없는 완료 보고 확인
def test_ffmpeg_scan_reports_silent_audio_as_complete_without_cues(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "silent.mkv"
    # 소리 트랙은 있으나 진폭이 없는 시험 영상 생성
    make_silent_audio_video(source)

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.COMPLETE
    # 관측 단서 목록이 빈 값으로 유지되는지 확인
    assert scan.cues == ()
    # 디코딩한 프레임 수가 5과 일치하는지 확인
    assert scan.decoded_frame_count == 5

# 음향 없는 영상의 부재 상태 보고 확인
def test_ffmpeg_scan_reports_a_video_without_audio_as_absent(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "video-only.mkv"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=10:d=0.3",
        "-an",
        "-c:v",
        "ffv1",
        str(source),
    )

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.ABSENT
    # 사유가 예상 계약과 일치하는지 확인
    assert scan.reason == "AUDIO_STREAM_ABSENT"

# 잘못된 미디어의 빈 완료 대신 실패 보고 확인
def test_invalid_media_is_failed_instead_of_complete_empty(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "invalid.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_text("not media", encoding="utf-8")

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.FAILED
    # 사유가 예상 계약과 일치하는지 확인
    assert scan.reason == "PROBE_FAILED"
    # 관측 단서 목록이 빈 값으로 유지되는지 확인
    assert scan.cues == ()

# 디코더 부재의 빈 완료 대신 실패 보고 확인
def test_missing_decoder_is_failed_instead_of_complete_empty(tmp_path, monkeypatch):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "video-only.mkv"
    # 외부 미디어 도구로 합성 시험 파일 생성
    run_ffmpeg(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:r=10:d=0.3",
        "-an",
        "-c:v",
        "ffv1",
        str(source),
    )
    # 실행 환경 변수를 고정하여 주변 환경 영향 차단
    monkeypatch.setenv("PATH", "/definitely-no-media-tools")

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.FAILED
    # 사유가 예상 계약과 일치하는지 확인
    assert scan.reason == "DECODER_UNAVAILABLE"

# 실행 불가 조회 도구의 권한 예외 대신 실패 보고 확인
def test_non_executable_probe_is_failed_instead_of_raising_permission_error(tmp_path, monkeypatch):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "existing.media"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"probe is denied before contents are read")

    # 권한 거부 모형
    def permission_denied(*args, **kwargs):
        # 권한 거부 모형 경로를 재현하는 예외 발생
        raise PermissionError("ffprobe is not executable")

    # 음향 입력의 성공·실패 조건을 고정하도록 관측 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.audio.subprocess.run", permission_denied)

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.FAILED
    # 사유가 예상 계약과 일치하는지 확인
    assert scan.reason == "DECODER_UNAVAILABLE"

# 조회 프로세스 생성 오류의 실패 보고 확인
def test_other_probe_process_creation_errors_are_reported_as_failed(tmp_path, monkeypatch):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "existing.media"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"probe process cannot start")

    # 프로세스 생성 실패 모형
    def process_creation_failed(*args, **kwargs):
        # 프로세스 생성 실패 모형 경로를 재현하는 예외 발생
        raise OSError("resource temporarily unavailable")

    # 음향 입력의 성공·실패 조건을 고정하도록 관측 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.audio.subprocess.run", process_creation_failed)

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.FAILED
    # 사유가 예상 계약과 일치하는지 확인
    assert scan.reason == "PROBE_FAILED"

# 미확인 스트림 원점의 정렬 추정 대신 미지원 확인
@pytest.mark.parametrize("missing_stream_start", ["video", "audio"])
def test_unknown_stream_origin_is_unsupported_instead_of_assumed_aligned(
    tmp_path,
    monkeypatch,
    missing_stream_start,
):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "unknown-origin.media"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"probe payload supplied by the test")
    # 시험 영상 정보를 비교에 사용할 고정 시험 자료로 구성
    video = {
        "index": 0,
        "codec_type": "video",
        "start_time": "0.000",
        "duration": "1.000",
        "disposition": {"attached_pic": 0},
    }
    # 음향 관측 정보를 비교에 사용할 고정 시험 자료로 구성
    audio = {
        "index": 1,
        "codec_type": "audio",
        "start_time": "0.000",
        "duration": "1.000",
        "sample_rate": "48000",
        "channels": 1,
    }
    # 영상 또는 음향의 시작 시각을 제거하여 원점 미확인 상황 재현
    del (video if missing_stream_start == "video" else audio)["start_time"]
    # 전송 본문을 비교에 사용할 고정 시험 자료로 구성
    payload = {"streams": [video, audio], "format": {"start_time": "0.000"}}

    # 원점 없는 스트림 조회 모형
    def probe_without_stream_origin(*args, **kwargs):
        # 외부 명령을 실행하지 않고 조회 결과를 담은 응답 결과 반환
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    # 음향 입력의 성공·실패 조건을 고정하도록 관측 대역 연결
    monkeypatch.setattr(
        "replay_video.infrastructure.audio.subprocess.run", probe_without_stream_origin
    )

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.UNSUPPORTED
    # 사유가 예상 계약과 일치하는지 확인
    assert scan.reason == "TIMELINE_ORIGIN_UNAVAILABLE"

# 시간 범위 없는 미디어의 미지원 보고 확인
def test_media_without_a_bounded_time_target_is_explicitly_unsupported(tmp_path, monkeypatch):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "unknown-duration.media"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"probe payload supplied by the test")
    # 전송 본문을 비교에 사용할 고정 시험 자료로 구성
    payload = {
        "streams": [
            {
                "index": 0,
                "codec_type": "video",
                "start_time": "0.000",
                "disposition": {"attached_pic": 0},
            },
            {
                "index": 1,
                "codec_type": "audio",
                "start_time": "0.000",
                "sample_rate": "48000",
                "channels": 1,
            },
        ],
        "format": {},
    }

    # 길이 없는 조회 모형
    def probe_without_duration(*args, **kwargs):
        # 외부 명령을 실행하지 않고 조회 결과를 담은 응답 결과 반환
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    # 음향 입력의 성공·실패 조건을 고정하도록 관측 대역 연결
    monkeypatch.setattr("replay_video.infrastructure.audio.subprocess.run", probe_without_duration)

    # 원본 시간축으로 음향 단서 탐색
    scan = audioCues(source)

    # 처리 상태가 예상 계약과 일치하는지 확인
    assert scan.status is AudioScanStatus.UNSUPPORTED
    # 사유가 예상 계약과 일치하는지 확인
    assert scan.reason == "NO_TIME_TARGET"

# 명령행 보고서의 관측 범위와 심판 판단 분리 확인
def test_cli_report_states_observation_scope_without_referee_claims(tmp_path):
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "silent.mkv"
    # 분석 보고서를 시험용 기준 경로에서 구성
    report = tmp_path / "audio-report.json"
    # 소리 트랙은 있으나 진폭이 없는 시험 영상 생성
    make_silent_audio_video(source)
    # 시험 미디어 명령을 실행하고 종료 상태와 출력을 수집
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            'replay_video.sound',
            str(source),
            str(report),
        ],
        cwd=Path(__file__).parents[1],
        env={**os.environ, "PYTHONPATH": "src"},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    # 외부 명령 종료 코드가 0과 일치하는지 확인
    assert result.returncode == 0, result.stderr
    # 저장된 문자열을 구조화된 자료로 읽음
    payload = json.loads(report.read_text(encoding="utf-8"))
    # 처리 상태가 예상 계약과 일치하는지 확인
    assert payload["status"] == "COMPLETE"
    # 음향 단서 수가 0과 일치하는지 확인
    assert payload["cueCount"] == 0
    # 평가 범위가 예상 계약과 일치하는지 확인
    assert payload["scope"] == "OBSERVED_AUDIO_CUE_ONLY"
    # 미평가 항목이 예상 계약과 일치하는지 확인
    assert payload["notAssessed"] == ["SOURCE_IDENTITY", "REFEREE_DECISION", "RESTART_TYPE"]
    # 시간축 정규화 정보가 예상 계약과 일치하는지 확인
    assert (
        payload["method"]["timelineNormalization"]
        == "FIRST_AUDIO_PTS_TO_ZERO_GAPS_FILLED_WITH_SILENCE"
    )
    # 합성 비교를 실제 원본 음향 관측으로 오인하지 않도록 한계 명시 확인
    assert any("not observed source audio" in limitation for limitation in payload["limitations"])
    # 휘슬 분석 주파수 대역의 경계 한계가 보고서에 남는지 확인
    assert any("band edges" in limitation for limitation in payload["limitations"])
    # 명령행 요약에 완료 상태와 영 개 단서 및 보고서 경로가 나오는지 확인
    assert f"status=COMPLETE cues=0 report={report}" in result.stdout

# 동시 생성된 보고서 대상의 덮어쓰기 방지 확인
def test_report_publication_never_overwrites_a_concurrently_created_destination(
    tmp_path, monkeypatch
):
    # 분석 보고서를 시험용 기준 경로에서 구성
    report = tmp_path / "audio-report.json"
    # 경합 상황을 주입한 뒤 실제 게시를 이어갈 원래 연결 함수 보관
    real_link = os.link

    # 동시 파일 연결 모형
    def competing_link(source, destination, *args, **kwargs):
        # 시험에 사용할 파일 경로 구성 결과에 시험 내용을 기록
        Path(destination).write_text("concurrent owner", encoding="utf-8")
        # 경합 파일 생성 이후 실제 파일 연결 동작으로 복귀
        return real_link(source, destination, *args, **kwargs)

    # 게시 직전에 다른 실행이 파일을 만드는 경합 대역 연결
    monkeypatch.setattr(sound.os, "link", competing_link)

    # 동시 생성된 보고서 대상의 덮어쓰기 방지을 위한 예상 예외 확인
    with pytest.raises(FileExistsError):
        # 기존 파일을 덮어쓰지 않는 보고서 게시 시도
        sound.publication(report, {"status": "COMPLETE"})

    # 분석 보고서의 내용이 예상 계약과 일치하는지 확인
    assert report.read_text(encoding="utf-8") == "concurrent owner"

# 직접 생성하지 않은 임시 파일의 삭제 방지 확인
def test_report_writer_never_deletes_a_temporary_file_it_did_not_create(tmp_path, monkeypatch):
    # 분석 보고서를 시험용 기준 경로에서 구성
    report = tmp_path / "audio-report.json"
    # 다른 프로세스가 이미 만들었을 법한 임시 파일 경로 구성
    preexisting = report.with_name(f".{report.name}.{os.getpid()}.tmp")
    # 다른 실행이 만든 임시 파일에 시험 내용을 기록
    preexisting.write_text("another process", encoding="utf-8")

    # 임시 파일 생성 실패 모형
    def temporary_creation_fails(*args, **kwargs):
        # 임시 파일 생성 실패 모형 경로를 재현하는 예외 발생
        raise FileExistsError("simulated temporary collision")

    # 임시 파일 생성 실패를 주입하여 타인 파일 보존 경로 실행
    monkeypatch.setattr(tempfile, "NamedTemporaryFile", temporary_creation_fails)

    # 직접 생성하지 않은 임시 파일의 삭제 방지을 위한 예상 예외 확인
    with pytest.raises(FileExistsError):
        # 기존 파일을 덮어쓰지 않는 보고서 게시 시도
        sound.publication(report, {"status": "COMPLETE"})

    # 다른 실행이 만든 임시 파일의 내용이 예상 계약과 일치하는지 확인
    assert preexisting.read_text(encoding="utf-8") == "another process"
    # 분석 보고서의 존재 여부가 거짓이거나 비어 있는지 확인
    assert not report.exists()

# 출력이 원본 경로여도 기존 파일 보존 확인
def test_report_writer_preserves_an_existing_output_even_if_it_is_the_source_path(tmp_path):
    # 원본과 출력이 겹치는 파일 경로를 시험용 기준 경로에서 구성
    source_and_report = tmp_path / "source.mp4"
    # 원본과 출력이 겹치는 파일 경로에 시험 내용을 기록
    source_and_report.write_bytes(b"original media bytes")

    # 출력이 원본 경로여도 기존 파일 보존을 위한 예상 예외 확인
    with pytest.raises(FileExistsError):
        # 기존 파일을 덮어쓰지 않는 보고서 게시 시도
        sound.publication(source_and_report, {"status": "COMPLETE"})

    # 원본과 출력이 겹치는 파일 경로의 내용이 예상 계약과 일치하는지 확인
    assert source_and_report.read_bytes() == b"original media bytes"
