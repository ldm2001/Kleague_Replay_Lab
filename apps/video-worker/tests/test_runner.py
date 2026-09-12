from __future__ import annotations
from pathlib import Path
from functools import partial
import hashlib
import json
import time
from threading import Event, Thread
from types import SimpleNamespace
import pytest
from test_pipeline import fixture
from replay_video.runner import Pulse, cycle, loop
from replay_video.http import HttpError
from replay_video.infrastructure.ports import media
from replay_video.worker import job as real_job

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
            "jobId": "11111111-1111-4111-8111-111111111111",
            "jobType": kind,
            "jobRevision": 1,
            "leaseToken": "lease",
            "analysisId": "22222222-2222-4222-8222-222222222222",
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
def test_analysis(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 분석 입력 준비
    source = tmp_path / "sample.mp4"
    fixture(source)
    api = ApiFake(source)
    # 운영 관측 모델을 로드하지 않는 기존 미디어 파이프라인 회귀 테스트
    monkeypatch.setattr("replay_video.runner.job", partial(real_job, ports=media()))

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


def test_pulse_state_and_accepted_result_do_not_wait_for_blocked_heartbeat_request(tmp_path: Path) -> None:
    blocked, release, checked, submitted = Event(), Event(), Event(), Event()

    class BlockedHeartbeat(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if message == "worker-heartbeat":
                blocked.set()
                assert release.wait(2)
            return super().progress(item, stage, percent, message)

    api = BlockedHeartbeat(tmp_path / "unused")
    pulse = Pulse(api, api.claim("VALIDATE_VIDEO"), "VALIDATING", interval=0.001)
    with pulse:
        assert blocked.wait(2)
        checker = Thread(target=lambda: (pulse.check(), checked.set()))
        finisher = Thread(target=lambda: (pulse.submit({"kind": "VALIDATED"}), submitted.set()))
        checker.start()
        finisher.start()
        check_was_nonblocking = checked.wait(0.2)
        submit_was_nonblocking = submitted.wait(0.2)
        release.set()
        checker.join(2)
        finisher.join(2)

    assert check_was_nonblocking is True
    assert submit_was_nonblocking is True
    assert pulse.accepted is True and pulse.failure is None
    assert api.results == [{"kind": "VALIDATED"}]


def test_stale_start_stops_before_download_or_result(tmp_path: Path) -> None:
    class Stale(ApiFake):
        downloaded = False

        def progress(self, *_args, **_kwargs):
            return {"kind": "STALE_LEASE"}

        def media(self, _url: str, _target: Path) -> None:
            self.downloaded = True

    api = Stale(tmp_path / "unused.mp4")

    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    assert api.downloaded is False
    assert api.results == []


def test_transient_heartbeat_failure_stops_job_without_submitting_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    failed = Event()

    class HeartbeatFailure(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if message == "worker-heartbeat":
                failed.set()
                raise HttpError("http-unavailable")
            return super().progress(item, stage, percent, message)

    def interrupted(_value, *, progress=None, check_cancelled=None, ports=None):
        assert progress is not None and check_cancelled is not None and ports is None
        assert failed.wait(1)
        check_cancelled()
        raise AssertionError("lease failure did not stop the job")

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = HeartbeatFailure(source)
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    monkeypatch.setattr("replay_video.runner.job", interrupted)

    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    assert failed.is_set()
    assert api.results == []
    assert "WORKER_HEARTBEAT_FAILED" in caplog.text


def test_heartbeat_continues_while_final_result_request_is_blocked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitting, heartbeating, release = Event(), Event(), Event()

    class BlockingResult(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if submitting.is_set() and message == "worker-heartbeat":
                heartbeating.set()
            return super().progress(item, stage, percent, message)

        def result(self, _job, payload):
            self.results.append(payload)
            submitting.set()
            assert release.wait(2)
            return {"kind": "ACCEPTED"}

    def validated(*_args, **_kwargs):
        return SimpleNamespace(payload={"kind": "VALIDATED", "duration_ms": 1000, "width": 10, "height": 10})

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = BlockingResult(source)
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    monkeypatch.setattr("replay_video.runner.job", validated)
    worker = Thread(target=cycle, args=(api, "VALIDATE_VIDEO", tmp_path / "work"))
    worker.start()
    assert submitting.wait(2)
    assert heartbeating.wait(2)
    release.set()
    worker.join(2)

    assert not worker.is_alive()
    assert api.results == [{"kind": "VALIDATED", "durationMs": 1000, "width": 10, "height": 10}]


def test_accepted_result_wins_heartbeat_stale_race(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitting, stale = Event(), Event()

    class AcceptedRace(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if submitting.is_set() and message == "worker-heartbeat":
                stale.set()
                raise HttpError("http-409")
            return super().progress(item, stage, percent, message)

        def result(self, _job, payload):
            self.results.append(payload)
            submitting.set()
            assert stale.wait(2)
            return {"kind": "ACCEPTED"}

    def validated(*_args, **_kwargs):
        return SimpleNamespace(payload={"kind": "VALIDATED", "duration_ms": 1000, "width": 10, "height": 10})

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = AcceptedRace(source)
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    monkeypatch.setattr("replay_video.runner.job", validated)

    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    assert stale.is_set()
    assert len(api.results) == 1


def test_normal_processing_failure_is_reported_only_while_lease_is_owned(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = ApiFake(source)

    def broken(*_args, **_kwargs):
        raise ValueError("processing failed")

    monkeypatch.setattr("replay_video.runner.job", broken)
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]


def test_heartbeat_continues_while_processing_failure_result_is_blocked(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitting, heartbeating = Event(), Event()

    class BlockingFailure(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if submitting.is_set() and message == "worker-heartbeat":
                heartbeating.set()
            return super().progress(item, stage, percent, message)

        def result(self, _job, payload):
            self.results.append(payload)
            submitting.set()
            assert heartbeating.wait(2)
            return {"kind": "ACCEPTED"}

    def broken(*_args, **_kwargs):
        raise ValueError("processing failed")

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = BlockingFailure(source)
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    monkeypatch.setattr("replay_video.runner.job", broken)

    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    assert heartbeating.is_set()
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]


def test_accepted_failure_result_wins_heartbeat_stale_race(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitting, stale = Event(), Event()

    class AcceptedFailureRace(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if submitting.is_set() and message == "worker-heartbeat":
                stale.set()
                raise HttpError("http-409")
            return super().progress(item, stage, percent, message)

        def result(self, _job, payload):
            self.results.append(payload)
            submitting.set()
            assert stale.wait(2)
            return {"kind": "ACCEPTED"}

    def broken(*_args, **_kwargs):
        raise ValueError("processing failed")

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = AcceptedFailureRace(source)
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    monkeypatch.setattr("replay_video.runner.job", broken)

    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    assert stale.is_set()
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]


def test_stale_failure_result_attempt_stops_without_second_submission(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    submitting, stale = Event(), Event()

    class RejectedFailureRace(ApiFake):
        def progress(self, item, stage, percent, message=None):
            if submitting.is_set() and message == "worker-heartbeat":
                stale.set()
                raise HttpError("http-409")
            return super().progress(item, stage, percent, message)

        def result(self, _job, payload):
            self.results.append(payload)
            submitting.set()
            assert stale.wait(2)
            raise HttpError("http-409")

    def broken(*_args, **_kwargs):
        raise ValueError("processing failed")

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = RejectedFailureRace(source)
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    monkeypatch.setattr("replay_video.runner.job", broken)

    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    assert stale.is_set()
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]


def local_analysis_job(*, perception: bool = False):
    def operation(value, **_kwargs):
        output = Path(value["output_path"])
        output.mkdir(parents=True)
        report_value = {"pipeline_version": "video-local-observers-v1" if perception else "video-baseline-v1",
                        "limitations": [], "shots": [], "candidates": [], "evidence": []}
        if perception:
            artifact = output / "perception" / "perception.jsonl.gz"
            artifact.parent.mkdir()
            artifact.write_bytes(b"gzip")
            report_value["perception"] = {
                "schemaVersion": "perception-run-v1", "sourceSha256": "a" * 64,
                "processingStatus": "PARTIAL", "coverage": {}, "models": [],
                "artifact": {"path": "perception/perception.jsonl.gz", "contentType": "application/gzip",
                             "contentSha256": hashlib.sha256(b"gzip").hexdigest(), "sizeBytes": 4},
                "summary": {}, "incidents": [],
            }
        else:
            frame = output / "frame.jpg"
            frame.write_bytes(b"frame")
            report_value["evidence"] = [{"path": "frame.jpg", "candidate_index": 0, "kind": "FRAME",
                                         "start_ms": 0, "end_ms": 0}]
        report_path = output / "report.json"
        report_path.write_text(json.dumps(report_value))
        return SimpleNamespace(payload={"kind": "ANALYZED", "report_path": str(report_path)})
    return operation


@pytest.mark.parametrize("terminal", ["http-404", "STALE_LEASE"])
def test_media_evidence_authorization_loss_never_submits_a_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, terminal: str,
) -> None:
    class LostEvidence(ApiFake):
        def evidence(self, _job, _items):
            if terminal.startswith("http-"):
                raise HttpError(terminal)
            return {"kind": terminal}

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = LostEvidence(source)
    monkeypatch.setattr("replay_video.runner.job", local_analysis_job())

    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    assert api.results == []
    assert api.uploads == []


@pytest.mark.parametrize("terminal", ["http-409", "NOT_FOUND"])
def test_perception_evidence_authorization_loss_never_submits_a_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, terminal: str,
) -> None:
    class LostEvidence(ApiFake):
        def evidence(self, _job, _items):
            if terminal.startswith("http-"):
                raise HttpError(terminal)
            return {"kind": terminal}

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = LostEvidence(source)
    monkeypatch.setattr("replay_video.runner.job", local_analysis_job(perception=True))

    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    assert api.results == []
    assert api.uploads == []


def test_storage_put_409_remains_an_ordinary_processing_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    class PutFailure(ApiFake):
        def put(self, *_args):
            raise HttpError("evidence-409")

    source = tmp_path / "sample.mp4"
    source.write_bytes(b"video")
    api = PutFailure(source)
    monkeypatch.setattr("replay_video.runner.job", local_analysis_job())

    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]
