from __future__ import annotations

import io
import json
from pathlib import Path
from urllib.error import HTTPError

import pytest

from replay_video.http import Api, HttpError


class Reply:
    def __init__(self, status: int, payload: bytes = b"") -> None:
        self.status = status
        self.payload = io.BytesIO(payload)

    def __enter__(self) -> Reply:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        return self.payload.read(size)


class Open:
    def __init__(self, replies: list[Reply | Exception]) -> None:
        self.replies = replies
        self.requests: list[object] = []

    def __call__(self, request: object, timeout: float = 0) -> Reply:
        self.requests.append(request)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def test_claim_maps_no_content_and_job() -> None:
    payload = {
        "jobId": "job-1",
        "jobType": "VALIDATE_VIDEO",
        "jobRevision": 1,
        "leaseToken": "lease",
        "sourceUrl": "http://storage/video",
    }
    opener = Open([Reply(204), Reply(200, json.dumps(payload).encode())])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)

    assert api.claim("VALIDATE_VIDEO") is None
    assert api.claim("VALIDATE_VIDEO") == payload


def test_result_posts_worker_lease() -> None:
    opener = Open([Reply(200, b'{"kind":"ACCEPTED"}')])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    job = {"jobId": "job-1", "jobRevision": 2, "leaseToken": "lease"}

    assert api.result(job, {"kind": "VALIDATED", "durationMs": 1000, "width": 320, "height": 180}) == {
        "kind": "ACCEPTED"
    }
    request = opener.requests[0]
    assert getattr(request, "full_url") == "http://web.test/api/internal/jobs/job-1/result"
    body = json.loads(getattr(request, "data").decode())
    assert body["workerId"] == "worker-1"
    assert body["jobRevision"] == 2
    assert body["leaseToken"] == "lease"


def test_media_downloads_bytes(tmp_path: Path) -> None:
    opener = Open([Reply(200, b"video-bytes")])
    api = Api("http://web.test", "secret", "worker-1", opener=opener)
    target = tmp_path / "source.mp4"

    api.media("http://storage/video", target)

    assert target.read_bytes() == b"video-bytes"


def test_http_error_keeps_status() -> None:
    error = HTTPError("http://web.test", 401, "unauthorized", {}, None)
    api = Api("http://web.test", "secret", "worker-1", opener=Open([error]))

    with pytest.raises(HttpError, match="http-401"):
        api.claim("VALIDATE_VIDEO")


def test_evidence_grants_and_upload(tmp_path: Path) -> None:
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
    source.write_bytes(b"frame")

    assert api.evidence(job, [{"name": source.name, "contentType": "image/jpeg", "sizeBytes": 5}]) == grant
    api.put("http://storage.test/candidate-0001.jpg", source, "image/jpeg")

    grant_request = opener.requests[0]
    put_request = opener.requests[1]
    assert getattr(grant_request, "full_url") == "http://web.test/api/internal/jobs/job-1/evidence"
    assert getattr(put_request, "method") == "PUT"
    assert getattr(put_request, "data") == b"frame"
