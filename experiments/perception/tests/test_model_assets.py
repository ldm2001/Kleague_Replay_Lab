import hashlib
import io
import ssl
from pathlib import Path

import pytest


REVISION = "ac77a11ff0170a41b771c03264987f8ce2b0d753"


def _entry(name: str, payload: bytes, *, required: bool = True) -> dict[str, object]:
    return {
        "name": name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
        "required": required,
        "url": (
            "https://huggingface.co/PekingU/rtdetr_r18vd/resolve/"
            f"{REVISION}/{name}"
        ),
    }


def _manifest(*entries: dict[str, object]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "model_id": "PekingU/rtdetr_r18vd",
        "revision": REVISION,
        "license": "Apache-2.0",
        "architecture": "RTDetrForObjectDetection",
        "disable_custom_kernels": True,
        "threshold": 0.30,
        "labels": ["person", "sports ball"],
        "preprocessing": {
            "do_normalize": False,
            "do_rescale": True,
            "rescale_factor": 1 / 255,
            "size": {"height": 640, "width": 640},
        },
        "files": list(entries),
    }


class FakeResponse:
    def __init__(self, payload: bytes, *, content_length: int | None = None):
        self._stream = io.BytesIO(payload)
        self.headers = {}
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, amount: int) -> bytes:
        return self._stream.read(amount)


def test_packaged_manifest_pins_only_the_approved_model_assets():
    from replay_perception.model_assets import load_manifest

    manifest = load_manifest()
    assert manifest["model_id"] == "PekingU/rtdetr_r18vd"
    assert manifest["revision"] == REVISION
    assert manifest["architecture"] == "RTDetrForObjectDetection"
    assert manifest["disable_custom_kernels"] is True
    assert manifest["threshold"] == pytest.approx(0.30)
    assert manifest["labels"] == ["person", "sports ball"]
    assert manifest["preprocessing"] == {
        "do_normalize": False,
        "do_rescale": True,
        "rescale_factor": pytest.approx(1 / 255),
        "size": {"height": 640, "width": 640},
    }

    files = {entry["name"]: entry for entry in manifest["files"]}
    assert files == {
        "config.json": {
            "name": "config.json",
            "sha256": "8493be71f51a1c0a741f8f71ec151039227579379de7bcba047c0470d9320c3c",
            "size": 5267,
            "required": True,
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/config.json",
        },
        "preprocessor_config.json": {
            "name": "preprocessor_config.json",
            "sha256": "ffb4b9461a1dad746be8f0f9c8330ed7743a1ba5fba4f75c232cd281b3d4c64a",
            "size": 841,
            "required": True,
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/preprocessor_config.json",
        },
        "model.safetensors": {
            "name": "model.safetensors",
            "sha256": "fe87a5a30f5daf298d10794c7682a63b6107986f97d6a770ba948d89e4340093",
            "size": 80904152,
            "required": True,
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/model.safetensors",
        },
        "README.md": {
            "name": "README.md",
            "sha256": "0d6d6065595011f4897e724f11d2b86494764eba68e3514cc6c70f0a851e539e",
            "size": 9102,
            "required": False,
            "url": f"https://huggingface.co/PekingU/rtdetr_r18vd/resolve/{REVISION}/README.md",
        },
    }


def test_default_model_dir_is_outside_the_repository(monkeypatch, tmp_path):
    from replay_perception.model_assets import default_model_dir

    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))
    assert default_model_dir() == (
        tmp_path / ".cache" / "replay-lab" / "models" / "rtdetr_r18vd" / REVISION
    )


def test_missing_model_file_has_a_stable_failure_code(tmp_path):
    from replay_perception.model_assets import verify_file

    with pytest.raises(FileNotFoundError, match="MODEL_FILE_MISSING"):
        verify_file(tmp_path / "model.safetensors", "0" * 64)


def test_tampered_model_is_rejected(tmp_path):
    from replay_perception.model_assets import verify_file

    path = tmp_path / "model.safetensors"
    path.write_bytes(b"tampered")
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        verify_file(path, "0" * 64)


def test_valid_model_file_is_accepted(tmp_path):
    from replay_perception.model_assets import verify_file

    payload = b"verified local bytes"
    path = tmp_path / "config.json"
    path.write_bytes(payload)
    assert verify_file(path, hashlib.sha256(payload).hexdigest()) is None


def test_verify_model_assets_requires_all_required_files_and_reports_provenance(
    monkeypatch, tmp_path
):
    from replay_perception import model_assets

    first = b"config"
    second = b"weights"
    manifest = _manifest(_entry("config.json", first), _entry("model.safetensors", second))
    monkeypatch.setattr(model_assets, "load_manifest", lambda: manifest)
    (tmp_path / "config.json").write_bytes(first)
    (tmp_path / "model.safetensors").write_bytes(second)

    metadata = model_assets.verify_model_assets(tmp_path)
    assert metadata["manifest_version"] == 1
    assert metadata["model_id"] == "PekingU/rtdetr_r18vd"
    assert metadata["revision"] == REVISION
    assert metadata["files"] == {
        "config.json": hashlib.sha256(first).hexdigest(),
        "model.safetensors": hashlib.sha256(second).hexdigest(),
    }
    assert metadata["threshold"] == pytest.approx(0.30)
    assert metadata["preprocessing"]["size"] == {"height": 640, "width": 640}


def test_optional_model_card_is_verified_when_present(monkeypatch, tmp_path):
    from replay_perception import model_assets

    required = b"config"
    optional = b"tampered card"
    manifest = _manifest(
        _entry("config.json", required),
        _entry("README.md", b"expected card", required=False),
    )
    monkeypatch.setattr(model_assets, "load_manifest", lambda: manifest)
    (tmp_path / "config.json").write_bytes(required)
    (tmp_path / "README.md").write_bytes(optional)

    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        model_assets.verify_model_assets(tmp_path)


def test_download_reuses_a_verified_existing_file_without_network(monkeypatch, tmp_path):
    from replay_perception import model_assets

    payload = b"already downloaded"
    manifest = _manifest(_entry("config.json", payload))
    monkeypatch.setattr(model_assets, "load_manifest", lambda: manifest)
    path = tmp_path / "config.json"
    path.write_bytes(payload)

    def network_must_not_run(*_args, **_kwargs):
        raise AssertionError("verified cached assets must not use the network")

    monkeypatch.setattr(model_assets, "_urlopen", network_must_not_run)
    metadata = model_assets.download_model(tmp_path)
    assert path.read_bytes() == payload
    assert metadata["files"]["config.json"] == hashlib.sha256(payload).hexdigest()


def test_download_rejects_an_invalid_existing_file_without_replacing_it(
    monkeypatch, tmp_path
):
    from replay_perception import model_assets

    expected = b"expected"
    path = tmp_path / "config.json"
    path.write_bytes(b"user cache content")
    monkeypatch.setattr(model_assets, "load_manifest", lambda: _manifest(_entry("config.json", expected)))

    def network_must_not_run(*_args, **_kwargs):
        raise AssertionError("invalid cached assets must not be replaced")

    monkeypatch.setattr(model_assets, "_urlopen", network_must_not_run)
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        model_assets.download_model(tmp_path)
    assert path.read_bytes() == b"user cache content"


@pytest.mark.parametrize("git_marker_kind", ["directory", "file"])
def test_download_rejects_repository_ancestor_before_mkdir_or_network(
    monkeypatch, tmp_path, git_marker_kind
):
    from replay_perception import model_assets

    repository = tmp_path / "repository"
    repository.mkdir()
    marker = repository / ".git"
    if git_marker_kind == "directory":
        marker.mkdir()
    else:
        marker.write_text("gitdir: ../metadata/worktrees/test\n", encoding="utf-8")
    target = repository / "nested" / "model-cache"
    network_calls = []
    monkeypatch.setattr(
        model_assets,
        "load_manifest",
        lambda: _manifest(_entry("config.json", b"expected")),
    )
    monkeypatch.setattr(
        model_assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    with pytest.raises(ValueError, match="MODEL_PATH_IN_REPOSITORY"):
        model_assets.download_model(target)

    assert not target.exists()
    assert network_calls == []


def test_download_rejects_symlink_that_resolves_inside_a_repository(
    monkeypatch, tmp_path
):
    from replay_perception import model_assets

    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / ".git").mkdir()
    alias = tmp_path / "outside-looking-alias"
    alias.symlink_to(repository, target_is_directory=True)
    target = alias / "nested" / "model-cache"
    network_calls = []
    monkeypatch.setattr(
        model_assets,
        "load_manifest",
        lambda: _manifest(_entry("config.json", b"expected")),
    )
    monkeypatch.setattr(
        model_assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    with pytest.raises(ValueError, match="MODEL_PATH_IN_REPOSITORY"):
        model_assets.download_model(target)

    assert not target.resolve().exists()
    assert network_calls == []


def test_verification_rejects_assets_located_inside_a_repository(
    monkeypatch, tmp_path
):
    from replay_perception import model_assets

    repository = tmp_path / "repository"
    model_dir = repository / "model-cache"
    model_dir.mkdir(parents=True)
    (repository / ".git").mkdir()
    payload = b"verified bytes"
    (model_dir / "config.json").write_bytes(payload)
    monkeypatch.setattr(
        model_assets,
        "load_manifest",
        lambda: _manifest(_entry("config.json", payload)),
    )

    with pytest.raises(ValueError, match="MODEL_PATH_IN_REPOSITORY"):
        model_assets.verify_model_assets(model_dir)


def test_download_uses_verified_tls_timeout_and_fixed_url(monkeypatch, tmp_path):
    from replay_perception import model_assets

    payload = b"downloaded"
    entry = _entry("config.json", payload)
    monkeypatch.setattr(model_assets, "load_manifest", lambda: _manifest(entry))
    observed = {}

    def fake_urlopen(request, *, timeout, context):
        observed.update(url=request.full_url, timeout=timeout, context=context)
        return FakeResponse(payload, content_length=len(payload))

    monkeypatch.setattr(model_assets, "_urlopen", fake_urlopen)
    model_assets.download_model(tmp_path)

    assert observed["url"] == entry["url"]
    assert 0 < observed["timeout"] <= 60
    assert observed["context"].verify_mode == ssl.CERT_REQUIRED
    assert observed["context"].check_hostname is True
    assert (tmp_path / "config.json").read_bytes() == payload
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_rejects_declared_or_streamed_oversize_and_cleans_temp_files(
    monkeypatch, tmp_path
):
    from replay_perception import model_assets

    expected = b"small"
    entry = _entry("config.json", expected)
    monkeypatch.setattr(model_assets, "load_manifest", lambda: _manifest(entry))

    monkeypatch.setattr(
        model_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(expected + b"x", content_length=len(expected) + 1),
    )
    with pytest.raises(ValueError, match="MODEL_SIZE_MISMATCH"):
        model_assets.download_model(tmp_path)
    assert not (tmp_path / "config.json").exists()
    assert not list(tmp_path.glob(".*.download-*"))

    monkeypatch.setattr(
        model_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(expected + b"x"),
    )
    with pytest.raises(ValueError, match="MODEL_SIZE_MISMATCH"):
        model_assets.download_model(tmp_path)
    assert not (tmp_path / "config.json").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_timeout_leaves_no_partial_or_published_file(monkeypatch, tmp_path):
    from replay_perception import model_assets

    expected = b"payload"
    monkeypatch.setattr(model_assets, "load_manifest", lambda: _manifest(_entry("config.json", expected)))

    class TimedOutResponse(FakeResponse):
        def read(self, _amount):
            raise TimeoutError("network stalled")

    monkeypatch.setattr(
        model_assets,
        "_urlopen",
        lambda *_args, **_kwargs: TimedOutResponse(expected, content_length=len(expected)),
    )
    with pytest.raises(TimeoutError, match="MODEL_DOWNLOAD_TIMEOUT"):
        model_assets.download_model(tmp_path)
    assert not (tmp_path / "config.json").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_atomic_publication_never_clobbers_a_racing_cache_writer(
    monkeypatch, tmp_path
):
    from replay_perception import model_assets

    downloaded = b"downloaded"
    competing = b"other writer"
    monkeypatch.setattr(model_assets, "load_manifest", lambda: _manifest(_entry("config.json", downloaded)))
    monkeypatch.setattr(
        model_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(downloaded, content_length=len(downloaded)),
    )

    def racing_link(_source, destination):
        Path(destination).write_bytes(competing)
        raise FileExistsError(destination)

    monkeypatch.setattr(model_assets.os, "link", racing_link)
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        model_assets.download_model(tmp_path)
    assert (tmp_path / "config.json").read_bytes() == competing
    assert not list(tmp_path.glob(".*.download-*"))
