# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 직렬화 자료 읽기와 기록 도구 가져옴
import json
# 재시도 대기 흔들림 난수 도구 가져옴
import random
# 재시도 대기와 경과 시간 측정 도구 가져옴
import time
# 응답 수신 중 끊긴 연결의 오류 타입 가져옴
from http.client import HTTPException
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 함수와 키 기반 입력 및 재시도 응답의 타입 표기 가져옴
from typing import Callable, Mapping, TypeVar
# 서버 상태 오류와 연결 오류 타입 가져옴
from urllib.error import HTTPError, URLError
# 웹 요청 구성과 전송 도구 가져옴
from urllib.request import Request, urlopen
# 서버와 맞출 작업자 계약 판본 가져옴
from .protocol import WORKER_PROTOCOL


# 내부 호출 실패를 표현하는 예외 타입 선언
class HttpError(RuntimeError):
    # 내부 호출 규약 오류
    pass


# 같은 제출을 다시 보내도 바뀌지 않는 서버 결과 거부 예외 타입 선언
class Rejection(HttpError):
    # 결정적 결과 거부
    pass


# 같은 요청을 다시 보내면 성공할 수 있는 일시 장애 예외 타입 선언
class Transient(HttpError):

    # 서버 대기 요구를 함께 보존하는 일시 장애
    def __init__(self, message: str, wait: float | None = None) -> None:
        # 기존 상태 오류 문자열 유지
        super().__init__(message)
        # 서버가 알려준 재시도 대기 초 보존
        self.wait = wait


# 재실행으로 바뀌지 않는 원본과 산출물 및 참조와 저장 문맥의 결과 거부 사유
TERMINAL = frozenset({"SOURCE", "ARTIFACT", "REFERENCE", "CONTEXT"})


# 다시 보내도 되는 시간 초과와 요청 과다 및 서버 일시 장애 상태
TRANSIENT = frozenset({408, 425, 429, 500, 502, 503, 504})
# 첫 재시도 대기 기준 초
BASE = 0.5
# 재시도 대기와 서버 대기 요구의 상한 초
CEILING = 4.0
# 서버 임대 30초에서 갱신 주기 10초를 뺀 진행 보고 재시도 시간 상한 초
RENEWAL = 20.0


# 교체 가능한 요청 실행 함수의 타입 선언
Open = Callable[..., object]


# 재시도 요청 응답의 타입 변수 선언
T = TypeVar("T")


# 서버가 알려준 재시도 대기 초 읽음
def delay(headers: Mapping[str, str] | None) -> float | None:
    try:
        # 숫자 초 형식의 재시도 대기 값 변환
        seconds = float((headers or {}).get("retry-after", ""))
    # 날짜 형식이나 누락된 대기 값 분기
    except (TypeError, ValueError):
        # 기본 지수 대기 사용 표시 반환
        return None
    # 음수와 무한 및 숫자 아닌 값을 제외한 대기 초 반환
    return seconds if 0 <= seconds < float("inf") else None


# 작업 선점과 진행 및 결과 전송을 맡는 통신 객체 선언
class Api:

    # 영상 작업 내부 호출 규약 클라이언트
    def __init__(
        self,
        base: str,
        key: str,
        worker: str,
        *,
        timeout: float = 30.0,
        opener: Open = urlopen,
        attempts: int = 3,
        sleep: Callable[[float], object] = time.sleep,
        jitter: Callable[[], float] = random.random,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        # 호출 규약 기본 주소 정규화
        self.base = base.rstrip("/")
        # 영상 작업자 인증 키 저장
        self.key = key
        # 영상 작업자 식별자 저장
        self.worker = worker
        # 웹 통신 요청 제한 시간 저장
        self.timeout = timeout
        # 웹 통신 열기 함수 저장
        self.opener = opener
        # 일시 장애 요청의 최대 시도 횟수 저장
        self.attempts = attempts
        # 재시도 사이 대기 함수 저장
        self.sleep = sleep
        # 재시도 대기 흔들림 난수 함수 저장
        self.jitter = jitter
        # 재시도 시간 상한 측정 시계 저장
        self.clock = clock

    # 일시 장애의 제한 재시도 요청
    def retry(self, call: Callable[[], T], budget: float = float("inf")) -> T:
        # 첫 요청 시작 시각 기록
        start = self.clock()
        # 현재 시도 순번 초기화
        attempt = 1
        # 성공 또는 재시도 불가 판단까지 같은 요청 반복
        while True:
            try:
                # 같은 본문의 요청 결과 반환
                return call()
            # 다시 보내면 성공할 수 있는 장애 분기
            except Transient as error:
                # 서버 대기 요구 우선 사용 후 지수 증가 전체 흔들림 대기 계산
                wait = (
                    error.wait
                    if error.wait is not None
                    else self.jitter() * min(CEILING, BASE * 2 ** (attempt - 1))
                )
                # 마지막 시도와 상한 초과 대기 및 시간 상한 소진 여부 확인
                if (
                    attempt >= self.attempts
                    or wait > CEILING
                    or self.clock() - start + wait > budget
                ):
                    # 마지막 일시 장애 오류 전달
                    raise
            # 다음 시도 전 대기
            self.sleep(wait)
            # 다음 시도 순번 증가
            attempt += 1

    # 직렬화 자료 요청
    def request(
        self,
        path: str,
        payload: Mapping[str, object],
        allowed_errors: tuple[int, ...] = (),
    ) -> dict[str, object] | None:
        # 직렬화 자료 요청 객체 구성
        request = Request(
            f"{self.base}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                # 요청 본문의 직렬화 자료 형식 지정
                "content-type": "application/json",
                # 내부 작업자 인증 키 전달
                "x-worker-key": self.key,
                # 서버와 맞춰야 할 실행 계약 버전 전달
                "x-worker-protocol": WORKER_PROTOCOL,
            },
            method="POST",
        )
        # 요청 전송과 허용된 오류 응답 읽기 시도
        try:
            # 제한 시간 안에 요청을 보내고 응답 자원 관리
            with self.opener(request, timeout=self.timeout) as response:
                # 응답 상태 코드 읽음
                status = int(getattr(response, "status", 200))
                # 내용 없는 성공 응답 여부 확인
                if status == 204:
                    # 빈 응답은 없음 결과 반환
                    return None
                # 응답 본문 읽기
                body = response.read()
        # 서버 오류 상태 응답 분기
        except HTTPError as error:
            # 호출자가 허용하지 않은 일시 장애 상태 확인
            if error.code in TRANSIENT and error.code not in allowed_errors:
                # 서버 대기 요구와 함께 재시도 가능한 상태 오류 전달
                raise Transient(f"http-{error.code}", delay(error.headers)) from error
            # 호출자가 허용하지 않은 오류 상태 확인
            if error.code not in allowed_errors:
                # 상태 코드를 내부 통신 예외로 전달
                raise HttpError(f"http-{error.code}") from error
            # 허용된 오류 응답의 상태 보존
            status = error.code
            # 허용된 오류의 상세 본문 읽음
            body = error.read()
        # 연결 실패 등 통신 오류 분기
        except URLError as error:
            # 재시도 가능한 서버 연결 불가 예외 전달
            raise Transient("http-unavailable") from error
        # 요청 전송 뒤 응답 수신 중 시간 초과와 연결 끊김 분기
        except (TimeoutError, ConnectionError, HTTPException) as error:
            # 처리 여부를 모르는 응답 유실을 재시도 가능한 연결 불가로 전달
            raise Transient("http-unavailable") from error
        # 성공 범위도 허용 오류도 아닌 상태 확인
        if (status < 200 or status >= 300) and status not in allowed_errors:
            # 일시 장애 상태 확인
            if status in TRANSIENT:
                # 재시도 가능한 상태 오류 전달
                raise Transient(f"http-{status}")
            # 오류 상태 변환
            raise HttpError(f"http-{status}")
        # 직렬화 자료 본문 해석
        try:
            # 응답 바이트를 문자열과 직렬화 객체로 해석
            value = json.loads(body.decode("utf-8"))
        # 문자열 또는 직렬화 해석 실패 분기
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            # 허용 오류의 본문 해석 실패 여부 확인
            if status in allowed_errors:
                # 해석 불가 본문 대신 원래 오류 상태 전달
                raise HttpError(f"http-{status}") from error
            # 응답 본문 형식 오류 전달
            raise HttpError("http-payload") from error
        # 응답이 객체 형태인지 확인
        if not isinstance(value, dict):
            # 객체가 아닌 응답 차단
            raise HttpError("http-payload")
        # 호출 규약 응답 반환
        return value

    # 일반 직렬화 자료 요청
    def json(self, path: str, payload: Mapping[str, object]) -> dict[str, object] | None:
        # 일반 요청 결과를 그대로 반환
        return self.request(path, payload)

    # 작업 선점
    def claim(self, kind: str) -> dict[str, object] | None:
        # 작업자 식별자와 작업 종류를 보내 선점 결과 반환
        return self.json("/api/internal/jobs/claim", {"workerId": self.worker, "jobType": kind})

    # 작업 진행
    def progress(
        self,
        job: Mapping[str, object],
        stage: str,
        percent: int,
        message: str | None = None,
    ) -> dict[str, object] | None:
        # 선점한 작업의 진행 보고 본문 생성
        payload: dict[str, object] = {
            # 진행을 보고하는 작업자 식별자 전달
            "workerId": self.worker,
            # 오래된 작업 세대의 갱신 방지를 위한 판본 전달
            "jobRevision": job["jobRevision"],
            # 현재 선점 권한을 증명하는 토큰 전달
            "leaseToken": job["leaseToken"],
            # 현재 처리 단계 전달
            "stage": stage,
            # 현재 처리 진행 백분율 전달
            "progressPercent": percent,
        }
        # 추가 진행 설명의 존재 확인
        if message:
            # 진행 설명을 본문에 추가
            payload["message"] = message
        # 임대 기한 안에서만 재시도한 해당 작업의 진행 보고 요청 결과 반환
        return self.retry(
            lambda: self.json(f"/api/internal/jobs/{job['jobId']}/progress", payload),
            RENEWAL,
        )

    # 작업 결과
    def result(
        self, job: Mapping[str, object], payload: Mapping[str, object]
    ) -> dict[str, object] | None:
        # 결과 제출 본문 생성
        body = {
            # 결과를 제출하는 작업자 식별자 전달
            "workerId": self.worker,
            # 제출 대상 작업 판본 전달
            "jobRevision": job["jobRevision"],
            # 제출 권한을 증명하는 선점 토큰 전달
            "leaseToken": job["leaseToken"],
            # 분석 산출물 본문의 복사본 전달
            "payload": dict(payload),
        }
        # 결과 제출의 거부와 충돌 응답까지 해석하며 일시 장애 시 같은 본문 재전송
        response = self.retry(
            lambda: self.request(f"/api/internal/jobs/{job['jobId']}/result", body, (400, 409))
        )
        # 결과 접수 또는 이미 완료된 응답인지 확인
        if response and response.get("kind") in {"ACCEPTED", "ALREADY_FINISHED"}:
            # 정상적인 제출 확인 응답 반환
            return response
        # 만료되거나 교체된 선점 권한 여부 확인
        if response and response.get("kind") == "STALE_LEASE":
            # 오래된 선점 권한의 제출 충돌 오류 전달
            raise HttpError("http-409")
        # 거부 응답의 종류와 사유 읽음
        kind, reason = (response or {}).get("kind"), (response or {}).get("reason")
        # 요청과 입력 형식 거부 또는 재실행으로 바뀌지 않는 결과 거부 확인
        if kind in {"INVALID_REQUEST", "INVALID_INPUT"} or (
            kind == "INVALID_RESULT" and reason in TERMINAL
        ):
            # 거부 종류와 사유 부호만 담은 결정적 거부 전달
            raise Rejection(f"result-rejected kind={kind} reason={reason}")
        # 저장소와 검증 기능의 일시 실패를 기존 상태 오류로 전달
        if kind == "INVALID_RESULT":
            # 임대 만료 뒤 재실행되는 기존 400 오류 유지
            raise HttpError("http-400")
        # 예상하지 못한 결과 응답 오류 전달
        raise HttpError("result-response-invalid")

    # 증거 업로드 권한
    def evidence(
        self, job: Mapping[str, object], items: list[dict[str, object]]
    ) -> dict[str, object] | None:
        # 증거 파일 업로드 권한 요청 본문 생성
        body = {
            # 증거 등록 작업자 식별자 전달
            "workerId": self.worker,
            # 증거를 연결할 작업 판본 전달
            "jobRevision": job["jobRevision"],
            # 증거 등록 권한을 증명하는 선점 토큰 전달
            "leaseToken": job["leaseToken"],
            # 업로드할 증거 메타데이터 목록 전달
            "items": items,
        }
        # 서명 주소만 발급하는 권한 요청을 일시 장애 시 재전송한 결과 반환
        return self.retry(
            lambda: self.json(f"/api/internal/jobs/{job['jobId']}/evidence", body)
        )

    # 증거 파일 전송
    def put(
        self,
        url: str,
        source: Path,
        content_type: str,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        # 저장소 권한의 전달 헤더 제한
        forwarded = {key.lower(): value for key, value in (headers or {}).items()}
        # 전달을 허용할 체크섬과 덮어쓰기 방지 헤더 집합 생성
        allowed = {"x-amz-checksum-sha256", "if-none-match"}
        # 중복된 이름과 허용 밖 헤더 및 값 타입 확인
        if (
            len(forwarded) != len(headers or {})
            or set(forwarded) - allowed
            or not all(isinstance(value, str) for value in forwarded.values())
        ):
            # 유효하지 않은 증거 전송 헤더 오류 전달
            raise HttpError("evidence-headers-invalid")
        # 압축 관측 자료의 전송 형식 여부 확인
        if content_type == "application/gzip":
            # 압축 자료에 필요한 두 헤더 존재 확인
            if set(forwarded) != allowed:
                # 압축 자료의 필수 헤더 누락 오류 전달
                raise HttpError("evidence-headers-invalid")
            # 압축 자료 최대 크기를 128메비바이트로 설정
            maximum = 128 * 1024 * 1024
        # 이미지 또는 영상 증거 형식 여부 확인
        elif content_type in {"image/jpeg", "video/mp4"}:
            # 헤더 전달 시 체크섬과 덮어쓰기 방지 조건 확인
            if forwarded and (
                set(forwarded) != allowed
                or forwarded.get("if-none-match") != "*"
                or not forwarded.get("x-amz-checksum-sha256")
            ):
                # 이미지와 영상의 잘못된 헤더 오류 전달
                raise HttpError("evidence-headers-invalid")
            # 이미지와 영상 최대 크기를 50메비바이트로 설정
            maximum = 50 * 1024 * 1024
        # 허용되지 않은 증거 콘텐츠 형식 분기
        else:
            # 지원하지 않는 증거 형식 오류 전달
            raise HttpError("evidence-type-invalid")
        # 로컬 증거 파일 상태 조회 시도
        try:
            # 업로드할 파일 바이트 크기 읽음
            size = source.stat().st_size
        # 파일 상태 조회 실패 분기
        except OSError as error:
            # 잘못된 증거 경로 오류 전달
            raise HttpError("evidence-path-invalid") from error
        # 빈 파일과 크기 상한 및 일반 파일 여부 확인
        if size <= 0 or size > maximum or not source.is_file():
            # 허용할 수 없는 증거 크기 오류 전달
            raise HttpError("evidence-size-invalid")
        # 형식과 실제 파일 크기를 전송 헤더에 조립
        request_headers = {"content-type": content_type, "content-length": str(size), **forwarded}
        # 증거 파일 전송과 응답 확인 시도
        try:
            # 파일 객체 전달로 요청 본문 전체의 메모리 적재 방지
            with source.open("rb") as stream:
                # 파일 스트림을 본문으로 업로드 요청 생성
                request = Request(url, data=stream, headers=request_headers, method="PUT")
                # 제한 시간 안에 증거 업로드 응답 읽음
                with self.opener(request, timeout=self.timeout) as response:
                    # 업로드 응답 상태 코드 읽음
                    status = int(getattr(response, "status", 200))
        # 업로드 서버 오류 응답 분기
        except HTTPError as error:
            # 증거 전송 상태 오류 전달
            raise HttpError(f"evidence-{error.code}") from error
        # 증거 업로드 연결 오류 분기
        except URLError as error:
            # 증거 저장소 연결 불가 오류 전달
            raise HttpError("evidence-unavailable") from error
        # 업로드 응답의 성공 범위 확인
        if status < 200 or status >= 300:
            # 증거 업로드 오류 변환
            raise HttpError(f"evidence-{status}")

    # 원본 다운로드
    def media(self, url: str, target: Path) -> None:
        # 안전한 조회 요청이므로 일시 장애 시 처음부터 다시 받음
        self.retry(lambda: self.download(url, target))

    # 원본 한 번 받음
    def download(self, url: str, target: Path) -> None:
        # 원본 다운로드 요청 구성
        request = Request(url, method="GET")
        # 대상 폴더 생성
        target.parent.mkdir(parents=True, exist_ok=True)
        # 원본 다운로드와 파일 쓰기 시도
        try:
            # 응답 스트림을 파일로 저장
            with self.opener(request, timeout=self.timeout) as response, target.open(
                "wb"
            ) as output:
                # 원본 응답을 최대 1메비바이트 단위로 읽음
                while chunk := response.read(1024 * 1024):
                    # 다운로드 청크 기록
                    output.write(chunk)
        # 원본 다운로드 서버 오류 분기
        except HTTPError as error:
            # 저장소 일시 장애 상태 확인
            if error.code in TRANSIENT:
                # 서버 대기 요구와 함께 재시도 가능한 다운로드 오류 전달
                raise Transient(f"media-{error.code}", delay(error.headers)) from error
            # 원본 다운로드 상태 오류 전달
            raise HttpError(f"media-{error.code}") from error
        # 원본 다운로드 연결 오류 분기
        except URLError as error:
            # 재시도 가능한 원본 다운로드 연결 불가 오류 전달
            raise Transient("media-unavailable") from error
        # 다운로드 도중 시간 초과와 연결 끊김 분기
        except (TimeoutError, ConnectionError, HTTPException) as error:
            # 재시도 가능한 원본 다운로드 연결 불가 오류 전달
            raise Transient("media-unavailable") from error
