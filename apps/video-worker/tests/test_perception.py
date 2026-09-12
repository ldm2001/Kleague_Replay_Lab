from dataclasses import replace
import gzip
import hashlib
import importlib
import json
from pathlib import Path

import pytest

from replay_video.application.pipeline import pipeline
from replay_video.application.ports import PipelinePorts
from replay_video.domain.models import Candidate, Evidence, Shot, VideoMetadata
from replay_video.infrastructure.evidence import evidence


def api():
    return importlib.import_module("replay_video.infrastructure.perception")


def observation(identifier="official-one", start=3000, end=3500):
    return {"id": identifier, "startMs": start, "endMs": end, "continuityId": 0,
            "officialRole": "UNKNOWN", "signalKind": "RAISED_ARM", "supportFrameCount": 4,
            "contact": "UNVERIFIED", "originalDecision": "UNKNOWN", "restart": "UNVERIFIED",
            "reasons": ["SIGNAL_MEANING_UNVALIDATED"]}


def local_report(source, root, *, observations=None):
    path = root / "perception" / "perception.jsonl.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(b'{"kind":"HEADER"}\n'))
    return {"schemaVersion": "perception-run-v1", "pipelineVersion": "video-local-observers-v1",
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(), "processingStatus": "COMPLETE",
            "coverage": {"startMs": 0, "endMs": 10000, "sampleIntervalMs": 100,
                         "expectedSamples": 100, "processedSamples": 100, "failedSamples": 0},
            "models": [], "artifact": {"path": str(path), "contentType": "application/gzip",
                         "contentSha256": hashlib.sha256(path.read_bytes()).hexdigest(), "sizeBytes": path.stat().st_size},
            "summary": {"roleObservationCount": 100, "poseObservationCount": 100, "officialCueCount": 1,
                         "interactionCount": 0, "linkCount": 0, "truncated": False,
                         "reasons": ["CONTACT_METHOD_UNVALIDATED"]},
            "observations": [observation()] if observations is None else observations,
            "interactions": [], "links": []}


def setup(tmp_path):
    source = tmp_path / "source.mp4"
    source.write_bytes(b"source")
    metadata = VideoMetadata(source, 10000, 320, 180, 10., 100, "test")
    shots = (Shot(0, 0, 5000), Shot(1, 5001, 10000))
    return source, metadata, shots


def test_observer_episode_creates_bounded_other_candidate_without_facts(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    raw = local_report(source, root)
    result = api().adapt_observations(raw, root, metadata, (), shots)
    candidate = result.candidates[0]
    assert candidate.category == "OTHER"
    assert (candidate.start_ms, candidate.end_ms) == (1500, 6500)
    assert candidate.shot_indices == (0, 1)
    assert candidate.camera_sufficiency == "LOW"
    assert candidate.confidence == 0
    assert "LOCAL_OBSERVER_EVIDENCE_REQUIRED" in candidate.reasons
    incident = result.perception["incidents"][0]
    assert incident["candidateIndex"] == candidate.index
    assert incident["contact"] == "UNVERIFIED"
    assert incident["originalDecision"] == "UNKNOWN"
    assert incident["restart"] == "UNVERIFIED"
    assert result.perception["artifact"]["path"] == "perception/perception.jsonl.gz"
    assert "observations" not in result.perception


def test_overlapping_existing_candidate_and_legacy_metadata_are_preserved(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    existing = Candidate(4, "OTHER", 2000, 4000, 2500, .8, "MEDIUM", ("motion",), (0,),
                         tracking={"sampleCount": 5})
    result = api().adapt_observations(local_report(source, root), root, metadata, (existing,), shots)
    assert len(result.candidates) == 1
    candidate = result.candidates[0]
    assert candidate.index == 4 and candidate.tracking == existing.tracking
    assert candidate.anchor_ms == existing.anchor_ms and "motion" in candidate.reasons
    assert candidate.start_ms <= 1500 and candidate.end_ms >= 6500


def test_summaries_beyond_candidate_budget_are_explicitly_truncated(tmp_path, monkeypatch):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    raw = local_report(source, root, observations=[observation("a", 100, 200), observation("b", 8000, 8500)])
    monkeypatch.setattr(api(), "MAX_NEW_CANDIDATES", 1)
    result = api().adapt_observations(raw, root, metadata, (), shots)
    assert len(result.candidates) == 1
    assert result.perception["summary"]["truncated"] is True
    assert "INCIDENT_SUMMARY_LIMIT" in result.perception["summary"]["reasons"]


def test_diagnostic_artifact_cannot_reference_a_file_outside_job_root(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    raw = local_report(source, root)
    raw["artifact"]["path"] = str(source)
    with pytest.raises(ValueError, match="PERCEPTION_ARTIFACT_PATH_INVALID"):
        api().adapt_observations(raw, root, metadata, (), shots)


def test_observation_candidates_always_receive_temporal_clip_even_over_legacy_budget(tmp_path, monkeypatch):
    source, metadata, _ = setup(tmp_path)
    candidate = Candidate(0, "OTHER", 1000, 2000, 1500, 0., "LOW",
                          ("LOCAL_OBSERVER_EVIDENCE_REQUIRED",), (0,))
    monkeypatch.setattr("replay_video.infrastructure.evidence.frame", lambda source, path, ms: path.write_bytes(b"frame"))
    monkeypatch.setattr("replay_video.infrastructure.evidence.clip", lambda source, path, start, end: path.write_bytes(b"clip"))
    result = evidence(source, tmp_path / "out", metadata, (candidate,), max_clips=0)
    assert [item.kind for item in result] == ["FRAME", "CLIP"]


def test_pipeline_observes_before_evidence_and_binds_only_actual_temporal_clips(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    calls = []
    def observe(source, target, meta, candidates, actual_shots):
        calls.append("perception")
        return api().adapt_observations(local_report(source, target), target, meta, candidates, actual_shots)
    def evidence_port(source, target, meta, candidates):
        calls.append("evidence")
        candidate = candidates[0]
        return (Evidence(candidate.index, "FRAME", target / "frame.jpg", 3000, candidate.start_ms, candidate.end_ms),
                Evidence(candidate.index, "CLIP", target / "clip.mp4", 3000, candidate.start_ms, candidate.end_ms))
    ports = PipelinePorts(probe=lambda value: metadata, shots=lambda source, meta: shots,
                          candidates=lambda source, meta, shots: (), evidence=evidence_port, perception=observe)
    result = pipeline(source, root, ports=ports, pipeline_version="video-local-observers-v1")
    payload = json.loads(result.report_path.read_text())
    assert calls == ["perception", "evidence"]
    assert payload["perception"]["incidents"][0]["evidenceIndices"] == [1]
    assert "pose_tracking_pending" not in payload["limitations"]
    assert "contact_fact_extraction_unverified" in payload["limitations"]


def test_new_pipeline_version_cannot_silently_run_without_observer_port(tmp_path):
    source, metadata, shots = setup(tmp_path)
    ports = PipelinePorts(probe=lambda source: metadata, shots=lambda source, meta: shots,
                          candidates=lambda source, meta, shots: (), evidence=lambda *args: ())
    with pytest.raises(ValueError, match="PERCEPTION_PORT_REQUIRED"):
        pipeline(source, tmp_path / "out", ports=ports, pipeline_version="video-local-observers-v1")


def test_default_analyze_job_selects_operating_ports_but_validation_never_loads_models(tmp_path, monkeypatch):
    from replay_video.worker import job
    source, metadata, shots = setup(tmp_path)
    called = []
    def operating(**kwargs):
        called.append(kwargs)
        return PipelinePorts(probe=lambda value: metadata, shots=lambda source, meta: shots,
                             candidates=lambda source, meta, shots: (), evidence=lambda *args: (),
                             perception=lambda source, target, meta, candidates, shots:
                                 api().adapt_observations(local_report(source, target, observations=[]), target, meta, candidates, shots))
    monkeypatch.setattr("replay_video.worker.operating", operating)
    monkeypatch.setattr("replay_video.worker.probe", lambda source: metadata)
    value = {"job_id": "one", "job_type": "VALIDATE_VIDEO", "source_path": str(source)}
    assert job(value).payload["kind"] == "VALIDATED"
    assert called == []
    result = job({**value, "job_type": "ANALYZE_VIDEO", "output_path": str(tmp_path / "out")})
    assert len(called) == 1
    assert json.loads(Path(result.payload["report_path"]).read_text())["pipeline_version"] == "video-local-observers-v1"


def test_default_operating_factory_cannot_fall_back_to_baseline_after_losing_its_port(tmp_path, monkeypatch):
    from replay_video.worker import job
    source, metadata, shots = setup(tmp_path)
    monkeypatch.setattr("replay_video.worker.operating", lambda **kwargs:
                        PipelinePorts(probe=lambda value: metadata, shots=lambda source, meta: shots,
                                      candidates=lambda *args: (), evidence=lambda *args: ()))
    with pytest.raises(ValueError, match="PERCEPTION_PORT_REQUIRED"):
        job({"job_id": "one", "job_type": "ANALYZE_VIDEO", "source_path": str(source),
             "output_path": str(tmp_path / "out")})


def test_expanded_candidate_tracking_is_recounted_from_original_full_scan(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    raw = local_report(source, root)
    previous = Candidate(4, "OTHER", 2000, 4000, 2500, .8, "MEDIUM", ("motion",), (0,),
                         tracking={"version": "ball-path-v1", "coverage": "COMPLETE", "sampleCount": 1,
                                   "selectedCount": 1, "cameraCount": 1, "motionOnsetsMs": []})
    tracking = root / "tracking"
    tracking.mkdir()
    (tracking / "context-summary.json").write_text(json.dumps({"source_sha256": raw["sourceSha256"], "coverage_status": "MATCHES_METADATA"}))
    samples = [{"timestamp_ms": ms, "ball_track": {"candidate": {}, "compensated_displacement_px": 1,
                                                 "motion_onset_ms": None}} for ms in (2500, 4500)]
    (tracking / "context.jsonl").write_text("\n".join(json.dumps(item) for item in samples) + "\n")
    adapter = api().PerceptionAdapter(observe=lambda *args, **kwargs: raw)
    observed = adapter(source, root, metadata, (previous,), shots)
    assert observed.candidates[0].tracking["sampleCount"] == 2
    assert observed.candidates[0].tracking["selectedCount"] == 2
    assert previous.tracking["sampleCount"] == 1


def test_tracking_refresh_rejects_another_source_scan(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    raw = local_report(source, root)
    tracking = root / "tracking"
    tracking.mkdir()
    (tracking / "context-summary.json").write_text(json.dumps({"source_sha256": "0" * 64, "coverage_status": "MATCHES_METADATA"}))
    (tracking / "context.jsonl").write_text("")
    adapter = api().PerceptionAdapter(observe=lambda *args, **kwargs: raw)
    with pytest.raises(ValueError, match="TRACKING_SOURCE_MISMATCH"):
        adapter(source, root, metadata, (), shots)
