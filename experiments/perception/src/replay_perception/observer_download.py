from __future__ import annotations

import argparse
import hashlib
import math
import os
import ssl
import subprocess
import sys
from pathlib import Path
from typing import Any, BinaryIO, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

import certifi


READ_TIMEOUT_SECONDS = 30
CHUNK_SIZE = 1024 * 1024
MAX_REDIRECTS = 5
_REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})


class _ReturnRedirectResponse(HTTPRedirectHandler):
    def _return_response(
        self,
        _request: Request,
        response: Any,
        _code: int,
        _message: str,
        _headers: Any,
    ) -> Any:
        return response

    http_error_301 = _return_response
    http_error_302 = _return_response
    http_error_303 = _return_response
    http_error_307 = _return_response
    http_error_308 = _return_response


def _build_https_opener() -> Any:
    context = ssl.create_default_context(cafile=certifi.where())
    return build_opener(
        HTTPSHandler(context=context),
        _ReturnRedirectResponse(),
    )


def _stream_entry(entry: dict[str, Any], output: BinaryIO) -> None:
    filename = entry["name"]
    current_url = entry["url"]
    _require_safe_https_url(current_url, filename)
    opener = _build_https_opener()

    for redirect_count in range(MAX_REDIRECTS + 1):
        request = Request(
            current_url,
            headers={"User-Agent": "Replay-Lab-Perception/0.1"},
            method="GET",
        )
        try:
            response = opener.open(request, timeout=READ_TIMEOUT_SECONDS)
        except URLError as exc:
            _raise_normalized_url_error(exc, filename)

        try:
            status = _response_status(response)
            if status in _REDIRECT_CODES:
                if redirect_count >= MAX_REDIRECTS:
                    raise HTTPError(
                        current_url,
                        status,
                        f"OBSERVER_MODEL_REDIRECT_LIMIT: {filename}",
                        response.headers,
                        response,
                    )
                location = response.headers.get("Location")
                if not isinstance(location, str) or not location:
                    raise HTTPError(
                        current_url,
                        status,
                        f"OBSERVER_MODEL_REDIRECT_INVALID: {filename}",
                        response.headers,
                        response,
                    )
                next_url = urljoin(current_url, location)
                _require_safe_https_url(next_url, filename, status=status)
                current_url = next_url
                continue

            if status != 200:
                raise HTTPError(
                    current_url,
                    status,
                    f"OBSERVER_MODEL_HTTP_STATUS_INVALID: {filename}",
                    response.headers,
                    response,
                )
            _stream_response(response, entry, output)
            return
        finally:
            response.close()

    raise AssertionError("unreachable redirect loop")


def _stream_response(
    response: Any, entry: dict[str, Any], output: BinaryIO
) -> None:
    filename = entry["name"]
    declared_size = response.headers.get("Content-Length")
    if declared_size is not None:
        try:
            parsed_size = int(declared_size)
        except (TypeError, ValueError) as exc:
            raise ValueError(
                f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
            ) from exc
        if parsed_size != entry["size"]:
            raise ValueError(f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}")

    digest = hashlib.sha256()
    received = 0
    read_available = getattr(response, "read1", response.read)
    while True:
        try:
            chunk = read_available(CHUNK_SIZE)
        except TimeoutError as exc:
            raise TimeoutError(
                f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {filename}"
            ) from exc
        if not chunk:
            break
        received += len(chunk)
        if received > entry["size"]:
            raise ValueError(f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}")
        digest.update(chunk)
        output.write(chunk)

    if received != entry["size"]:
        raise ValueError(f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}")
    if digest.hexdigest() != entry["sha256"]:
        raise ValueError(f"OBSERVER_MODEL_HASH_MISMATCH: {filename}")


def _response_status(response: Any) -> int:
    status = getattr(response, "status", None)
    if status is None:
        status = response.getcode()
    return int(status)


def _require_safe_https_url(
    url: str, filename: str, *, status: int = 302
) -> None:
    parsed = urlsplit(url)
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise HTTPError(
            url,
            status,
            f"OBSERVER_MODEL_REDIRECT_SCHEME_INVALID: {filename}",
            {},
            None,
        )


def _raise_normalized_url_error(exc: URLError, filename: str) -> None:
    if isinstance(exc.reason, TimeoutError):
        raise TimeoutError(
            f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {filename}"
        ) from exc
    raise RuntimeError(f"OBSERVER_MODEL_DOWNLOAD_FAILED: {filename}") from exc


def _approved_entry(model_key: str, filename: str) -> dict[str, Any]:
    from .observer_assets import _manifest_model

    model = _manifest_model(model_key)
    for entry in model["files"]:
        if entry["name"] == filename:
            return entry
    raise ValueError(f"OBSERVER_MODEL_FILE_INVALID: {filename}")


def _communicate_bounded(
    process: subprocess.Popen[str], *, timeout_seconds: float, filename: str
) -> tuple[str, str]:
    try:
        return process.communicate(timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        process.kill()
        process.communicate()
        raise TimeoutError(
            f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {filename}"
        ) from exc


def run_bounded_observer_download(
    model_key: str,
    filename: str,
    descriptor: int,
    timeout_seconds: float,
) -> None:
    _approved_entry(model_key, filename)
    if (
        not isinstance(descriptor, int)
        or isinstance(descriptor, bool)
        or descriptor < 0
    ):
        raise ValueError("OBSERVER_MODEL_DOWNLOAD_DESCRIPTOR_INVALID")
    if (
        not isinstance(timeout_seconds, (int, float))
        or isinstance(timeout_seconds, bool)
        or not math.isfinite(timeout_seconds)
        or timeout_seconds <= 0
    ):
        raise ValueError("OBSERVER_MODEL_DOWNLOAD_TIMEOUT_INVALID")

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "replay_perception.observer_download",
            "_child",
            model_key,
            filename,
            str(descriptor),
        ],
        pass_fds=(descriptor,),
        close_fds=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    _stdout, stderr = _communicate_bounded(
        process,
        timeout_seconds=float(timeout_seconds),
        filename=filename,
    )
    if process.returncode == 0:
        return

    message = stderr.strip()
    if "OBSERVER_MODEL_DOWNLOAD_TIMEOUT" in message:
        raise TimeoutError(f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {filename}")
    if "OBSERVER_MODEL_SIZE_MISMATCH" in message:
        raise ValueError(f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}")
    if "OBSERVER_MODEL_HASH_MISMATCH" in message:
        raise ValueError(f"OBSERVER_MODEL_HASH_MISMATCH: {filename}")
    if "OBSERVER_MODEL_REDIRECT_" in message:
        raise ValueError(message)
    raise RuntimeError(f"OBSERVER_MODEL_DOWNLOAD_FAILED: {filename}")


def _child_main(model_key: str, filename: str, descriptor_text: str) -> int:
    try:
        descriptor = int(descriptor_text)
        if descriptor < 0:
            raise ValueError("OBSERVER_MODEL_DOWNLOAD_DESCRIPTOR_INVALID")
        entry = _approved_entry(model_key, filename)
        with os.fdopen(descriptor, "wb") as output:
            _stream_entry(entry, output)
            output.flush()
            os.fsync(output.fileno())
        return 0
    except BaseException as exc:
        if isinstance(exc, KeyboardInterrupt):
            raise
        print(str(exc), file=sys.stderr)
        return 1


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("mode", choices=("_child",))
    parser.add_argument("model_key", choices=("role", "pose"))
    parser.add_argument("filename")
    parser.add_argument("descriptor")
    arguments = parser.parse_args(argv)
    return _child_main(
        arguments.model_key,
        arguments.filename,
        arguments.descriptor,
    )


if __name__ == "__main__":
    raise SystemExit(main())
