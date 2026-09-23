# 형식 주석의 지연 해석 사용
from __future__ import annotations
# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 메모리 바이트 입출력 도구 읽음
import io
# 격리 명령 실행 도구 읽음
import subprocess
# 현재 실행기와 모듈 경로 정보 읽음
import sys
# 제한 시간 측정 도구 읽음
import time
# 시험 파일 경로 도구 읽음
from pathlib import Path
# 다운로드 요청과 전송 오류 도구 읽음
from urllib.error import HTTPError, URLError
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest

# 자산 항목 생성
def _entry(payload: bytes) -> dict[str, object]:
    # 자산 항목 결과 반환
    return {
        # 항목 이름의 시험값 지정
        "name": "weights.bin",
        # 파일 크기의 시험값 지정
        "size": len(payload),
        # 파일 무결성 해시의 시험값 지정
        "sha256": hashlib.sha256(payload).hexdigest(),
        # 다운로드 주소의 시험값 지정
        "url": "https://huggingface.co/approved/model/resolve/revision/weights.bin",
    }


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeResponse:

    # 초기 상태와 입력 계약 구성
    def __init__(
        self,
        status: int,
        *,
        payload: bytes = b"",
        location: str | None = None,
    ):
        # 처리 상태 준비
        self.status = status
        # 전송 응답 헤더의 시험 항목 구성
        self.headers: dict[str, str] = {"Content-Length": str(len(payload))}
        # 리디렉션 대상 주소의 비교 결과별 분기
        if location is not None:
            # 리디렉션 대상 주소 준비
            self.headers["Location"] = location
        # 메모리에서 읽고 쓸 바이트 저장소 읽음
        self._payload = io.BytesIO(payload)
        # 응답 본문 읽기 호출 수의 0 설정
        self.read_calls = 0
        # 자원 종료 여부의 거짓 설정
        self.closed = False

    # 자료 읽음
    def read(self, amount: int = -1) -> bytes:
        # 응답 본문 읽기 호출 수 갱신
        self.read_calls += 1
        # 요청한 분량의 바이트 자료 반환
        return self._payload.read(amount)

    # 가용 자료 읽음
    def read1(self, amount: int = -1) -> bytes:
        # 응답 본문 읽기 호출 수 갱신
        self.read_calls += 1
        # 요청한 분량의 바이트 자료 반환
        return self._payload.read(amount)

    # 자원 닫기
    def close(self) -> None:
        # 자원 종료 여부의 참 설정
        self.closed = True


# 실제 외부 실행을 대신할 시험 객체 정의
class FakeOpener:

    # 초기 상태와 입력 계약 구성
    def __init__(self, *responses: FakeResponse):
        # 순서대로 반환할 모의 응답의 비교 자료 생성
        self.responses = list(responses)
        # 전송 요청 이력의 빈 누적 공간 생성
        self.requests: list[tuple[str, float]] = []

    # 모의 연결 열기
    def open(self, request, *, timeout):
        # 전송 요청 이력에 현재 관측 추가
        self.requests.append((request.full_url, timeout))
        # 대기 목록에서 꺼낸 첫 항목 반환
        return self.responses.pop(0)

# 비보안 수동 리디렉션 거부와 소진 없는 응답 닫기 확인
def test_manual_redirect_rejects_http_and_closes_without_draining(
    monkeypatch,
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import transport

    # 다운로드 본문과 헤더를 가진 모의 응답 생성
    redirect = FakeResponse(
        302,
        # 전송 본문의 호출 조건 지정
        payload=b"body that must never be drained",
        location="http://example.invalid/weights.bin",
    )
    # 정해진 응답을 차례대로 반환할 모의 연결 생성
    opener = FakeOpener(redirect)
    # 비보안 수동 리디렉션 거부와 소진 없는 응답 닫기 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, 'httpsOpener', lambda: opener)

    # 모델 계약 오류 발생 기대
    with pytest.raises(HTTPError, match="OBSERVER_MODEL_REDIRECT_SCHEME_INVALID"):
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), io.BytesIO())

    # 자원 종료 여부 값이 참인지 확인
    assert redirect.closed is True
    # 응답 본문 읽기 호출 수 값이 0인지 확인
    assert redirect.read_calls == 0
    # 전송 요청 이력의 개수 값이 1인지 확인
    assert len(opener.requests) == 1

# 보안 콘텐츠 배포 리디렉션 허용과 소진 없는 응답 닫기 확인
def test_manual_redirect_allows_https_cdn_and_closes_redirect_without_draining(
    monkeypatch,
):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import transport

    # 전송 본문 준비
    payload = b"weights"
    # 다운로드 본문과 헤더를 가진 모의 응답 생성
    redirect = FakeResponse(
        302,
        # 전송 본문의 호출 조건 지정
        payload=b"redirect body that must never be drained",
        location="https://cdn-lfs.huggingface.co/approved/weights.bin",
    )
    # 다운로드 본문과 헤더를 가진 모의 응답 생성
    final = FakeResponse(200, payload=payload)
    # 정해진 응답을 차례대로 반환할 모의 연결 생성
    opener = FakeOpener(redirect, final)
    # 보안 콘텐츠 배포 리디렉션 허용과 소진 없는 응답 닫기 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, 'httpsOpener', lambda: opener)
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 주소와 크기와 해시를 검증하는 자산 전송 실행
    transport.entryStream(_entry(payload), output)

    # 메모리 저장소에 기록한 바이트의 기대 자료 일치 확인
    assert output.getvalue() == payload
    # 자원 종료 여부 값이 참인지 확인
    assert redirect.closed is True
    # 응답 본문 읽기 호출 수 값이 0인지 확인
    assert redirect.read_calls == 0
    # 자원 종료 여부 값이 참인지 확인
    assert final.closed is True
    # 전송 요청 이력의 기대 자료 일치 확인
    assert opener.requests == [
        (
            "https://huggingface.co/approved/model/resolve/revision/weights.bin",
            transport.READ_TIMEOUT_SECONDS,
        ),
        (
            "https://cdn-lfs.huggingface.co/approved/weights.bin",
            transport.READ_TIMEOUT_SECONDS,
        ),
    ]

# 감싼 주소 시간 초과의 고정 다운로드 오류 코드 확인
def test_wrapped_url_timeout_has_stable_download_timeout_code(monkeypatch):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import transport

    # 실제 외부 실행을 대신할 시험 객체 정의
    class TimedOutOpener:

        # 모의 연결 열기
        def open(self, _request, *, timeout):
            # 제한 시간의 기대 자료 일치 확인
            assert timeout == transport.READ_TIMEOUT_SECONDS
            # 모의 연결 열기의 예외 상황 재현
            raise URLError(TimeoutError("socket timed out"))

    # 감싼 주소 시간 초과의 고정 다운로드 오류 코드 의존성의 시험 대역 주입
    monkeypatch.setattr(
        transport,
        'httpsOpener',
        lambda: TimedOutOpener(),
    )

    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT: weights.bin"):
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), io.BytesIO())

# 제한된 통신의 정지 자식 종료와 대기 확인
def test_bounded_communicate_kills_and_waits_for_a_blocking_child():
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import transport

    # 모의 하위 프로세스 준비
    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        # 외부 명령 표준 출력의 호출 조건 지정
        stdout=subprocess.PIPE,
        # 외부 명령 오류 출력의 호출 조건 지정
        stderr=subprocess.PIPE,
        # 문자열 자료의 호출 조건 지정
        text=True,
    )
    # 단조 증가하는 시험 시각 생성
    started = time.monotonic()

    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT: weights.bin"):
        # 제한된 통신의 정지 자식 종료와 대기 대상 동작 실행
        transport.boundedCommunication(process, timeout_seconds=0.05, filename="weights.bin")

    # 제한 시간 초과 뒤 하위 프로세스가 종료됐는지 확인
    assert process.poll() is not None
    # 정지한 하위 프로세스의 정리까지 5초 이내인지 확인
    assert time.monotonic() - started < 5

# 부모의 고정 로컬 다운로드 모듈만 실행 확인
def test_parent_launches_only_the_fixed_local_downloader_module(monkeypatch):
    # 시험에 필요한 인식 구현과 자료 계약 읽음
    from replay_perception import transport

    # 관측 결과의 빈 누적 공간 생성
    observed = {}

    # 실제 외부 실행을 대신할 시험 객체 정의
    class CompletedProcess:
        # 외부 명령 종료 코드의 0 설정
        returncode = 0

        # 모의 자식 통신 결과 반환
        def communicate(self, *, timeout):
            # 제한 시간 준비
            observed["timeout"] = timeout
            # 모의 자식 통신 결과 반환
            return "", ""

        # 자식 종료 기록
        def kill(self):
            # 자식 종료의 예외 상황 재현
            raise AssertionError("completed process must not be killed")

    # 모의 자식 프로세스 생성
    def fake_popen(command, **kwargs):
        # 관측 결과에 현재 입력 반영
        observed.update(command=command, kwargs=kwargs)
        # 모의 자식 프로세스 결과 반환
        return CompletedProcess()

    # 부모의 고정 로컬 다운로드 모듈만 실행 의존성의 시험 대역 주입
    monkeypatch.setattr(transport.subprocess, "Popen", fake_popen)

    # 부모의 고정 로컬 다운로드 모듈만 실행 대상 동작 실행
    transport.boundedDownload(
        "role",
        "yolo-football-player-detection.pt",
        # 출력 파일 핸들의 호출 조건 지정
        descriptor=17,
        # 초 단위 제한 시간의 호출 조건 지정
        timeout_seconds=12.5,
    )

    # 실행 명령의 기대 자료 일치 확인
    assert observed["command"] == [
        sys.executable,
        "-m",
        'replay_perception.transport',
        "_child",
        "role",
        "yolo-football-player-detection.pt",
        "17",
    ]
    # 하위 프로세스에 허용한 파일 핸들이 17 하나뿐인지 확인
    assert observed["kwargs"]["pass_fds"] == (17,)
    # 허용한 핸들 외의 파일 핸들을 하위 프로세스에서 닫도록 설정했는지 확인
    assert observed["kwargs"]["close_fds"] is True
    # 제한 시간의 기대 자료 일치 확인
    assert observed["timeout"] == pytest.approx(12.5)
    # 하위 프로세스 명령에 직접 다운로드 주소를 전달하지 않음 확인
    assert not any(
        part.startswith("http") for part in observed["command"]
    )
