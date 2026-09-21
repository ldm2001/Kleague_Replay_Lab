import hashlib
import subprocess

import pytest

from test_operational import api, bundle, records, video


def video_with_audio(path):
    result = subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-n",
        "-f", "lavfi", "-i", "color=c=0x2d822d:s=320x360:r=10:d=0.5",
        "-f", "lavfi", "-i", "sine=frequency=1800:duration=0.5:sample_rate=48000",
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(path),
    ], capture_output=True, text=True, timeout=20)
    assert result.returncode == 0, result.stderr


def audio_input(source, *, status="COMPLETE", count=2, duration_ms=500):
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    cues = [{"id": f"cue-{index}", "startMs": index * 300, "endMs": index * 300 + 200,
             "peakFrequenciesHz": [3700, 4100], "frameCount": 2} for index in range(count)]
    absent = status == "ABSENT"
    return {"observations": {
        "version": "audio-observations-v1", "sourceSha256": source_sha, "status": status,
        "method": "spectral-multitone-v1", "speechStatus": "NOT_ANALYZED",
        "sourceSampleRateHz": None if absent else 48000,
        "sourceChannels": None if absent else 2,
        "timeline": {"videoOriginSeconds": None if absent else 0.0,
                     "audioOffsetMs": None if absent else 0,
                     "scannedStartMs": None if absent else 0,
                     "scannedEndMs": None if absent else duration_ms,
                     "decodedFrameCount": 0 if absent else duration_ms // 100,
                     "frameDurationMs": 100,
                     "gapPolicy": "PRESERVED_WITH_SYNTHETIC_SILENCE"},
        "cueCount": count, "cues": cues, "associations": [], "truncated": False,
        "reasons": []},
        "implementation": {"sourceFilesSha256": {"audio.py": "a" * 64,
                                                 "audio_observations.py": "b" * 64}}}


def test_audio_run_writes_v2_header_and_cue_rows_before_visual_frames(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source)
    result = api().run_observers(source, tmp_path / "audio-output", bundle(),
                                 duration_ms=500, audio_input=supplied)
    rows = records(result)
    assert result["schemaVersion"] == rows[0]["schemaVersion"] == "perception-run-v2"
    assert result["pipelineVersion"] == rows[0]["implementation"]["pipelineVersion"] == "video-local-observers-av-v1"
    assert rows[0]["audio"]["cueCount"] == 2
    assert "cues" not in rows[0]["audio"]
    assert rows[0]["implementation"]["audio"] == supplied["implementation"]
    assert [row["kind"] for row in rows[:4]] == ["HEADER", "AUDIO_CUE", "AUDIO_CUE", "FRAME"]
    assert [row["id"] for row in rows[1:3]] == ["cue-0", "cue-1"]
    assert all(row["sourceSha256"] == result["sourceSha256"] for row in rows[1:3])
    assert result["audio"] == supplied["observations"]


def test_audio_summary_is_bounded_while_every_cue_is_raw(tmp_path):
    source = tmp_path / "source.mkv"
    video(source, duration="90.0")
    supplied = audio_input(source, count=300, duration_ms=90_000)
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True),
                                 duration_ms=90_000, end_ms=500, audio_input=supplied)
    assert len([row for row in records(result) if row["kind"] == "AUDIO_CUE"]) == 300
    assert result["audio"]["cueCount"] == 300
    assert len(result["audio"]["cues"]) == 256
    assert result["audio"]["truncated"] is True
    assert "AUDIO_SUMMARY_TRUNCATED_RAW_PRESERVED" in result["audio"]["reasons"]
    assert result["processingStatus"] == "COMPLETE"


@pytest.mark.parametrize("mutate", [
    lambda audio: audio["timeline"].update(scannedEndMs=501),
    lambda audio: audio["cues"][0].update(endMs=501),
    lambda audio: audio["timeline"].update(scannedStartMs=101),
    lambda audio: audio["timeline"].update(scannedEndMs=199),
])
def test_audio_intervals_must_fit_duration_and_scanned_range_before_artifact(tmp_path, mutate):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source)
    mutate(supplied["observations"])
    models = bundle()
    output = tmp_path / "output"
    with pytest.raises(ValueError, match="AUDIO_INPUT_INVALID"):
        api().run_observers(source, output, models, duration_ms=500, audio_input=supplied)
    assert not output.exists()
    assert models.detector.calls == models.role.calls == models.pose.calls == 0


@pytest.mark.parametrize("status", ["FAILED", "UNSUPPORTED"])
def test_audio_failure_makes_complete_visual_run_partial(tmp_path, status):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source, status=status, count=0)
    supplied["observations"]["reasons"] = [f"AUDIO_{status}"]
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True),
                                 duration_ms=500, audio_input=supplied)
    assert result["coverage"]["processedSamples"] == 5
    assert result["processingStatus"] == "PARTIAL"
    assert f"AUDIO_{status}" in result["summary"]["reasons"]


def test_absent_audio_does_not_make_complete_visual_run_partial(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True), duration_ms=500,
                                 audio_input=audio_input(source, status="ABSENT", count=0))
    assert result["processingStatus"] == "COMPLETE"
    assert result["audio"]["status"] == "ABSENT"


def test_wrong_audio_source_rejected_before_artifact_or_models(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source)
    supplied["observations"]["sourceSha256"] = "0" * 64
    models = bundle()
    output = tmp_path / "output"
    with pytest.raises(ValueError, match="AUDIO_SOURCE_MISMATCH"):
        api().run_observers(source, output, models, duration_ms=500, audio_input=supplied)
    assert not output.exists()
    assert models.detector.calls == models.role.calls == models.pose.calls == 0


@pytest.mark.parametrize("mutate", [
    lambda value: value.pop("implementation"),
    lambda value: value["implementation"]["sourceFilesSha256"].pop("audio.py"),
    lambda value: value["observations"].update(cueCount=999),
    lambda value: value["observations"].update(speechStatus="TRANSCRIBED"),
])
def test_malformed_audio_input_rejected_before_artifact(tmp_path, mutate):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source)
    mutate(supplied)
    output = tmp_path / "output"
    with pytest.raises(ValueError, match="AUDIO_INPUT_INVALID"):
        api().run_observers(source, output, bundle(), duration_ms=500, audio_input=supplied)
    assert not output.exists()


def test_audio_header_does_not_copy_unknown_timeline_payload(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source)
    supplied["observations"]["timeline"]["largeInternalPayload"] = ["x"] * 1000
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True),
                                 duration_ms=500, audio_input=supplied)
    assert "largeInternalPayload" not in records(result)[0]["audio"]["timeline"]
    assert "largeInternalPayload" not in result["audio"]["timeline"]


def test_negative_audio_offset_is_valid_source_timeline_metadata(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source)
    supplied["observations"]["timeline"]["audioOffsetMs"] = -50
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True),
                                 duration_ms=500, audio_input=supplied)
    assert result["audio"]["timeline"]["audioOffsetMs"] == -50


def test_complete_audio_with_late_origin_and_zero_decoded_frames_is_valid(tmp_path):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source, count=0)
    supplied["observations"]["timeline"].update(
        audioOffsetMs=600, scannedStartMs=500, scannedEndMs=500, decodedFrameCount=0)
    result = api().run_observers(source, tmp_path / "output", bundle(empty=True),
                                 duration_ms=500, audio_input=supplied)
    assert result["processingStatus"] == "COMPLETE"
    assert result["audio"]["cueCount"] == 0


@pytest.mark.parametrize("field, value", [
    ("sourceSampleRateHz", -1), ("sourceChannels", 0),
    ("timeline", {"videoOriginSeconds": float("nan"), "audioOffsetMs": 0,
                  "scannedStartMs": 0, "scannedEndMs": 500,
                  "decodedFrameCount": 5, "frameDurationMs": 100,
                  "gapPolicy": "PRESERVED_WITH_SYNTHETIC_SILENCE"}),
])
def test_invalid_audio_metadata_rejected_before_artifact(tmp_path, field, value):
    source = tmp_path / "source.mkv"
    video(source)
    supplied = audio_input(source)
    supplied["observations"][field] = value
    output = tmp_path / "output"
    with pytest.raises(ValueError, match="AUDIO_INPUT_INVALID"):
        api().run_observers(source, output, bundle(), duration_ms=500, audio_input=supplied)
    assert not output.exists()


def test_audio_extension_does_not_change_visual_observations(tmp_path):
    source = tmp_path / "source.mkv"
    video_with_audio(source)
    old = api().run_observers(source, tmp_path / "old", bundle(), duration_ms=500)
    new = api().run_observers(source, tmp_path / "new", bundle(), duration_ms=500,
                              audio_input=audio_input(source))
    assert old["schemaVersion"] == "perception-run-v1"
    assert old["pipelineVersion"] == "video-local-observers-v1"
    assert "audio" not in old
    for key in ("coverage", "models", "summary", "observations", "interactions", "links"):
        assert new[key] == old[key]
    assert [row for row in records(new) if row["kind"] == "FRAME"] == [
        row for row in records(old) if row["kind"] == "FRAME"]
