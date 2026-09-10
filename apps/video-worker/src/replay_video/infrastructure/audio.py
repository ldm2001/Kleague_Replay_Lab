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
from typing import Any

import numpy as np


FRAME_DURATION_MS = 100
DECODE_SAMPLE_RATE_HZ = 48_000
MIN_BAND_FREQUENCY_HZ = 3_500
MAX_BAND_FREQUENCY_HZ = 4_500
MIN_RMS = 1e-4
MIN_BAND_POWER_RATIO = 0.15
MAX_NORMALIZED_SPECTRAL_ENTROPY = 0.65
MIN_PEAK_RELATIVE_POWER = 0.1
MIN_PEAK_SEPARATION_HZ = 150
MIN_CUE_FRAMES = 2
MAX_DECODED_SPAN_MS = 4 * 60 * 60 * 1_000
PROCESS_TIMEOUT_SECONDS = 30
MAX_DECODE_RUNTIME_SECONDS = 15 * 60


class UnsupportedAudioError(ValueError):
    pass


class AudioScanStatus(str, Enum):
    COMPLETE = "COMPLETE"
    ABSENT = "ABSENT"
    UNSUPPORTED = "UNSUPPORTED"
    FAILED = "FAILED"


@dataclass(frozen=True, slots=True)
class AudioFrameMeasures:
    is_whistle_like: bool
    rms: float
    band_power_ratio: float
    normalized_spectral_entropy: float
    peak_frequencies_hz: tuple[float, ...]
    local_peak_count: int


@dataclass(frozen=True, slots=True)
class AudioCue:
    start_ms: int
    end_ms: int
    peak_frequencies_hz: tuple[float, ...]
    frame_count: int
    kind: str = "WHISTLE_LIKE_AUDIO"
    method: str = "spectral-multitone-v1"


@dataclass(frozen=True, slots=True)
class AudioScan:
    status: AudioScanStatus
    reason: str | None
    cues: tuple[AudioCue, ...]
    source_audio_sample_rate_hz: int | None
    source_audio_channels: int | None
    video_origin_seconds: float | None
    audio_offset_ms: int | None
    scanned_start_ms: int | None
    scanned_end_ms: int | None
    decoded_frame_count: int


def _empty_scan(status: AudioScanStatus, reason: str) -> AudioScan:
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


def _finite_number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _validate_frame(waveform: np.ndarray, sample_rate_hz: int) -> np.ndarray:
    if type(sample_rate_hz) is not int or sample_rate_hz <= 0:
        raise ValueError("invalid-sample-rate")
    if sample_rate_hz / 2 < MAX_BAND_FREQUENCY_HZ:
        raise UnsupportedAudioError("analysis-band-above-nyquist")
    if not isinstance(waveform, np.ndarray) or waveform.ndim != 2:
        raise ValueError("audio-frame-must-be-n-by-c-array")
    expected_samples = sample_rate_hz * FRAME_DURATION_MS
    if expected_samples % 1_000 or waveform.shape[0] != expected_samples // 1_000 or waveform.shape[1] < 1:
        raise ValueError("audio-frame-must-be-100ms")
    if not np.issubdtype(waveform.dtype, np.number) or np.iscomplexobj(waveform):
        raise ValueError("audio-frame-must-be-real-numeric")
    frame = waveform.astype(np.float64, copy=False)
    if not np.isfinite(frame).all():
        raise ValueError("audio-frame-must-be-finite")
    return frame


def _separated_local_peaks(
    band_power: np.ndarray,
    band_frequencies_hz: np.ndarray,
) -> tuple[float, ...]:
    if band_power.size < 3:
        return ()
    maximum = float(np.max(band_power))
    if maximum <= 0:
        return ()
    local = np.flatnonzero(
        (band_power[1:-1] > band_power[:-2])
        & (band_power[1:-1] >= band_power[2:])
        & (band_power[1:-1] >= maximum * MIN_PEAK_RELATIVE_POWER)
    ) + 1
    ranked = sorted(local, key=lambda index: (-float(band_power[index]), int(index)))
    selected: list[int] = []
    for index in ranked:
        frequency = float(band_frequencies_hz[index])
        if all(abs(frequency - float(band_frequencies_hz[other])) >= MIN_PEAK_SEPARATION_HZ for other in selected):
            selected.append(int(index))
    return tuple(sorted(float(band_frequencies_hz[index]) for index in selected))


def analyze_audio_frame(waveform: np.ndarray, sample_rate_hz: int) -> AudioFrameMeasures:
    """Measure one 100 ms N×C frame without mixing channels or making an event decision."""
    frame = _validate_frame(waveform, sample_rate_hz)
    centered = frame - np.mean(frame, axis=0, keepdims=True)
    rms = float(np.sqrt(np.mean(np.square(centered))))
    windowed = centered * np.hanning(frame.shape[0])[:, None]
    spectrum = np.fft.rfft(windowed, axis=0)
    power = np.mean(np.square(np.abs(spectrum)), axis=1)
    frequencies_hz = np.fft.rfftfreq(frame.shape[0], d=1 / sample_rate_hz)
    non_dc_power = float(np.sum(power[1:]))
    band_mask = (frequencies_hz >= MIN_BAND_FREQUENCY_HZ) & (frequencies_hz <= MAX_BAND_FREQUENCY_HZ)
    band_power = power[band_mask]
    band_frequencies_hz = frequencies_hz[band_mask]
    band_sum = float(np.sum(band_power))
    band_power_ratio = band_sum / non_dc_power if non_dc_power > 0 else 0.0
    if band_sum > 0 and band_power.size > 1:
        probabilities = band_power / band_sum
        nonzero = probabilities[probabilities > 0]
        entropy = float(-np.sum(nonzero * np.log(nonzero)) / math.log(band_power.size))
    else:
        entropy = 1.0
    peaks = _separated_local_peaks(band_power, band_frequencies_hz)
    positive = (
        rms >= MIN_RMS
        and band_power_ratio >= MIN_BAND_POWER_RATIO
        and entropy <= MAX_NORMALIZED_SPECTRAL_ENTROPY
        and len(peaks) in (2, 3)
    )
    return AudioFrameMeasures(
        is_whistle_like=positive,
        rms=rms,
        band_power_ratio=band_power_ratio,
        normalized_spectral_entropy=entropy,
        peak_frequencies_hz=peaks,
        local_peak_count=len(peaks),
    )


class WhistleCueDetector:
    def __init__(self, media_end_ms: int | None = None) -> None:
        if media_end_ms is not None and (type(media_end_ms) is not int or media_end_ms < 0):
            raise ValueError("invalid-media-end")
        self._media_end_ms = media_end_ms
        self._start_ms: int | None = None
        self._last_start_ms: int | None = None
        self._frame_count = 0
        self._representative: AudioFrameMeasures | None = None

    def update(self, measures: AudioFrameMeasures, frame_start_ms: int) -> AudioCue | None:
        if not isinstance(measures, AudioFrameMeasures) or type(frame_start_ms) is not int:
            raise ValueError("invalid-audio-frame-observation")
        emitted = None
        contiguous = self._last_start_ms is None or frame_start_ms == self._last_start_ms + FRAME_DURATION_MS
        if self._start_ms is not None and (not measures.is_whistle_like or not contiguous):
            emitted = self._emit()
        if measures.is_whistle_like:
            if self._start_ms is None:
                self._start_ms = frame_start_ms
                self._frame_count = 0
                self._representative = None
            self._frame_count += 1
            self._last_start_ms = frame_start_ms
            if self._representative is None or measures.rms > self._representative.rms:
                self._representative = measures
        else:
            self._last_start_ms = None
        return emitted

    def finish(self) -> AudioCue | None:
        return self._emit()

    def _emit(self) -> AudioCue | None:
        start_ms = self._start_ms
        last_start_ms = self._last_start_ms
        frame_count = self._frame_count
        representative = self._representative
        self._start_ms = None
        self._last_start_ms = None
        self._frame_count = 0
        self._representative = None
        if start_ms is None or last_start_ms is None or representative is None or frame_count < MIN_CUE_FRAMES:
            return None
        start_ms = max(0, start_ms)
        end_ms = last_start_ms + FRAME_DURATION_MS
        if self._media_end_ms is not None:
            end_ms = min(end_ms, self._media_end_ms)
        if end_ms - start_ms < MIN_CUE_FRAMES * FRAME_DURATION_MS:
            return None
        return AudioCue(
            start_ms=start_ms,
            end_ms=end_ms,
            peak_frequencies_hz=representative.peak_frequencies_hz,
            frame_count=frame_count,
        )


@dataclass(frozen=True, slots=True)
class _MediaAudioMetadata:
    stream_index: int
    sample_rate_hz: int
    channels: int
    video_origin_seconds: float
    audio_offset_ms: int
    video_duration_ms: int


def _probe_audio(path: Path, duration_ms: int | None) -> _MediaAudioMetadata | AudioScan:
    command = [
        "ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=PROCESS_TIMEOUT_SECONDS, check=False)
    except (FileNotFoundError, PermissionError):
        return _empty_scan(AudioScanStatus.FAILED, "DECODER_UNAVAILABLE")
    except subprocess.TimeoutExpired:
        return _empty_scan(AudioScanStatus.FAILED, "PROBE_TIMEOUT")
    except OSError:
        return _empty_scan(AudioScanStatus.FAILED, "PROBE_FAILED")
    if result.returncode != 0:
        return _empty_scan(AudioScanStatus.FAILED, "PROBE_FAILED")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return _empty_scan(AudioScanStatus.FAILED, "PROBE_INVALID")
    streams = payload.get("streams")
    if not isinstance(streams, list):
        return _empty_scan(AudioScanStatus.FAILED, "PROBE_INVALID")
    video = next((
        stream for stream in streams
        if isinstance(stream, dict)
        and stream.get("codec_type") == "video"
        and not bool((stream.get("disposition") or {}).get("attached_pic"))
    ), None)
    if video is None:
        return _empty_scan(AudioScanStatus.UNSUPPORTED, "VIDEO_STREAM_ABSENT")
    audio = next((stream for stream in streams if isinstance(stream, dict) and stream.get("codec_type") == "audio"), None)
    if audio is None:
        return _empty_scan(AudioScanStatus.ABSENT, "AUDIO_STREAM_ABSENT")
    sample_rate_value = _finite_number(audio.get("sample_rate"))
    channels_value = _finite_number(audio.get("channels"))
    if sample_rate_value is None or channels_value is None:
        return _empty_scan(AudioScanStatus.UNSUPPORTED, "AUDIO_METADATA_UNSUPPORTED")
    sample_rate_hz = int(sample_rate_value)
    channels = int(channels_value)
    if sample_rate_hz / 2 < MAX_BAND_FREQUENCY_HZ:
        return _empty_scan(AudioScanStatus.UNSUPPORTED, "ANALYSIS_BAND_ABOVE_NYQUIST")
    if channels < 1 or channels > 32:
        return _empty_scan(AudioScanStatus.UNSUPPORTED, "CHANNEL_COUNT_UNSUPPORTED")
    format_payload = payload.get("format") if isinstance(payload.get("format"), dict) else {}
    video_start = _finite_number(video.get("start_time"))
    audio_start = _finite_number(audio.get("start_time"))
    if video_start is None or audio_start is None:
        return _empty_scan(AudioScanStatus.UNSUPPORTED, "TIMELINE_ORIGIN_UNAVAILABLE")
    video_origin = video_start
    audio_offset_ms = round((audio_start - video_origin) * 1_000)
    if duration_ms is not None:
        if type(duration_ms) is not int or duration_ms <= 0:
            return _empty_scan(AudioScanStatus.UNSUPPORTED, "NO_TIME_TARGET")
        target_duration_ms = duration_ms
    else:
        duration_seconds = _finite_number(video.get("duration"))
        if duration_seconds is None:
            duration_seconds = _finite_number(format_payload.get("duration"))
        if duration_seconds is None or duration_seconds <= 0:
            return _empty_scan(AudioScanStatus.UNSUPPORTED, "NO_TIME_TARGET")
        target_duration_ms = round(duration_seconds * 1_000)
    decoded_span_ms = target_duration_ms - audio_offset_ms
    if target_duration_ms > MAX_DECODED_SPAN_MS or decoded_span_ms > MAX_DECODED_SPAN_MS:
        return _empty_scan(AudioScanStatus.UNSUPPORTED, "DECODED_SPAN_LIMIT_EXCEEDED")
    return _MediaAudioMetadata(
        stream_index=int(audio.get("index")),
        sample_rate_hz=sample_rate_hz,
        channels=channels,
        video_origin_seconds=video_origin,
        audio_offset_ms=audio_offset_ms,
        video_duration_ms=target_duration_ms,
    )


def _scan_pcm(path: Path, metadata: _MediaAudioMetadata) -> AudioScan:
    decode_duration_ms = max(0, metadata.video_duration_ms - metadata.audio_offset_ms)
    if decode_duration_ms == 0:
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
    command = [
        "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
        "-map", f"0:{metadata.stream_index}", "-vn", "-sn", "-dn",
        "-af", (
            f"asetpts=PTS-STARTPTS,aresample={DECODE_SAMPLE_RATE_HZ}:"
            "async=1:first_pts=0:min_hard_comp=0"
        ),
        "-t", f"{decode_duration_ms / 1_000:.3f}",
        "-ac", str(metadata.channels), "-ar", str(DECODE_SAMPLE_RATE_HZ),
        "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1",
    ]
    process: subprocess.Popen[bytes] | None = None
    selector: selectors.BaseSelector | None = None
    frame_bytes = DECODE_SAMPLE_RATE_HZ // 10 * metadata.channels * 4
    pending = bytearray()
    detector = WhistleCueDetector(media_end_ms=metadata.video_duration_ms)
    cues: list[AudioCue] = []
    decoded_frames = 0
    failure_reason: str | None = None
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if process.stdout is None:
            raise RuntimeError("decode-output-unavailable")
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + MAX_DECODE_RUNTIME_SECONDS
        reached_eof = False
        while not reached_eof:
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                failure_reason = "DECODE_TIMEOUT"
                break
            events = selector.select(min(PROCESS_TIMEOUT_SECONDS, remaining_seconds))
            if not events:
                if process.poll() is None:
                    failure_reason = "DECODE_TIMEOUT"
                break
            chunk = os.read(process.stdout.fileno(), 64 * 1_024)
            if not chunk:
                reached_eof = True
                continue
            pending.extend(chunk)
            while len(pending) >= frame_bytes:
                frame_data = bytes(pending[:frame_bytes])
                del pending[:frame_bytes]
                waveform = np.frombuffer(frame_data, dtype="<f4").reshape(-1, metadata.channels)
                measures = analyze_audio_frame(waveform, DECODE_SAMPLE_RATE_HZ)
                timestamp_ms = metadata.audio_offset_ms + decoded_frames * FRAME_DURATION_MS
                cue = detector.update(measures, timestamp_ms)
                if cue is not None:
                    cues.append(cue)
                decoded_frames += 1
                if decoded_frames * FRAME_DURATION_MS >= decode_duration_ms:
                    reached_eof = True
                    break
        if failure_reason is None:
            try:
                remaining_seconds = max(0.001, deadline - time.monotonic())
                return_code = process.wait(timeout=min(PROCESS_TIMEOUT_SECONDS, remaining_seconds))
            except subprocess.TimeoutExpired:
                failure_reason = "DECODE_TIMEOUT"
            else:
                if return_code != 0:
                    failure_reason = "DECODE_FAILED"
        if failure_reason is None:
            final_cue = detector.finish()
            if final_cue is not None:
                cues.append(final_cue)
    except FileNotFoundError:
        failure_reason = "DECODER_UNAVAILABLE"
    except (OSError, RuntimeError, ValueError):
        failure_reason = "DECODE_FAILED"
    finally:
        if selector is not None:
            selector.close()
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process is not None:
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()
    if failure_reason is not None:
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
    scanned_start_ms = min(metadata.video_duration_ms, max(0, metadata.audio_offset_ms))
    scanned_end_ms = min(
        metadata.video_duration_ms,
        max(0, metadata.audio_offset_ms + decoded_frames * FRAME_DURATION_MS),
    )
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


def audio_cues(source: Path | str, duration_ms: int | None = None) -> AudioScan:
    """Stream a bounded media audio track and return observed whistle-like cues on the video timeline."""
    path = Path(source).expanduser().resolve()
    if not path.is_file():
        return _empty_scan(AudioScanStatus.FAILED, "SOURCE_NOT_FOUND")
    metadata = _probe_audio(path, duration_ms)
    if isinstance(metadata, AudioScan):
        return metadata
    return _scan_pcm(path, metadata)
