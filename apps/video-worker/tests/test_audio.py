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

from replay_video import inspect_audio
from replay_video.infrastructure.audio import (
    AudioFrameMeasures,
    AudioScanStatus,
    UnsupportedAudioError,
    WhistleCueDetector,
    analyze_audio_frame,
    audio_cues,
)


SAMPLE_RATE = 48_000


def tone_frame(*frequencies_hz: float, sample_rate_hz: int = SAMPLE_RATE) -> np.ndarray:
    time = np.arange(sample_rate_hz // 10, dtype=np.float64) / sample_rate_hz
    waveform = sum(np.sin(2 * np.pi * frequency * time) for frequency in frequencies_hz)
    return (0.2 * waveform / max(len(frequencies_hz), 1))[:, None]


@pytest.mark.parametrize("frequencies", [(3_700, 4_100), (3_650, 4_000, 4_350)])
def test_two_or_three_whistle_band_tones_are_auditable_positive_frames(frequencies):
    measures = analyze_audio_frame(tone_frame(*frequencies), SAMPLE_RATE)

    assert measures.is_whistle_like
    assert measures.rms >= 1e-4
    assert measures.band_power_ratio >= 0.15
    assert measures.normalized_spectral_entropy <= 0.65
    assert len(measures.peak_frequencies_hz) == len(frequencies)
    assert measures.peak_frequencies_hz == pytest.approx(frequencies, abs=12)


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
    assert not analyze_audio_frame(waveform, SAMPLE_RATE).is_whistle_like


def test_white_and_band_limited_noise_are_not_multitone_cues():
    random = np.random.default_rng(20260909)
    white = random.normal(0, 0.1, (4_800, 1))
    spectrum = np.zeros(2_401, dtype=np.complex128)
    frequencies = np.fft.rfftfreq(4_800, 1 / SAMPLE_RATE)
    band = (frequencies >= 3_500) & (frequencies <= 4_500)
    spectrum[band] = random.normal(size=band.sum()) + 1j * random.normal(size=band.sum())
    band_noise = np.fft.irfft(spectrum, n=4_800)[:, None]

    assert not analyze_audio_frame(white, SAMPLE_RATE).is_whistle_like
    band_measures = analyze_audio_frame(band_noise, SAMPLE_RATE)
    assert band_measures.band_power_ratio >= 0.15
    assert not band_measures.is_whistle_like


def test_antiphase_stereo_uses_channel_power_instead_of_cancelling_waveforms():
    mono = tone_frame(3_700, 4_100)
    stereo = np.column_stack((mono[:, 0], -mono[:, 0]))

    assert analyze_audio_frame(stereo, SAMPLE_RATE).is_whistle_like


def test_24khz_input_uses_a_100ms_frame_and_the_same_frequency_band():
    measures = analyze_audio_frame(tone_frame(3_700, 4_100, sample_rate_hz=24_000), 24_000)

    assert measures.is_whistle_like
    assert measures.peak_frequencies_hz == pytest.approx((3_700, 4_100), abs=12)


def test_a_single_frame_impulse_is_filtered():
    impulse = np.zeros((4_800, 1), dtype=np.float64)
    impulse[2_400, 0] = 1.0

    assert not analyze_audio_frame(impulse, SAMPLE_RATE).is_whistle_like


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
    with pytest.raises(ValueError):
        analyze_audio_frame(waveform, SAMPLE_RATE)


def test_sampling_rate_without_the_full_analysis_band_is_explicitly_unsupported():
    with pytest.raises(UnsupportedAudioError):
        analyze_audio_frame(np.zeros((800, 1)), 8_000)


def frame_measures(positive: bool, rms: float = 0.1) -> AudioFrameMeasures:
    return AudioFrameMeasures(
        is_whistle_like=positive,
        rms=rms,
        band_power_ratio=0.9 if positive else 0.0,
        normalized_spectral_entropy=0.2 if positive else 1.0,
        peak_frequencies_hz=(3_700.0, 4_100.0) if positive else (),
        local_peak_count=2 if positive else 0,
    )


def collect_cues(sequence: list[bool], *, offset_ms: int = 0, end_ms: int | None = None):
    detector = WhistleCueDetector(media_end_ms=end_ms)
    cues = []
    for index, positive in enumerate(sequence):
        cue = detector.update(frame_measures(positive), offset_ms + index * 100)
        if cue is not None:
            cues.append(cue)
    final = detector.finish()
    if final is not None:
        cues.append(final)
    return cues


def test_two_contiguous_positive_frames_form_a_cue_with_original_bounds():
    cues = collect_cues([False, True, True, False], offset_ms=1_000)

    assert [asdict(cue) for cue in cues] == [{
        "start_ms": 1_100,
        "end_ms": 1_300,
        "peak_frequencies_hz": (3_700.0, 4_100.0),
        "frame_count": 2,
        "kind": "WHISTLE_LIKE_AUDIO",
        "method": "spectral-multitone-v1",
    }]


def test_negative_frame_does_not_bridge_positive_runs_and_short_runs_are_dropped():
    cues = collect_cues([True, False, True, True, False, True])

    assert [(cue.start_ms, cue.end_ms) for cue in cues] == [(200, 400)]


def test_cue_end_is_clamped_to_the_metadata_end():
    cues = collect_cues([True, True, True], offset_ms=900, end_ms=1_150)

    assert [(cue.start_ms, cue.end_ms, cue.frame_count) for cue in cues] == [(900, 1_150, 3)]


def test_cue_start_is_clamped_to_the_video_origin():
    cues = collect_cues([True, True, True], offset_ms=-100)

    assert [(cue.start_ms, cue.end_ms, cue.frame_count) for cue in cues] == [(0, 200, 3)]


def test_clamping_cannot_turn_less_than_200ms_at_video_start_into_a_cue():
    assert collect_cues([True, True], offset_ms=-150) == []


def test_clamping_cannot_turn_less_than_200ms_at_video_end_into_a_cue():
    assert collect_cues([True, True], offset_ms=900, end_ms=1_050) == []


def run_ffmpeg(*arguments: str) -> None:
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def make_delayed_audio_video(path: Path) -> None:
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=1",
        "-itsoffset", "0.3",
        "-f", "lavfi", "-i", f"aevalsrc={expression}:s=48000:d=0.4",
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "ffv1", "-c:a", "pcm_s16le", str(path),
    )


def make_silent_audio_video(path: Path) -> None:
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=0.5",
        "-f", "lavfi", "-i", "anullsrc=r=24000:cl=stereo:d=0.5",
        "-map", "0:v:0", "-map", "1:a:0", "-shortest",
        "-c:v", "ffv1", "-c:a", "pcm_s16le", str(path),
    )


def test_ffmpeg_scan_preserves_audio_offset_on_the_video_timeline(tmp_path):
    source = tmp_path / "delayed.mkv"
    make_delayed_audio_video(source)

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.COMPLETE
    assert scan.reason is None
    assert scan.source_audio_sample_rate_hz == 48_000
    assert scan.source_audio_channels == 1
    assert scan.audio_offset_ms == 300
    assert scan.scanned_start_ms == 300
    assert scan.scanned_end_ms == 700
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(300, 700)]


def test_ffmpeg_scan_does_not_double_apply_offset_when_audio_runs_to_video_end(tmp_path):
    source = tmp_path / "delayed-to-end.mkv"
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=1",
        "-itsoffset", "0.6",
        "-f", "lavfi", "-i", f"aevalsrc={expression}:s=48000:d=0.4",
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source),
    )

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.COMPLETE
    assert scan.audio_offset_ms == 600
    assert scan.scanned_start_ms == 600
    assert scan.scanned_end_ms == 1_000
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(600, 1_000)]


def test_ffmpeg_scan_inserts_silence_for_packet_pts_gaps_instead_of_bridging(tmp_path):
    source = tmp_path / "packet-gap.mkv"
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=1",
        "-f", "lavfi", "-i", f"aevalsrc={expression}:s=48000:n=4800:d=0.4",
        "-filter_complex", "[1:a]asetpts=PTS+gte(N\\,9600)*0.5/TB[a]",
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source),
    )

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.COMPLETE
    assert scan.scanned_start_ms == 0
    assert scan.scanned_end_ms == 900
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(0, 200), (700, 900)]


def test_ffmpeg_scan_preserves_an_exact_100ms_packet_pts_gap(tmp_path):
    source = tmp_path / "packet-gap-100ms.mkv"
    expression = "0.12*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=1",
        "-f", "lavfi", "-i", f"aevalsrc={expression}:s=48000:n=4800:d=0.4",
        "-filter_complex", "[1:a]asetpts=PTS+gte(N\\,9600)*0.1/TB[a]",
        "-map", "0:v:0", "-map", "[a]",
        "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source),
    )

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.COMPLETE
    assert scan.decoded_frame_count == 5
    assert scan.scanned_end_ms == 500
    assert [(cue.start_ms, cue.end_ms) for cue in scan.cues] == [(0, 200), (300, 500)]


def test_ffmpeg_scan_reports_silent_audio_as_complete_without_cues(tmp_path):
    source = tmp_path / "silent.mkv"
    make_silent_audio_video(source)

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.COMPLETE
    assert scan.cues == ()
    assert scan.decoded_frame_count == 5


def test_ffmpeg_scan_reports_a_video_without_audio_as_absent(tmp_path):
    source = tmp_path / "video-only.mkv"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=0.3",
        "-an", "-c:v", "ffv1", str(source),
    )

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.ABSENT
    assert scan.reason == "AUDIO_STREAM_ABSENT"


def test_invalid_media_is_failed_instead_of_complete_empty(tmp_path):
    source = tmp_path / "invalid.mp4"
    source.write_text("not media", encoding="utf-8")

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.FAILED
    assert scan.reason == "PROBE_FAILED"
    assert scan.cues == ()


def test_missing_decoder_is_failed_instead_of_complete_empty(tmp_path, monkeypatch):
    source = tmp_path / "video-only.mkv"
    run_ffmpeg(
        "-f", "lavfi", "-i", "color=c=black:s=64x64:r=10:d=0.3",
        "-an", "-c:v", "ffv1", str(source),
    )
    monkeypatch.setenv("PATH", "/definitely-no-media-tools")

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.FAILED
    assert scan.reason == "DECODER_UNAVAILABLE"


def test_non_executable_probe_is_failed_instead_of_raising_permission_error(tmp_path, monkeypatch):
    source = tmp_path / "existing.media"
    source.write_bytes(b"probe is denied before contents are read")

    def permission_denied(*args, **kwargs):
        raise PermissionError("ffprobe is not executable")

    monkeypatch.setattr("replay_video.infrastructure.audio.subprocess.run", permission_denied)

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.FAILED
    assert scan.reason == "DECODER_UNAVAILABLE"


def test_other_probe_process_creation_errors_are_reported_as_failed(tmp_path, monkeypatch):
    source = tmp_path / "existing.media"
    source.write_bytes(b"probe process cannot start")

    def process_creation_failed(*args, **kwargs):
        raise OSError("resource temporarily unavailable")

    monkeypatch.setattr("replay_video.infrastructure.audio.subprocess.run", process_creation_failed)

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.FAILED
    assert scan.reason == "PROBE_FAILED"


@pytest.mark.parametrize("missing_stream_start", ["video", "audio"])
def test_unknown_stream_origin_is_unsupported_instead_of_assumed_aligned(
    tmp_path,
    monkeypatch,
    missing_stream_start,
):
    source = tmp_path / "unknown-origin.media"
    source.write_bytes(b"probe payload supplied by the test")
    video = {
        "index": 0,
        "codec_type": "video",
        "start_time": "0.000",
        "duration": "1.000",
        "disposition": {"attached_pic": 0},
    }
    audio = {
        "index": 1,
        "codec_type": "audio",
        "start_time": "0.000",
        "duration": "1.000",
        "sample_rate": "48000",
        "channels": 1,
    }
    del (video if missing_stream_start == "video" else audio)["start_time"]
    payload = {"streams": [video, audio], "format": {"start_time": "0.000"}}

    def probe_without_stream_origin(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("replay_video.infrastructure.audio.subprocess.run", probe_without_stream_origin)

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.UNSUPPORTED
    assert scan.reason == "TIMELINE_ORIGIN_UNAVAILABLE"


def test_media_without_a_bounded_time_target_is_explicitly_unsupported(tmp_path, monkeypatch):
    source = tmp_path / "unknown-duration.media"
    source.write_bytes(b"probe payload supplied by the test")
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

    def probe_without_duration(*args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, stdout=json.dumps(payload), stderr="")

    monkeypatch.setattr("replay_video.infrastructure.audio.subprocess.run", probe_without_duration)

    scan = audio_cues(source)

    assert scan.status is AudioScanStatus.UNSUPPORTED
    assert scan.reason == "NO_TIME_TARGET"


def test_cli_report_states_observation_scope_without_referee_claims(tmp_path):
    source = tmp_path / "silent.mkv"
    report = tmp_path / "audio-report.json"
    make_silent_audio_video(source)
    result = subprocess.run(
        [
            sys.executable, "-m", "replay_video.inspect_audio", str(source), str(report),
        ],
        cwd=Path(__file__).parents[1],
        env={**os.environ, "PYTHONPATH": "src"},
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    payload = json.loads(report.read_text(encoding="utf-8"))
    assert payload["status"] == "COMPLETE"
    assert payload["cueCount"] == 0
    assert payload["scope"] == "OBSERVED_AUDIO_CUE_ONLY"
    assert payload["notAssessed"] == ["SOURCE_IDENTITY", "REFEREE_DECISION", "RESTART_TYPE"]
    assert payload["method"]["timelineNormalization"] == "FIRST_AUDIO_PTS_TO_ZERO_GAPS_FILLED_WITH_SILENCE"
    assert any("not observed source audio" in limitation for limitation in payload["limitations"])
    assert any("band edges" in limitation for limitation in payload["limitations"])
    assert f"status=COMPLETE cues=0 report={report}" in result.stdout


def test_report_publication_never_overwrites_a_concurrently_created_destination(tmp_path, monkeypatch):
    report = tmp_path / "audio-report.json"
    real_link = os.link

    def competing_link(source, destination, *args, **kwargs):
        Path(destination).write_text("concurrent owner", encoding="utf-8")
        return real_link(source, destination, *args, **kwargs)

    monkeypatch.setattr(inspect_audio.os, "link", competing_link)

    with pytest.raises(FileExistsError):
        inspect_audio._write_new_json(report, {"status": "COMPLETE"})

    assert report.read_text(encoding="utf-8") == "concurrent owner"


def test_report_writer_never_deletes_a_temporary_file_it_did_not_create(tmp_path, monkeypatch):
    report = tmp_path / "audio-report.json"
    preexisting = report.with_name(f".{report.name}.{os.getpid()}.tmp")
    preexisting.write_text("another process", encoding="utf-8")

    def temporary_creation_fails(*args, **kwargs):
        raise FileExistsError("simulated temporary collision")

    monkeypatch.setattr(tempfile, "NamedTemporaryFile", temporary_creation_fails)

    with pytest.raises(FileExistsError):
        inspect_audio._write_new_json(report, {"status": "COMPLETE"})

    assert preexisting.read_text(encoding="utf-8") == "another process"
    assert not report.exists()


def test_report_writer_preserves_an_existing_output_even_if_it_is_the_source_path(tmp_path):
    source_and_report = tmp_path / "source.mp4"
    source_and_report.write_bytes(b"original media bytes")

    with pytest.raises(FileExistsError):
        inspect_audio._write_new_json(source_and_report, {"status": "COMPLETE"})

    assert source_and_report.read_bytes() == b"original media bytes"
