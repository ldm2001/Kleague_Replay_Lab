"""Bounded AV evidence benchmark with synthetic, source-known signals only.

This does not assess recognition of real whistles, speech, contact, fouls, or
refereeing decisions. It deliberately decodes PCM independently of the encoder.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from .infrastructure.audio import audio_cues
from .infrastructure.evidence import clip


SAMPLE_RATE = 48_000
MAX_CLIP_MS = 60_000
MAX_SOURCE_BYTES = 256 * 1024 * 1024
ONSET_TOLERANCE_MS = 50
CUE_TOLERANCE_MS = 100


def _run(command: list[str], *, timeout: int = 30) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("evaluation-media-tool-failed") from error
    if result.returncode:
        raise RuntimeError(f"evaluation-media-tool-failed: {result.stderr.decode(errors='replace')[:300]}")
    return result


def _streams(path: Path) -> list[dict[str, Any]]:
    result = _run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(path)])
    try:
        streams = json.loads(result.stdout)["streams"]
    except (ValueError, KeyError, TypeError) as error:
        raise RuntimeError("evaluation-probe-invalid") from error
    if not isinstance(streams, list):
        raise RuntimeError("evaluation-probe-invalid")
    return streams


def _tracks(path: Path) -> tuple[dict[str, Any], dict[str, Any] | None]:
    streams = _streams(path)
    video = next((stream for stream in streams if stream.get("codec_type") == "video"
                  and not stream.get("disposition", {}).get("attached_pic")), None)
    if video is None:
        raise RuntimeError("evaluation-video-absent")
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    return video, audio


def _start_seconds(stream: dict[str, Any]) -> float:
    value = float(stream["start_time"])
    if not math.isfinite(value):
        raise ValueError("evaluation-origin-invalid")
    return value


def _output_duration_ms(video: dict[str, Any]) -> float | None:
    try:
        measured = float(video["duration"]) * 1000
    except (KeyError, TypeError, ValueError):
        return None
    return measured if math.isfinite(measured) and measured > 0 else None


def _has_decodable_frame(path: Path, video: dict[str, Any]) -> bool:
    try:
        decoded = _run([
            "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
            "-map", f"0:{int(video['index'])}", "-an", "-sn", "-dn",
            "-frames:v", "1", "-vf", "scale=2:2", "-pix_fmt", "rgb24",
            "-c:v", "rawvideo", "-f", "rawvideo", "pipe:1",
        ], timeout=10).stdout
    except (RuntimeError, KeyError, TypeError, ValueError):
        return False
    return len(decoded) == 12


def _full_video_decode(path: Path, video: dict[str, Any], duration_ms: float) -> tuple[int, float] | None:
    """Strictly decode every output frame and check the decoded end, not just MP4 headers."""
    try:
        progress = _run([
            "ffmpeg", "-nostdin", "-xerror", "-v", "error", "-i", str(path),
            "-map", f"0:{int(video['index'])}", "-an", "-sn", "-dn",
            "-f", "null", "-", "-progress", "pipe:1",
        ], timeout=90).stdout.decode("ascii", errors="replace")
        if "progress=end" not in progress:
            return None
        fields = dict(line.split("=", 1) for line in progress.splitlines() if "=" in line)
        frames = int(fields["frame"])
        decoded_end_ms = int(fields["out_time_us"]) / 1000
    except (RuntimeError, KeyError, TypeError, ValueError):
        return None
    if frames <= 0 or not math.isfinite(decoded_end_ms) or decoded_end_ms < duration_ms - 100:
        return None
    return frames, decoded_end_ms


def _decoded_onset_ms(path: Path, video: dict[str, Any], audio: dict[str, Any] | None) -> int | None:
    if audio is None:
        return None
    channels = int(audio["channels"])
    if not 1 <= channels <= 8:
        raise ValueError("evaluation-channel-count-unsupported")
    # This independent decoder does not use the production resample/PTS filter.
    # Decode only bounded synthetic input, maintaining separate channel energy.
    decoded = _run([
        "ffmpeg", "-nostdin", "-v", "error", "-i", str(path),
        "-map", f"0:{int(audio['index'])}", "-vn", "-sn", "-dn",
        "-t", f"{MAX_CLIP_MS / 1000:.3f}", "-ar", str(SAMPLE_RATE),
        "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1",
    ], timeout=30).stdout
    if len(decoded) > MAX_CLIP_MS * SAMPLE_RATE // 1000 * channels * 4:
        raise ValueError("evaluation-pcm-limit")
    samples = np.frombuffer(decoded, dtype="<f4")
    if samples.size % channels:
        raise RuntimeError("evaluation-pcm-invalid")
    samples = samples.reshape(-1, channels)
    window = SAMPLE_RATE // 50
    for start in range(0, len(samples) - window + 1, window):
        level = float(np.sqrt(np.mean(np.square(samples[start:start + window].astype(np.float64)))))
        if level > 0.025:
            relative_ms = start * 1000 // SAMPLE_RATE
            offset_ms = round((_start_seconds(audio) - _start_seconds(video)) * 1000)
            return offset_ms + relative_ms
    return None


def make_fixture(path: Path, *, video_origin: float, audio_origin: float | None,
                 pulse_local: float | None, kind: str, duration: float = 1.5) -> None:
    """Create synthetic ground truth; no source media or labels are inferred."""
    if path.exists() or duration <= 0 or duration > MAX_CLIP_MS / 1000:
        raise ValueError("evaluation-fixture-target-invalid")
    video_args = ["-itsoffset", str(video_origin), "-f", "lavfi", "-i",
                  f"color=c=black:s=64x64:r=20:d={duration}"]
    if kind == "no_audio":
        _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
              *video_args, "-an", "-c:v", "ffv1", str(path)])
        return
    if audio_origin is None:
        raise ValueError("evaluation-audio-origin-required")
    if kind == "silent":
        expression = "0"
    else:
        if pulse_local is None or not 0 <= pulse_local <= duration - 0.4:
            raise ValueError("evaluation-pulse-invalid")
        if kind in ("multitone", "antiphase"):
            signal = "0.15*(sin(2*PI*3700*t)+sin(2*PI*4100*t))"
        elif kind == "single_band":
            signal = "0.25*sin(2*PI*4000*t)"
        elif kind == "outside_band":
            signal = "0.25*sin(2*PI*2000*t)"
        else:
            raise ValueError("evaluation-fixture-kind-invalid")
        expression = f"({signal})*between(t\\,{pulse_local}\\,{pulse_local + 0.4})"
        if kind == "antiphase":
            expression = f"{expression}|-({expression})"
    _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
          *video_args, "-itsoffset", str(audio_origin), "-f", "lavfi", "-i",
          f"aevalsrc={expression}:s={SAMPLE_RATE}:d={duration}",
          "-map", "0:v:0", "-map", "1:a:0", "-c:v", "ffv1", "-c:a", "pcm_s16le", str(path)])


def baseline_clip(source: Path, destination: Path, start_ms: int, end_ms: int) -> None:
    """Frozen pre-change evidence clip recipe, whose explicit -an removes audio."""
    duration = max(0.2, (end_ms - start_ms) / 1000)
    rate = min(6_000_000, int(45 * 1024 * 1024 * 8 / (duration + 2)))
    if destination.exists():
        raise FileExistsError(destination)
    _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-n",
          "-ss", f"{start_ms / 1000:.3f}", "-i", str(source),
          "-t", f"{duration:.3f}", "-map", "0:v:0", "-an",
          "-vf", "scale=-2:min(720\\,ih)", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "23", "-maxrate", str(rate), "-bufsize", str(rate * 2),
          "-threads", "2", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination)], timeout=60)


def compare_clip_audio(source: Path, baseline: Path, av: Path, start_ms: int, end_ms: int,
                       *, expected_onset_ms: int | None) -> dict[str, Any]:
    """Compare a <=60-second synthetic source/clip to fixture truth and PCM."""
    if not 0 <= start_ms < end_ms or end_ms - start_ms > MAX_CLIP_MS:
        raise ValueError("evaluation-window-limit")
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("evaluation-source-size-limit")
    expected_duration_ms = end_ms - start_ms
    source_audio = None
    source_valid_video = False
    try:
        source_video, source_audio = _tracks(source)
        source_valid_video = _has_decodable_frame(source, source_video)
        source_onset = _decoded_onset_ms(source, source_video, source_audio) if source_valid_video else None
    except (OSError, RuntimeError, ValueError):
        source_onset = None
        source_valid_video = False
    baseline_valid_video = False
    baseline_duration_ms = None
    baseline_decoded = None
    try:
        baseline_video, baseline_audio = _tracks(baseline)
        baseline_duration_ms = _output_duration_ms(baseline_video)
        baseline_decoded = (_full_video_decode(baseline, baseline_video, baseline_duration_ms)
                            if baseline_duration_ms is not None else None)
        baseline_valid_video = baseline_decoded is not None
        baseline_has_audio: bool | None = baseline_audio is not None if baseline_valid_video else None
    except (OSError, RuntimeError, ValueError):
        baseline_has_audio = None
    av_valid_video = False
    av_duration_ms = None
    av_decoded = None
    av_duration_pass = False
    try:
        av_video, av_audio = _tracks(av)
        av_duration_ms = _output_duration_ms(av_video)
        av_duration_pass = av_duration_ms is not None and abs(av_duration_ms - expected_duration_ms) <= 100
        av_decoded = (_full_video_decode(av, av_video, av_duration_ms) if av_duration_ms is not None else None)
        av_valid_video = av_duration_pass and av_decoded is not None
        av_has_audio: bool | None = av_audio is not None if av_valid_video else None
        output_onset = _decoded_onset_ms(av, av_video, av_audio) if av_valid_video else None
    except (OSError, RuntimeError, ValueError):
        av_valid_video = False
        av_has_audio = None
        output_onset = None
    expected_relative = expected_onset_ms - start_ms if expected_onset_ms is not None else None
    onset_error = output_onset - expected_relative if output_onset is not None and expected_relative is not None else None
    source_error = source_onset - expected_onset_ms if source_onset is not None and expected_onset_ms is not None else None
    alignment_pass = (onset_error is not None and source_error is not None
                      and abs(onset_error) <= ONSET_TOLERANCE_MS
                      and abs(source_error) <= ONSET_TOLERANCE_MS
                      and abs((output_onset + start_ms) - source_onset) <= ONSET_TOLERANCE_MS)
    return {
        "sourceValidVideo": source_valid_video, "baselineValidVideo": baseline_valid_video,
        "avValidVideo": av_valid_video, "expectedClipDurationMs": expected_duration_ms,
        "baselineDurationMs": baseline_duration_ms, "avDurationMs": av_duration_ms,
        "baselineDurationPass": (baseline_duration_ms is not None and
                                 abs(baseline_duration_ms - expected_duration_ms) <= 100),
        "avDurationPass": av_duration_pass,
        "baselineDecodedCoveragePass": baseline_decoded is not None,
        "avDecodedCoveragePass": av_decoded is not None,
        "baselineDecodedFrameCount": baseline_decoded[0] if baseline_decoded else None,
        "avDecodedFrameCount": av_decoded[0] if av_decoded else None,
        "baselineDecodedEndMs": baseline_decoded[1] if baseline_decoded else None,
        "avDecodedEndMs": av_decoded[1] if av_decoded else None,
        "baselineHasAudio": baseline_has_audio, "avHasAudio": av_has_audio,
        "audioRetained": source_valid_video and source_audio is not None and av_valid_video and av_has_audio is True,
        "sourceDecodedOnsetMs": source_onset, "avDecodedOnsetMs": output_onset,
        "expectedOnsetMs": expected_onset_ms, "sourceOnsetErrorMs": source_error,
        "onsetErrorMs": onset_error, "alignmentToleranceMs": ONSET_TOLERANCE_MS,
        "alignmentPass": alignment_pass,
    }


def score_cues(expected: list[tuple[int, int]], predicted: list[tuple[int, int]]) -> dict[str, Any]:
    """One-to-one match, requiring <=100 ms onset difference and nontrivial IoU."""
    matches: list[tuple[int, int, int]] = []
    used: set[int] = set()
    for expected_start, expected_end in expected:
        eligible = []
        for index, (start, end) in enumerate(predicted):
            intersection = max(0, min(end, expected_end) - max(start, expected_start))
            union = max(end, expected_end) - min(start, expected_start)
            iou = intersection / union if union > 0 else 0
            if index not in used and abs(start - expected_start) <= CUE_TOLERANCE_MS and iou >= 0.25:
                eligible.append((abs(start - expected_start), index, start - expected_start))
        if eligible:
            _, index, error = min(eligible)
            used.add(index)
            matches.append((expected_start, index, error))
    tp, fp, fn = len(matches), len(predicted) - len(matches), len(expected) - len(matches)
    return {
        "truePositive": tp, "falsePositive": fp, "falseNegative": fn,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
        "meanAbsoluteOnsetErrorMs": sum(abs(error) for _, _, error in matches) / tp if tp else None,
        "onsetToleranceMs": CUE_TOLERANCE_MS, "minimumIoU": 0.25,
    }


def compare_visual_reports(baseline: dict[str, Any], av: dict[str, Any],
                           *, baseline_reused: bool = False) -> dict[str, Any]:
    """Strict visual-data equality after removing only audio and path/version fields."""
    def valid_report(report: Any) -> bool:
        if not isinstance(report, dict):
            return False
        video = report.get("video")
        perception = report.get("perception")
        if not isinstance(video, dict) or not isinstance(perception, dict):
            return False
        positive = ("duration_ms", "width", "height", "fps", "frame_count")
        if any(type(video.get(key)) not in (int, float) or not math.isfinite(video[key]) or video[key] <= 0
               for key in positive) or not isinstance(video.get("codec"), str) or not video["codec"] \
                or not isinstance(video.get("source_name"), str) or not video["source_name"]:
            return False
        source_hashes = [value for value in (report.get("sourceSha256"), report.get("source_sha256"),
                                              perception.get("sourceSha256")) if value is not None]
        if (not source_hashes or any(not isinstance(value, str) or
                                    re.fullmatch(r"[0-9a-fA-F]{64}", value) is None
                                    for value in source_hashes) or len(set(source_hashes)) != 1):
            return False
        if any(not isinstance(report.get(key), list) or
               any(not isinstance(item, dict) for item in report[key])
               for key in ("shots", "candidates", "evidence")):
            return False
        if not isinstance(perception.get("incidents"), list) or any(
            not isinstance(item, dict) for item in perception["incidents"]
        ):
            return False
        coverage, summary = perception.get("coverage"), perception.get("summary")
        if not isinstance(coverage, dict) or not isinstance(summary, dict):
            return False
        coverage_fields = ("startMs", "endMs", "sampleIntervalMs", "expectedSamples",
                           "processedSamples", "failedSamples")
        if any(type(coverage.get(key)) is not int for key in coverage_fields):
            return False
        if (coverage["startMs"] < 0 or coverage["endMs"] <= coverage["startMs"]
            or coverage["sampleIntervalMs"] <= 0 or coverage["expectedSamples"] <= 0
            or not 0 <= coverage["processedSamples"] <= coverage["expectedSamples"]
            or coverage["failedSamples"] != coverage["expectedSamples"] - coverage["processedSamples"]):
            return False
        summary_fields = ("roleObservationCount", "poseObservationCount", "officialCueCount",
                          "interactionCount", "linkCount")
        if any(type(summary.get(key)) is not int or summary[key] < 0 for key in summary_fields):
            return False
        return perception.get("processingStatus") in ("COMPLETE", "PARTIAL")

    def source_hash(report: dict[str, Any]) -> Any:
        perception = report.get("perception")
        nested = perception.get("sourceSha256") if isinstance(perception, dict) else None
        return report.get("sourceSha256") or report.get("source_sha256") or nested
    baseline_valid, av_valid = valid_report(baseline), valid_report(av)
    hashes = (source_hash(baseline) if baseline_valid else None,
              source_hash(av) if av_valid else None)
    comparable = (baseline_valid and av_valid and isinstance(hashes[0], str)
                  and re.fullmatch(r"[0-9a-fA-F]{64}", hashes[0]) is not None and hashes[0] == hashes[1])
    baseline_perception = baseline.get("perception", {}) if baseline_valid else {}
    av_perception = av.get("perception", {}) if av_valid else {}
    status_changed = baseline_perception.get("processingStatus") != av_perception.get("processingStatus")
    av_audio = av_perception.get("audio")
    audio_only_status = bool(
        comparable and status_changed
        and baseline_perception.get("processingStatus") == "COMPLETE"
        and av_perception.get("processingStatus") == "PARTIAL"
        and isinstance(av_audio, dict) and av_audio.get("status") in ("FAILED", "UNSUPPORTED")
        and baseline_perception.get("coverage") == av_perception.get("coverage")
    )
    root_ignored = {"audioObservations", "audio_observations", "reportVersion", "artifactRoot",
                    "artifact_root", "schema_version", "pipeline_version", "version"}
    evidence_ignored = {"path", "artifactPath", "artifact_path", "audioStatus", "audioReason",
                        "audio_status", "audio_reason"}
    perception_ignored = {"audio", "schemaVersion", "pipelineVersion", "processingStatus", "artifact"}
    audio_limitations = {"speech_not_analyzed", "audio_cue_method_unverified",
                         "audiovisual_association_temporal_only", "audio_evidence_incomplete"}
    def visual(value: Any, location: tuple[str, ...] = ()) -> Any:
        if isinstance(value, dict):
            ignored = (root_ignored if not location else
                       evidence_ignored if location[:1] == ("evidence",) else
                       perception_ignored if location == ("perception",) else set())
            return {key: visual(item, location + (key,)) for key, item in value.items()
                    if key not in ignored}
        if isinstance(value, list):
            values = value
            if location == ("limitations",):
                values = [item for item in value if item not in audio_limitations]
            elif location == ("perception", "summary", "reasons"):
                values = [item for item in value if not (isinstance(item, str) and item.startswith("AUDIO_"))]
            return [visual(item, location + ("[]",)) for item in values]
        return value
    baseline_visual = visual(baseline) if isinstance(baseline, dict) else {}
    av_visual = visual(av) if isinstance(av, dict) else {}
    changed = sorted(key for key in baseline_visual.keys() | av_visual.keys()
                     if baseline_visual.get(key) != av_visual.get(key))
    if status_changed and not audio_only_status and "perception" not in changed:
        changed.append("perception")
    return {"comparable": comparable,
            "exactVisualUnchanged": comparable and not changed,
            "changedVisualSections": changed,
            "audioOnlyProcessingStatusDifference": audio_only_status,
            "processingStatusNote": ("AV_PARTIAL_FROM_AUDIO_FAILED_OR_UNSUPPORTED_VISUAL_COVERAGE_UNCHANGED"
                                     if audio_only_status else None),
            "baselineReused": baseline_reused,
            "accuracyImprovement": "NOT_MEASURABLE_WITHOUT_INDEPENDENT_VISUAL_GROUND_TRUTH"}


def run_synthetic(output: Path) -> dict[str, Any]:
    """Create one exclusive, durable synthetic benchmark directory."""
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
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
    results = []
    for name, video_origin, audio_origin, pulse_local, kind, start_ms, end_ms, expected_onset in cases:
        directory = output / name
        directory.mkdir()
        source, baseline, av = (directory / name for name in ("source.mkv", "baseline.mp4", "av.mp4"))
        make_fixture(source, video_origin=video_origin, audio_origin=audio_origin,
                     pulse_local=pulse_local, kind=kind)
        baseline_clip(source, baseline, start_ms, end_ms)
        audio_result = clip(source, av, start_ms, end_ms)
        audio_metrics = compare_clip_audio(source, baseline, av, start_ms, end_ms,
                                           expected_onset_ms=expected_onset)
        expected_cues = [(expected_onset, expected_onset + 400)] if kind in ("multitone", "antiphase") else []
        scan = audio_cues(source, duration_ms=1500)
        predicted = [(cue.start_ms, cue.end_ms) for cue in scan.cues]
        cue_metrics = score_cues(expected_cues, predicted)
        results.append({
            "name": name, "kind": kind, "videoOriginSeconds": video_origin,
            "audioOriginSeconds": audio_origin, "windowMs": [start_ms, end_ms],
            "expectedCueIntervalsMs": [list(item) for item in expected_cues],
            "observedCueIntervalsMs": [list(item) for item in predicted],
            "audioScanStatus": scan.status.value, "audioScanReason": scan.reason,
            "clipAudioStatus": audio_result.status, "clipAudioReason": audio_result.reason,
            "clipAudioMetrics": audio_metrics, "cueMetrics": cue_metrics,
        })
    tp = sum(case["cueMetrics"]["truePositive"] for case in results)
    fp = sum(case["cueMetrics"]["falsePositive"] for case in results)
    fn = sum(case["cueMetrics"]["falseNegative"] for case in results)
    onset_weight = sum(case["cueMetrics"]["truePositive"] for case in results)
    onset_error_sum = sum(case["cueMetrics"]["meanAbsoluteOnsetErrorMs"] * case["cueMetrics"]["truePositive"]
                          for case in results if case["cueMetrics"]["truePositive"])
    checks_pass = all(
        case["clipAudioMetrics"]["sourceValidVideo"] is True
        and case["clipAudioMetrics"]["baselineValidVideo"] is True
        and case["clipAudioMetrics"]["avValidVideo"] is True
        and case["clipAudioMetrics"]["baselineHasAudio"] is False
        and case["clipAudioMetrics"]["avHasAudio"] is (case["kind"] != "no_audio")
        and case["clipAudioStatus"] == ("ABSENT" if case["kind"] == "no_audio" else "PRESERVED")
        and case["audioScanStatus"] == ("ABSENT" if case["kind"] == "no_audio" else "COMPLETE")
        and (case["clipAudioMetrics"]["alignmentPass"] if case["clipAudioMetrics"]["expectedOnsetMs"] is not None
             else (case["clipAudioMetrics"]["sourceDecodedOnsetMs"] is None
                   and (case["kind"] != "silent" or case["clipAudioMetrics"]["avDecodedOnsetMs"] is None)))
        and case["cueMetrics"]["falsePositive"] == 0
        and case["cueMetrics"]["falseNegative"] == 0
        for case in results
    )
    report = {
        "benchmark": "synthetic-av-evidence-v1", "groundTruthScope": "KNOWN_SYNTHETIC_MULTITONE_SIGNALS",
        "syntheticChecksPass": checks_pass,
        "semanticAccuracyImprovement": "NOT_ESTABLISHED",
        "semanticLimitations": ["NO_INDEPENDENT_REAL_MATCH_GROUND_TRUTH", "NO_APPROVED_SPEECH_MODEL",
                                "SYNTHETIC_TONES_ARE_NOT_FOOTBALL_WHISTLES_OR_REFEREE_DECISIONS"],
        "baselineRecipe": "FROZEN_PRECHANGE_FFMPEG_AN", "baselineReused": False,
        "baselineVisualDurationMismatchCases": [case["name"] for case in results
                                                if not case["clipAudioMetrics"]["baselineDurationPass"]],
        "cueMetrics": {"truePositive": tp, "falsePositive": fp, "falseNegative": fn,
                       "precision": tp / (tp + fp) if tp + fp else None,
                       "recall": tp / (tp + fn) if tp + fn else None,
                       "falsePositivesPerSourceMinute": fp / (len(results) * 1.5 / 60),
                       "meanAbsoluteOnsetErrorMs": onset_error_sum / onset_weight if onset_weight else None},
        "audioRetention": {"baselineWithAudio": sum(case["clipAudioMetrics"]["baselineHasAudio"] is True for case in results),
                           "avWithAudio": sum(case["clipAudioMetrics"]["avHasAudio"] is True for case in results),
                           "sourceWithAudio": sum(case["kind"] != "no_audio" for case in results)},
        "cases": results,
    }
    (output / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
                                          encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Bounded synthetic AV evidence evaluation")
    parser.add_argument("--synthetic", required=True, type=Path, metavar="OUTPUT_DIR")
    args = parser.parse_args()
    report = run_synthetic(args.synthetic)
    print(json.dumps({"metricsPath": str(args.synthetic.resolve() / "metrics.json"),
                      "cueMetrics": report["cueMetrics"],
                      "syntheticChecksPass": report["syntheticChecksPass"],
                      "semanticAccuracyImprovement": report["semanticAccuracyImprovement"]},
                     ensure_ascii=False, allow_nan=False))
    if not report["syntheticChecksPass"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
