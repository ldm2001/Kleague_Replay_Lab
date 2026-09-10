from __future__ import annotations

import hashlib
import json
import os
import ssl
import tempfile
from copy import deepcopy
from importlib import resources
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen as _stdlib_urlopen

import certifi


MODEL_ID = "PekingU/rtdetr_r18vd"
MODEL_SLUG = "rtdetr_r18vd"
MODEL_REVISION = "ac77a11ff0170a41b771c03264987f8ce2b0d753"
MODEL_HOST = "https://huggingface.co"
READ_TIMEOUT_SECONDS = 30
CHUNK_SIZE = 1024 * 1024
_APPROVED_FILENAMES = frozenset(
    {"config.json", "preprocessor_config.json", "model.safetensors", "README.md"}
)
_urlopen = _stdlib_urlopen


def load_manifest() -> dict[str, Any]:
    manifest_path = resources.files("replay_perception").joinpath("model-manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _validate_manifest(manifest)
    return manifest


def default_model_dir() -> Path:
    return (
        Path.home()
        / ".cache"
        / "replay-lab"
        / "models"
        / MODEL_SLUG
        / MODEL_REVISION
    )


def verify_file(path: Path | str, sha256: str) -> None:
    candidate = Path(path)
    if not candidate.is_file():
        raise FileNotFoundError(f"MODEL_FILE_MISSING: {candidate.name}")

    digest = hashlib.sha256()
    with candidate.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    if digest.hexdigest() != sha256:
        raise ValueError(f"MODEL_HASH_MISMATCH: {candidate.name}")


def verify_model_assets(model_dir: Path | str) -> dict[str, Any]:
    directory = _external_model_dir(model_dir)
    manifest = load_manifest()
    verified: dict[str, str] = {}
    for entry in manifest["files"]:
        path = directory / entry["name"]
        if not entry["required"] and not path.exists():
            continue
        verify_file(path, entry["sha256"])
        if path.stat().st_size != entry["size"]:
            raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")
        verified[entry["name"]] = entry["sha256"]
    return _metadata(manifest, verified)


def download_model(model_dir: Path | str) -> dict[str, Any]:
    directory = _external_model_dir(model_dir)
    directory.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()

    for entry in manifest["files"]:
        destination = directory / entry["name"]
        if destination.exists():
            _verify_entry(destination, entry)
            continue
        _download_entry(destination, entry)

    return verify_model_assets(directory)


def _download_entry(destination: Path, entry: dict[str, Any]) -> None:
    expected_size = entry["size"]
    context = ssl.create_default_context(cafile=certifi.where())
    request = Request(
        entry["url"],
        headers={"User-Agent": "Replay-Lab-Perception/0.1"},
        method="GET",
    )
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.download-",
    )
    temporary = Path(temporary_name)
    try:
        try:
            with _urlopen(
                request,
                timeout=READ_TIMEOUT_SECONDS,
                context=context,
            ) as response:
                declared_size = response.headers.get("Content-Length")
                if declared_size is not None:
                    try:
                        parsed_size = int(declared_size)
                    except (TypeError, ValueError) as exc:
                        raise ValueError(
                            f"MODEL_SIZE_MISMATCH: {entry['name']}"
                        ) from exc
                    if parsed_size != expected_size:
                        raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")

                digest = hashlib.sha256()
                received = 0
                with os.fdopen(descriptor, "wb") as output:
                    descriptor = -1
                    while True:
                        try:
                            chunk = response.read(CHUNK_SIZE)
                        except TimeoutError as exc:
                            raise TimeoutError(
                                f"MODEL_DOWNLOAD_TIMEOUT: {entry['name']}"
                            ) from exc
                        if not chunk:
                            break
                        received += len(chunk)
                        if received > expected_size:
                            raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")
                        digest.update(chunk)
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())

                if received != expected_size:
                    raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")
                if digest.hexdigest() != entry["sha256"]:
                    raise ValueError(f"MODEL_HASH_MISMATCH: {entry['name']}")
        except TimeoutError as exc:
            if "MODEL_DOWNLOAD_TIMEOUT" in str(exc):
                raise
            raise TimeoutError(f"MODEL_DOWNLOAD_TIMEOUT: {entry['name']}") from exc

        try:
            os.link(temporary, destination)
        except FileExistsError:
            _verify_entry(destination, entry)
        else:
            _verify_entry(destination, entry)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        temporary.unlink(missing_ok=True)


def _verify_entry(path: Path, entry: dict[str, Any]) -> None:
    verify_file(path, entry["sha256"])
    if path.stat().st_size != entry["size"]:
        raise ValueError(f"MODEL_SIZE_MISMATCH: {entry['name']}")


def _external_model_dir(model_dir: Path | str) -> Path:
    directory = Path(model_dir).expanduser().resolve(strict=False)
    for ancestor in (directory, *directory.parents):
        git_marker = ancestor / ".git"
        if git_marker.is_file() or git_marker.is_dir():
            raise ValueError(f"MODEL_PATH_IN_REPOSITORY: {directory}")
    return directory


def _metadata(manifest: dict[str, Any], files: dict[str, str]) -> dict[str, Any]:
    return {
        "manifest_version": manifest["schema_version"],
        "model_id": manifest["model_id"],
        "revision": manifest["revision"],
        "license": manifest["license"],
        "architecture": manifest["architecture"],
        "disable_custom_kernels": manifest["disable_custom_kernels"],
        "files": dict(files),
        "threshold": manifest["threshold"],
        "labels": list(manifest["labels"]),
        "preprocessing": deepcopy(manifest["preprocessing"]),
    }


def _validate_manifest(manifest: dict[str, Any]) -> None:
    if (
        manifest.get("schema_version") != 1
        or manifest.get("model_id") != MODEL_ID
        or manifest.get("revision") != MODEL_REVISION
        or manifest.get("architecture") != "RTDetrForObjectDetection"
        or manifest.get("disable_custom_kernels") is not True
        or manifest.get("labels") != ["person", "sports ball"]
        or manifest.get("threshold") != 0.30
    ):
        raise ValueError("MODEL_MANIFEST_INVALID")

    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("MODEL_MANIFEST_INVALID")
    seen: set[str] = set()
    prefix = f"{MODEL_HOST}/{MODEL_ID}/resolve/{MODEL_REVISION}/"
    for entry in entries:
        name = entry.get("name")
        if name not in _APPROVED_FILENAMES or name in seen:
            raise ValueError("MODEL_MANIFEST_INVALID")
        seen.add(name)
        if (
            entry.get("url") != prefix + name
            or not isinstance(entry.get("sha256"), str)
            or len(entry["sha256"]) != 64
            or not isinstance(entry.get("size"), int)
            or isinstance(entry["size"], bool)
            or entry["size"] <= 0
            or not isinstance(entry.get("required"), bool)
        ):
            raise ValueError("MODEL_MANIFEST_INVALID")
