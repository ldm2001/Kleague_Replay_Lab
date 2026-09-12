from __future__ import annotations

import hashlib
import json
import os
import tempfile
import time
from copy import deepcopy
from importlib import resources
from pathlib import Path
from typing import Any

from .observer_download import run_bounded_observer_download


_ROLE_REVISION = "5e83fafa8d564243001ce8e063612a618a138fbe"
_POSE_REVISION = "0c30b6534bb621af0162b481176742577264e36e"
_COCO_KEYPOINTS = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]
_APPROVED_MODELS: dict[str, dict[str, Any]] = {
    "role": {
        "model_id": "martinjolif/yolo-football-player-detection",
        "slug": "yolo11m_football",
        "revision": _ROLE_REVISION,
        "license": "AGPL-3.0",
        "architecture": "YOLO11m",
        "labels": ["ball", "goalkeeper", "player", "referee"],
        "files": [
            {
                "name": "yolo-football-player-detection.pt",
                "size": 40583084,
                "sha256": "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd",
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{_ROLE_REVISION}/yolo-football-player-detection.pt"
                ),
            },
            {
                "name": "README.md",
                "size": 2537,
                "sha256": "446b7be35352183834b72eda7e197485a3da660e77a2013409a0e91fe00efb92",
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{_ROLE_REVISION}/README.md"
                ),
            },
        ],
    },
    "pose": {
        "model_id": "usyd-community/vitpose-plus-small",
        "slug": "vitpose_plus_small",
        "revision": _POSE_REVISION,
        "license": "Apache-2.0",
        "architecture": "VitPoseForPoseEstimation",
        "keypoints": _COCO_KEYPOINTS,
        "files": [
            {
                "name": "model.safetensors",
                "size": 132619932,
                "sha256": "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9",
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/model.safetensors"
                ),
            },
            {
                "name": "config.json",
                "size": 1846,
                "sha256": "9a81cb593c0af3c5a7e07bb4ffb4643d6a8163f73b4373d294b4a4997c8abe81",
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/config.json"
                ),
            },
            {
                "name": "preprocessor_config.json",
                "size": 363,
                "sha256": "9b11cadc98c30b968a70cc1658ce1fbd74b721b0f21402a2ff8bc1dc9d1474a0",
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/preprocessor_config.json"
                ),
            },
            {
                "name": "README.md",
                "size": 11656,
                "sha256": "0f83999d99d35f74969ff14d33c29fe9657888d92f532baff8339ba1a486f834",
                "url": (
                    "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                    f"{_POSE_REVISION}/README.md"
                ),
            },
        ],
    },
}
CHUNK_SIZE = 1024 * 1024
READ_TIMEOUT_SECONDS = 30
MAX_DOWNLOAD_SECONDS = 30 * 60


def load_observer_manifest() -> dict[str, Any]:
    manifest_path = resources.files("replay_perception").joinpath(
        "observer-models.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    _validate_manifest(manifest)
    return manifest


def default_observer_model_dir(model_key: str) -> Path:
    model = _approved_model(model_key)
    return (
        Path.home()
        / ".cache"
        / "replay-lab"
        / "models"
        / model["slug"]
        / model["revision"]
    )


def verify_observer_assets(
    model_key: str, directory: Path | str
) -> dict[str, Any]:
    _approved_model(model_key)
    model = _manifest_model(model_key)
    model_dir = _external_model_dir(directory)
    verified: dict[str, str] = {}
    for entry in model["files"]:
        path = model_dir / entry["name"]
        _verify_entry(path, entry)
        verified[entry["name"]] = entry["sha256"]
    return _provenance(model_key, model, verified)


def download_observer_assets(
    model_key: str, directory: Path | str
) -> dict[str, Any]:
    _approved_model(model_key)
    model = _manifest_model(model_key)
    model_dir = _external_model_dir(directory)
    model_dir.mkdir(parents=True, exist_ok=True)
    model_dir = _external_model_dir(model_dir)

    for entry in model["files"]:
        destination = model_dir / entry["name"]
        _reject_repository_path(destination)
        if destination.exists() or destination.is_symlink():
            _verify_entry(destination, entry)
            continue
        _download_entry(destination, model_key, entry)

    return verify_observer_assets(model_key, model_dir)


def _approved_model(model_key: str) -> dict[str, Any]:
    try:
        return _APPROVED_MODELS[model_key]
    except (KeyError, TypeError) as exc:
        raise ValueError(f"OBSERVER_MODEL_KEY_INVALID: {model_key!r}") from exc


def _validate_manifest(manifest: dict[str, Any]) -> None:
    expected = {"schema_version": 1, "models": _APPROVED_MODELS}
    if manifest != expected:
        raise ValueError("OBSERVER_MODEL_MANIFEST_INVALID")


def _manifest_model(model_key: str) -> dict[str, Any]:
    manifest = load_observer_manifest()
    _approved_model(model_key)
    return deepcopy(manifest["models"][model_key])


def _verify_entry(path: Path, entry: dict[str, Any]) -> None:
    _reject_repository_path(path)
    if not path.is_file():
        raise FileNotFoundError(
            f"OBSERVER_MODEL_FILE_MISSING: {entry['name']}"
        )

    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    if digest.hexdigest() != entry["sha256"]:
        raise ValueError(
            f"OBSERVER_MODEL_HASH_MISMATCH: {entry['name']}"
        )
    if path.stat().st_size != entry["size"]:
        raise ValueError(
            f"OBSERVER_MODEL_SIZE_MISMATCH: {entry['name']}"
        )


def _download_entry(
    destination: Path, model_key: str, entry: dict[str, Any]
) -> None:
    _reject_repository_path(destination)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.download-",
    )
    temporary = Path(temporary_name)
    started = time.monotonic()
    try:
        run_bounded_observer_download(
            model_key,
            entry["name"],
            descriptor,
            _download_time_remaining(started, entry),
        )
        os.close(descriptor)
        descriptor = -1
        _verify_entry(temporary, entry)

        _raise_if_download_deadline_exceeded(started, entry)
        _reject_repository_path(destination)
        _raise_if_download_deadline_exceeded(started, entry)
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


def _download_time_remaining(
    started: float, entry: dict[str, Any]
) -> float:
    remaining = MAX_DOWNLOAD_SECONDS - (time.monotonic() - started)
    if remaining <= 0:
        raise TimeoutError(
            f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {entry['name']}"
        )
    return remaining


def _raise_if_download_deadline_exceeded(
    started: float, entry: dict[str, Any]
) -> None:
    _download_time_remaining(started, entry)


def _external_model_dir(directory: Path | str) -> Path:
    expanded = Path(directory).expanduser()
    lexical = Path(os.path.abspath(os.fspath(expanded)))
    resolved = lexical.resolve(strict=False)
    _reject_git_ancestor(lexical)
    _reject_git_ancestor(resolved)
    return resolved


def _reject_repository_path(path: Path) -> None:
    lexical = Path(os.path.abspath(os.fspath(path)))
    resolved = lexical.resolve(strict=False)
    _reject_git_ancestor(lexical)
    _reject_git_ancestor(resolved)


def _reject_git_ancestor(path: Path) -> None:
    for ancestor in (path, *path.parents):
        marker = ancestor / ".git"
        if marker.is_file() or marker.is_dir() or marker.is_symlink():
            raise ValueError(f"OBSERVER_MODEL_PATH_IN_REPOSITORY: {path}")


def _provenance(
    model_key: str, model: dict[str, Any], files: dict[str, str]
) -> dict[str, Any]:
    result = {
        "manifest_version": 1,
        "model_key": model_key,
        "model_id": model["model_id"],
        "revision": model["revision"],
        "license": model["license"],
        "architecture": model["architecture"],
        "files": dict(files),
    }
    if model_key == "role":
        result["labels"] = list(model["labels"])
    else:
        result["keypoints"] = list(model["keypoints"])
    return result
