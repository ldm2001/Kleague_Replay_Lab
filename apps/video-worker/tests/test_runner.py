from __future__ import annotations

from pathlib import Path

from test_pipeline import fixture

from replay_video.runner import cycle
from replay_video.http import HttpError


class ApiFake:
    def __init__(self, source: Path) -> None:
        self.source = source
        self.results: list[dict[str, object]] = []
        self.progresses: list[tuple[str, int]] = []
        self.uploads: list[str] = []

    def claim(self, kind: str) -> dict[str, object]:
        return {
            "jobId": "job-1",
            "jobType": kind,
            "jobRevision": 1,
            "leaseToken": "lease",
            "sourceUrl": "http://storage/video",
        }

    def media(self, _url: str, target: Path) -> None:
        assert self.progresses
        target.write_bytes(self.source.read_bytes())

    def result(self, _job: dict[str, object], payload: dict[str, object]) -> dict[str, object]:
        self.results.append(payload)
        return {"kind": "ACCEPTED"}

    def progress(
        self,
        _job: dict[str, object],
        stage: str,
        percent: int,
        _message: str | None = None,
    ) -> dict[str, object]:
        self.progresses.append((stage, percent))
        return {"kind": "UPDATED"}

    def evidence(self, job: dict[str, object], items: list[dict[str, object]]) -> dict[str, object]:
        return {
            "kind": "GRANTED",
            "items": [{
                "name": item["name"],
                "objectKey": f"evidence/analysis/{job['jobId']}/{item['name']}",
                "uploadUrl": f"http://storage/{item['name']}",
            } for item in items],
        }

    def put(self, _url: str, source: Path, _content_type: str) -> None:
        self.uploads.append(source.name)


def test_cycle_validates_claimed_video(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    fixture(source)
    api = ApiFake(source)

    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    assert api.results == [{
        "kind": "VALIDATED",
        "durationMs": 4000,
        "width": 320,
        "height": 180,
    }]
    assert api.progresses[0] == ("VALIDATING", 10)


def test_cycle_submits_pipeline_report(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    fixture(source)
    api = ApiFake(source)

    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    payload = api.results[0]
    assert payload["kind"] == "ANALYZED"
    assert payload["pipelineVersion"] == "video-baseline-v1"
    assert payload["limitations"] == [
        "replay_detection_pending",
        "incident_category_classification_pending",
        "pose_tracking_pending",
    ]
    assert isinstance(payload["shots"], list)
    assert isinstance(payload["candidates"], list)
    assert payload["candidates"]
    assert api.progresses[0] == ("SEGMENTING", 10)
    assert {stage for stage, _percent in api.progresses} >= {"SEGMENTING", "DETECTING", "EXTRACTING_FACTS", "BUILDING_EVIDENCE", "APPLYING_RULES"}
    assert isinstance(payload["evidence"], list)
    assert len(payload["evidence"]) == 2
    assert len(api.uploads) == 2


def test_cycle_does_not_crash_when_stale_result_is_rejected(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    fixture(source)

    class Stale(ApiFake):
        def result(self, _job: dict[str, object], _payload: dict[str, object]) -> dict[str, object]:
            raise HttpError("http-409")

    assert cycle(Stale(source), "VALIDATE_VIDEO", tmp_path / "work") is True
