"""The AV benchmark checks known signals, not real officiating decisions."""

import json
import subprocess
from pathlib import Path

import pytest

from replay_video.evaluate_av import (
    compare_clip_audio,
    compare_visual_reports,
    make_fixture,
    score_cues,
)
from replay_video.infrastructure.evidence import clip


def visual_report():
    return {
        "schema_version": 2, "pipeline_version": "video-local-observers-v1",
        "video": {"source_name": "fixture.mkv", "duration_ms": 1500,
                  "width": 64, "height": 64, "fps": 20, "frame_count": 30, "codec": "ffv1"},
        "shots": [{"index": 1}], "candidates": [{"index": 1, "reasons": ["CHANGE"]}],
        "evidence": [{"kind": "CLIP", "path": "old.mp4"}],
        "limitations": ["contact_fact_extraction_unverified"],
        "perception": {
            "sourceSha256": "a" * 64, "schemaVersion": "perception-run-v1",
            "pipelineVersion": "video-local-observers-v1", "processingStatus": "COMPLETE",
            "coverage": {"startMs": 0, "endMs": 1500, "sampleIntervalMs": 500, "expectedSamples": 4,
                         "processedSamples": 4, "failedSamples": 0},
            "summary": {"roleObservationCount": 2, "poseObservationCount": 0,
                        "officialCueCount": 0, "interactionCount": 0, "linkCount": 0,
                        "reasons": ["OFFICIAL_METHOD_UNVALIDATED"]},
            "observations": [{"id": "official-1"}], "incidents": [{"id": "incident-1"}],
        },
    }


def test_cue_matching_uses_fixture_truth_and_counts_misses_and_extras():
    result = score_cues([(400, 800)], [(390, 790), (1000, 1250)])

    assert result["truePositive"] == 1
    assert result["falsePositive"] == 1
    assert result["falseNegative"] == 0
    assert result["precision"] == 0.5
    assert result["recall"] == 1.0
    assert result["meanAbsoluteOnsetErrorMs"] == 10


def test_cue_matching_does_not_claim_perfect_precision_for_no_predictions():
    result = score_cues([(400, 800)], [])

    assert result["truePositive"] == 0
    assert result["falseNegative"] == 1
    assert result["recall"] == 0
    assert result["precision"] is None


def test_visual_comparator_ignores_only_audio_and_artifact_fields():
    baseline = visual_report()
    baseline.update({"audioObservations": None, "reportVersion": "old", "artifactRoot": "/one"})
    av = json.loads(json.dumps(baseline))
    av.update({"audioObservations": {"cueCount": 1},
               "reportVersion": "new", "artifactRoot": "/two"})
    assert compare_visual_reports(baseline, av)["exactVisualUnchanged"] is True

    av["candidates"] = [{"id": 2}]
    assert compare_visual_reports(baseline, av)["exactVisualUnchanged"] is False

    av["perception"]["sourceSha256"] = "b" * 64
    assert compare_visual_reports(baseline, av)["comparable"] is False


def test_visual_comparator_handles_actual_report_shape_without_masking_visual_changes():
    baseline = visual_report()
    av = json.loads(json.dumps(baseline))
    av["schema_version"] = 3
    av["pipeline_version"] = "video-local-observers-av-v1"
    av["limitations"].append("speech_not_analyzed")
    av["evidence"][0]["path"] = "new.mp4"
    av["evidence"][0]["audio_status"] = "PRESERVED"
    av["perception"]["schemaVersion"] = "perception-run-v2"
    av["perception"]["pipelineVersion"] = "video-local-observers-av-v1"
    av["perception"]["audio"] = {"cueCount": 1}
    assert compare_visual_reports(baseline, av)["exactVisualUnchanged"] is True
    av["perception"]["coverage"]["processedSamples"] = 3
    assert compare_visual_reports(baseline, av)["exactVisualUnchanged"] is False


def test_visual_comparator_rejects_hash_only_or_structurally_empty_reports():
    assert compare_visual_reports(None, None)["comparable"] is False
    hash_only = {"sourceSha256": "a" * 64}
    assert compare_visual_reports(hash_only, hash_only)["comparable"] is False
    assert compare_visual_reports(hash_only, hash_only)["exactVisualUnchanged"] is False

    incomplete = visual_report()
    incomplete["perception"]["coverage"] = {}
    assert compare_visual_reports(incomplete, incomplete)["comparable"] is False

    contradictory_source = visual_report()
    contradictory_source["sourceSha256"] = "b" * 64
    assert compare_visual_reports(contradictory_source, contradictory_source)["comparable"] is False

    missing_source_name = visual_report()
    missing_source_name["video"].pop("source_name")
    assert compare_visual_reports(missing_source_name, missing_source_name)["comparable"] is False


def test_visual_comparator_explains_audio_only_partial_but_rejects_unsupported_status():
    baseline = visual_report()
    av = json.loads(json.dumps(baseline))
    av["perception"]["processingStatus"] = "PARTIAL"
    av["perception"]["audio"] = {"status": "FAILED"}
    result = compare_visual_reports(baseline, av)
    assert result["comparable"] is True
    assert result["exactVisualUnchanged"] is True
    assert result["audioOnlyProcessingStatusDifference"] is True

    av["perception"]["processingStatus"] = "FAILED"
    assert compare_visual_reports(baseline, av)["exactVisualUnchanged"] is False

    av["perception"]["processingStatus"] = "PARTIAL"
    av["perception"]["audio"] = {"status": "COMPLETE"}
    assert compare_visual_reports(baseline, av)["exactVisualUnchanged"] is False


def test_audio_measurement_fails_on_missing_and_misaligned_av_output(tmp_path):
    source = tmp_path / "source.mkv"
    make_fixture(source, video_origin=0, audio_origin=0.3, pulse_local=0.1,
                 kind="multitone")
    expected_onset_ms = 400
    baseline = tmp_path / "baseline.mp4"
    baseline.write_bytes(b"not-a-video")
    correct = tmp_path / "correct.mp4"
    clip(source, correct, 0, 1000)

    missing = compare_clip_audio(source, baseline, tmp_path / "missing.mp4",
                                 0, 1000, expected_onset_ms=expected_onset_ms)
    assert missing["audioRetained"] is False
    assert missing["alignmentPass"] is False

    wrong = tmp_path / "wrong.mp4"
    clip(source, wrong, 300, 1300)
    misaligned = compare_clip_audio(source, baseline, wrong, 0, 1000,
                                    expected_onset_ms=expected_onset_ms)
    assert misaligned["alignmentPass"] is False
    assert abs(misaligned["onsetErrorMs"]) > 50


def test_no_audio_source_still_requires_valid_av_video_and_duration(tmp_path):
    from replay_video.evaluate_av import baseline_clip
    source = tmp_path / "source.mkv"
    make_fixture(source, video_origin=0, audio_origin=None, pulse_local=None,
                 kind="no_audio")
    baseline = tmp_path / "baseline.mp4"
    baseline_clip(source, baseline, 0, 1000)

    missing = compare_clip_audio(source, baseline, tmp_path / "missing.mp4",
                                 0, 1000, expected_onset_ms=None)
    assert missing["avValidVideo"] is False
    assert missing["avHasAudio"] is None

    corrupt = tmp_path / "corrupt.mp4"
    corrupt.write_bytes(b"invalid mp4")
    measured = compare_clip_audio(source, baseline, corrupt,
                                  0, 1000, expected_onset_ms=None)
    assert measured["avValidVideo"] is False
    assert measured["avHasAudio"] is None

    short = tmp_path / "short.mp4"
    clip(source, short, 0, 300)
    measured = compare_clip_audio(source, baseline, short,
                                  0, 1000, expected_onset_ms=None)
    assert measured["avValidVideo"] is False


def test_video_metadata_alone_cannot_validate_undecodable_output(tmp_path, monkeypatch):
    import replay_video.evaluate_av as evaluator
    source = tmp_path / "source.mkv"
    evaluator.make_fixture(source, video_origin=0, audio_origin=None, pulse_local=None,
                           kind="no_audio")
    baseline = tmp_path / "baseline.mp4"
    evaluator.baseline_clip(source, baseline, 0, 1000)
    broken = tmp_path / "broken.mp4"
    broken.write_bytes(b"not decodable")
    real_tracks = evaluator._tracks

    def misleading_tracks(path):
        if path == broken:
            return {"codec_type": "video", "index": 0, "duration": "1.000"}, None
        return real_tracks(path)

    monkeypatch.setattr(evaluator, "_tracks", misleading_tracks)
    measured = evaluator.compare_clip_audio(source, baseline, broken, 0, 1000,
                                             expected_onset_ms=None)
    assert measured["avValidVideo"] is False
    assert measured["avHasAudio"] is None


def test_no_audio_output_with_valid_header_and_first_frame_but_corrupt_tail_is_invalid(tmp_path):
    from replay_video.evaluate_av import baseline_clip
    source = tmp_path / "source.mkv"
    make_fixture(source, video_origin=0, audio_origin=None, pulse_local=None,
                 kind="no_audio")
    baseline = tmp_path / "baseline.mp4"
    baseline_clip(source, baseline, 0, 1000)
    av = tmp_path / "av.mp4"
    clip(source, av, 0, 1000)
    packets = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_packets",
         "-show_entries", "packet=pos,size", "-of", "json", str(av)],
        capture_output=True, text=True, check=True, timeout=10,
    ).stdout)["packets"]
    assert len(packets) == 20
    data = bytearray(av.read_bytes())
    for packet in packets[-15:]:
        start = int(packet["pos"])
        end = start + int(packet["size"])
        data[start:end] = bytes(end - start)
    av.write_bytes(data)
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(av)],
                           capture_output=True, text=True, check=True, timeout=10)
    assert float(next(stream["duration"] for stream in json.loads(probe.stdout)["streams"]
                      if stream["codec_type"] == "video")) == pytest.approx(1.0)
    strict_decode = subprocess.run(
        ["ffmpeg", "-nostdin", "-xerror", "-v", "error", "-i", str(av),
         "-map", "0:v:0", "-an", "-f", "null", "-"],
        capture_output=True, timeout=10,
    )
    assert strict_decode.returncode != 0

    measured = compare_clip_audio(source, baseline, av, 0, 1000, expected_onset_ms=None)
    assert measured["avDurationPass"] is True
    assert measured["avDecodedCoveragePass"] is False
    assert measured["avValidVideo"] is False
    assert measured["avHasAudio"] is None


def test_synthetic_no_audio_case_fails_if_encoder_returns_without_output(tmp_path, monkeypatch):
    import replay_video.evaluate_av as evaluator
    from replay_video.infrastructure.av_media import ClipAudioResult
    real_clip = evaluator.clip

    def omit_no_audio(source, destination, start_ms, end_ms):
        if destination.parent.name == "no_audio":
            return ClipAudioResult("ABSENT", "SOURCE_AUDIO_ABSENT")
        return real_clip(source, destination, start_ms, end_ms)

    monkeypatch.setattr(evaluator, "clip", omit_no_audio)
    report = evaluator.run_synthetic(tmp_path / "benchmark")
    assert report["syntheticChecksPass"] is False
    assert report["cases"][6]["clipAudioMetrics"]["avValidVideo"] is False


def test_synthetic_silent_track_fails_if_av_output_contains_injected_tone(tmp_path, monkeypatch):
    import replay_video.evaluate_av as evaluator
    real_clip = evaluator.clip

    def inject_tone_into_silent_output(source, destination, start_ms, end_ms):
        if destination.parent.name == "silent_tracked":
            injected_source = destination.parent.parent / "stereo_antiphase" / "source.mkv"
            return real_clip(injected_source, destination, start_ms, end_ms)
        return real_clip(source, destination, start_ms, end_ms)

    monkeypatch.setattr(evaluator, "clip", inject_tone_into_silent_output)
    report = evaluator.run_synthetic(tmp_path / "benchmark")
    silent = next(case for case in report["cases"] if case["name"] == "silent_tracked")
    assert silent["clipAudioMetrics"]["sourceDecodedOnsetMs"] is None
    assert silent["clipAudioMetrics"]["avDecodedOnsetMs"] == 200
    assert report["syntheticChecksPass"] is False


def test_audio_measurement_accepts_real_encoded_clip_and_independent_pcm_onset(tmp_path):
    source = tmp_path / "source.mkv"
    make_fixture(source, video_origin=5, audio_origin=5.3, pulse_local=0.1,
                 kind="multitone")
    baseline = tmp_path / "baseline.mp4"
    from replay_video.evaluate_av import baseline_clip
    baseline_clip(source, baseline, 0, 1000)
    av = tmp_path / "av.mp4"
    clip(source, av, 0, 1000)

    measured = compare_clip_audio(source, baseline, av, 0, 1000,
                                  expected_onset_ms=400)

    assert measured["baselineHasAudio"] is False
    assert measured["avHasAudio"] is True
    assert measured["audioRetained"] is True
    assert measured["alignmentPass"] is True
    assert abs(measured["onsetErrorMs"]) <= 50
    assert abs(measured["sourceOnsetErrorMs"]) <= 50


def test_synthetic_run_is_exclusive_and_marks_semantic_accuracy_unproven(tmp_path):
    from replay_video.evaluate_av import run_synthetic
    output = tmp_path / "benchmark"
    report = run_synthetic(output)
    persisted = json.loads((output / "metrics.json").read_text())
    assert persisted == report
    assert report["semanticAccuracyImprovement"] == "NOT_ESTABLISHED"
    assert report["groundTruthScope"] == "KNOWN_SYNTHETIC_MULTITONE_SIGNALS"
    assert len(report["cases"]) >= 9
    assert report["syntheticChecksPass"] is True
    negative = next(case for case in report["cases"] if case["name"] == "negative_offset")
    assert negative["clipAudioMetrics"]["baselineValidVideo"] is True
    assert negative["clipAudioMetrics"]["baselineDurationPass"] is False
    assert report["baselineVisualDurationMismatchCases"] == ["negative_offset"]
    assert all(case["clipAudioMetrics"]["alignmentPass"] for case in report["cases"]
               if case["clipAudioMetrics"]["expectedOnsetMs"] is not None)
    assert sum(case["cueMetrics"]["falseNegative"] for case in report["cases"]
               if case["expectedCueIntervalsMs"]) == 0
    with pytest.raises(FileExistsError):
        run_synthetic(output)
