# 형식 주석의 지연 해석 사용
from __future__ import annotations
# 소스 문법 트리 분석 도구 읽음
import ast
# 원본과 가중치의 해시 계산 도구 읽음
import hashlib
# 메모리 바이트 입출력 도구 읽음
import io
# 파일 핸들을 다룰 운영체제 도구 읽음
import os
# 서버 인증서 검증 설정과 오류 도구 읽음
import ssl
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
# 주소 이동과 보안 연결 처리기와 요청 도구 읽음
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request
# 예외 기대와 반복 사례 검증 도구 읽음
import pytest
# 시험에 필요한 인식 구현과 자료 계약 읽음
from replay_perception import transport

# 모델 키별 오류 코드 접두사의 기대 대응표
PREFIXES = [
    ("detector", "MODEL"),
    ("role", "OBSERVER_MODEL"),
    ("pose", "OBSERVER_MODEL"),
]
# 모델 키별 승인 파일 이름의 기대 대응표
FILES = {
    "detector": "config.json",
    "role": "yolo-football-player-detection.pt",
    "pose": "model.safetensors",
}
# 자식 프로세스가 부모에게 전달하는 거부 코드 접미사의 기대 목록
REJECTED = [
    "SIZE_MISMATCH",
    "HASH_MISMATCH",
    "REDIRECT_SCHEME_INVALID",
    "REDIRECT_LIMIT",
    "REDIRECT_INVALID",
]
# 자식 프로세스가 부모에게 전달하는 모든 코드 접미사의 기대 목록
CODES = ["DOWNLOAD_TIMEOUT", *REJECTED]
# 주소 이동으로 취급하는 상태 코드의 기대 목록
REDIRECTS = [301, 302, 303, 307, 308]
# 원본 패키지에서 전송 모듈 밖의 가져오기를 금지할 네트워크 계열 모듈 목록
NETWORK = (
    "urllib.request",
    "urllib3",
    "ssl",
    "socket",
    "http.client",
    "certifi",
    "requests",
    "httpx",
    "aiohttp",
    "ftplib",
    "huggingface_hub",
)

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

# 서로 다른 보안 배포 주소로 이어지는 이동 응답 사슬과 최종 응답 생성
def _chain(count: int, payload: bytes) -> tuple[list[FakeResponse], FakeResponse]:
    # 이동 응답 사슬 생성
    redirects = [
        FakeResponse(302, location=f"https://cdn{number}.example.invalid/weights.bin")
        for number in range(count)
    ]
    # 최종 성공 응답 생성
    final = FakeResponse(200, payload=payload)
    # 이동 응답 사슬과 최종 응답 반환
    return redirects, final

# 정해진 응답을 차례대로 반환하는 모의 연결을 전송 모듈에 주입하고 반환
def _serve(monkeypatch, *responses: FakeResponse) -> FakeOpener:
    # 정해진 응답을 차례대로 반환할 모의 연결 생성
    opener = FakeOpener(*responses)
    # 전송 모듈의 보안 연결 생성 의존성에 모의 연결 주입
    monkeypatch.setattr(transport, 'httpsOpener', lambda: opener)
    # 주입한 모의 연결 반환
    return opener

# 쓰기 전용 출력 파일 핸들 생성
def _descriptor(directory: Path) -> int:
    # 새 출력 파일을 쓰기 전용으로 열어 핸들 반환
    return os.open(directory / "output.bin", os.O_WRONLY | os.O_CREAT, 0o600)

# 비보안 수동 리디렉션 거부와 소진 없는 응답 닫기 확인
def test_manual_redirect_rejects_http_and_closes_without_draining(
    monkeypatch,
):
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
        transport.entryStream(_entry(b"weights"), io.BytesIO(), "role")

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
    transport.entryStream(_entry(payload), output, "role")

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
        transport.entryStream(_entry(b"weights"), io.BytesIO(), "role")

# 제한된 통신의 정지 자식 종료와 대기 확인
def test_bounded_communicate_kills_and_waits_for_a_blocking_child():
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
        transport.boundedCommunication(
            process,
            # 초 단위 제한 시간의 호출 조건 지정
            timeout_seconds=0.05,
            # 오류 메시지에 쓸 파일 이름의 호출 조건 지정
            filename="weights.bin",
            # 오류 코드 접두사를 정할 모델 키의 호출 조건 지정
            model_key="role",
        )

    # 제한 시간 초과 뒤 하위 프로세스가 종료됐는지 확인
    assert process.poll() is not None
    # 정지한 하위 프로세스의 정리까지 5초 이내인지 확인
    assert time.monotonic() - started < 5

# 부모의 고정 로컬 다운로드 모듈만 실행 확인
@pytest.mark.parametrize("model_key, filename", list(FILES.items()))
def test_parent_launches_only_the_fixed_local_downloader_module(
    monkeypatch,
    model_key,
    filename,
):
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
        model_key,
        filename,
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
        model_key,
        filename,
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

# 안전하지 않은 이동 대상의 거부와 추적 금지 확인
@pytest.mark.parametrize(
    "target",
    [
        "ftp://example.invalid/weights.bin",
        "file:///etc/passwd",
        "https://user:secret@example.invalid/weights.bin",
        "https://user@example.invalid/weights.bin",
        "https://:secret@example.invalid/weights.bin",
        "https://@example.invalid/weights.bin",
        "https://:443/weights.bin",
    ],
)
def test_redirect_to_an_unsafe_target_is_rejected_and_never_followed(
    monkeypatch,
    target,
):
    # 안전하지 않은 위치로 이동시키는 응답 생성
    redirect = FakeResponse(
        307,
        # 전송 본문의 호출 조건 지정
        payload=b"body that must never be drained",
        # 이동 대상 주소의 호출 조건 지정
        location=target,
    )
    # 이동 응답 하나를 반환하는 모의 연결 주입
    opener = _serve(monkeypatch, redirect)
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 모델 계약 오류 발생 기대
    with pytest.raises(HTTPError) as caught:
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), output, "role")

    # 고정 오류 사유의 기대 자료 일치 확인
    assert caught.value.reason == "OBSERVER_MODEL_REDIRECT_SCHEME_INVALID: weights.bin"
    # 이동 응답 상태 코드 전달 확인
    assert caught.value.code == 307
    # 오류 문구에 자격 정보가 섞이지 않았는지 확인
    assert "secret" not in str(caught.value)
    # 이동 대상으로 추가 요청을 보내지 않았는지 확인
    assert len(opener.requests) == 1
    # 이동 응답이 본문을 읽지 않고 닫혔는지 확인
    assert (redirect.closed, redirect.read_calls) == (True, 0)
    # 출력에 기록한 바이트가 없는지 확인
    assert output.getvalue() == b""

# 첫 주소가 비보안이거나 호스트가 없거나 자격 정보를 담으면 연결 생성 전 거부 확인
@pytest.mark.parametrize(
    "url",
    [
        "http://huggingface.co/approved/weights.bin",
        "https:///weights.bin",
        "https://:443/weights.bin",
        "https://user:secret@huggingface.co/approved/weights.bin",
    ],
)
def test_entry_with_an_unsafe_first_url_is_rejected_before_any_connection(
    monkeypatch,
    url,
):
    # 연결 생성 호출 기록 공간 생성
    created = []
    # 호출되면 기록하는 연결 생성 의존성 주입
    monkeypatch.setattr(transport, 'httpsOpener', lambda: created.append(True))
    # 안전하지 않은 첫 주소를 가진 자산 항목 생성
    entry = {**_entry(b"weights"), "url": url}

    # 모델 계약 오류 발생 기대
    with pytest.raises(HTTPError) as caught:
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(entry, io.BytesIO(), "role")

    # 고정 오류 사유의 기대 자료 일치 확인
    assert caught.value.reason == "OBSERVER_MODEL_REDIRECT_SCHEME_INVALID: weights.bin"
    # 연결 생성을 호출하지 않았는지 확인
    assert created == []

# 모든 주소 이동 상태 코드의 보안 대상 추적 확인
@pytest.mark.parametrize("status", REDIRECTS)
def test_every_redirect_status_is_followed_to_the_https_target(monkeypatch, status):
    # 전송 본문 준비
    payload = b"weights"
    # 보안 대상으로 이동시키는 응답 생성
    redirect = FakeResponse(status, location="https://cdn.example.invalid/weights.bin")
    # 최종 성공 응답 생성
    final = FakeResponse(200, payload=payload)
    # 두 응답을 차례대로 반환하는 모의 연결 주입
    opener = _serve(monkeypatch, redirect, final)
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 주소와 크기와 해시를 검증하는 자산 전송 실행
    transport.entryStream(_entry(payload), output, "role")

    # 저장소에 기록한 바이트의 기대 자료 일치 확인
    assert output.getvalue() == payload
    # 요청한 주소 순서의 기대 자료 일치 확인
    assert [url for url, _ in opener.requests] == [
        _entry(payload)["url"],
        "https://cdn.example.invalid/weights.bin",
    ]
    # 이동 응답이 닫혔는지 확인
    assert redirect.closed is True
    # 최종 응답이 닫혔는지 확인
    assert final.closed is True

# 200이 아닌 상태의 본문 거부 확인
@pytest.mark.parametrize("status", [204, 206, 300, 304, 404, 500])
def test_entry_stream_accepts_only_status_200_as_a_download_body(
    monkeypatch,
    status,
):
    # 크기와 해시가 맞는 본문을 가진 응답 생성
    response = FakeResponse(status, payload=b"weights")
    # 응답 하나를 반환하는 모의 연결 주입
    _serve(monkeypatch, response)
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 모델 계약 오류 발생 기대
    with pytest.raises(HTTPError) as caught:
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), output, "role")

    # 고정 오류 사유의 기대 자료 일치 확인
    assert caught.value.reason == "OBSERVER_MODEL_HTTP_STATUS_INVALID: weights.bin"
    # 응답 상태 코드 전달 확인
    assert caught.value.code == status
    # 출력에 기록한 바이트가 없는지 확인
    assert output.getvalue() == b""
    # 응답이 본문을 읽지 않고 닫혔는지 확인
    assert (response.closed, response.read_calls) == (True, 0)

# 이동 횟수가 승인 한도인 다섯 번인 사슬의 성공 확인
def test_redirect_chain_at_the_limit_still_succeeds(monkeypatch):
    # 전송 본문 준비
    payload = b"weights"
    # 이동 응답 다섯 개의 사슬과 최종 응답 생성
    redirects, final = _chain(5, payload)
    # 모든 응답을 차례대로 반환하는 모의 연결 주입
    opener = _serve(monkeypatch, *redirects, final)
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 주소와 크기와 해시를 검증하는 자산 전송 실행
    transport.entryStream(_entry(payload), output, "role")

    # 저장소에 기록한 바이트의 기대 자료 일치 확인
    assert output.getvalue() == payload
    # 요청 수가 이동 횟수보다 하나 많은 여섯 개인지 확인
    assert len(opener.requests) == 6
    # 모든 응답이 닫혔는지 확인
    assert all(response.closed for response in [*redirects, final])
    # 이동 응답이 본문을 읽지 않았는지 확인
    assert all(response.read_calls == 0 for response in redirects)

# 이동 횟수가 승인 한도를 넘긴 여섯 번인 사슬의 거부 확인
def test_redirect_chain_beyond_the_limit_is_rejected_without_another_request(
    monkeypatch,
):
    # 이동 응답 여섯 개의 사슬과 최종 응답 생성
    redirects, final = _chain(6, b"weights")
    # 모든 응답을 차례대로 반환하는 모의 연결 주입
    opener = _serve(monkeypatch, *redirects, final)

    # 모델 계약 오류 발생 기대
    with pytest.raises(HTTPError) as caught:
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), io.BytesIO(), "role")

    # 고정 오류 사유의 기대 자료 일치 확인
    assert caught.value.reason == "OBSERVER_MODEL_REDIRECT_LIMIT: weights.bin"
    # 요청 수가 여섯 개에서 멈췄는지 확인
    assert len(opener.requests) == 6
    # 최종 응답은 요청되지 않고 대기열에 남았는지 확인
    assert opener.responses == [final]
    # 소비한 이동 응답이 모두 닫혔는지 확인
    assert all(response.closed for response in redirects)

# 상대 이동 주소의 현재 보안 주소 기준 해석 확인
@pytest.mark.parametrize(
    "location, expected",
    [
        (
            "/cdn/weights.bin",
            "https://huggingface.co/cdn/weights.bin",
        ),
        (
            "../other.bin",
            "https://huggingface.co/approved/model/resolve/other.bin",
        ),
        (
            "other.bin",
            "https://huggingface.co/approved/model/resolve/revision/other.bin",
        ),
        (
            "//cdn.example.invalid/weights.bin",
            "https://cdn.example.invalid/weights.bin",
        ),
        (
            "?download=true",
            "https://huggingface.co/approved/model/resolve/revision/weights.bin"
            "?download=true",
        ),
    ],
)
def test_relative_redirect_is_resolved_against_the_current_https_url(
    monkeypatch,
    location,
    expected,
):
    # 전송 본문 준비
    payload = b"weights"
    # 상대 위치로 이동시키는 응답 생성
    redirect = FakeResponse(302, location=location)
    # 최종 성공 응답 생성
    final = FakeResponse(200, payload=payload)
    # 두 응답을 차례대로 반환하는 모의 연결 주입
    opener = _serve(monkeypatch, redirect, final)

    # 주소와 크기와 해시를 검증하는 자산 전송 실행
    transport.entryStream(_entry(payload), io.BytesIO(), "role")

    # 두 번째 요청 주소의 기대 자료 일치 확인
    assert opener.requests[1][0] == expected

# 사용할 수 없는 이동 위치의 거부 확인
@pytest.mark.parametrize("location", [None, ""])
def test_redirect_without_a_usable_location_is_rejected(monkeypatch, location):
    # 이동 위치가 없거나 비어 있는 응답 생성
    redirect = FakeResponse(302, payload=b"body", location=location)
    # 이동 응답 하나를 반환하는 모의 연결 주입
    opener = _serve(monkeypatch, redirect)

    # 모델 계약 오류 발생 기대
    with pytest.raises(HTTPError) as caught:
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), io.BytesIO(), "role")

    # 고정 오류 사유의 기대 자료 일치 확인
    assert caught.value.reason == "OBSERVER_MODEL_REDIRECT_INVALID: weights.bin"
    # 추가 요청을 보내지 않았는지 확인
    assert len(opener.requests) == 1
    # 이동 응답이 본문을 읽지 않고 닫혔는지 확인
    assert (redirect.closed, redirect.read_calls) == (True, 0)

# 모델 키별 오류 코드 접두사 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_entry_stream_error_codes_follow_the_model_key_prefix(
    monkeypatch,
    model_key,
    prefix,
):
    # 비보안 위치로 이동시키는 응답을 반환하는 모의 연결 주입
    _serve(monkeypatch, FakeResponse(302, location="http://example.invalid/weights.bin"))

    # 모델 계약 오류 발생 기대
    with pytest.raises(HTTPError) as caught:
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), io.BytesIO(), model_key)

    # 모델 키별 고정 오류 사유의 기대 자료 일치 확인
    assert caught.value.reason == f"{prefix}_REDIRECT_SCHEME_INVALID: weights.bin"

# 열기 단계 실패의 고정 코드 예외 변환 확인
@pytest.mark.parametrize(
    "failure, kind, code",
    [
        (
            ConnectionResetError("reset with secret detail"),
            RuntimeError,
            "DOWNLOAD_FAILED",
        ),
        (
            TimeoutError("raw timeout while waiting for headers"),
            TimeoutError,
            "DOWNLOAD_TIMEOUT",
        ),
        (
            HTTPError("https://example.invalid/", 404, "Not Found", {}, None),
            RuntimeError,
            "DOWNLOAD_FAILED",
        ),
    ],
)
def test_entry_stream_turns_an_open_failure_into_a_fixed_code(
    monkeypatch,
    failure,
    kind,
    code,
):
    # 실제 외부 실행을 대신할 시험 객체 정의
    class FailingOpener:

        # 모의 연결 열기
        def open(self, _request, *, timeout):
            # 모의 연결 열기의 예외 상황 재현
            raise failure

    # 열기에서 실패하는 모의 연결 주입
    monkeypatch.setattr(transport, 'httpsOpener', lambda: FailingOpener())

    # 고정 코드 예외 발생 기대
    with pytest.raises(kind) as caught:
        # 주소와 크기와 해시를 검증하는 자산 전송 실행
        transport.entryStream(_entry(b"weights"), io.BytesIO(), "role")

    # 예외 종류가 정확히 일치하는지 확인
    assert type(caught.value) is kind
    # 원본 상세 없이 고정 코드만 담았는지 확인
    assert str(caught.value) == f"OBSERVER_MODEL_{code}: weights.bin"
    # 원본 실패가 원인으로 보존됐는지 확인
    assert caught.value.__cause__ is failure

# 상태 속성이 없는 응답의 상태 코드 조회 확인
def test_response_status_falls_back_to_getcode_when_status_is_missing():
    # 상태 속성 없이 상태 코드 조회만 가진 응답 정의
    class LegacyResponse:

        # 상태 코드 조회
        def getcode(self):
            # 문자열 상태 코드 반환
            return "200"

    # 정수로 변환된 상태 코드의 기대 자료 일치 확인
    assert transport.responseStatus(LegacyResponse()) == 200

# 쪼개 받은 본문의 기록과 검증 확인
def test_response_stream_writes_a_chunked_body_and_verifies_it(monkeypatch):
    # 읽기 묶음 크기를 본문보다 작게 조정
    monkeypatch.setattr(transport, "CHUNK_SIZE", 4)
    # 전송 본문 준비
    payload = b"0123456789"
    # 본문을 가진 모의 응답 생성
    response = FakeResponse(200, payload=payload)
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 응답 본문의 크기와 해시 검증 기록 실행
    transport.responseStream(response, _entry(payload), output, "role")

    # 저장소에 기록한 바이트의 기대 자료 일치 확인
    assert output.getvalue() == payload
    # 4바이트씩 세 번과 종료 확인 한 번을 읽었는지 확인
    assert response.read_calls == 4

# 크기 선언이 없는 본문의 허용 확인
def test_response_stream_accepts_a_body_without_a_declared_size():
    # 전송 본문 준비
    payload = b"weights"
    # 본문을 가진 모의 응답 생성
    response = FakeResponse(200, payload=payload)
    # 서버가 크기를 선언하지 않은 상황 재현
    del response.headers["Content-Length"]
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 응답 본문의 크기와 해시 검증 기록 실행
    transport.responseStream(response, _entry(payload), output, "role")

    # 저장소에 기록한 바이트의 기대 자료 일치 확인
    assert output.getvalue() == payload

# 선언 크기 불일치의 읽기 전 거부 확인
def test_response_stream_rejects_a_declared_size_mismatch_before_reading():
    # 기대보다 큰 본문을 선언하는 응답 생성
    response = FakeResponse(200, payload=b"weights!")
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 크기 불일치 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 응답 본문의 크기와 해시 검증 기록 실행
        transport.responseStream(response, _entry(b"weights"), output, "role")

    # 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == "OBSERVER_MODEL_SIZE_MISMATCH: weights.bin"
    # 본문을 읽지 않았는지 확인
    assert response.read_calls == 0
    # 출력에 기록한 바이트가 없는지 확인
    assert output.getvalue() == b""

# 정수가 아닌 선언 크기의 거부 확인
def test_response_stream_rejects_a_non_integer_declared_size():
    # 본문을 가진 모의 응답 생성
    response = FakeResponse(200, payload=b"weights")
    # 정수로 읽을 수 없는 크기 선언 재현
    response.headers["Content-Length"] = "seven"

    # 크기 불일치 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 응답 본문의 크기와 해시 검증 기록 실행
        transport.responseStream(response, _entry(b"weights"), io.BytesIO(), "role")

    # 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == "OBSERVER_MODEL_SIZE_MISMATCH: weights.bin"
    # 변환 실패가 원인으로 보존됐는지 확인
    assert isinstance(caught.value.__cause__, ValueError)
    # 본문을 읽지 않았는지 확인
    assert response.read_calls == 0

# 선언 없이 기대 크기를 넘는 본문의 상한 중단 확인
def test_response_stream_stops_at_the_size_cap_when_no_size_is_declared(
    monkeypatch,
):
    # 읽기 묶음 크기를 기대 크기보다 작게 조정
    monkeypatch.setattr(transport, "CHUNK_SIZE", 4)
    # 기대 크기를 넘는 본문을 가진 모의 응답 생성
    response = FakeResponse(200, payload=b"weights-and-more")
    # 서버가 크기를 선언하지 않은 상황 재현
    del response.headers["Content-Length"]
    # 메모리에서 읽고 쓸 바이트 저장소 읽음
    output = io.BytesIO()

    # 크기 불일치 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 응답 본문의 크기와 해시 검증 기록 실행
        transport.responseStream(response, _entry(b"weights"), output, "role")

    # 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == "OBSERVER_MODEL_SIZE_MISMATCH: weights.bin"
    # 상한을 넘긴 묶음은 기록하지 않고 첫 묶음만 남았는지 확인
    assert output.getvalue() == b"weig"
    # 상한 초과 직후 더 읽지 않았는지 확인
    assert response.read_calls == 2

# 선언과 달리 짧게 끝난 본문의 거부 확인
def test_response_stream_rejects_a_body_that_ends_short():
    # 본문이 한 바이트 모자란 모의 응답 생성
    response = FakeResponse(200, payload=b"weight")
    # 기대 크기를 선언했지만 본문이 중간에 끊긴 상황 재현
    response.headers["Content-Length"] = "7"

    # 크기 불일치 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 응답 본문의 크기와 해시 검증 기록 실행
        transport.responseStream(response, _entry(b"weights"), io.BytesIO(), "role")

    # 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == "OBSERVER_MODEL_SIZE_MISMATCH: weights.bin"

# 같은 길이의 다른 내용 거부와 모델 키별 접두사 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_response_stream_rejects_a_body_with_a_different_digest(model_key, prefix):
    # 길이는 같고 내용이 다른 본문을 가진 모의 응답 생성
    response = FakeResponse(200, payload=b"weighTs")

    # 해시 불일치 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 응답 본문의 크기와 해시 검증 기록 실행
        transport.responseStream(response, _entry(b"weights"), io.BytesIO(), model_key)

    # 모델 키별 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == f"{prefix}_HASH_MISMATCH: weights.bin"

# 본문 읽기 시간 초과의 고정 오류 코드 확인
def test_response_stream_maps_a_read_timeout_to_the_download_timeout_code():
    # 읽기에서 멈추는 모의 응답 정의
    class StalledResponse:
        # 크기 선언이 없는 응답 헤더 준비
        headers: dict[str, str] = {}

        # 기본 읽기 자리 채움
        def read(self, _amount=-1):
            # 기본 읽기 사용의 예외 상황 재현
            raise AssertionError("read1 must be used when it exists")

        # 가용 자료 읽기 시간 초과 재현
        def read1(self, _amount=-1):
            # 가용 자료 읽기의 예외 상황 재현
            raise TimeoutError("timed out")

    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError) as caught:
        # 응답 본문의 크기와 해시 검증 기록 실행
        transport.responseStream(
            StalledResponse(),
            _entry(b"weights"),
            io.BytesIO(),
            "role",
        )

    # 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == "OBSERVER_MODEL_DOWNLOAD_TIMEOUT: weights.bin"
    # 원본 시간 초과가 원인으로 보존됐는지 확인
    assert isinstance(caught.value.__cause__, TimeoutError)

# 열기 오류의 고정 코드 예외 변환과 모델 키별 접두사 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
@pytest.mark.parametrize(
    "failure, kind, code",
    [
        (URLError(TimeoutError("timed out")), TimeoutError, "DOWNLOAD_TIMEOUT"),
        (TimeoutError("timed out"), TimeoutError, "DOWNLOAD_TIMEOUT"),
        (ConnectionResetError("reset"), RuntimeError, "DOWNLOAD_FAILED"),
        (URLError("dns failure"), RuntimeError, "DOWNLOAD_FAILED"),
        (
            HTTPError("https://example.invalid/", 404, "Not Found", {}, None),
            RuntimeError,
            "DOWNLOAD_FAILED",
        ),
        (
            URLError(ssl.SSLCertVerificationError(1, "certificate verify failed")),
            RuntimeError,
            "DOWNLOAD_FAILED",
        ),
    ],
)
def test_open_error_maps_to_a_fixed_code_without_the_original_detail(
    model_key,
    prefix,
    failure,
    kind,
    code,
):
    # 열기 오류의 고정 코드 예외 변환 실행
    result = transport.openError(failure, "weights.bin", model_key)

    # 예외 종류가 정확히 일치하는지 확인
    assert type(result) is kind
    # 고정 오류 코드의 기대 자료 일치 확인
    assert str(result) == f"{prefix}_{code}: weights.bin"

# 제한된 통신 시간 초과의 모델 키별 접두사와 종료 수거 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_bounded_communication_timeout_uses_the_model_key_prefix(
    model_key,
    prefix,
):
    # 제한 시간을 넘기는 모의 하위 프로세스 정의
    class StalledProcess:

        # 초기 상태와 입력 계약 구성
        def __init__(self):
            # 통신 호출의 제한 시간 기록 공간 생성
            self.calls: list[float | None] = []
            # 종료 요청 여부의 거짓 설정
            self.killed = False

        # 제한 시간이 있으면 초과를 재현하고 없으면 남은 출력 반환
        def communicate(self, timeout=None):
            # 호출 기록에 제한 시간 추가
            self.calls.append(timeout)
            # 제한 시간이 지정된 호출의 조건 확인
            if timeout is not None:
                # 제한 시간 초과의 예외 상황 재현
                raise subprocess.TimeoutExpired("child", timeout)
            # 남은 출력 반환
            return "", ""

        # 종료 요청 기록
        def kill(self):
            # 종료 요청 여부의 참 설정
            self.killed = True

    # 모의 하위 프로세스 준비
    process = StalledProcess()

    # 제한 시간 초과 발생 기대
    with pytest.raises(TimeoutError) as caught:
        # 제한된 통신 실행
        transport.boundedCommunication(
            process,
            # 초 단위 제한 시간의 호출 조건 지정
            timeout_seconds=0.5,
            # 오류 메시지에 쓸 파일 이름의 호출 조건 지정
            filename="weights.bin",
            # 오류 코드 접두사를 정할 모델 키의 호출 조건 지정
            model_key=model_key,
        )

    # 모델 키별 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == f"{prefix}_DOWNLOAD_TIMEOUT: weights.bin"
    # 초과한 하위 프로세스를 종료했는지 확인
    assert process.killed is True
    # 제한 시간 호출 뒤 종료 상태를 수거하는 무제한 호출이 이어졌는지 확인
    assert process.calls == [0.5, None]
    # 시간 초과 원인이 보존됐는지 확인
    assert isinstance(caught.value.__cause__, subprocess.TimeoutExpired)

# 자식이 전달하는 허용 코드의 통과 확인
@pytest.mark.parametrize("prefix", ["MODEL", "OBSERVER_MODEL"])
@pytest.mark.parametrize("code", CODES)
def test_failure_code_passes_only_the_allowed_tokens(prefix, code):
    # 접두사와 접미사를 결합한 허용 코드 생성
    token = f"{prefix}_{code}"
    # 주소 오류의 사유에 같은 코드를 담은 예외 생성
    http_error = HTTPError(
        "https://example.invalid/",
        302,
        f"{token}: weights.bin",
        {},
        None,
    )

    # 일반 예외 메시지의 코드 통과 확인
    assert transport.failureCode(RuntimeError(f"{token}: weights.bin"), prefix) == token
    # 주소 오류 사유의 코드 통과 확인
    assert transport.failureCode(http_error, prefix) == token

# 허용 코드 외 모든 예외 메시지의 고정 실패 코드 수렴 확인
@pytest.mark.parametrize("prefix", ["MODEL", "OBSERVER_MODEL"])
@pytest.mark.parametrize(
    "message",
    [
        "secret: token",
        "{prefix}_DOWNLOAD_FAILED: weights.bin",
        "{prefix}_HTTP_STATUS_INVALID: weights.bin",
        "{prefix}_FILE_INVALID: weights.bin",
        "{other}_HASH_MISMATCH: weights.bin",
        "invalid literal for int() with base 10: 'abc'",
        "",
    ],
)
def test_failure_code_collapses_every_other_message_to_the_fixed_failure(
    prefix,
    message,
):
    # 다른 접두사 계열 이름 준비
    other = "OBSERVER_MODEL" if prefix == "MODEL" else "MODEL"
    # 접두사를 채운 예외 생성
    failure = RuntimeError(message.format(prefix=prefix, other=other))

    # 고정 실패 코드의 기대 자료 일치 확인
    assert transport.failureCode(failure, prefix) == f"{prefix}_DOWNLOAD_FAILED"

# 메시지 형태가 다른 예외의 고정 실패 코드 수렴 확인
@pytest.mark.parametrize("prefix", ["MODEL", "OBSERVER_MODEL"])
@pytest.mark.parametrize(
    "failure",
    [
        KeyError("weights.bin"),
        OSError(9, "Bad file descriptor"),
        OSError(28, "No space left on device"),
        HTTPError("https://user:secret@example.invalid/", 404, "Not Found", {}, None),
    ],
)
def test_failure_code_collapses_exceptions_with_other_message_shapes(
    prefix,
    failure,
):
    # 고정 실패 코드의 기대 자료 일치 확인
    assert transport.failureCode(failure, prefix) == f"{prefix}_DOWNLOAD_FAILED"

# 자식 출력의 허용 코드별 예외 종류 복원 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
@pytest.mark.parametrize("code", CODES)
def test_child_failure_restores_the_exception_kind_of_each_allowed_token(
    model_key,
    prefix,
    code,
):
    # 허용 코드 한 줄을 가진 자식 오류 출력 변환
    result = transport.childFailure(f"{prefix}_{code}\n", "weights.bin", model_key)
    # 시간 초과 코드만 시간 초과 예외로 복원하는 기대 종류 선택
    kind = TimeoutError if code == "DOWNLOAD_TIMEOUT" else ValueError

    # 예외 종류가 정확히 일치하는지 확인
    assert type(result) is kind
    # 파일 이름을 붙인 오류 문구의 기대 자료 일치 확인
    assert str(result) == f"{prefix}_{code}: weights.bin"

# 잡음 줄 사이의 허용 코드 탐지 확인
def test_child_failure_finds_the_token_among_noisy_lines():
    # 앞뒤 공백과 줄바꿈 변형을 섞은 자식 오류 출력 준비
    stderr = "warning: noise\r\n  OBSERVER_MODEL_HASH_MISMATCH  \r\ntrailing noise\n"

    # 자식 오류 출력 변환
    result = transport.childFailure(stderr, "weights.bin", "role")

    # 예외 종류가 정확히 일치하는지 확인
    assert type(result) is ValueError
    # 파일 이름을 붙인 오류 문구의 기대 자료 일치 확인
    assert str(result) == "OBSERVER_MODEL_HASH_MISMATCH: weights.bin"

# 다른 접두사 계열 코드의 무시 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_child_failure_ignores_the_tokens_of_the_other_prefix(model_key, prefix):
    # 다른 접두사 계열 이름 준비
    other = "OBSERVER_MODEL" if prefix == "MODEL" else "MODEL"
    # 다른 접두사의 모든 코드를 한 줄씩 담은 자식 오류 출력 준비
    stderr = "\n".join(f"{other}_{code}" for code in CODES)

    # 자식 오류 출력 변환
    result = transport.childFailure(stderr, "weights.bin", model_key)

    # 예외 종류가 정확히 일치하는지 확인
    assert type(result) is RuntimeError
    # 고정 실패 문구의 기대 자료 일치 확인
    assert str(result) == f"{prefix}_DOWNLOAD_FAILED: weights.bin"

# 정확한 한 줄이 아닌 출력의 고정 실패 수렴 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
@pytest.mark.parametrize(
    "stderr",
    [
        "",
        "\n",
        "secret value leaked here\n",
        "error: {prefix}_HASH_MISMATCH happened\n",
        "{prefix}_HASH_MISMATCH_EXTRA\n",
        "{prefix}_HASH_MISMATCH: weights.bin\n",
        "{prefix}_DOWNLOAD_FAILED\n",
    ],
)
def test_child_failure_falls_back_to_the_fixed_failure_for_anything_else(
    model_key,
    prefix,
    stderr,
):
    # 자식 오류 출력 변환
    result = transport.childFailure(stderr.format(prefix=prefix), "weights.bin", model_key)

    # 예외 종류가 정확히 일치하는지 확인
    assert type(result) is RuntimeError
    # 출력 내용을 싣지 않은 고정 실패 문구 확인
    assert str(result) == f"{prefix}_DOWNLOAD_FAILED: weights.bin"

# 전송 모듈이 허용하는 모델 키 집합 고정 확인
def test_transport_accepts_exactly_the_three_approved_model_keys():
    # 허용 모델 키 집합의 기대 자료 일치 확인
    assert set(transport.MODEL_KEYS) == {"detector", "role", "pose"}
    # 시험 대응표가 같은 키 집합을 다루는지 확인
    assert set(FILES) == set(transport.MODEL_KEYS)
    # 접두사 대응표가 같은 키 집합을 다루는지 확인
    assert {key for key, _ in PREFIXES} == set(transport.MODEL_KEYS)

# 승인된 세 모델 키의 자식 실행 연결 확인
@pytest.mark.parametrize("model_key", list(FILES))
def test_main_dispatches_each_approved_model_key_to_the_child(
    monkeypatch,
    model_key,
):
    # 자식 실행 호출 기록 공간 생성
    calls = []

    # 호출 인자만 기록하는 자식 실행 대역 정의
    def fake_child(*arguments):
        # 호출 기록 추가
        calls.append(arguments)
        # 정상 종료 코드 반환
        return 0

    # 자식 실행 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, "child", fake_child)

    # 명령행 인자 해석과 자식 실행 호출
    result = transport.main(["_child", model_key, "weights.bin", "7"])

    # 자식 실행 종료 코드의 전달 확인
    assert result == 0
    # 해석한 인자 순서의 기대 자료 일치 확인
    assert calls == [(model_key, "weights.bin", "7")]

# 잘못된 명령행 인자의 자식 실행 전 거부 확인
@pytest.mark.parametrize(
    "argv",
    [
        ["download", "role", "weights.bin", "7"],
        ["_child", "unknown", "weights.bin", "7"],
        ["_child", "role", "weights.bin"],
        ["_child"],
        [],
    ],
)
def test_main_rejects_malformed_arguments_before_any_download(
    monkeypatch,
    capsys,
    argv,
):
    # 자식 실행 호출 기록 공간 생성
    calls = []
    # 호출 인자를 기록하는 자식 실행 의존성 주입
    monkeypatch.setattr(transport, "child", lambda *arguments: calls.append(arguments))

    # 명령행 인자 오류 종료 기대
    with pytest.raises(SystemExit) as caught:
        # 명령행 인자 해석과 자식 실행 호출
        transport.main(argv)

    # 인자 오류 종료 코드의 기대 자료 일치 확인
    assert caught.value.code == 2
    # 자식 실행을 호출하지 않았는지 확인
    assert calls == []
    # 사용법 안내만 오류 출력에 남았는지 확인
    assert capsys.readouterr().err.startswith("usage:")

# 상속받은 핸들로 검증한 본문을 기록하는 자식 실행 확인
@pytest.mark.parametrize("model_key", list(FILES))
def test_child_writes_the_download_through_the_inherited_descriptor(
    monkeypatch,
    tmp_path,
    capsys,
    model_key,
):
    # 전송 호출 기록 공간 생성
    calls = []
    # 저장 장치 동기화 호출 기록 공간 생성
    synced = []
    # 교체 전 원래 동기화 함수 보관
    original = os.fsync

    # 받은 항목과 모델 키를 기록하고 본문을 기록하는 전송 대역 정의
    def fake_stream(entry, output, key):
        # 호출 기록 추가
        calls.append((entry["name"], key))
        # 출력에 시험 본문 기록
        output.write(b"weights")

    # 동기화 대상 핸들과 그 시점의 기록된 크기를 남기고 원래 함수로 위임하는 동기화 대역 정의
    def recording_sync(target):
        # 동기화 대상과 운영체제에 반영된 파일 크기 기록
        synced.append((target, os.fstat(target).st_size))
        # 원래 함수로 동기화
        original(target)

    # 전송 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, "entryStream", fake_stream)
    # 동기화 의존성의 시험 대역 주입
    monkeypatch.setattr(transport.os, "fsync", recording_sync)
    # 쓰기 전용 출력 파일 핸들 생성
    descriptor = _descriptor(tmp_path)

    # 자식 실행 호출
    result = transport.child(model_key, FILES[model_key], str(descriptor))

    # 정상 종료 코드의 기대 자료 일치 확인
    assert result == 0
    # 가로챈 표준 출력과 오류 출력 읽음
    captured = capsys.readouterr()
    # 표준 출력과 오류 출력이 비었는지 확인
    assert (captured.out, captured.err) == ("", "")
    # 파일에 본문이 기록됐는지 확인
    assert (tmp_path / "output.bin").read_bytes() == b"weights"
    # 승인된 항목 이름과 모델 키로 전송했는지 확인
    assert calls == [(FILES[model_key], model_key)]
    # 본문을 운영체제에 모두 반영한 뒤 핸들을 저장 장치로 동기화했는지 확인
    assert synced == [(descriptor, len(b"weights"))]

# 자식 실행 실패의 고정 코드 출력과 종료 코드 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
@pytest.mark.parametrize(
    "kind, message, line",
    [
        (
            ValueError,
            "{prefix}_HASH_MISMATCH: weights.bin",
            "{prefix}_HASH_MISMATCH",
        ),
        (
            TimeoutError,
            "{prefix}_DOWNLOAD_TIMEOUT: weights.bin",
            "{prefix}_DOWNLOAD_TIMEOUT",
        ),
        (
            RuntimeError,
            "secret detail: token",
            "{prefix}_DOWNLOAD_FAILED",
        ),
        (
            OSError,
            "No space left on device",
            "{prefix}_DOWNLOAD_FAILED",
        ),
    ],
)
def test_child_prints_only_the_fixed_code_and_returns_one(
    monkeypatch,
    tmp_path,
    capsys,
    model_key,
    prefix,
    kind,
    message,
    line,
):
    # 실패하는 전송 대역 정의
    def failing_stream(*_arguments):
        # 전송의 예외 상황 재현
        raise kind(message.format(prefix=prefix))

    # 전송 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, "entryStream", failing_stream)
    # 쓰기 전용 출력 파일 핸들 생성
    descriptor = _descriptor(tmp_path)

    # 자식 실행 호출
    result = transport.child(model_key, FILES[model_key], str(descriptor))

    # 실패 종료 코드의 기대 자료 일치 확인
    assert result == 1
    # 가로챈 표준 출력과 오류 출력 읽음
    captured = capsys.readouterr()
    # 표준 출력이 비었는지 확인
    assert captured.out == ""
    # 오류 출력이 고정 코드 한 줄뿐인지 확인
    assert captured.err == line.format(prefix=prefix) + "\n"

# 주소 오류의 사유만 전달하고 주소는 전달하지 않음 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_child_reports_the_reason_of_an_http_error_but_never_its_url(
    monkeypatch,
    tmp_path,
    capsys,
    model_key,
    prefix,
):
    # 자격 정보가 든 주소를 가진 주소 오류를 던지는 전송 대역 정의
    def failing_stream(*_arguments):
        # 전송의 예외 상황 재현
        raise HTTPError(
            "https://user:secret@example.invalid/weights.bin",
            302,
            f"{prefix}_REDIRECT_SCHEME_INVALID: weights.bin",
            {},
            None,
        )

    # 전송 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, "entryStream", failing_stream)
    # 쓰기 전용 출력 파일 핸들 생성
    descriptor = _descriptor(tmp_path)

    # 자식 실행 호출
    result = transport.child(model_key, FILES[model_key], str(descriptor))

    # 실패 종료 코드의 기대 자료 일치 확인
    assert result == 1
    # 오류 출력에 사유 코드만 있고 주소와 자격 정보가 없는지 확인
    assert capsys.readouterr().err == f"{prefix}_REDIRECT_SCHEME_INVALID\n"

# 쓸 수 없는 핸들의 고정 실패 코드 출력과 전송 미시작 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
@pytest.mark.parametrize("descriptor", ["abc", "", "-1", "1.5", "987654"])
def test_child_rejects_an_unusable_descriptor_without_starting_the_stream(
    monkeypatch,
    capsys,
    model_key,
    prefix,
    descriptor,
):
    # 전송 호출 기록 공간 생성
    calls = []
    # 호출 인자를 기록하는 전송 의존성 주입
    monkeypatch.setattr(transport, "entryStream", lambda *arguments: calls.append(arguments))

    # 자식 실행 호출
    result = transport.child(model_key, FILES[model_key], descriptor)

    # 실패 종료 코드의 기대 자료 일치 확인
    assert result == 1
    # 고정 실패 코드만 오류 출력에 남았는지 확인
    assert capsys.readouterr().err == f"{prefix}_DOWNLOAD_FAILED\n"
    # 전송을 시작하지 않았는지 확인
    assert calls == []

# 승인되지 않은 파일의 고정 실패 코드 출력과 전송 미시작과 핸들 미소비 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_child_rejects_an_unapproved_file_without_starting_the_stream(
    monkeypatch,
    tmp_path,
    capsys,
    model_key,
    prefix,
):
    # 전송 호출 기록 공간 생성
    calls = []
    # 호출 인자를 기록하는 전송 의존성 주입
    monkeypatch.setattr(transport, "entryStream", lambda *arguments: calls.append(arguments))
    # 쓰기 전용 출력 파일 핸들 생성
    descriptor = _descriptor(tmp_path)

    # 승인 밖 파일의 자식 실행 호출
    result = transport.child(model_key, "unapproved.bin", str(descriptor))
    # 핸들을 자식이 닫지 않았는지 확인 (닫혔다면 여기서 오류가 나 다른 파일 번호를 닫지 않음)
    os.fstat(descriptor)
    # 열려 있던 핸들 정리
    os.close(descriptor)

    # 실패 종료 코드의 기대 자료 일치 확인
    assert result == 1
    # 고정 실패 코드만 오류 출력에 남았는지 확인
    assert capsys.readouterr().err == f"{prefix}_DOWNLOAD_FAILED\n"
    # 전송을 시작하지 않았는지 확인
    assert calls == []

# 사용자 중단 신호의 삼키지 않고 전달 확인
def test_child_lets_a_keyboard_interrupt_propagate(monkeypatch, tmp_path, capsys):
    # 사용자 중단을 던지는 전송 대역 정의
    def interrupted(*_arguments):
        # 사용자 중단의 예외 상황 재현
        raise KeyboardInterrupt

    # 전송 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, "entryStream", interrupted)
    # 쓰기 전용 출력 파일 핸들 생성
    descriptor = _descriptor(tmp_path)

    # 사용자 중단 전달 기대
    with pytest.raises(KeyboardInterrupt):
        # 자식 실행 호출
        transport.child("role", FILES["role"], str(descriptor))

    # 실패 코드를 출력하지 않았는지 확인
    assert capsys.readouterr().err == ""

# 자식 프로세스 시작을 금지하는 시험 대역 주입
@pytest.fixture
def no_child(monkeypatch):
    # 시작되면 실패하는 하위 프로세스 생성 대역 정의
    def forbidden(*_arguments, **_options):
        # 시작 금지의 예외 상황 재현
        raise AssertionError("child process must not start")

    # 하위 프로세스 생성 의존성의 시험 대역 주입
    monkeypatch.setattr(transport.subprocess, "Popen", forbidden)

# 잘못된 핸들 번호의 자식 시작 전 거부 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
@pytest.mark.parametrize("descriptor", [-1, True, "7"])
def test_bounded_download_rejects_an_invalid_descriptor_before_launching(
    no_child,
    model_key,
    prefix,
    descriptor,
):
    # 입력 계약 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 잘못된 핸들 번호로 제한 시간 다운로드 실행
        transport.boundedDownload(
            model_key,
            FILES[model_key],
            descriptor=descriptor,
            timeout_seconds=5,
        )

    # 모델 키별 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == f"{prefix}_DOWNLOAD_DESCRIPTOR_INVALID"

# 잘못된 제한 시간의 자식 시작 전 거부 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
@pytest.mark.parametrize(
    "timeout",
    [0, -1, float("nan"), float("inf"), True, "5"],
)
def test_bounded_download_rejects_an_invalid_timeout_before_launching(
    no_child,
    model_key,
    prefix,
    timeout,
):
    # 입력 계약 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 잘못된 제한 시간으로 제한 시간 다운로드 실행
        transport.boundedDownload(
            model_key,
            FILES[model_key],
            descriptor=7,
            timeout_seconds=timeout,
        )

    # 모델 키별 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == f"{prefix}_DOWNLOAD_TIMEOUT_INVALID"

# 승인되지 않은 파일의 자식 시작 전 거부 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_bounded_download_rejects_an_unapproved_file_before_launching(
    no_child,
    model_key,
    prefix,
):
    # 입력 계약 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 승인 밖 파일로 제한 시간 다운로드 실행
        transport.boundedDownload(
            model_key,
            "unapproved.bin",
            descriptor=7,
            timeout_seconds=5,
        )

    # 모델 키별 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == f"{prefix}_FILE_INVALID: unapproved.bin"

# 알 수 없는 모델 키의 자식 시작 전 거부 확인
def test_bounded_download_rejects_an_unknown_model_key_before_launching(no_child):
    # 입력 계약 오류 발생 기대
    with pytest.raises(ValueError) as caught:
        # 승인 밖 모델 키로 제한 시간 다운로드 실행
        transport.boundedDownload(
            "unknown",
            "weights.bin",
            descriptor=7,
            timeout_seconds=5,
        )

    # 고정 오류 코드의 기대 자료 일치 확인
    assert str(caught.value) == "OBSERVER_MODEL_KEY_INVALID: 'unknown'"

# 자식 실패 출력의 부모측 예외 복원 확인
@pytest.mark.parametrize("model_key, prefix", PREFIXES)
def test_parent_restores_the_child_failure_as_the_matching_exception(
    monkeypatch,
    model_key,
    prefix,
):
    # 해시 불일치로 끝난 모의 하위 프로세스 정의
    class FailedProcess:
        # 외부 명령 종료 코드의 1 설정
        returncode = 1

        # 모의 자식 통신 결과 반환
        def communicate(self, *, timeout):
            # 오류 출력에 고정 코드 한 줄을 담아 반환
            return "", f"{prefix}_HASH_MISMATCH\n"

    # 하위 프로세스 생성 의존성의 시험 대역 주입
    monkeypatch.setattr(
        transport.subprocess,
        "Popen",
        lambda *_arguments, **_options: FailedProcess(),
    )

    # 해시 불일치 복원 기대
    with pytest.raises(ValueError) as caught:
        # 제한 시간 다운로드 실행
        transport.boundedDownload(
            model_key,
            FILES[model_key],
            descriptor=17,
            timeout_seconds=5,
        )

    # 파일 이름을 붙인 오류 문구의 기대 자료 일치 확인
    assert str(caught.value) == f"{prefix}_HASH_MISMATCH: {FILES[model_key]}"

# 실제 자식 프로세스의 고정 실패 코드 출력과 부모 복원 확인
def test_real_child_process_reports_only_the_fixed_failure_code():
    # 패키지 원본 폴더 경로 읽음
    source = Path(transport.__file__).parents[1]
    # 원본 폴더를 모듈 검색 경로로 더한 자식 환경 생성
    environment = {**os.environ, "PYTHONPATH": str(source)}

    # 쓸 수 없는 핸들로 실제 자식 프로세스 실행
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "replay_perception.transport",
            "_child",
            "detector",
            "config.json",
            "-1",
        ],
        # 출력 수집의 호출 조건 지정
        capture_output=True,
        # 문자열 자료의 호출 조건 지정
        text=True,
        # 초 단위 제한 시간의 호출 조건 지정
        timeout=30,
        # 자식 환경의 호출 조건 지정
        env=environment,
    )
    # 부모가 같은 출력을 예외로 복원한 결과 생성
    restored = transport.childFailure(completed.stderr, "config.json", "detector")

    # 실패 종료 코드의 기대 자료 일치 확인
    assert completed.returncode == 1
    # 표준 출력이 비었는지 확인
    assert completed.stdout == ""
    # 오류 출력이 고정 코드 한 줄뿐인지 확인
    assert completed.stderr == "MODEL_DOWNLOAD_FAILED\n"
    # 복원한 예외 종류가 정확히 일치하는지 확인
    assert type(restored) is RuntimeError
    # 복원한 오류 문구의 기대 자료 일치 확인
    assert str(restored) == "MODEL_DOWNLOAD_FAILED: config.json"

# 전송 열기 도구의 인증서 검증과 주소 이동 직접 처리 구성 확인
def test_https_opener_verifies_certificates_and_hands_every_redirect_back(monkeypatch):
    # 교체 전 원래 문맥 생성 함수 보관
    original = ssl.create_default_context
    # 문맥 생성 호출 조건 기록 공간 생성
    options: list[dict[str, object]] = []
    # 만들어진 문맥 기록 공간 생성
    contexts: list[ssl.SSLContext] = []
    # 보안 연결 처리기가 받은 문맥 기록 공간 생성
    received: list[ssl.SSLContext] = []

    # 호출 조건을 기록하고 원래 함수로 위임하는 문맥 생성 대역 정의
    def recording_context(*arguments, **keywords):
        # 호출 조건 기록
        options.append(keywords)
        # 원래 함수로 문맥 생성
        context = original(*arguments, **keywords)
        # 만들어진 문맥 기록
        contexts.append(context)
        # 만들어진 문맥 반환
        return context

    # 받은 문맥을 기록하는 보안 연결 처리기 정의
    class RecordingHandler(HTTPSHandler):

        # 받은 문맥을 기록한 뒤 원래 처리기 초기화
        def __init__(self, *, context):
            # 받은 문맥 기록
            received.append(context)
            # 원래 처리기 초기화
            super().__init__(context=context)

    # 문맥 생성 의존성의 시험 대역 주입
    monkeypatch.setattr(transport.ssl, "create_default_context", recording_context)
    # 보안 연결 처리기 의존성의 시험 대역 주입
    monkeypatch.setattr(transport, "HTTPSHandler", RecordingHandler)

    # 보안 연결 열기 도구 생성
    opener = transport.httpsOpener()
    # 열기 도구가 가진 보안 연결 처리기 목록 읽음
    secure = [handler for handler in opener.handlers if isinstance(handler, HTTPSHandler)]
    # 열기 도구가 가진 주소 이동 처리기 목록 읽음
    moving = [handler for handler in opener.handlers if isinstance(handler, HTTPRedirectHandler)]

    # 인증서 묶음 경로만 지정해 문맥을 한 번 만들었는지 확인
    assert options == [{"cafile": transport.certifi.where()}]
    # 만들어진 문맥 수 확인
    assert len(contexts) == 1
    # 서버 인증서 검증 필수 여부 확인
    assert contexts[0].verify_mode == ssl.CERT_REQUIRED
    # 서버 이름 검증 여부 확인
    assert contexts[0].check_hostname is True
    # 보안 연결 처리기가 문맥 하나를 받았는지 확인
    assert len(received) == 1
    # 받은 문맥이 만들어진 문맥과 같은지 확인
    assert received[0] is contexts[0]
    # 보안 연결 처리기가 대역 하나뿐인지 확인
    assert [type(handler) for handler in secure] == [RecordingHandler]
    # 주소 이동 처리기가 하나뿐인지 확인
    assert len(moving) == 1
    # 그 처리기가 자동 추적을 하는 기본형이 아닌지 확인
    assert type(moving[0]) is not HTTPRedirectHandler

    # 주소 이동 상태 코드를 하나씩 확인
    for code in REDIRECTS:
        # 이동 위치를 가진 모의 응답 생성
        response = FakeResponse(code, location="https://cdn.example.invalid/weights.bin")
        # 열기 도구의 오류 처리 사슬에 응답 전달
        handled = opener.error(
            "http",
            Request("https://example.invalid/weights.bin"),
            response,
            code,
            "redirect",
            response.headers,
        )
        # 응답을 따라가지 않고 그대로 돌려받았는지 확인
        assert handled is response
        # 응답을 읽지도 닫지도 않았는지 확인
        assert (response.read_calls, response.closed) == (0, False)

    # 주소 이동이 아닌 상태 코드의 모의 응답 생성
    other = FakeResponse(304)
    # 주소 이동이 아닌 상태 코드의 주소 오류 기대
    with pytest.raises(HTTPError) as caught:
        # 열기 도구의 오류 처리 사슬에 응답 전달
        opener.error(
            "http",
            Request("https://example.invalid/weights.bin"),
            other,
            304,
            "Not Modified",
            other.headers,
        )

    # 상태 코드 보존 확인
    assert caught.value.code == 304

# 인식 패키지의 모든 원본 파일 목록 읽음
def _sources() -> list[Path]:
    # 패키지 폴더 아래 모든 파이썬 파일을 정렬해 반환
    return sorted(Path(transport.__file__).parent.rglob("*.py"))

# 구문 트리가 읽어 들이는 줄 번호와 모듈 이름 목록 반환
def _imports(tree: ast.AST) -> list[tuple[int, str]]:
    # 읽어 들인 이름 기록 공간 생성
    names: list[tuple[int, str]] = []
    # 구문 트리의 모든 노드를 하나씩 확인
    for node in ast.walk(tree):
        # 모듈 전체를 읽는 구문 조건 확인
        if isinstance(node, ast.Import):
            # 읽은 모듈마다 줄 번호와 모듈 이름 기록
            names += [(node.lineno, alias.name) for alias in node.names]
        # 절대 경로 모듈에서 이름을 읽는 구문 조건 확인
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            # 읽은 이름마다 줄 번호와 모듈 경로를 이은 이름 기록
            names += [(node.lineno, f"{node.module}.{alias.name}") for alias in node.names]
    # 읽어 들인 이름 목록 반환
    return names

# 전송 모듈 밖에서 네트워크 계열 모듈을 읽지 않는지 확인
def test_only_the_transport_module_imports_network_libraries():
    # 위반 기록 공간 생성
    offenders: list[str] = []
    # 패키지의 모든 원본 파일을 하나씩 확인
    for source in _sources():
        # 전송 모듈 자신인지 확인
        if source == Path(transport.__file__):
            # 네트워크 읽기를 허용한 유일한 모듈이므로 생략
            continue
        # 원본을 구문 트리로 해석
        tree = ast.parse(source.read_text(encoding="utf-8"))
        # 읽어 들인 이름을 하나씩 확인
        for line, name in _imports(tree):
            # 금지 모듈과 같거나 그 하위 이름인지 확인
            if any(name == banned or name.startswith(f"{banned}.") for banned in NETWORK):
                # 위반 위치 기록
                offenders.append(f"{source.name}:{line} {name}")

    # 위반이 없는지 확인
    assert offenders == []

# 가져오기 검사가 전송 모듈의 실제 네트워크 가져오기를 탐지하는지 확인
def test_the_import_scan_detects_the_network_imports_of_the_transport_module():
    # 전송 모듈을 구문 트리로 해석
    tree = ast.parse(Path(transport.__file__).read_text(encoding="utf-8"))
    # 읽어 들인 이름 집합 생성
    names = {name for _, name in _imports(tree)}

    # 네트워크 관련 이름을 탐지했는지 확인
    assert {"ssl", "certifi", "urllib.request.build_opener"} <= names

# 사전 학습 모델 읽기 호출이 모두 로컬 파일만 쓰는지 확인
def test_every_from_pretrained_call_reads_local_files_only():
    # 호출을 확인한 원본 파일 이름 기록 공간 생성
    checked: set[str] = set()
    # 위반 기록 공간 생성
    violations: list[str] = []
    # 패키지의 모든 원본 파일을 하나씩 확인
    for source in _sources():
        # 원본을 구문 트리로 해석
        tree = ast.parse(source.read_text(encoding="utf-8"))
        # 구문 트리의 모든 노드를 하나씩 확인
        for node in ast.walk(tree):
            # 사전 학습 읽기 호출이 아닌 노드 조건 확인
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "from_pretrained"
            ):
                # 현재 노드 생략
                continue
            # 호출을 확인한 파일로 기록
            checked.add(source.name)
            # 키워드 인자를 이름별로 묶음
            keywords = {keyword.arg: keyword.value for keyword in node.keywords}
            # 로컬 파일 전용 지정 읽음
            local = keywords.get("local_files_only")
            # 원격 코드 실행 허용 지정 읽음
            remote = keywords.get("trust_remote_code")
            # 로컬 파일 전용이 상수 참이 아닌 경우 확인
            if not (isinstance(local, ast.Constant) and local.value is True):
                # 위반 위치 기록
                violations.append(f"{source.name}:{node.lineno} local_files_only")
            # 원격 코드 실행 허용이 지정됐고 상수 거짓이 아닌 경우 확인
            if (
                remote is not None
                and not (isinstance(remote, ast.Constant) and remote.value is False)
            ):
                # 위반 위치 기록
                violations.append(f"{source.name}:{node.lineno} trust_remote_code")

    # 위반이 없는지 확인
    assert violations == []
    # 검사 대상 호출이 실제로 있었는지 확인
    assert {"detector.py", "pose.py"} <= checked
