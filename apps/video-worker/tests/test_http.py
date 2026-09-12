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
        # opener 호출 중 스트림에서 읽은 요청 본문 보관
        self.bodies: list[bytes | None] = []
        self.streaming: list[bool] = []

    def __call__(self, request: object, timeout: float = 0) -> Reply:
        # 요청 기록
        self.requests.append(request)
        data = getattr(request, "data", None)
        self.streaming.append(hasattr(data, "read"))
        self.bodies.append(data.read() if hasattr(data, "read") else data)
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


def test_json_sends_current_worker_protocol() -> None:
    opener = Open([Reply(204)])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    api.json("/api/internal/jobs/claim", {"workerId": "worker-1", "jobType": "ANALYZE_VIDEO"})
    headers = {key.lower(): value for key, value in opener.requests[0].header_items()}
    assert headers["x-worker-protocol"] == "video-observations-v2"


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


def test_result_accepts_idempotent_already_finished_response() -> None:
    payload = io.BytesIO(b'{"kind":"ALREADY_FINISHED"}')
    error = HTTPError("http://web.test", 409, "finished", {}, payload)
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    assert api.result(job, {"kind": "VALIDATED"}) == {"kind": "ALREADY_FINISHED"}


def test_result_preserves_terminal_409_when_no_verifiable_body_exists() -> None:
    error = HTTPError("http://web.test", 409, "stale", {}, None)
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    with pytest.raises(HttpError, match="http-409"):
        api.result(job, {"kind": "VALIDATED"})


def test_result_rejects_unexpected_success_payload() -> None:
    api = Api("http://web.test", "secret", "worker-1", opener=Open([Reply(200, b'{"kind":"OTHER"}')]))
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    with pytest.raises(HttpError, match="result-response-invalid"):
        api.result(job, {"kind": "VALIDATED"})


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
    assert opener.bodies[1] == b"frame"
    assert opener.streaming[1] is True
    headers = {key.lower(): value for key, value in put_request.header_items()}
    assert headers["content-length"] == "5"
    assert headers["content-type"] == "image/jpeg"


def test_put_streams_gzip_with_only_checksum_bound_headers(tmp_path: Path) -> None:
    source = tmp_path / "perception.jsonl.gz"
    source.write_bytes(b"diagnostic")
    opener = Open([Reply(200)])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    api.put("http://storage.test/perception", source, "application/gzip", {
        "x-amz-checksum-sha256": "checksum",
        "if-none-match": "*",
    })

    request = opener.requests[0]
    headers = {key.lower(): value for key, value in request.header_items()}
    assert opener.streaming == [True]
    assert opener.bodies == [b"diagnostic"]
    assert headers == {
        "content-type": "application/gzip",
        "content-length": str(len(b"diagnostic")),
        "x-amz-checksum-sha256": "checksum",
        "if-none-match": "*",
    }


@pytest.mark.parametrize("headers", [
    {"authorization": "secret"},
    {"content-type": "application/gzip"},
    {"x-amz-checksum-sha256": "checksum", "if-none-match": "*", "x-extra": "no"},
])
def test_put_rejects_unapproved_grant_headers_before_network(tmp_path: Path, headers: dict[str, str]) -> None:
    source = tmp_path / "perception.jsonl.gz"
    source.write_bytes(b"diagnostic")
    opener = Open([])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    with pytest.raises(HttpError, match="evidence-headers-invalid"):
        api.put("http://storage.test/perception", source, "application/gzip", headers)
    assert opener.requests == []


def test_put_rejects_oversize_before_opening_network(tmp_path: Path) -> None:
    source = tmp_path / "candidate.mp4"
    with source.open("wb") as output:
        output.truncate(50 * 1024 * 1024 + 1)
    opener = Open([])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    with pytest.raises(HttpError, match="evidence-size-invalid"):
        api.put("http://storage.test/candidate.mp4", source, "video/mp4")
    assert opener.requests == []


def test_put_treats_precondition_failure_as_upload_failure(tmp_path: Path) -> None:
    source = tmp_path / "perception.jsonl.gz"
    source.write_bytes(b"diagnostic")
    error = HTTPError("http://storage.test/perception", 412, "exists", {}, None)
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))

    with pytest.raises(HttpError, match="evidence-412"):
        api.put("http://storage.test/perception", source, "application/gzip", {
            "x-amz-checksum-sha256": "checksum", "if-none-match": "*",
        })
