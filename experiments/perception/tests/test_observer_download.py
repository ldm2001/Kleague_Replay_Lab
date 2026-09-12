from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError

import pytest


def _entry(payload: bytes) -> dict[str, object]:
    return {
        "name": "weights.bin",
        "size": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "url": "https://huggingface.co/approved/model/resolve/revision/weights.bin",
    }


class FakeResponse:
    def __init__(
        self,
        status: int,
        *,
        payload: bytes = b"",
        location: str | None = None,
    ):
        self.status = status
        self.headers: dict[str, str] = {
            "Content-Length": str(len(payload))
        }
        if location is not None:
            self.headers["Location"] = location
        self._payload = io.BytesIO(payload)
        self.read_calls = 0
        self.closed = False

    def read(self, amount: int = -1) -> bytes:
        self.read_calls += 1
        return self._payload.read(amount)

    def read1(self, amount: int = -1) -> bytes:
        self.read_calls += 1
        return self._payload.read(amount)

    def close(self) -> None:
        self.closed = True


class FakeOpener:
    def __init__(self, *responses: FakeResponse):
        self.responses = list(responses)
        self.requests: list[tuple[str, float]] = []

    def open(self, request, *, timeout):
        self.requests.append((request.full_url, timeout))
        return self.responses.pop(0)


def test_manual_redirect_rejects_http_and_closes_without_draining(
    monkeypatch,
):
    from replay_perception import observer_download

    redirect = FakeResponse(
        302,
        payload=b"body that must never be drained",
        location="http://example.invalid/weights.bin",
    )
    opener = FakeOpener(redirect)
    monkeypatch.setattr(
        observer_download, "_build_https_opener", lambda: opener
    )

    with pytest.raises(
        HTTPError, match="OBSERVER_MODEL_REDIRECT_SCHEME_INVALID"
    ):
        observer_download._stream_entry(_entry(b"weights"), io.BytesIO())

    assert redirect.closed is True
    assert redirect.read_calls == 0
    assert len(opener.requests) == 1


def test_manual_redirect_allows_https_cdn_and_closes_redirect_without_draining(
    monkeypatch,
):
    from replay_perception import observer_download

    payload = b"weights"
    redirect = FakeResponse(
        302,
        payload=b"redirect body that must never be drained",
        location="https://cdn-lfs.huggingface.co/approved/weights.bin",
    )
    final = FakeResponse(200, payload=payload)
    opener = FakeOpener(redirect, final)
    monkeypatch.setattr(
        observer_download, "_build_https_opener", lambda: opener
    )
    output = io.BytesIO()

    observer_download._stream_entry(_entry(payload), output)

    assert output.getvalue() == payload
    assert redirect.closed is True
    assert redirect.read_calls == 0
    assert final.closed is True
    assert opener.requests == [
        (
            "https://huggingface.co/approved/model/resolve/revision/weights.bin",
            observer_download.READ_TIMEOUT_SECONDS,
        ),
        (
            "https://cdn-lfs.huggingface.co/approved/weights.bin",
            observer_download.READ_TIMEOUT_SECONDS,
        ),
    ]


def test_wrapped_url_timeout_has_stable_download_timeout_code(monkeypatch):
    from replay_perception import observer_download

    class TimedOutOpener:
        def open(self, _request, *, timeout):
            assert timeout == observer_download.READ_TIMEOUT_SECONDS
            raise URLError(TimeoutError("socket timed out"))

    monkeypatch.setattr(
        observer_download,
        "_build_https_opener",
        lambda: TimedOutOpener(),
    )

    with pytest.raises(
        TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT: weights.bin"
    ):
        observer_download._stream_entry(_entry(b"weights"), io.BytesIO())


def test_bounded_communicate_kills_and_waits_for_a_blocking_child():
    from replay_perception import observer_download

    process = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    started = time.monotonic()

    with pytest.raises(
        TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT: weights.bin"
    ):
        observer_download._communicate_bounded(
            process, timeout_seconds=0.05, filename="weights.bin"
        )

    assert process.poll() is not None
    assert time.monotonic() - started < 5


def test_parent_launches_only_the_fixed_local_downloader_module(monkeypatch):
    from replay_perception import observer_download

    observed = {}

    class CompletedProcess:
        returncode = 0

        def communicate(self, *, timeout):
            observed["timeout"] = timeout
            return "", ""

        def kill(self):
            raise AssertionError("completed process must not be killed")

    def fake_popen(command, **kwargs):
        observed.update(command=command, kwargs=kwargs)
        return CompletedProcess()

    monkeypatch.setattr(observer_download.subprocess, "Popen", fake_popen)

    observer_download.run_bounded_observer_download(
        "role",
        "yolo-football-player-detection.pt",
        descriptor=17,
        timeout_seconds=12.5,
    )

    assert observed["command"] == [
        sys.executable,
        "-m",
        "replay_perception.observer_download",
        "_child",
        "role",
        "yolo-football-player-detection.pt",
        "17",
    ]
    assert observed["kwargs"]["pass_fds"] == (17,)
    assert observed["kwargs"]["close_fds"] is True
    assert observed["timeout"] == pytest.approx(12.5)
    assert not any(
        part.startswith("http") for part in observed["command"]
    )
