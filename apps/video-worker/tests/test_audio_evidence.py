"""Real-media tests for preserving source audio on the video's timeline."""

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

from replay_video.infrastructure.evidence import clip
from replay_video.infrastructure.av_media import ClipStreams, clip_streams
from replay_video.domain.models import Candidate, VideoMetadata


SAMPLE_RATE = 48_000


def ffmpeg(*args: str) -> None:
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True, text=True, timeout=30, check=False,
    )
    assert result.returncode == 0, result.stderr


def streams(path: Path) -> list[dict]:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=10, check=True,
    )
    return json.loads(result.stdout)["streams"]


def waveform(path: Path, channel: int = 0) -> np.ndarray:
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
         "-af", "aresample=48000:async=1:first_pts=0", "-ar", "48000",
         "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"],
        capture_output=True, timeout=15, check=True,
    )
    channels = next(s["channels"] for s in streams(path) if s["codec_type"] == "audio")
    return np.frombuffer(result.stdout, dtype="<f4").reshape(-1, channels)[:, channel]


def first_tone_onset_ms(samples: np.ndarray) -> int:
    # 20 ms RMS windows stay robust to AAC priming and codec ringing.
    window = SAMPLE_RATE // 50
    levels = [np.sqrt(np.mean(samples[i:i + window] ** 2))
              for i in range(0, len(samples) - window + 1, window)]
    return next(index * 20 for index, level in enumerate(levels) if level > 0.025)


def media(path: Path, *, video_origin: float, audio_origin: float,
          pulse_local: float, stereo_antiphase: bool = False, duration: float = 1.5) -> None:
    expression = f"0.35*sin(2*PI*1000*t)*between(t\\,{pulse_local}\\,{pulse_local + 0.14})"
    if stereo_antiphase:
        expression = f"{expression}|-({expression})"
    ffmpeg(
        "-itsoffset", str(video_origin), "-f", "lavfi", "-i", f"color=c=black:s=64x64:r=20:d={duration}",
        "-itsoffset", str(audio_origin), "-f", "lavfi", "-i",
        f"aevalsrc={expression}:s={SAMPLE_RATE}:d={duration}",
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(path),
    )


@pytest.mark.parametrize(
    ("video_origin", "audio_origin", "pulse_local", "start_ms", "end_ms", "expected_ms"),
    [
        (0, 0.3, 0.1, 0, 1000, 400),
        (0, -0.2, 0.4, 0, 1000, 200),
        (5, 5.3, 0.1, 0, 1000, 400),
        (5, 4.8, 0.4, 0, 1000, 200),
        (5, 5.3, 0.8, 500, 1200, 600),
    ],
)
def test_clip_preserves_audio_on_video_relative_timeline(
    tmp_path, video_origin, audio_origin, pulse_local, start_ms, end_ms, expected_ms,
):
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    media(source, video_origin=video_origin, audio_origin=audio_origin, pulse_local=pulse_local)

    audio_result = clip(source, output, start_ms, end_ms)

    tracks = streams(output)
    assert len([s for s in tracks if s["codec_type"] == "video"]) == 1
    assert len([s for s in tracks if s["codec_type"] == "audio"]) == 1
    assert (audio_result.status, audio_result.reason) == ("PRESERVED", None)
    output_onset = first_tone_onset_ms(waveform(output))
    assert output_onset == pytest.approx(expected_ms, abs=50)
    source_tracks = streams(source)
    video_start = float(next(s["start_time"] for s in source_tracks if s["codec_type"] == "video"))
    audio_start = float(next(s["start_time"] for s in source_tracks if s["codec_type"] == "audio"))
    source_onset = first_tone_onset_ms(waveform(source))
    assert output_onset + start_ms == pytest.approx(
        source_onset + round((min(video_start, audio_start) - video_start) * 1000), abs=50,
    )
    assert float(next(s["duration"] for s in tracks if s["codec_type"] == "video")) == pytest.approx(
        (end_ms - start_ms) / 1000, abs=0.06,
    )


def test_clip_keeps_antiphase_stereo_channels_separate(tmp_path):
    source, output = tmp_path / "stereo.mkv", tmp_path / "clip.mp4"
    media(source, video_origin=0, audio_origin=0, pulse_local=0.2, stereo_antiphase=True)

    clip(source, output, 0, 1000)

    assert next(s["channels"] for s in streams(output) if s["codec_type"] == "audio") == 2
    left, right = waveform(output, 0), waveform(output, 1)
    assert np.sqrt(np.mean(left ** 2)) > 0.05
    assert np.sqrt(np.mean(right ** 2)) > 0.05
    assert np.corrcoef(left, right)[0, 1] < -0.9


def test_clip_does_not_invent_audio_for_video_only_source(tmp_path):
    source, output = tmp_path / "video.mkv", tmp_path / "clip.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1",
           "-an", "-c:v", "ffv1", str(source))

    audio_result = clip(source, output, 0, 800)

    assert [s["codec_type"] for s in streams(output)] == ["video"]
    assert audio_result.status == "ABSENT"


def test_clip_does_not_claim_preserved_audio_when_source_track_has_no_samples_in_interval(tmp_path):
    source, output = tmp_path / "late-audio.mkv", tmp_path / "clip.mp4"
    media(source, video_origin=0, audio_origin=2, pulse_local=0.1)

    audio_result = clip(source, output, 0, 800)

    assert [s["codec_type"] for s in streams(output)] == ["video"]
    assert audio_result.status == "OMITTED_DECODE_FAILED"
    assert audio_result.reason in ("AUDIO_OUTPUT_EMPTY", "AV_ENCODE_FAILED_VIDEO_RETRY_SUCCEEDED")


def test_clip_preserves_an_existing_silent_audio_track(tmp_path):
    source, output = tmp_path / "silent.mkv", tmp_path / "clip.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1",
           "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=1",
           "-map", "0:v:0", "-map", "1:a:0", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source))

    clip(source, output, 0, 800)

    assert [s["codec_type"] for s in streams(output)] == ["video", "audio"]
    assert np.max(np.abs(waveform(output))) < 1e-4


def test_clip_preserves_audio_packet_timestamp_gap(tmp_path):
    source, output = tmp_path / "gap.mkv", tmp_path / "clip.mp4"
    expression = "0.3*sin(2*PI*1000*t)"
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1.2",
           "-f", "lavfi", "-i", f"aevalsrc={expression}:s=48000:n=4800:d=0.4",
           "-filter_complex", "[1:a]asetpts=PTS+gte(N\\,9600)*0.5/TB[a]",
           "-map", "0:v:0", "-map", "[a]", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source))

    clip(source, output, 0, 1000)

    audio = waveform(output)
    assert np.sqrt(np.mean(audio[int(.02*SAMPLE_RATE):int(.15*SAMPLE_RATE)] ** 2)) > 0.05
    assert np.sqrt(np.mean(audio[int(.35*SAMPLE_RATE):int(.55*SAMPLE_RATE)] ** 2)) < 0.005
    assert np.sqrt(np.mean(audio[int(.72*SAMPLE_RATE):int(.85*SAMPLE_RATE)] ** 2)) > 0.05


def test_clip_selects_first_real_video_and_first_audio_stream(tmp_path, monkeypatch):
    monkeypatch.setattr("replay_video.infrastructure.av_media.probe_streams", lambda _source: [
        {"index": 0, "codec_type": "video", "start_time": "0", "disposition": {"attached_pic": 1}},
        {"index": 1, "codec_type": "audio", "channels": 1, "start_time": "5.3"},
        {"index": 2, "codec_type": "video", "start_time": "5", "disposition": {"attached_pic": 0}},
        {"index": 3, "codec_type": "audio", "channels": 2, "start_time": "5"},
    ])
    selected = clip_streams(tmp_path / "mock.media")
    assert (selected.video_index, selected.video_origin_seconds, selected.audio_index) == (2, 5, 1)


def test_clip_seeks_near_a_late_selected_interval_without_shifting_pts(tmp_path, monkeypatch):
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    media(source, video_origin=5, audio_origin=5.3, pulse_local=3.0, duration=4.5)
    from replay_video.infrastructure import evidence
    original = evidence.subprocess.run
    commands = []
    def record(command, **kwargs):
        commands.append(command)
        return original(command, **kwargs)
    monkeypatch.setattr(evidence.subprocess, "run", record)

    clip(source, output, 3000, 4000)

    command = next(item for item in commands if item[0] == "ffmpeg")
    assert "-ss" in command
    assert command.index("-ss") < command.index("-i")
    assert first_tone_onset_ms(waveform(output)) == pytest.approx(300, abs=50)


def test_clip_preserves_multichannel_layout_without_downmix(tmp_path):
    source, output = tmp_path / "surround.mkv", tmp_path / "clip.mp4"
    tone = "0.3*sin(2*PI*1000*t)*between(t\\,0.2\\,0.4)"
    expression = "|".join([tone, f"-({tone})", "0", "0", "0", "0"])
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1",
           "-f", "lavfi", "-i", f"aevalsrc={expression}:s=48000:d=1:c=5.1",
           "-map", "0:v:0", "-map", "1:a:0", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source))

    clip(source, output, 0, 800)

    assert next(s["channels"] for s in streams(output) if s["codec_type"] == "audio") == 6
    assert np.sqrt(np.mean(waveform(output, 0) ** 2)) > 0.05
    assert np.sqrt(np.mean(waveform(output, 1) ** 2)) > 0.05


def test_clip_omits_unsupported_audio_but_keeps_valid_video(tmp_path, monkeypatch):
    source, output = tmp_path / "video.mkv", tmp_path / "clip.mp4"
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=1",
           "-an", "-c:v", "ffv1", str(source))
    monkeypatch.setattr("replay_video.infrastructure.evidence.clip_streams", lambda _source:
                        ClipStreams(0, 0.0, 0.0, None, None, "CHANNEL_COUNT_UNSUPPORTED"))

    audio_result = clip(source, output, 0, 800)

    assert (audio_result.status, audio_result.reason) == ("OMITTED_UNSUPPORTED", "CHANNEL_COUNT_UNSUPPORTED")
    assert [s["codec_type"] for s in streams(output)] == ["video"]


def test_clip_retries_video_only_after_av_encode_failure_and_reports_omission(tmp_path, monkeypatch):
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    media(source, video_origin=0, audio_origin=0, pulse_local=0.2)
    from replay_video.infrastructure import evidence
    original = evidence.subprocess.run
    commands = []
    def fail_first_av(command, **kwargs):
        commands.append(command)
        if "[a]" in command:
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="audio encode failed")
        return original(command, **kwargs)
    monkeypatch.setattr(evidence.subprocess, "run", fail_first_av)

    audio_result = clip(source, output, 0, 800)

    assert audio_result.status == "OMITTED_DECODE_FAILED"
    assert audio_result.reason == "AV_ENCODE_FAILED_VIDEO_RETRY_SUCCEEDED"
    assert len([c for c in commands if c[0] == "ffmpeg"]) == 2
    assert [s["codec_type"] for s in streams(output)] == ["video"]


def test_clip_does_not_mislabel_video_failure_as_audio_failure(tmp_path, monkeypatch):
    source, output = tmp_path / "source.mkv", tmp_path / "clip.mp4"
    media(source, video_origin=0, audio_origin=0, pulse_local=0.2)
    from replay_video.infrastructure import evidence
    original = evidence.subprocess.run
    def fail_encoder(command, **kwargs):
        if command[0] == "ffmpeg":
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="video failed")
        return original(command, **kwargs)
    monkeypatch.setattr(evidence.subprocess, "run", fail_encoder)

    with pytest.raises(RuntimeError, match="clip-write-failed"):
        clip(source, output, 0, 800)


def test_clip_does_not_claim_preserved_audio_for_damaged_aac_packets(tmp_path):
    clean, damaged, output = (tmp_path / name for name in ("clean.mkv", "damaged.mkv", "clip.mp4"))
    ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=3",
           "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=3",
           "-map", "0:v:0", "-map", "1:a:0", "-c:v", "ffv1", "-c:a", "aac", str(clean))
    ffmpeg("-i", str(clean), "-map", "0:v:0", "-map", "0:a:0", "-c", "copy",
           "-bsf:a", "noise=amount='if(between(n,40,50),1,0)'", str(damaged))
    source_decode = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(damaged), "-map", "0:a:0", "-f", "null", "-"],
        capture_output=True, text=True, timeout=15, check=False,
    )
    assert source_decode.returncode == 0
    assert source_decode.stderr, "fixture must expose FFmpeg decoder errors despite exit code 0"

    audio_result = clip(damaged, output, 0, 2800)

    assert audio_result.status == "OMITTED_DECODE_FAILED"
    assert [s["codec_type"] for s in streams(output)] == ["video"]
    assert float(streams(output)[0]["duration"]) == pytest.approx(2.8, abs=0.06)


def test_evidence_attaches_audio_omission_status_to_clip_only(tmp_path, monkeypatch):
    from replay_video.infrastructure import evidence as module
    from replay_video.infrastructure.av_media import ClipAudioResult
    source = tmp_path / "source.mp4"
    source.write_bytes(b"test stub")
    metadata = VideoMetadata(source, 1000, 64, 64, 20, 20, "h264")
    candidate = Candidate(1, "OTHER", 0, 800, 400, 0.9, "UNKNOWN", (), ())
    monkeypatch.setattr(module, "frame", lambda _source, target, _ms: target.write_bytes(b"jpeg"))
    monkeypatch.setattr(module, "clip", lambda _source, target, _start, _end:
                        (target.write_bytes(b"mp4"), ClipAudioResult("OMITTED_UNSUPPORTED", "CHANNEL_COUNT_UNSUPPORTED"))[1])

    entries = module.evidence(source, tmp_path / "output", metadata, (candidate,))

    assert [(entry.kind, entry.audio_status, entry.audio_reason) for entry in entries] == [
        ("FRAME", None, None),
        ("CLIP", "OMITTED_UNSUPPORTED", "CHANNEL_COUNT_UNSUPPORTED"),
    ]
