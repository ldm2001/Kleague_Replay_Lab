from dataclasses import replace
import hashlib
import importlib
import subprocess

import pytest

from replay_video.domain.models import Candidate, Evidence
from replay_video.infrastructure.audio import AudioCue, AudioScan, AudioScanStatus, audio_cues


def api():
    return importlib.import_module("replay_video.infrastructure.audio_observations")


def scan(status=AudioScanStatus.COMPLETE):
    return AudioScan(status, None, (AudioCue(1300, 1600, (3700., 4100.), 3),),
                     48000, 2, 5., 300, 300, 10000, 97)


def test_source_bound_audio_keeps_original_offset_without_applying_it_twice(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    result = api().observe_audio(source, duration_ms=10000, scan=lambda *a, **kw: scan())
    audio = result["observations"]
    assert audio["sourceSha256"] == hashlib.sha256(b"source").hexdigest()
    assert audio["timeline"]["audioOffsetMs"] == 300
    assert audio["timeline"]["videoOriginSeconds"] == 5.
    assert audio["cues"][0]["startMs"] == 1300
    assert audio["speechStatus"] == "NOT_ANALYZED"
    assert audio["method"] == "spectral-multitone-v1"
    assert "audio.py" in result["implementation"]["sourceFilesSha256"]
    assert "audio_observations.py" in result["implementation"]["sourceFilesSha256"]
    assert audio["associations"] == []


def test_audio_scan_source_mutation_cannot_be_linked_to_visual_scan(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    def changed(*args, **kwargs):
        source.write_bytes(b"different")
        return scan()
    with pytest.raises(ValueError, match="AUDIO_SOURCE_CHANGED"):
        api().observe_audio(source, duration_ms=10000, scan=changed)


def test_complete_silence_and_missing_audio_remain_different(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    silent = api().observe_audio(source, duration_ms=10000,
                                 scan=lambda *a, **kw: replace(scan(), cues=()))["observations"]
    absent = AudioScan(AudioScanStatus.ABSENT, "AUDIO_STREAM_ABSENT", (), None, None, None, None, None, None, 0)
    missing = api().observe_audio(source, duration_ms=10000,
                                  scan=lambda *a, **kw: absent)["observations"]
    assert silent["status"] == "COMPLETE" and silent["cueCount"] == 0
    assert missing["status"] == "ABSENT" and missing["cueCount"] == 0
    assert missing["timeline"]["scannedEndMs"] is None


def test_audio_raw_scan_is_not_truncated_before_diagnostic_writer(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    many = tuple(AudioCue(i * 300, i * 300 + 200, (3700., 4100.), 2) for i in range(300))
    result = api().observe_audio(source, duration_ms=100000,
                                 scan=lambda *a, **kw: replace(scan(), cues=many))["observations"]
    assert result["cueCount"] == len(result["cues"]) == 300
    assert len({item["id"] for item in result["cues"]}) == 300
    assert result["truncated"] is False


def test_association_is_pure_temporal_and_requires_same_candidate_covering_clip(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    audio = api().observe_audio(source, duration_ms=10000, scan=lambda *a, **kw: scan())["observations"]
    candidates = (Candidate(7, "OTHER", 1000, 2000, 1400, .1, "LOW", (), ()),)
    evidence = (Evidence(7, "FRAME", tmp_path / "a.jpg", 1300, 1000, 2000),
                Evidence(9, "CLIP", tmp_path / "b.mp4", 1300, 1000, 2000),
                Evidence(7, "CLIP", tmp_path / "c.mp4", 1400, 1400, 1700),
                Evidence(7, "CLIP", tmp_path / "d.mp4", 1300, 1000, 2000, audio_status="PRESERVED"))
    linked = api().associate_audio(audio, candidates, evidence)
    assert linked["associations"] == [{"cueId": audio["cues"][0]["id"], "candidateIndex": 7,
                                      "evidenceIndices": [3], "relation": "TEMPORAL_OVERLAP_ONLY"}]
    assert audio["associations"] == []
    assert candidates[0].category == "OTHER"
    assert api().associate_audio(audio, candidates, evidence[:3])["associations"] == []
    for status in (None, "ABSENT", "OMITTED_UNSUPPORTED", "OMITTED_DECODE_FAILED"):
        without_audio = (replace(evidence[3], audio_status=status),)
        assert api().associate_audio(audio, candidates, without_audio)["associations"] == []


def test_audio_cancellation_is_not_rewritten_as_decode_failure(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    def cancel():
        raise RuntimeError("lease-lost")
    with pytest.raises(RuntimeError, match="lease-lost"):
        audio_cues(source, duration_ms=1000, check_cancelled=cancel)


def test_association_caps_and_input_immutability(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    audio = api().observe_audio(source, duration_ms=10000, scan=lambda *a, **kw: scan())["observations"]
    audio["cues"] = [dict(audio["cues"][0], id=f"cue-{index}") for index in range(256)]
    audio["cueCount"] = 256
    candidates = tuple(Candidate(index, "OTHER", 1000, 2000, 1400, .1, "LOW", (), ()) for index in range(3))
    evidence = tuple(Evidence(candidate.index, "CLIP", tmp_path / f"{candidate.index}-{index}.mp4",
                              1400, 1000, 2000, audio_status="PRESERVED")
                     for candidate in candidates for index in range(17))
    linked = api().associate_audio(audio, candidates, evidence)
    assert len(linked["associations"]) == 512
    assert all(len(item["evidenceIndices"]) == 16 for item in linked["associations"])
    assert linked["truncated"] is True
    assert linked["reasons"].count("AUDIO_ASSOCIATION_LIMIT") == 1
    assert audio["associations"] == [] and audio["truncated"] is False
    assert "AUDIO_ASSOCIATION_LIMIT" not in audio["reasons"]


def test_cancellation_during_pcm_decode_terminates_decoder(tmp_path, monkeypatch):
    from test_audio import run_ffmpeg
    source = tmp_path / "source.mkv"
    run_ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=3",
               "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=3",
               "-c:v", "ffv1", "-c:a", "pcm_s16le", str(source))
    module = importlib.import_module("replay_video.infrastructure.audio")
    spawn = subprocess.Popen
    processes = []
    def recording(*args, **kwargs):
        process = spawn(*args, **kwargs)
        processes.append(process)
        return process
    monkeypatch.setattr(module.subprocess, "Popen", recording)
    checks = 0
    def cancel():
        nonlocal checks
        checks += 1
        if checks >= 6:
            raise RuntimeError("lease-lost-during-read")
    with pytest.raises(RuntimeError, match="lease-lost-during-read"):
        audio_cues(source, duration_ms=3000, check_cancelled=cancel)
    assert processes and all(process.poll() is not None for process in processes)


def test_damaged_audio_packets_cannot_be_reported_as_complete_scan(tmp_path):
    from test_audio import run_ffmpeg
    source, damaged = tmp_path / "source.mkv", tmp_path / "damaged.mkv"
    run_ffmpeg("-f", "lavfi", "-i", "color=c=black:s=64x64:r=20:d=3",
               "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=3",
               "-c:v", "ffv1", "-c:a", "aac", str(source))
    run_ffmpeg("-i", str(source), "-map", "0", "-c", "copy",
               "-bsf:a", "noise=amount='if(between(n,40,50),1,0)'", str(damaged))
    assert audio_cues(source, duration_ms=3000).status == AudioScanStatus.COMPLETE
    result = audio_cues(damaged, duration_ms=3000)
    assert result.status == AudioScanStatus.FAILED
    assert result.reason == "DECODE_FAILED"
    assert result.cues == ()
