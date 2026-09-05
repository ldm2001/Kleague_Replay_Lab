from __future__ import annotations
from pathlib import Path
import time
from threading import Event, Thread
import pytest
from test_pipeline import fixture
from replay_video.runner import Pulse, cycle, loop
from replay_video.http import HttpError

# 워커 API 모형
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


# 영상 검증 작업 확인
def test_validation(tmp_path: Path) -> None:
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


# 영상 분석 작업 확인
def test_analysis(tmp_path: Path) -> None:
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


# 오래된 결과 처리 확인
def test_stale(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    fixture(source)

    class Stale(ApiFake):
        def result(self, _job: dict[str, object], _payload: dict[str, object]) -> dict[str, object]:
            raise HttpError("http-409")

    assert cycle(Stale(source), "VALIDATE_VIDEO", tmp_path / "work") is True


# 진행률 heartbeat 확인
def test_pulse(tmp_path: Path) -> None:
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = ApiFake(source)
    item = api.claim("ANALYZE_VIDEO")

    with Pulse(api, item, "SEGMENTING", interval=0.005) as pulse:
        pulse.progress("DETECTING", 40, "candidate-scan")
        deadline = time.monotonic() + 0.2
        while len(api.progresses) < 3 and time.monotonic() < deadline:
            time.sleep(0.005)

    assert api.progresses[0] == ("SEGMENTING", 10)
    assert api.progresses[1] == ("DETECTING", 40)
    assert api.progresses[-1] == ("DETECTING", 40)


# 첫 조회 실패 뒤 다음 반복에서 정상 작업 처리
def test_recovery(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class Recovery(ApiFake):
        failures = 0

        def claim(self, kind: str) -> dict[str, object] | None:
            if self.failures == 0:
                self.failures += 1
                raise HttpError("http-500")
            if kind == "ANALYZE_VIDEO":
                return None
            if self.results:
                raise KeyboardInterrupt()
            return super().claim(kind)

    source = tmp_path / "sample.mp4"
    fixture(source)
    api = Recovery(source)
    delays = []
    monkeypatch.setattr("replay_video.runner.time.sleep", delays.append)
    with pytest.raises(KeyboardInterrupt):
        loop(api, tmp_path / "work", 0.1)
    assert api.results[0]["kind"] == "VALIDATED"
    assert delays


# 진행 전송이 겹쳐도 이전 heartbeat가 뒤늦게 저장되지 않음
def test_order(tmp_path: Path) -> None:
    class Delayed(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if message == "worker-heartbeat":
                pending.set()
                assert release.wait(2)
            return super().progress(item, stage, percent, message)

    pending, release, finished = Event(), Event(), Event()
    api = Delayed(tmp_path / "unused")
    pulse = Pulse(api, {}, "SEGMENTING", interval=0.001)
    heartbeat = Thread(target=pulse.beat)
    heartbeat.start()
    assert pending.wait(2)
    def delivery():
        pulse.progress("BUILDING_EVIDENCE", 70)
        finished.set()
    reporter = Thread(target=delivery)
    reporter.start()
    # 기존 구현의 역행 순서를 재현할 전송 기회 제공
    finished.wait(0.05)
    pulse.stop.set()
    release.set()
    heartbeat.join(2)
    reporter.join(2)
    assert not heartbeat.is_alive() and not reporter.is_alive()
    assert api.progresses[-1] == ("BUILDING_EVIDENCE", 70)
