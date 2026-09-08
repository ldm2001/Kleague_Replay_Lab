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
        # 가짜 저장소 원본 보관
        self.source = source
        # 작업 결과 기록
        self.results: list[dict[str, object]] = []
        # 진행 보고 기록
        self.progresses: list[tuple[str, int]] = []
        # 업로드 파일 기록
        self.uploads: list[str] = []

    def claim(self, kind: str) -> dict[str, object]:
        # 고정 작업 Lease 반환
        return {
            "jobId": "job-1",
            "jobType": kind,
            "jobRevision": 1,
            "leaseToken": "lease",
            "sourceUrl": "http://storage/video",
        }

    def media(self, _url: str, target: Path) -> None:
        # 진행 보고 후 원본 복사
        assert self.progresses
        target.write_bytes(self.source.read_bytes())

    def result(self, _job: dict[str, object], payload: dict[str, object]) -> dict[str, object]:
        # 작업 결과 저장
        self.results.append(payload)
        return {"kind": "ACCEPTED"}

    def progress(
        self,
        _job: dict[str, object],
        stage: str,
        percent: int,
        _message: str | None = None,
    ) -> dict[str, object]:
        # 진행 상태 저장
        self.progresses.append((stage, percent))
        return {"kind": "UPDATED"}

    def evidence(self, job: dict[str, object], items: list[dict[str, object]]) -> dict[str, object]:
        # 증거 권한 모형 반환
        return {
            "kind": "GRANTED",
            "items": [{
                "name": item["name"],
                "objectKey": f"evidence/analysis/{job['jobId']}/{item['name']}",
                "uploadUrl": f"http://storage/{item['name']}",
            } for item in items],
        }

    def put(self, _url: str, source: Path, _content_type: str) -> None:
        # 증거 업로드 파일 기록
        self.uploads.append(source.name)

# 영상 검증 작업 확인
def test_validation(tmp_path: Path) -> None:
    # 검증 입력 준비
    source = tmp_path / "sample.mp4"
    fixture(source)
    api = ApiFake(source)

    # 검증 작업 실행
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
    # 분석 입력 준비
    source = tmp_path / "sample.mp4"
    fixture(source)
    api = ApiFake(source)

    # 분석 작업 실행
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
    assert {stage for stage, _percent in api.progresses} >= {"SEGMENTING", "DETECTING", "EXTRACTING_FACTS", "BUILDING_EVIDENCE"}
    assert isinstance(payload["evidence"], list)
    assert len(payload["evidence"]) == 2
    assert len(api.uploads) == 2

# 오래된 결과 처리 확인
def test_stale(tmp_path: Path) -> None:
    # 오래된 Lease 결과 모형
    source = tmp_path / "sample.mp4"
    fixture(source)

    class Stale(ApiFake):
        def result(self, _job: dict[str, object], _payload: dict[str, object]) -> dict[str, object]:
            raise HttpError("http-409")

    assert cycle(Stale(source), "VALIDATE_VIDEO", tmp_path / "work") is True

# 진행률 heartbeat 확인
def test_pulse(tmp_path: Path) -> None:
    # heartbeat 입력 준비
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = ApiFake(source)
    item = api.claim("ANALYZE_VIDEO")

    # 진행률 갱신과 heartbeat 실행
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
    # 첫 조회 실패 후 복구 모형
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
        # 다음 폴링에서 검증 작업 실행
        loop(api, tmp_path / "work", 0.1)
    # 실패 뒤 작업 처리와 지연 확인
    assert api.results[0]["kind"] == "VALIDATED"
    assert delays

# 진행 전송이 겹쳐도 이전 heartbeat가 뒤늦게 저장되지 않음
def test_order(tmp_path: Path) -> None:
    # heartbeat 지연 모형
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
    # 최신 진행 보고를 별도 스레드에서 실행
    reporter.start()
    # 기존 구현의 역행 순서를 재현할 전송 기회 제공
    finished.wait(0.05)
    pulse.stop.set()
    release.set()
    heartbeat.join(2)
    reporter.join(2)
    assert not heartbeat.is_alive() and not reporter.is_alive()
    assert api.progresses[-1] == ("BUILDING_EVIDENCE", 70)
