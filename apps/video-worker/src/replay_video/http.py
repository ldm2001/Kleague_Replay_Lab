from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .protocol import WORKER_PROTOCOL


class HttpError(RuntimeError):
    # 내부 API 오류
    pass


Open = Callable[..., object]


class Api:
    # Worker 내부 API Client
    def __init__(
        self,
        base: str,
        key: str,
        worker: str,
        *,
        timeout: float = 30.0,
        opener: Open = urlopen,
    ) -> None:
        # API 기본 주소 정규화
        self.base = base.rstrip("/")
        # Worker 인증 키 저장
        self.key = key
        # Worker 식별자 저장
        self.worker = worker
        # HTTP 요청 제한 시간 저장
        self.timeout = timeout
        # HTTP 열기 함수 저장
        self.opener = opener

    # JSON 요청
    def _json(
        self,
        path: str,
        payload: Mapping[str, object],
        allowed_errors: tuple[int, ...] = (),
    ) -> dict[str, object] | None:
        # JSON 요청 객체 구성
        request = Request(
            f"{self.base}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-worker-key": self.key,
                "x-worker-protocol": WORKER_PROTOCOL,
            },
            method="POST",
        )
        # HTTP 응답 변수 초기화
        try:
            with self.opener(request, timeout=self.timeout) as response:
                status = int(getattr(response, "status", 200))
                if status == 204:
                    # 빈 응답은 없음 결과 반환
                    return None
                # 응답 본문 읽기
                body = response.read()
        except HTTPError as error:
            if error.code not in allowed_errors:
                raise HttpError(f"http-{error.code}") from error
            status = error.code
            body = error.read()
        except URLError as error:
            raise HttpError("http-unavailable") from error
        if (status < 200 or status >= 300) and status not in allowed_errors:
            # 오류 상태 변환
            raise HttpError(f"http-{status}")
        # JSON 본문 해석
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            if status in allowed_errors:
                raise HttpError(f"http-{status}") from error
            raise HttpError("http-payload") from error
        if not isinstance(value, dict):
            # 객체가 아닌 응답 차단
            raise HttpError("http-payload")
        # API 응답 반환
        return value

    # 일반 JSON 요청
    def json(self, path: str, payload: Mapping[str, object]) -> dict[str, object] | None:
        return self._json(path, payload)

    # 작업 선점
    def claim(self, kind: str) -> dict[str, object] | None:
        return self.json("/api/internal/jobs/claim", {"workerId": self.worker, "jobType": kind})

    # 작업 진행
    def progress(
        self,
        job: Mapping[str, object],
        stage: str,
        percent: int,
        message: str | None = None,
    ) -> dict[str, object] | None:
        payload: dict[str, object] = {
            "workerId": self.worker,
            "jobRevision": job["jobRevision"],
            "leaseToken": job["leaseToken"],
            "stage": stage,
            "progressPercent": percent,
        }
        if message:
            payload["message"] = message
        return self.json(f"/api/internal/jobs/{job['jobId']}/progress", payload)

    # 작업 결과
    def result(self, job: Mapping[str, object], payload: Mapping[str, object]) -> dict[str, object] | None:
        response = self._json(
            f"/api/internal/jobs/{job['jobId']}/result",
            {
                "workerId": self.worker,
                "jobRevision": job["jobRevision"],
                "leaseToken": job["leaseToken"],
                "payload": dict(payload),
            },
            (409,),
        )
        if response and response.get("kind") in {"ACCEPTED", "ALREADY_FINISHED"}:
            return response
        if response and response.get("kind") == "STALE_LEASE":
            raise HttpError("http-409")
        raise HttpError("result-response-invalid")

    # 증거 업로드 권한
    def evidence(self, job: Mapping[str, object], items: list[dict[str, object]]) -> dict[str, object] | None:
        return self.json(
            f"/api/internal/jobs/{job['jobId']}/evidence",
            {
                "workerId": self.worker,
                "jobRevision": job["jobRevision"],
                "leaseToken": job["leaseToken"],
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
        # 저장소 권한에서 전달 가능한 헤더를 제한한다
        forwarded = {key.lower(): value for key, value in (headers or {}).items()}
        allowed = {"x-amz-checksum-sha256", "if-none-match"}
        if (len(forwarded) != len(headers or {}) or set(forwarded) - allowed or
                not all(isinstance(value, str) for value in forwarded.values())):
            raise HttpError("evidence-headers-invalid")
        if content_type == "application/gzip":
            if set(forwarded) != allowed:
                raise HttpError("evidence-headers-invalid")
            maximum = 128 * 1024 * 1024
        elif content_type in {"image/jpeg", "video/mp4"}:
            if forwarded:
                raise HttpError("evidence-headers-invalid")
            maximum = 50 * 1024 * 1024
        else:
            raise HttpError("evidence-type-invalid")
        try:
            size = source.stat().st_size
        except OSError as error:
            raise HttpError("evidence-path-invalid") from error
        if size <= 0 or size > maximum or not source.is_file():
            raise HttpError("evidence-size-invalid")
        request_headers = {"content-type": content_type, "content-length": str(size), **forwarded}
        try:
            # 파일 객체를 urllib에 전달해 본문 전체를 메모리에 올리지 않는다
            with source.open("rb") as stream:
                request = Request(url, data=stream, headers=request_headers, method="PUT")
                with self.opener(request, timeout=self.timeout) as response:
                    status = int(getattr(response, "status", 200))
        except HTTPError as error:
            raise HttpError(f"evidence-{error.code}") from error
        except URLError as error:
            raise HttpError("evidence-unavailable") from error
        if status < 200 or status >= 300:
            # 증거 업로드 오류 변환
            raise HttpError(f"evidence-{status}")

    # 원본 다운로드
    def media(self, url: str, target: Path) -> None:
        # 원본 다운로드 요청 구성
        request = Request(url, method="GET")
        # 대상 폴더 생성
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            # 응답 스트림을 파일로 저장
            with self.opener(request, timeout=self.timeout) as response, target.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    # 다운로드 청크 기록
                    output.write(chunk)
        except HTTPError as error:
            raise HttpError(f"media-{error.code}") from error
        except URLError as error:
            raise HttpError("media-unavailable") from error
