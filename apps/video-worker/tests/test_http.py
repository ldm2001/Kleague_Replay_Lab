from __future__ import annotations

import io
import json
from pathlib import Path
from urllib.error import HTTPError

import pytest

from replay_video.http import Api, HttpError


# HTTP 응답 모형
class Reply:
    def __init__(self, status: int, payload: bytes = b"") -> None:
        # 응답 상태와 본문 초기화
        self.status = status
        self.payload = io.BytesIO(payload)

    def __enter__(self) -> Reply:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        # 응답 본문 읽기
        return self.payload.read(size)


# HTTP 호출 모형
class Open:
    def __init__(self, replies: list[Reply | Exception]) -> None:
        # 순서대로 반환할 응답 보관
        self.replies = replies
        # 요청 기록 초기화
        self.requests: list[object] = []

    def __call__(self, request: object, timeout: float = 0) -> Reply:
        # 요청 기록
        self.requests.append(request)
        # 다음 응답 선택
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


# 작업 선점 응답 확인
def test_claim() -> None:
    # 선점 응답 모형 구성
    payload = {
        "jobId": "job-1",
        "jobType": "VALIDATE_VIDEO",
        "jobRevision": 1,
        "leaseToken": "lease",
        "sourceUrl": "http://storage/video",
    }
    opener = Open([Reply(204), Reply(200, json.dumps(payload).encode())])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    # 빈 응답과 작업 응답 확인
    assert api.claim("VALIDATE_VIDEO") is None
    assert api.claim("VALIDATE_VIDEO") == payload


# 작업 결과 요청 확인
def test_result() -> None:
    # 작업 결과 응답 모형 구성
    opener = Open([Reply(200, b'{"kind":"ACCEPTED"}')])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    assert api.result(job, {"kind": "VALIDATED", "durationMs": 1000, "width": 320, "height": 180}) == {
        "kind": "ACCEPTED"
    }
    # 결과 요청 본문 확인
    request = opener.requests[0]
    assert getattr(request, "full_url") == "http://web.test/api/internal/jobs/job-1/result"
    body = json.loads(getattr(request, "data").decode())
    assert body["workerId"] == "worker-1"
    assert body["jobRevision"] == 2
    assert body["leaseToken"] == "lease"


# 원본 영상 수신 확인
def test_media(tmp_path: Path) -> None:
    # 원본 다운로드 응답 모형 구성
    opener = Open([Reply(200, b"video-bytes")])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    target = tmp_path / "source.mp4"

    # 원본 영상 저장
    api.media("http://storage/video", target)

    assert target.read_bytes() == b"video-bytes"


# HTTP 오류 상태 확인
def test_error() -> None:
    # 인증 실패 응답 모형 구성
    error = HTTPError("http://web.test", 401, "unauthorized", {}, None)
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))

    with pytest.raises(HttpError, match="http-401"):
        api.claim("VALIDATE_VIDEO")


# 증거 업로드 요청 확인
def test_evidence(tmp_path: Path) -> None:
    # 증거 권한 응답 모형 구성
    grant = {
        "kind": "GRANTED",
        "items": [{
            "name": "candidate-0001.jpg",
            "objectKey": "evidence/analysis/job/candidate-0001.jpg",
            "uploadUrl": "http://storage.test/candidate-0001.jpg",
        }],
    }
    opener = Open([Reply(200, json.dumps(grant).encode()), Reply(200)])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}
    source = tmp_path / "candidate-0001.jpg"
    # 증거 파일 저장
    source.write_bytes(b"frame")

    # 권한 요청과 파일 업로드 확인
    assert api.evidence(job, [{"name": source.name, "contentType": "image/jpeg", "sizeBytes": 5}]) == grant
    api.put("http://storage.test/candidate-0001.jpg", source, "image/jpeg")

    grant_request = opener.requests[0]
    put_request = opener.requests[1]
    assert getattr(grant_request, "full_url") == "http://web.test/api/internal/jobs/job-1/evidence"
    assert getattr(put_request, "method") == "PUT"
    assert getattr(put_request, "data") == b"frame"
