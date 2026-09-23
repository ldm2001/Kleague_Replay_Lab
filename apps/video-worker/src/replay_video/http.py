# 타입 표기의 지연 평가 설정
from __future__ import annotations
# 직렬화 자료 읽기와 기록 도구 가져옴
import json
# 파일과 폴더 경로 도구 가져옴
from pathlib import Path
# 함수와 키 기반 입력의 타입 표기 가져옴
from typing import Callable, Mapping
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


# 교체 가능한 요청 실행 함수의 타입 선언
Open = Callable[..., object]


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
            # 서버 연결 불가 예외 전달
            raise HttpError("http-unavailable") from error
        # 성공 범위도 허용 오류도 아닌 상태 확인
        if (status < 200 or status >= 300) and status not in allowed_errors:
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
        # 해당 작업의 진행 보고 요청 결과 반환
        return self.json(f"/api/internal/jobs/{job['jobId']}/progress", payload)

    # 작업 결과
    def result(
        self, job: Mapping[str, object], payload: Mapping[str, object]
    ) -> dict[str, object] | None:
        # 결과 제출의 충돌 응답까지 해석할 요청 실행
        response = self.request(
            f"/api/internal/jobs/{job['jobId']}/result",
            {
                # 결과를 제출하는 작업자 식별자 전달
                "workerId": self.worker,
                # 제출 대상 작업 판본 전달
                "jobRevision": job["jobRevision"],
                # 제출 권한을 증명하는 선점 토큰 전달
                "leaseToken": job["leaseToken"],
                # 분석 산출물 본문의 복사본 전달
                "payload": dict(payload),
            },
            (409,),
        )
        # 결과 접수 또는 이미 완료된 응답인지 확인
        if response and response.get("kind") in {"ACCEPTED", "ALREADY_FINISHED"}:
            # 정상적인 제출 확인 응답 반환
            return response
        # 만료되거나 교체된 선점 권한 여부 확인
        if response and response.get("kind") == "STALE_LEASE":
            # 오래된 선점 권한의 제출 충돌 오류 전달
            raise HttpError("http-409")
        # 예상하지 못한 결과 응답 오류 전달
        raise HttpError("result-response-invalid")

    # 증거 업로드 권한
    def evidence(
        self, job: Mapping[str, object], items: list[dict[str, object]]
    ) -> dict[str, object] | None:
        # 증거 파일 업로드 권한 요청 결과 반환
        return self.json(
            f"/api/internal/jobs/{job['jobId']}/evidence",
            {
                # 증거 등록 작업자 식별자 전달
                "workerId": self.worker,
                # 증거를 연결할 작업 판본 전달
                "jobRevision": job["jobRevision"],
                # 증거 등록 권한을 증명하는 선점 토큰 전달
                "leaseToken": job["leaseToken"],
                # 업로드할 증거 메타데이터 목록 전달
                "items": items,
            },
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
            # 원본 다운로드 상태 오류 전달
            raise HttpError(f"media-{error.code}") from error
        # 원본 다운로드 연결 오류 분기
        except URLError as error:
            # 원본 다운로드 연결 불가 오류 전달
            raise HttpError("media-unavailable") from error
