from __future__ import annotations
from pathlib import Path
from functools import partial
import hashlib
import base64
import json
import time
from threading import Event, Thread
from types import SimpleNamespace
import pytest
from test_pipeline import fixture
from replay_video.runner import Pulse, cycle, fault, loop
from replay_video.http import HttpError, Rejection, Transient
from replay_video.infrastructure.ports import media
from replay_video.worker import job as real_job

# 워커 호출 규약 모형
class ApiFake:

    # 초기 상태·입력 계약 구성
    def __init__(self, source: Path) -> None:
        # 가짜 저장소 원본 보관
        self.source = source
        # 작업 결과 기록
        self.results: list[dict[str, object]] = []
        # 진행 보고 기록
        self.progresses: list[tuple[str, int]] = []
        # 업로드 파일 기록
        self.uploads: list[str] = []

    # 시험용 작업 선점 결과 반환
    def claim(self, kind: str) -> dict[str, object]:
        # 고정 작업 임대 반환
        return {
            "jobId": "11111111-1111-4111-8111-111111111111",
            "jobType": kind,
            "jobRevision": 1,
            "leaseToken": "lease",
            "analysisId": "22222222-2222-4222-8222-222222222222",
            "sourceUrl": "http://storage/video",
        }

    # 시험용 미디어 반환
    def media(self, _url: str, target: Path, *, check_cancelled=None) -> None:
        # 진행 보고 후 원본 복사
        assert self.progresses
        # 가짜 저장소의 원본 바이트를 작업 디렉터리로 복사
        target.write_bytes(self.source.read_bytes())

    # 결과 반환 모형
    def result(self, _job: dict[str, object], payload: dict[str, object]) -> dict[str, object]:
        # 작업 결과 저장
        self.results.append(payload)
        # 서버가 결과를 수락한 상태 반환
        return {"kind": "ACCEPTED"}

    # 진행률 보고 모형
    def progress(
        self,
        _job: dict[str, object],
        stage: str,
        percent: int,
        _message: str | None = None,
    ) -> dict[str, object]:
        # 진행 상태 저장
        self.progresses.append((stage, percent))
        # 서버가 진행률을 갱신한 상태 반환
        return {"kind": "UPDATED"}

    # 시험용 증거 반환
    def evidence(self, job: dict[str, object], items: list[dict[str, object]]) -> dict[str, object]:
        # 증거 권한 모형 반환
        return {
            "kind": "GRANTED",
            "items": [
                {
                    "name": item["name"],
                    "objectKey": f"evidence/{job['analysisId']}/{job['jobId']}/{job['jobRevision']}/{item['contentSha256']}/{item['name']}",
                    "uploadUrl": f"http://storage/{item['name']}",
                    "headers": {
                        "x-amz-checksum-sha256": base64.b64encode(
                            bytes.fromhex(item["contentSha256"])
                        ).decode("ascii"),
                        "if-none-match": "*",
                    },
                }
                for item in items
            ],
        }

    # 업로드 모형
    def put(self, _url: str, source: Path, _content_type: str, _headers=None) -> None:
        # 증거 업로드 파일 기록
        self.uploads.append(source.name)

# 영상 검증 작업 확인
def test_validation(tmp_path: Path) -> None:
    # 검증 입력 준비
    source = tmp_path / "sample.mp4"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)
    # 서버 호출을 이력에 남기는 가짜 통신 객체 생성
    api = ApiFake(source)

    # 검증 작업 실행
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{
        "kind": "VALIDATED",
        "durationMs": 4000,
        "width": 320,
        "height": 180,
    }]
    # 진행률 보고 이력의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.progresses[0] == ("VALIDATING", 10)

# 영상 분석 작업 확인
def test_analysis(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 분석 입력 준비
    source = tmp_path / "sample.mp4"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)
    # 서버 호출을 이력에 남기는 가짜 통신 객체 생성
    api = ApiFake(source)
    # 운영 관측 모델을 로드하지 않는 기존 미디어 파이프라인 회귀 테스트
    monkeypatch.setattr("replay_video.runner.job", partial(real_job, ports=media()))

    # 분석 작업 실행
    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    # 제출 결과 이력의 선택 항목을 후속 비교에 사용할 값으로 보관
    payload = api.results[0]
    # 종류가 예상 계약과 일치하는지 확인
    assert payload["kind"] == "ANALYZED"
    # 파이프라인 판본이 예상 계약과 일치하는지 확인
    assert payload["pipelineVersion"] == "video-baseline-v1"
    # 분석 한계 목록이 예상 계약과 일치하는지 확인
    assert payload["limitations"] == [
        "replay_detection_pending",
        "incident_category_classification_pending",
        "pose_tracking_pending",
    ]
    # 샷 구간 목록이 계약에 지정된 자료형인지 확인
    assert isinstance(payload["shots"], list)
    # 변화 후보 목록이 계약에 지정된 자료형인지 확인
    assert isinstance(payload["candidates"], list)
    # 변화 후보 목록이 참이거나 비어 있지 않은지 확인
    assert payload["candidates"]
    # 진행률 보고 이력의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.progresses[0] == ("SEGMENTING", 10)
    # 처리 단계 목록이 허용 경계 조건을 만족하는지 확인
    assert {stage for stage, _percent in api.progresses} >= {
        "SEGMENTING",
        "DETECTING",
        "EXTRACTING_FACTS",
        "BUILDING_EVIDENCE",
    }
    # 증거 묶음이 계약에 지정된 자료형인지 확인
    assert isinstance(payload["evidence"], list)
    # 증거 묶음의 개수가 2과 일치하는지 확인
    assert len(payload["evidence"]) == 2
    # 업로드 이력의 개수가 2과 일치하는지 확인
    assert len(api.uploads) == 2

# 오래된 결과 처리 확인
def test_stale(tmp_path: Path) -> None:
    # 만료된 작업 임대 결과 모형
    source = tmp_path / "sample.mp4"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)

    # 결과 제출 시 임대 만료 오류를 내는 서버 대역
    class Stale(ApiFake):

        # 결과 반환 모형
        def result(self, _job: dict[str, object], _payload: dict[str, object]) -> dict[str, object]:
            # 결과 반환 모형 경로를 재현하는 예외 발생
            raise HttpError("http-409")

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(Stale(source), "VALIDATE_VIDEO", tmp_path / "work") is True

# 진행률 상태 갱신 확인
def test_pulse(tmp_path: Path) -> None:
    # 상태 갱신 입력 준비
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 서버 호출을 이력에 남기는 가짜 통신 객체 생성
    api = ApiFake(source)
    # 진행률 갱신에 사용할 분석 작업 임대 획득
    item = api.claim("ANALYZE_VIDEO")

    # 진행률 갱신과 상태 전송 실행
    with Pulse(api, item, "SEGMENTING", interval=0.005) as pulse:
        # 실제 처리 단계가 후보 탐지로 바뀐 진행률 전송
        pulse.progress("DETECTING", 40, "candidate-scan")
        # 백그라운드 갱신을 기다릴 짧은 종료 시각 계산
        deadline = time.monotonic() + 0.2
        # 추가 진행 보고가 도착하거나 제한 시간이 끝날 때까지 대기
        while len(api.progresses) < 3 and time.monotonic() < deadline:
            # 백그라운드 갱신이 실행될 짧은 대기 시간 부여
            time.sleep(0.005)

    # 진행률 보고 이력의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.progresses[0] == ("SEGMENTING", 10)
    # 진행률 보고 이력의 선택 항목이 예상 계약과 일치하는지 확인
    assert api.progresses[1] == ("DETECTING", 40)
    # 진행률 보고 이력이 예상 계약과 일치하는지 확인
    assert api.progresses[-1] == ("DETECTING", 40)

# 첫 조회 실패 뒤 다음 반복에서 정상 작업 처리
def test_recovery(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 첫 조회 실패 후 복구 모형
    class Recovery(ApiFake):
        # 실패 횟수를 시험 조건에 맞춰 고정
        failures = 0

        # 시험용 작업 선점 결과 반환
        def claim(self, kind: str) -> dict[str, object] | None:
            # 첫 번째 선점 호출에서만 일시 오류 발생
            if self.failures == 0:
                # 실패 횟수에 이번 실행분 누적
                self.failures += 1
                # 시험용 작업 선점 결과 경로를 재현하는 예외 발생
                raise HttpError("http-500")
            # 분석 작업 조회에는 할당할 작업이 없는 경로 선택
            if kind == "ANALYZE_VIDEO":
                # 할당할 분석 작업이 없음을 반환
                return None
            # 제출 결과 이력이 있는 경우에만 다음 단계 실행
            if self.results:
                # 시험용 작업 선점 결과 경로를 재현하는 예외 발생
                raise KeyboardInterrupt()
            # 이후 검증 작업 조회는 정상 가짜 선점 처리로 복귀
            return super().claim(kind)

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 샷 전환과 움직임을 포함한 시험 영상 생성
    fixture(source)
    # 첫 조회 실패 뒤 복구하는 통신 대역 생성
    api = Recovery(source)
    # 대기 간격 이력을 누적할 빈 자료 구조 준비
    delays = []
    # 실제 대기 없이 시간 경과를 통제하도록 시간 함수 교체
    monkeypatch.setattr("replay_video.runner.time.sleep", delays.append)
    # 첫 조회 실패 뒤 다음 반복에서 정상 작업 처리을 위한 예상 예외 확인
    with pytest.raises(KeyboardInterrupt):
        # 다음 폴링에서 검증 작업 실행
        loop(api, tmp_path / "work", 0.1)
    # 실패 뒤 작업 처리와 지연 확인
    assert api.results[0]["kind"] == "VALIDATED"
    # 대기 간격 이력이 참이거나 비어 있지 않은지 확인
    assert delays

# 진행 전송 중첩 시 이전 상태 갱신의 지연 저장 방지
def test_order(tmp_path: Path) -> None:
    # 상태 갱신 지연 모형
    class Delayed(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 주기적 임대 갱신 요청에만 지연 주입
            if message == "worker-heartbeat":
                # 임대 갱신 요청이 시작되었음을 다른 스레드에 알림
                pending.set()
                # 시험이 지연된 갱신을 풀어줄 때까지 제한 시간 내 대기 확인
                assert release.wait(2)
            # 지연 해제 뒤 원래 진행률 기록 동작 실행
            return super().progress(item, stage, percent, message)

    # 갱신 진입과 대기 해제 및 새 보고 완료를 구분할 신호 생성
    pending, release, finished = Event(), Event(), Event()
    # 임대 갱신 요청을 지연시키는 통신 대역 생성
    api = Delayed(tmp_path / "unused")
    # 짧은 주기로 갱신하는 진행률 관리 객체 생성
    pulse = Pulse(api, {}, "SEGMENTING", interval=0.001)
    # 동시 실행 동작을 확인할 시험 스레드 생성
    heartbeat = Thread(target=pulse.beat)
    # 임대 갱신을 별도 스레드에서 시작
    heartbeat.start()
    # 새 상태 전송 전에 기존 갱신이 지연 지점에 도달했는지 확인
    assert pending.wait(2)

    # 전송 모형
    def delivery():
        # 지연된 갱신보다 최신인 증거 생성 단계 전송
        pulse.progress("BUILDING_EVIDENCE", 70)
        # 최신 진행 보고의 종료를 시험에 알림
        finished.set()
    # 동시 실행 동작을 확인할 시험 스레드 생성
    reporter = Thread(target=delivery)
    # 최신 진행 보고를 별도 스레드에서 실행
    reporter.start()
    # 기존 구현의 역행 순서를 재현할 전송 기회 제공
    finished.wait(0.05)
    # 정리 중 추가 임대 갱신이 발생하지 않도록 중단 신호 설정
    pulse.stop.set()
    # 대기 해제 신호를 켜서 대기 중인 실행 진행
    release.set()
    # 기존 임대 갱신 스레드가 끝날 때까지 대기
    heartbeat.join(2)
    # 새 상태 전송 스레드가 끝날 때까지 대기
    reporter.join(2)
    # 두 전송 스레드가 모두 종료되어 교착이 없는지 확인
    assert not heartbeat.is_alive() and not reporter.is_alive()
    # 진행률 보고 이력이 예상 계약과 일치하는지 확인
    assert api.progresses[-1] == ("BUILDING_EVIDENCE", 70)

# 상태·수락 결과의 지연된 상태 요청 대기 방지 확인
def test_pulse_state_and_accepted_result_do_not_wait_for_blocked_heartbeat_request(
    tmp_path: Path,
) -> None:
    # 갱신 차단과 해제 및 검사·제출 완료를 구분할 신호 생성
    blocked, release, checked, submitted = Event(), Event(), Event(), Event()

    # 임대 갱신만 지연시켜 다른 동작의 비차단 여부를 시험하는 대역
    class BlockedHeartbeat(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 주기적 임대 갱신에만 응답 지연 주입
            if message == "worker-heartbeat":
                # 갱신 요청이 차단 지점에 도착했음을 알림
                blocked.set()
                # 시험에서 차단을 해제할 때까지 제한 시간 내 대기 확인
                assert release.wait(2)
            # 차단 해제 뒤 기본 진행률 기록 실행
            return super().progress(item, stage, percent, message)

    # 임대 갱신 응답이 멈추는 서버 대역 생성
    api = BlockedHeartbeat(tmp_path / "unused")
    # 검증 작업의 짧은 주기 임대 갱신 객체 생성
    pulse = Pulse(api, api.claim("VALIDATE_VIDEO"), "VALIDATING", interval=0.001)
    # 임대 갱신 스레드의 시작과 종료를 관리하는 범위 진입
    with pulse:
        # 동시 검사 전에 갱신 요청이 차단됐는지 확인
        assert blocked.wait(2)
        # 동시 실행 동작을 확인할 시험 스레드 생성
        checker = Thread(target=lambda: (pulse.check(), checked.set()))
        # 동시 실행 동작을 확인할 시험 스레드 생성
        finisher = Thread(target=lambda: (pulse.submission({"kind": "VALIDATED"}), submitted.set()))
        # 임대 유효성 검사를 별도 스레드에서 시작
        checker.start()
        # 최종 결과 제출을 또 다른 스레드에서 시작
        finisher.start()
        # 차단된 갱신과 무관하게 임대 검사가 끝나는지 관측
        check_was_nonblocking = checked.wait(0.2)
        # 차단된 갱신과 무관하게 결과 제출이 끝나는지 관측
        submit_was_nonblocking = submitted.wait(0.2)
        # 대기 해제 신호를 켜서 대기 중인 실행 진행
        release.set()
        # 임대 검사 스레드 종료 대기
        checker.join(2)
        # 결과 제출 스레드 종료 대기
        finisher.join(2)

    # 임대 검사가 차단된 네트워크 요청을 기다리지 않았는지 확인
    assert check_was_nonblocking is True
    # 결과 제출도 차단된 갱신을 기다리지 않았는지 확인
    assert submit_was_nonblocking is True
    # 결과 수락 후 오류 없는 최종 상태가 유지되는지 확인
    assert pulse.accepted is True and pulse.failure is None
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{"kind": "VALIDATED"}]

# 기한 지난 시작의 다운로드·결과 제출 전 중단 확인
def test_stale_start_stops_before_download_or_result(tmp_path: Path) -> None:
    # 첫 진행 보고부터 임대가 만료된 서버 대역
    class Stale(ApiFake):
        # 다운로드가 시작되지 않았음을 나타내는 초기 표시 준비
        downloaded = False

        # 진행률 보고 모형
        def progress(self, *_args, **_kwargs):
            # 시작 진행 보고에 이미 만료된 임대 상태 반환
            return {"kind": "STALE_LEASE"}

        # 시험용 미디어 반환
        def media(self, _url: str, _target: Path, *, check_cancelled=None) -> None:
            # 다운로드 함수에 도달했는지 기록
            self.downloaded = True

    # 시작부터 임대가 만료된 통신 대역 생성
    api = Stale(tmp_path / "unused.mp4")

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    # 임대 만료를 알면 원본 다운로드도 시작하지 않는지 확인
    assert api.downloaded is False
    # 제출 결과 이력이 빈 값으로 유지되는지 확인
    assert api.results == []

# 일시 상태 갱신 실패 시 결과 제출 없는 중단 확인
def test_transient_heartbeat_failure_stops_job_without_submitting_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # 스레드 실행 순서를 맞추는 동기화 신호 생성
    failed = Event()

    # 주기적 임대 갱신에서 실패하는 서버 대역
    class HeartbeatFailure(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 주기적 갱신 호출에서만 통신 실패 발생
            if message == "worker-heartbeat":
                # 실패 결과를 켜서 대기 중인 실행 진행
                failed.set()
                # 진행률 보고 모형 경로를 재현하는 예외 발생
                raise HttpError("http-unavailable")
            # 일반 진행 보고는 정상 가짜 통신 처리 유지
            return super().progress(item, stage, percent, message)

    # 작업 중단 모형
    def interrupted(_value, *, progress=None, check_cancelled=None, ports=None):
        # 분석 함수에 진행과 취소 확인이 제공되고 기본 포트가 유지되는지 확인
        assert progress is not None and check_cancelled is not None and ports is None
        # 갱신 실패가 발생한 뒤 취소 검사를 진행하도록 대기
        assert failed.wait(1)
        # 실패한 임대 갱신을 분석 취소 예외로 확인
        check_cancelled()
        # 작업 중단 모형 경로를 재현하는 예외 발생
        raise AssertionError("lease failure did not stop the job")

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 주기적 갱신 실패를 재현하는 통신 대역 생성
    api = HeartbeatFailure(source)
    # 갱신 실패를 빠르게 재현하도록 시험 갱신 주기 축소
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    # 실제 분석 대신 갱신 실패 뒤 취소를 확인하는 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", interrupted)

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    # 예상한 주기적 갱신 실패 경로가 실행됐는지 확인
    assert failed.is_set()
    # 제출 결과 이력이 빈 값으로 유지되는지 확인
    assert api.results == []
    # 주기적 갱신 실패 사유가 실행 로그에 보존되는지 확인
    assert "WORKER_HEARTBEAT_FAILED" in caplog.text

# 원본 다운로드 중 임대 갱신 실패 시 남은 수신과 분석 중단 확인
def test_heartbeat_failure_during_download_stops_before_analysis(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # 주기적 임대 갱신 실패 발생 신호 생성
    failed = Event()
    # 끝까지 받은 원본 기록 목록 준비
    completed: list[Path] = []
    # 분석 단계 시작 기록 목록 준비
    started: list[object] = []

    # 긴 원본 수신 도중 주기적 임대 갱신이 실패하는 서버 대역
    class SlowDownload(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 주기적 갱신 호출에서만 통신 실패 발생
            if message == "worker-heartbeat":
                # 갱신 실패 발생 기록
                failed.set()
                # 임대 갱신 통신 실패 재현
                raise HttpError("http-unavailable")
            # 일반 진행 보고는 정상 가짜 통신 처리 유지
            return super().progress(item, stage, percent, message)

        # 청크 경계마다 작업 취소를 확인하는 긴 원본 수신 모형
        def media(self, _url: str, target: Path, *, check_cancelled=None) -> None:
            # 수신 중인 원본 파일 열기
            with target.open("wb") as output:
                # 갱신 주기보다 충분히 긴 청크 수신 반복
                for _ in range(200):
                    # 작업 취소 함수가 전달된 경우만 청크 경계 확인
                    if check_cancelled is not None:
                        # 임대 상실 시 남은 원본 수신 중단
                        check_cancelled()
                    # 다음 청크 기록
                    output.write(b"chunk")
                    # 느린 저장소 응답 재현
                    time.sleep(0.005)
            # 끝까지 받은 원본 기록
            completed.append(target)

    # 분석 단계 시작을 기록하는 작업 대역
    def analysis(value, *, progress=None, check_cancelled=None, ports=None):
        # 분석 단계 시작 기록
        started.append(value)
        # 다운로드 단계에서 멈추지 않은 경우의 실패 경로 재현
        raise AssertionError("analysis started after lease failure")

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 수신 중 갱신 실패를 재현하는 통신 대역 생성
    api = SlowDownload(source)
    # 작업별 임시 폴더를 담을 실행 루트 구성
    root = tmp_path / "work"
    # 갱신 실패를 빠르게 재현하도록 시험 갱신 주기 축소
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    # 실제 분석 대신 시작 여부를 기록하는 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", analysis)

    # 임대 중단을 처리한 작업 시도로 반환하는지 확인
    assert cycle(api, "ANALYZE_VIDEO", root) is True
    # 갱신 실패 뒤 원본 수신을 끝내지 않고 분석과 결과 제출도 하지 않았는지 확인
    assert (failed.is_set(), completed, started, api.results) == (True, [], [], [])
    # 중단된 부분 원본을 포함한 작업별 임시 폴더 정리 확인
    assert list(root.iterdir()) == []
    # 갱신 실패 사유가 작업 중단 로그에 보존되는지 확인
    assert "worker-stopped code=WORKER_HEARTBEAT_FAILED" in caplog.text

# 최종 결과 요청 지연 중 상태 갱신 지속 확인
def test_heartbeat_continues_while_final_result_request_is_blocked(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 제출 시작과 갱신 지속 및 제출 해제를 구분할 신호 생성
    submitting, heartbeating, release = Event(), Event(), Event()

    # 결과 제출 응답을 기다리는 동안 갱신을 관찰할 서버 대역
    class BlockingResult(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 결과 제출이 진행 중일 때의 임대 갱신 호출 선택
            if submitting.is_set() and message == "worker-heartbeat":
                # 결과 제출 도중에도 임대 갱신이 계속됨을 기록
                heartbeating.set()
            # 기본 진행률 기록 동작 유지
            return super().progress(item, stage, percent, message)

        # 결과 반환 모형
        def result(self, _job, payload):
            # 제출 결과 이력에 이번 항목 추가
            self.results.append(payload)
            # 결과 제출 시작 신호를 켜서 대기 중인 실행 진행
            submitting.set()
            # 시험이 결과 제출 응답을 해제할 때까지 대기 확인
            assert release.wait(2)
            # 지연 뒤 결과 수락 상태 반환
            return {"kind": "ACCEPTED"}

    # 검증 결과 반환
    def validated(*_args, **_kwargs):
        # 필요한 속성만 제공하는 대역 객체 결과 반환
        return SimpleNamespace(
            payload={"kind": "VALIDATED", "duration_ms": 1000, "width": 10, "height": 10}
        )

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 결과 제출 응답만 지연시키는 서버 대역 생성
    api = BlockingResult(source)
    # 제출 중 임대 갱신을 관찰하도록 주기 축소
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    # 실제 분석 없이 검증 성공을 반환하는 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", validated)
    # 동시 실행 동작을 확인할 시험 스레드 생성
    worker = Thread(target=cycle, args=(api, "VALIDATE_VIDEO", tmp_path / "work"))
    # 시험 작업자의 백그라운드 실행 시작
    worker.start()
    # 결과 제출이 지연 지점에 도달했는지 확인
    assert submitting.wait(2)
    # 제출 대기 중에도 임대 갱신이 발생하는지 확인
    assert heartbeating.wait(2)
    # 대기 해제 신호를 켜서 대기 중인 실행 진행
    release.set()
    # 시험 작업자의 종료 대기
    worker.join(2)

    # 응답 해제 뒤 작업자 스레드가 끝나는지 확인
    assert not worker.is_alive()
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{"kind": "VALIDATED", "durationMs": 1000, "width": 10, "height": 10}]

# 수락된 결과의 상태 갱신 경합 우선순위 확인
def test_accepted_result_wins_heartbeat_stale_race(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 결과 제출 시작 신호 · 임대 상실 신호를 비교에 사용할 고정 시험 자료로 구성
    submitting, stale = Event(), Event()

    # 결과 수락과 임대 만료를 동시에 재현하는 서버 대역
    class AcceptedRace(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 결과 제출 중인 임대 갱신에만 만료 응답 주입
            if submitting.is_set() and message == "worker-heartbeat":
                # 임대 상실 신호를 켜서 대기 중인 실행 진행
                stale.set()
                # 진행률 보고 모형 경로를 재현하는 예외 발생
                raise HttpError("http-409")
            # 다른 진행률 보고는 정상 처리
            return super().progress(item, stage, percent, message)

        # 결과 반환 모형
        def result(self, _job, payload):
            # 제출 결과 이력에 이번 항목 추가
            self.results.append(payload)
            # 결과 제출 시작 신호를 켜서 대기 중인 실행 진행
            submitting.set()
            # 임대 만료 응답이 경쟁 상황에 도달한 뒤 결과 수락 진행
            assert stale.wait(2)
            # 경쟁하는 임대 만료와 별개로 결과 수락 상태 반환
            return {"kind": "ACCEPTED"}

    # 검증 결과 반환
    def validated(*_args, **_kwargs):
        # 필요한 속성만 제공하는 대역 객체 결과 반환
        return SimpleNamespace(
            payload={"kind": "VALIDATED", "duration_ms": 1000, "width": 10, "height": 10}
        )

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 결과 수락과 임대 만료가 경합하는 서버 대역 생성
    api = AcceptedRace(source)
    # 경합을 빠르게 재현하도록 임대 갱신 주기 축소
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    # 결과 수락 경로에 집중하도록 검증 성공 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", validated)

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 결과 제출과 임대 만료의 경쟁 경로 실행 확인
    assert stale.is_set()
    # 제출 결과 이력의 개수가 1과 일치하는지 확인
    assert len(api.results) == 1

# 임대 보유 중에만 일반 처리 실패 보고 확인
def test_normal_processing_failure_is_reported_only_while_lease_is_owned(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 서버 호출을 이력에 남기는 가짜 통신 객체 생성
    api = ApiFake(source)

    # 처리 실패 모형
    def broken(*_args, **_kwargs):
        # 처리 실패 모형 경로를 재현하는 예외 발생
        raise ValueError("processing failed")

    # 분석 중 실제 처리 오류를 발생시키는 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", broken)
    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]

# 실패 결과 요청 지연 중 상태 갱신 지속 확인
def test_heartbeat_continues_while_processing_failure_result_is_blocked(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 실패 결과 제출과 그 사이 갱신을 관찰할 신호 생성
    submitting, heartbeating = Event(), Event()

    # 실패 결과 응답을 지연시키는 서버 대역
    class BlockingFailure(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 실패 결과 제출 중의 임대 갱신 호출 선택
            if submitting.is_set() and message == "worker-heartbeat":
                # 실패 결과 제출을 기다리는 동안의 갱신 이력 기록
                heartbeating.set()
            # 일반 진행률 기록 동작 유지
            return super().progress(item, stage, percent, message)

        # 결과 반환 모형
        def result(self, _job, payload):
            # 제출 결과 이력에 이번 항목 추가
            self.results.append(payload)
            # 결과 제출 시작 신호를 켜서 대기 중인 실행 진행
            submitting.set()
            # 실패 결과 제출 중 임대 갱신이 발생할 때까지 대기 확인
            assert heartbeating.wait(2)
            # 실패 결과를 서버가 수락한 상태 반환
            return {"kind": "ACCEPTED"}

    # 처리 실패 모형
    def broken(*_args, **_kwargs):
        # 처리 실패 모형 경로를 재현하는 예외 발생
        raise ValueError("processing failed")

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 실패 결과의 응답을 지연시키는 서버 대역 생성
    api = BlockingFailure(source)
    # 실패 결과 제출 중 갱신을 관찰하도록 주기 축소
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    # 실제 분석 오류를 발생시키는 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", broken)

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 실패 결과 제출 중에도 임대 갱신이 지속됐는지 확인
    assert heartbeating.is_set()
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]

# 수락된 실패 결과의 상태 갱신 경합 우선순위 확인
def test_accepted_failure_result_wins_heartbeat_stale_race(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 결과 제출 시작 신호 · 임대 상실 신호를 비교에 사용할 고정 시험 자료로 구성
    submitting, stale = Event(), Event()

    # 실패 결과 수락과 임대 만료가 경합하는 서버 대역
    class AcceptedFailureRace(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 실패 결과 제출과 경합하는 갱신에서 임대 만료 주입
            if submitting.is_set() and message == "worker-heartbeat":
                # 임대 상실 신호를 켜서 대기 중인 실행 진행
                stale.set()
                # 진행률 보고 모형 경로를 재현하는 예외 발생
                raise HttpError("http-409")
            # 그 외 진행률 보고는 기본 처리 유지
            return super().progress(item, stage, percent, message)

        # 결과 반환 모형
        def result(self, _job, payload):
            # 제출 결과 이력에 이번 항목 추가
            self.results.append(payload)
            # 결과 제출 시작 신호를 켜서 대기 중인 실행 진행
            submitting.set()
            # 만료 응답과 실패 결과 수락의 경쟁 시점 동기화
            assert stale.wait(2)
            # 실패 결과의 수락 상태 반환
            return {"kind": "ACCEPTED"}

    # 처리 실패 모형
    def broken(*_args, **_kwargs):
        # 처리 실패 모형 경로를 재현하는 예외 발생
        raise ValueError("processing failed")

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 실패 결과 수락과 임대 만료가 경합하는 서버 대역 생성
    api = AcceptedFailureRace(source)
    # 실패 수락 경합을 빠르게 재현할 갱신 주기 지정
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    # 실패 결과가 생성되도록 분석 오류 대역 연결
    monkeypatch.setattr("replay_video.runner.job", broken)

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 실패 결과 수락과 임대 만료가 실제로 경합했는지 확인
    assert stale.is_set()
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]

# 기한 지난 실패 결과 제출 뒤 재제출 방지 확인
def test_stale_failure_result_attempt_stops_without_second_submission(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 결과 제출 시작 신호 · 임대 상실 신호를 비교에 사용할 고정 시험 자료로 구성
    submitting, stale = Event(), Event()

    # 실패 결과 거부와 임대 만료가 경합하는 서버 대역
    class RejectedFailureRace(ApiFake):

        # 진행률 보고 모형
        def progress(self, item, stage, percent, message=None):
            # 실패 결과 제출과 경합하는 갱신에서 만료 상태 주입
            if submitting.is_set() and message == "worker-heartbeat":
                # 임대 상실 신호를 켜서 대기 중인 실행 진행
                stale.set()
                # 진행률 보고 모형 경로를 재현하는 예외 발생
                raise HttpError("http-409")
            # 일반 진행률 기록 동작 유지
            return super().progress(item, stage, percent, message)

        # 결과 반환 모형
        def result(self, _job, payload):
            # 제출 결과 이력에 이번 항목 추가
            self.results.append(payload)
            # 결과 제출 시작 신호를 켜서 대기 중인 실행 진행
            submitting.set()
            # 임대 만료 이후 실패 결과 거부를 재현하도록 동기화
            assert stale.wait(2)
            # 결과 반환 모형 경로를 재현하는 예외 발생
            raise HttpError("http-409")

    # 처리 실패 모형
    def broken(*_args, **_kwargs):
        # 처리 실패 모형 경로를 재현하는 예외 발생
        raise ValueError("processing failed")

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 실패 결과도 거부하는 임대 만료 서버 대역 생성
    api = RejectedFailureRace(source)
    # 실패 결과 거부 경합을 재현할 짧은 갱신 주기 지정
    monkeypatch.setattr("replay_video.runner.Pulse", partial(Pulse, interval=0.001))
    # 분석 오류로 실패 결과 제출 경로 유도
    monkeypatch.setattr("replay_video.runner.job", broken)

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 실패 결과 거부 전에 임대 만료가 확인됐는지 점검
    assert stale.is_set()
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]

# 결정적 결과 거부 뒤 같은 임대의 최종 실패 제출과 일시 거부의 재실행 보존 확인
@pytest.mark.parametrize(
    ("rejection", "expected"),
    [
        (Rejection("result-rejected kind=INVALID_RESULT reason=ARTIFACT"), "WORKER_RESULT_REJECTED"),
        (HttpError("http-400"), None),
    ],
)
def test_result_rejection_ends_only_deterministic_failures(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    rejection: HttpError,
    expected: str | None,
) -> None:

    # 완료 결과만 거부하고 실패 결과는 수락하는 서버 대역
    class RejectingResult(ApiFake):

        # 결과 반환 모형
        def result(self, _job, payload):
            # 제출 결과 이력에 이번 항목 추가
            self.results.append(payload)
            # 완료 결과 제출에 지정 거부 주입
            if payload["kind"] != "FAILED":
                raise rejection
            # 같은 임대의 실패 결과 수락 상태 반환
            return {"kind": "ACCEPTED"}

    # 검증 결과 반환
    def validated(*_args, **_kwargs):
        # 필요한 속성만 제공하는 대역 객체 결과 반환
        return SimpleNamespace(
            payload={"kind": "VALIDATED", "duration_ms": 1000, "width": 10, "height": 10}
        )

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 완료 결과를 거부하는 서버 대역 생성
    api = RejectingResult(source)
    # 실제 분석 없이 검증 성공을 반환하는 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", validated)

    # 거부 뒤에도 선점 작업을 처리한 시도로 반환하는지 확인
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 완료 결과 한 번과 결정적 거부일 때만 재시도 없는 실패 결과 제출 확인
    assert api.results == [
        {"kind": "VALIDATED", "durationMs": 1000, "width": 10, "height": 10},
        *([{"kind": "FAILED", "failureCode": expected, "retryable": False}] if expected else []),
    ]

# 로컬 분석 작업 모형
def local_analysis_job(*, perception: bool = False):

    # 작업 실행 모형
    def operation(value, **_kwargs):
        # 시험에 사용할 파일 경로 구성
        output = Path(value["output_path"])
        # 출력 경로를 시험용으로 생성
        output.mkdir(parents=True)
        # 보고서 내용을 비교에 사용할 고정 시험 자료로 구성
        report_value = {
            "pipeline_version": "video-local-observers-v1" if perception else "video-baseline-v1",
            "limitations": [],
            "shots": [],
            "candidates": [],
            "evidence": [],
        }
        # 모델 관측 정보가 있는 경우에만 다음 단계 실행
        if perception:
            # 비공개 산출물을 시험용 기준 경로에서 구성
            artifact = output / "perception" / "perception.jsonl.gz"
            # 비공개 산출물의 상위 디렉터리를 시험용으로 생성
            artifact.parent.mkdir()
            # 비공개 산출물에 시험 내용을 기록
            artifact.write_bytes(b"gzip")
            # 모델 관측 정보를 비교에 사용할 고정 시험 자료로 구성
            report_value["perception"] = {
                "schemaVersion": "perception-run-v1",
                "sourceSha256": "a" * 64,
                "processingStatus": "PARTIAL",
                "coverage": {},
                "models": [],
                "artifact": {
                    "path": "perception/perception.jsonl.gz",
                    "contentType": "application/gzip",
                    "contentSha256": hashlib.sha256(b"gzip").hexdigest(),
                    "sizeBytes": 4,
                },
                "summary": {},
                "incidents": [],
            }
        else:
            # 영상 프레임을 시험용 기준 경로에서 구성
            frame = output / "frame.jpg"
            # 영상 프레임에 시험 내용을 기록
            frame.write_bytes(b"frame")
            # 증거 묶음을 비교에 사용할 고정 시험 자료로 구성
            report_value["evidence"] = [
                {
                    "path": "frame.jpg",
                    "candidate_index": 0,
                    "kind": "FRAME",
                    "timestamp_ms": 0,
                    "start_ms": 0,
                    "end_ms": 0,
                }
            ]
        # 보고서 경로를 시험용 기준 경로에서 구성
        report_path = output / "report.json"
        # 보고서 경로에 시험 내용을 기록
        report_path.write_text(json.dumps(report_value))
        # 필요한 속성만 제공하는 대역 객체 결과 반환
        return SimpleNamespace(payload={"kind": "ANALYZED", "report_path": str(report_path)})
    # 파일을 생성하는 로컬 분석 작업 대역 반환
    return operation

# 미디어 증거 권한 상실 시 결과 미제출 확인
@pytest.mark.parametrize("terminal", ["http-404", "STALE_LEASE"])
def test_media_evidence_authorization_loss_never_submits_a_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    terminal: str,
) -> None:
    # 미디어 증거 업로드 권한을 상실한 서버 대역
    class LostEvidence(ApiFake):

        # 시험용 증거 반환
        def evidence(self, _job, _items):
            # 상태 코드 오류로 권한 상실을 표현하는 사례 선택
            if terminal.startswith("http-"):
                # 시험용 증거 경로를 재현하는 예외 발생
                raise HttpError(terminal)
            # 응답 본문으로 권한 상실 상태를 반환
            return {"kind": terminal}

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 미디어 증거 권한을 거부하는 서버 대역 생성
    api = LostEvidence(source)
    # 실제 인식 없이 로컬 증거 파일만 생성하는 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", local_analysis_job())

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    # 제출 결과 이력이 빈 값으로 유지되는지 확인
    assert api.results == []
    # 업로드 이력이 빈 값으로 유지되는지 확인
    assert api.uploads == []

# 인식 증거 권한 상실 시 결과 미제출 확인
@pytest.mark.parametrize("terminal", ["http-409", "NOT_FOUND"])
def test_perception_evidence_authorization_loss_never_submits_a_result(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    terminal: str,
) -> None:
    # 비공개 인식 업로드 권한을 상실한 서버 대역
    class LostEvidence(ApiFake):

        # 시험용 증거 반환
        def evidence(self, _job, _items):
            # 인식 권한 상실을 통신 오류로 표현하는 사례 선택
            if terminal.startswith("http-"):
                # 시험용 증거 경로를 재현하는 예외 발생
                raise HttpError(terminal)
            # 인식 권한 상실을 명시적 응답 상태로 반환
            return {"kind": terminal}

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 비공개 인식 증거 권한을 거부하는 서버 대역 생성
    api = LostEvidence(source)
    # 비공개 인식 산출물까지 만드는 로컬 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", local_analysis_job(perception=True))

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    # 제출 결과 이력이 빈 값으로 유지되는지 확인
    assert api.results == []
    # 업로드 이력이 빈 값으로 유지되는지 확인
    assert api.uploads == []

# 저장소 업로드 409의 일반 처리 실패 유지 확인
def test_storage_put_409_remains_an_ordinary_processing_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 저장소 업로드에서 충돌 오류를 내는 서버 대역
    class PutFailure(ApiFake):

        # 업로드 모형
        def put(self, *_args):
            # 업로드 모형 경로를 재현하는 예외 발생
            raise HttpError("evidence-409")

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 저장소 업로드에서 충돌 오류를 내는 통신 대역 생성
    api = PutFailure(source)
    # 업로드 실패에 집중하도록 로컬 증거 생성 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", local_analysis_job())

    # 작업 선점부터 결과 제출까지 한 차례 결과이 참인지 확인
    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    # 제출 결과 이력이 예상 계약과 일치하는지 확인
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]

# 실패 예외의 서버 실패 결과 분류 확인
@pytest.mark.parametrize(
    ("error", "code", "retryable"),
    [
        (
            Rejection("result-rejected kind=INVALID_RESULT reason=ARTIFACT"),
            "WORKER_RESULT_REJECTED",
            False,
        ),
        (Transient("media-503"), "WORKER_TRANSIENT_ERROR", True),
        (Transient("evidence-unavailable"), "WORKER_TRANSIENT_ERROR", True),
        (HttpError("evidence-409"), "WORKER_ERROR", False),
        (ValueError("source-url-invalid"), "WORKER_ERROR", False),
    ],
)
def test_fault_retries_only_exhausted_transient_failures(
    error: Exception,
    code: str,
    retryable: bool,
) -> None:
    # 실패 부호와 재시도 가능 여부가 예외 분류와 일치하는지 확인
    assert fault(error) == {"kind": "FAILED", "failureCode": code, "retryable": retryable}

# 호출 안 재시도를 소진한 다운로드와 업로드 일시 장애의 재시도 가능 실패 제출 확인
@pytest.mark.parametrize(
    ("point", "error"),
    [("media", Transient("media-503")), ("put", Transient("evidence-unavailable"))],
)
def test_exhausted_transient_failure_is_submitted_as_retryable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    point: str,
    error: Exception,
) -> None:

    # 지정 지점에서 일시 장애를 내는 서버 대역
    class Outage(ApiFake):

        # 원본 다운로드 모형
        def media(self, url: str, target: Path, *, check_cancelled=None) -> None:
            # 다운로드 지점의 일시 장애 주입
            if point == "media":
                raise error
            # 그 밖의 지점에서는 원본 복사
            super().media(url, target, check_cancelled=check_cancelled)

        # 업로드 모형
        def put(self, *args) -> None:
            # 업로드 지점의 일시 장애 주입
            if point == "put":
                raise error
            # 그 밖의 지점에서는 업로드 기록
            super().put(*args)

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 지정 지점의 일시 장애를 주입할 통신 대역 생성
    api = Outage(source)
    # 증거 업로드까지 도달하도록 로컬 증거 생성 작업 대역 연결
    monkeypatch.setattr("replay_video.runner.job", local_analysis_job())

    # 작업 선점부터 실패 제출까지 한 차례 처리 확인
    assert cycle(api, "ANALYZE_VIDEO", tmp_path / "work") is True
    # 서버가 남은 시도 안에서 다시 대기시킬 실패 결과 한 건만 제출 확인
    assert api.results == [
        {"kind": "FAILED", "failureCode": "WORKER_TRANSIENT_ERROR", "retryable": True}
    ]

# 임대 관리 시작 전 실패의 같은 분류 결과 제출 확인
def test_failure_before_lease_pulse_uses_the_same_classification(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:

    # 작업 폴더 생성 실패 모형
    def unavailable(*_args, **_kwargs):
        # 작업 폴더를 만들 수 없는 환경 오류 발생
        raise OSError("disk full")

    # 입력 영상을 시험용 기준 경로에서 구성
    source = tmp_path / "sample.mp4"
    # 입력 영상에 시험 내용을 기록
    source.write_bytes(b"video")
    # 서버 호출을 이력에 남기는 가짜 통신 객체 생성
    api = ApiFake(source)
    # 임대 관리 생성 전에 작업 폴더 생성이 실패하도록 연결
    monkeypatch.setattr("replay_video.runner.tempfile.TemporaryDirectory", unavailable)

    # 작업 선점 뒤 실패 제출까지 한 차례 처리 확인
    assert cycle(api, "VALIDATE_VIDEO", tmp_path / "work") is True
    # 환경 오류를 재시도 없는 일반 처리 실패로 제출 확인
    assert api.results == [{"kind": "FAILED", "failureCode": "WORKER_ERROR", "retryable": False}]
