import json

import pytest

from replay_video.application.pipeline import pipeline
from replay_video.application.ports import PipelinePorts
from replay_video.domain.models import Candidate, Evidence
from replay_video.infrastructure.audio_observations import observe_audio
from test_audio_observations import scan
from test_perception import api, local_report, setup


def av_report(source, root):
    raw = local_report(source, root, observations=[])
    raw.update(schemaVersion="perception-run-v2", pipelineVersion="video-local-observers-av-v1",
               audio=observe_audio(source, duration_ms=10000, scan=lambda *a, **kw: scan())["observations"])
    return raw


def test_adapter_observes_whole_source_audio_before_visual_observers(tmp_path):
    source, metadata, shots = setup(tmp_path)
    calls = []
    root = tmp_path / "out"
    def audio(source, **kwargs):
        calls.append(("audio", kwargs["duration_ms"]))
        return observe_audio(source, scan=lambda *a, **kw: scan(), **kwargs)
    def visual(source, output, **kwargs):
        calls.append(("visual", kwargs["audio_input"]["observations"]["sourceSha256"]))
        return av_report(source, root)
    adapter = api().PerceptionAdapter(observe=visual, audio_enabled=True, observe_audio=audio)
    result = adapter(source, root, metadata, (), shots)
    assert [call[0] for call in calls] == ["audio", "visual"]
    assert calls[0][1] == metadata.duration_ms
    assert result.candidates == ()  # Sound does not create adjudication candidates.
    assert result.perception["audio"]["cueCount"] == 1
    assert adapter.pipeline_version == "video-local-observers-av-v1"


def test_av_pipeline_preserves_candidates_and_binds_audio_after_evidence(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    candidate = Candidate(7, "OTHER", 1000, 2000, 1400, .1, "LOW", (), (0,))
    def perception(source, output, meta, candidates, shots):
        return api().adapt_observations(av_report(source, root), root, meta, candidates, shots)
    ports = PipelinePorts(probe=lambda _: metadata, shots=lambda *a: shots,
                          candidates=lambda *a: (candidate,), perception=perception,
                          evidence=lambda *a: (Evidence(7, "CLIP", root / "clip.mp4", 1400, 1000, 2000,
                                                        audio_status="PRESERVED"),))
    result = pipeline(source, root, ports=ports, pipeline_version="video-local-observers-av-v1")
    payload = json.loads(result.report_path.read_text())
    assert result.pipeline_version == "video-local-observers-av-v1"
    assert len(result.candidates) == 1
    assert result.candidates[0].start_ms == candidate.start_ms
    assert result.candidates[0].confidence == candidate.confidence
    assert payload["perception"]["audio"]["associations"][0]["evidenceIndices"] == [0]
    assert "speech_not_analyzed" in payload["limitations"]


def test_av_pipeline_cannot_silently_accept_legacy_observations(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    ports = PipelinePorts(probe=lambda _: metadata, shots=lambda *a: shots,
                          candidates=lambda *a: (), evidence=lambda *a: (),
                          perception=lambda *a: api().adapt_observations(local_report(source, root), root, metadata, (), shots))
    with pytest.raises(ValueError, match="PERCEPTION_AUDIO_REQUIRED"):
        pipeline(source, root, ports=ports, pipeline_version="video-local-observers-av-v1")


def test_av_adapter_rejects_different_source_audio_from_observer(tmp_path):
    source, metadata, shots = setup(tmp_path)
    root = tmp_path / "out"
    raw = av_report(source, root)
    raw["audio"]["sourceSha256"] = "0" * 64
    with pytest.raises(ValueError, match="PERCEPTION_AUDIO_SOURCE_MISMATCH"):
        api().adapt_observations(raw, root, metadata, (), shots)


def test_operating_factory_selects_av_but_legacy_diagnostic_adapter_stays_v1():
    from replay_video.infrastructure.ports import operating
    assert operating().perception.pipeline_version == "video-local-observers-av-v1"
    assert api().PerceptionAdapter().pipeline_version == "video-local-observers-v1"


def test_runner_rejects_missing_av_observations_before_upload(tmp_path):
    from replay_video.runner import report
    path = tmp_path / "report.json"
    path.write_text(json.dumps({"pipeline_version": "video-local-observers-av-v1", "shots": [],
                               "candidates": [], "evidence": [], "limitations": []}))
    with pytest.raises(RuntimeError, match="perception-required"):
        report(None, {}, path)
