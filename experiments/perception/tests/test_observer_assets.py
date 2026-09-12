import hashlib
import io
import json
import ssl
from copy import deepcopy
from pathlib import Path
from urllib.request import Request

import pytest


ROLE_REVISION = "5e83fafa8d564243001ce8e063612a618a138fbe"
POSE_REVISION = "0c30b6534bb621af0162b481176742577264e36e"


class FakeResponse:
    def __init__(self, payload: bytes, *, content_length: object = None):
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

    def read1(self, amount: int) -> bytes:
        return self.read(amount)


@pytest.fixture(autouse=True)
def _replace_bounded_child_with_controlled_transport(monkeypatch):
    from replay_perception import observer_assets

    monkeypatch.setattr(observer_assets, "_urlopen", None, raising=False)

    def controlled_transfer(
        model_key, filename, descriptor, timeout_seconds
    ):
        model = observer_assets._manifest_model(model_key)
        entry = next(
            item for item in model["files"] if item["name"] == filename
        )
        if observer_assets._urlopen is None:
            raise AssertionError("test must provide controlled transport")
        context = ssl.create_default_context()
        request = Request(
            entry["url"],
            headers={"User-Agent": "Replay-Lab-Perception/0.1"},
            method="GET",
        )
        try:
            with observer_assets._urlopen(
                request,
                timeout=min(30, timeout_seconds),
                context=context,
            ) as response:
                declared_size = response.headers.get("Content-Length")
                if declared_size is not None:
                    try:
                        parsed_size = int(declared_size)
                    except (TypeError, ValueError) as exc:
                        raise ValueError(
                            f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                        ) from exc
                    if parsed_size != entry["size"]:
                        raise ValueError(
                            f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                        )

                digest = hashlib.sha256()
                received = 0
                read_available = getattr(response, "read1", response.read)
                while True:
                    chunk = read_available(1024 * 1024)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > entry["size"]:
                        raise ValueError(
                            f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                        )
                    digest.update(chunk)
                    observer_assets.os.write(descriptor, chunk)
                if received != entry["size"]:
                    raise ValueError(
                        f"OBSERVER_MODEL_SIZE_MISMATCH: {filename}"
                    )
                if digest.hexdigest() != entry["sha256"]:
                    raise ValueError(
                        f"OBSERVER_MODEL_HASH_MISMATCH: {filename}"
                    )
        except TimeoutError as exc:
            raise TimeoutError(
                f"OBSERVER_MODEL_DOWNLOAD_TIMEOUT: {filename}"
            ) from exc

    monkeypatch.setattr(
        observer_assets,
        "run_bounded_observer_download",
        controlled_transfer,
    )


def test_packaged_manifest_pins_only_the_two_approved_observer_models():
    from replay_perception.observer_assets import load_observer_manifest

    manifest = load_observer_manifest()

    assert manifest["schema_version"] == 1
    assert set(manifest["models"]) == {"role", "pose"}

    role = manifest["models"]["role"]
    assert role == {
        "model_id": "martinjolif/yolo-football-player-detection",
        "slug": "yolo11m_football",
        "revision": ROLE_REVISION,
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
                    f"{ROLE_REVISION}/yolo-football-player-detection.pt"
                ),
            },
            {
                "name": "README.md",
                "size": 2537,
                "sha256": "446b7be35352183834b72eda7e197485a3da660e77a2013409a0e91fe00efb92",
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{ROLE_REVISION}/README.md"
                ),
            },
        ],
    }

    pose = manifest["models"]["pose"]
    assert pose["model_id"] == "usyd-community/vitpose-plus-small"
    assert pose["slug"] == "vitpose_plus_small"
    assert pose["revision"] == POSE_REVISION
    assert pose["license"] == "Apache-2.0"
    assert pose["architecture"] == "VitPoseForPoseEstimation"
    assert pose["keypoints"] == [
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
    assert pose["files"] == [
        {
            "name": "model.safetensors",
            "size": 132619932,
            "sha256": "f7bad8ed09eeeb2a7de6b38faaa8a88d07838e23e9c06a2a782099bca7467cb9",
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/model.safetensors"
            ),
        },
        {
            "name": "config.json",
            "size": 1846,
            "sha256": "9a81cb593c0af3c5a7e07bb4ffb4643d6a8163f73b4373d294b4a4997c8abe81",
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/config.json"
            ),
        },
        {
            "name": "preprocessor_config.json",
            "size": 363,
            "sha256": "9b11cadc98c30b968a70cc1658ce1fbd74b721b0f21402a2ff8bc1dc9d1474a0",
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/preprocessor_config.json"
            ),
        },
        {
            "name": "README.md",
            "size": 11656,
            "sha256": "0f83999d99d35f74969ff14d33c29fe9657888d92f532baff8339ba1a486f834",
            "url": (
                "https://huggingface.co/usyd-community/vitpose-plus-small/resolve/"
                f"{POSE_REVISION}/README.md"
            ),
        },
    ]


@pytest.mark.parametrize(
    ("model_key", "slug", "revision"),
    [
        ("role", "yolo11m_football", ROLE_REVISION),
        ("pose", "vitpose_plus_small", POSE_REVISION),
    ],
)
def test_default_observer_model_dir_uses_the_external_cache(
    monkeypatch, tmp_path, model_key, slug, revision
):
    from replay_perception.observer_assets import default_observer_model_dir

    monkeypatch.setattr(Path, "home", classmethod(lambda _cls: tmp_path))

    assert default_observer_model_dir(model_key) == (
        tmp_path / ".cache" / "replay-lab" / "models" / slug / revision
    )


@pytest.mark.parametrize("model_key", ["", "roles", "ROLE", "rtdetr", None])
def test_unknown_observer_model_key_is_rejected(model_key):
    from replay_perception.observer_assets import default_observer_model_dir

    with pytest.raises(ValueError, match="OBSERVER_MODEL_KEY_INVALID"):
        default_observer_model_dir(model_key)


@pytest.mark.parametrize(
    ("model_key", "field", "replacement"),
    [
        ("role", "model_id", "other/role-model"),
        ("role", "revision", "0" * 40),
        ("role", "architecture", "ArbitraryDetector"),
        ("role", "labels", ["person", "referee"]),
        ("pose", "model_id", "other/pose-model"),
        ("pose", "revision", "f" * 40),
        ("pose", "architecture", "ArbitraryPoseModel"),
        ("pose", "keypoints", ["left_wrist"]),
    ],
)
def test_manifest_validation_rejects_unapproved_identity_or_vocabulary(
    model_key, field, replacement
):
    from replay_perception import observer_assets

    manifest = observer_assets.load_observer_manifest()
    manifest["models"][model_key][field] = replacement

    with pytest.raises(ValueError, match="OBSERVER_MODEL_MANIFEST_INVALID"):
        observer_assets._validate_manifest(manifest)


def test_manifest_validation_rejects_an_added_model_key():
    from replay_perception import observer_assets

    manifest = observer_assets.load_observer_manifest()
    manifest["models"]["extra"] = deepcopy(manifest["models"]["role"])

    with pytest.raises(ValueError, match="OBSERVER_MODEL_MANIFEST_INVALID"):
        observer_assets._validate_manifest(manifest)


def _test_model(*files: tuple[str, bytes]) -> dict[str, object]:
    return {
        "model_id": "martinjolif/yolo-football-player-detection",
        "slug": "yolo11m_football",
        "revision": ROLE_REVISION,
        "license": "AGPL-3.0",
        "architecture": "YOLO11m",
        "labels": ["ball", "goalkeeper", "player", "referee"],
        "files": [
            {
                "name": name,
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "url": (
                    "https://huggingface.co/martinjolif/"
                    "yolo-football-player-detection/resolve/"
                    f"{ROLE_REVISION}/{name}"
                ),
            }
            for name, payload in files
        ],
    }


def test_verify_observer_assets_requires_every_pinned_file(monkeypatch, tmp_path):
    from replay_perception import observer_assets

    model = _test_model(("weights.pt", b"weights"), ("README.md", b"card"))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    (tmp_path / "weights.pt").write_bytes(b"weights")

    with pytest.raises(FileNotFoundError, match="OBSERVER_MODEL_FILE_MISSING: README.md"):
        observer_assets.verify_observer_assets("role", tmp_path)


def test_verify_observer_assets_rejects_tampering(monkeypatch, tmp_path):
    from replay_perception import observer_assets

    model = _test_model(("weights.pt", b"expected"))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    (tmp_path / "weights.pt").write_bytes(b"tampered")

    with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH: weights.pt"):
        observer_assets.verify_observer_assets("role", tmp_path)


def test_verify_observer_assets_rejects_wrong_size_even_if_hash_matches(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"verified"
    model = _test_model(("weights.pt", payload))
    model["files"][0]["size"] = len(payload) + 1
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    (tmp_path / "weights.pt").write_bytes(payload)

    with pytest.raises(ValueError, match="OBSERVER_MODEL_SIZE_MISMATCH: weights.pt"):
        observer_assets.verify_observer_assets("role", tmp_path)


def test_verify_observer_assets_reports_complete_provenance(monkeypatch, tmp_path):
    from replay_perception import observer_assets

    weights = b"weights"
    card = b"card"
    model = _test_model(("weights.pt", weights), ("README.md", card))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    (tmp_path / "weights.pt").write_bytes(weights)
    (tmp_path / "README.md").write_bytes(card)

    provenance = observer_assets.verify_observer_assets("role", tmp_path)

    assert provenance == {
        "manifest_version": 1,
        "model_key": "role",
        "model_id": "martinjolif/yolo-football-player-detection",
        "revision": ROLE_REVISION,
        "license": "AGPL-3.0",
        "architecture": "YOLO11m",
        "labels": ["ball", "goalkeeper", "player", "referee"],
        "files": {
            "weights.pt": hashlib.sha256(weights).hexdigest(),
            "README.md": hashlib.sha256(card).hexdigest(),
        },
    }


@pytest.mark.parametrize("marker_kind", ["file", "directory"])
def test_verification_rejects_any_git_worktree_ancestor(
    monkeypatch, tmp_path, marker_kind
):
    from replay_perception import observer_assets

    repository = tmp_path / "repository"
    model_dir = repository / "nested" / "cache"
    model_dir.mkdir(parents=True)
    marker = repository / ".git"
    if marker_kind == "file":
        marker.write_text("gitdir: elsewhere\n", encoding="utf-8")
    else:
        marker.mkdir()
    monkeypatch.setattr(
        observer_assets, "_manifest_model", lambda _key: _test_model()
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        observer_assets.verify_observer_assets("role", model_dir)


def test_verification_rejects_an_outside_symlink_targeting_a_repository(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / ".git").mkdir()
    alias = tmp_path / "outside-alias"
    alias.symlink_to(repository, target_is_directory=True)
    monkeypatch.setattr(
        observer_assets, "_manifest_model", lambda _key: _test_model()
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        observer_assets.verify_observer_assets("role", alias / "cache")


def test_verification_rejects_a_repository_symlink_that_escapes_outside(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / ".git").mkdir()
    external = tmp_path / "external-cache"
    external.mkdir()
    alias = repository / "escaping-alias"
    alias.symlink_to(external, target_is_directory=True)
    monkeypatch.setattr(
        observer_assets, "_manifest_model", lambda _key: _test_model()
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        observer_assets.verify_observer_assets("role", alias)


def test_verification_rejects_a_file_symlink_targeting_a_repository(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / ".git").mkdir()
    target = repository / "weights.pt"
    target.write_bytes(b"weights")
    model_dir = tmp_path / "external-cache"
    model_dir.mkdir()
    (model_dir / "weights.pt").symlink_to(target)
    monkeypatch.setattr(
        observer_assets,
        "_manifest_model",
        lambda _key: _test_model(("weights.pt", b"weights")),
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        observer_assets.verify_observer_assets("role", model_dir)


def test_download_reuses_verified_existing_files_without_network(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"already verified"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    path = tmp_path / "weights.pt"
    path.write_bytes(payload)

    def network_must_not_run(*_args, **_kwargs):
        raise AssertionError("verified cache files must not use the network")

    monkeypatch.setattr(observer_assets, "_urlopen", network_must_not_run)

    provenance = observer_assets.download_observer_assets("role", tmp_path)

    assert path.read_bytes() == payload
    assert provenance["files"] == {
        "weights.pt": hashlib.sha256(payload).hexdigest()
    }


def test_parent_download_uses_bounded_child_for_the_temporary_file(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"downloaded in bounded child"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    calls = []

    def fake_bounded_child(
        model_key, filename, descriptor, timeout_seconds
    ):
        calls.append((model_key, filename, timeout_seconds))
        observer_assets.os.write(descriptor, payload)
        observer_assets.os.fsync(descriptor)

    monkeypatch.setattr(
        observer_assets,
        "run_bounded_observer_download",
        fake_bounded_child,
        raising=False,
    )
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("parent process must not perform network I/O")
        ),
        raising=False,
    )

    provenance = observer_assets.download_observer_assets("role", tmp_path)

    assert len(calls) == 1
    assert calls[0][:2] == ("role", "weights.pt")
    assert 0 < calls[0][2] <= observer_assets.MAX_DOWNLOAD_SECONDS
    assert provenance["files"]["weights.pt"] == hashlib.sha256(
        payload
    ).hexdigest()


def test_killed_child_bytes_are_cleaned_and_never_published(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"complete bytes received after deadline"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)

    def timed_out_child(_key, _filename, descriptor, _timeout_seconds):
        observer_assets.os.write(descriptor, payload)
        observer_assets.os.fsync(descriptor)
        raise TimeoutError("OBSERVER_MODEL_DOWNLOAD_TIMEOUT: weights.pt")

    monkeypatch.setattr(
        observer_assets,
        "run_bounded_observer_download",
        timed_out_child,
        raising=False,
    )
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            payload, content_length=len(payload)
        ),
        raising=False,
    )

    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT"):
        observer_assets.download_observer_assets("role", tmp_path)

    assert not (tmp_path / "weights.pt").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_rejects_invalid_existing_file_without_replacing_it(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    model = _test_model(("weights.pt", b"approved bytes"))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    path = tmp_path / "weights.pt"
    path.write_bytes(b"existing user bytes")
    network_calls = []
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH"):
        observer_assets.download_observer_assets("role", tmp_path)

    assert path.read_bytes() == b"existing user bytes"
    assert network_calls == []


@pytest.mark.parametrize("marker_kind", ["file", "directory"])
def test_download_rejects_git_ancestor_before_directory_creation_or_network(
    monkeypatch, tmp_path, marker_kind
):
    from replay_perception import observer_assets

    repository = tmp_path / "repository"
    repository.mkdir()
    marker = repository / ".git"
    if marker_kind == "file":
        marker.write_text("gitdir: elsewhere\n", encoding="utf-8")
    else:
        marker.mkdir()
    model_dir = repository / "not-created" / "model-cache"
    network_calls = []
    monkeypatch.setattr(
        observer_assets,
        "_manifest_model",
        lambda _key: _test_model(("weights.pt", b"approved")),
    )
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        observer_assets.download_observer_assets("role", model_dir)

    assert not model_dir.exists()
    assert network_calls == []


def test_download_rejects_symlink_into_repository_before_writes_or_network(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    repository = tmp_path / "repository"
    repository.mkdir()
    (repository / ".git").mkdir()
    alias = tmp_path / "outside-alias"
    alias.symlink_to(repository, target_is_directory=True)
    model_dir = alias / "not-created"
    network_calls = []
    monkeypatch.setattr(
        observer_assets,
        "_manifest_model",
        lambda _key: _test_model(("weights.pt", b"approved")),
    )
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: network_calls.append(True),
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        observer_assets.download_observer_assets("role", model_dir)

    assert not model_dir.resolve().exists()
    assert network_calls == []


def test_download_uses_fixed_https_url_verified_tls_and_bounded_timeout(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"downloaded bytes"
    model = _test_model(("weights.pt", payload))
    entry = model["files"][0]
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    observed = {}

    def fake_urlopen(request, *, timeout, context):
        observed.update(url=request.full_url, timeout=timeout, context=context)
        return FakeResponse(payload, content_length=len(payload))

    monkeypatch.setattr(observer_assets, "_urlopen", fake_urlopen)

    observer_assets.download_observer_assets("role", tmp_path)

    assert observed["url"] == entry["url"]
    assert observed["url"].startswith("https://huggingface.co/")
    assert 0 < observed["timeout"] <= 60
    assert observed["context"].verify_mode == ssl.CERT_REQUIRED
    assert observed["context"].check_hostname is True
    assert (tmp_path / "weights.pt").read_bytes() == payload
    assert not list(tmp_path.glob(".*.download-*"))


@pytest.mark.parametrize("declared_size", ["not-an-integer", 18, -1])
def test_download_rejects_invalid_content_length_and_cleans_temporary_file(
    monkeypatch, tmp_path, declared_size
):
    from replay_perception import observer_assets

    payload = b"short"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            payload, content_length=declared_size
        ),
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_SIZE_MISMATCH"):
        observer_assets.download_observer_assets("role", tmp_path)

    assert not (tmp_path / "weights.pt").exists()
    assert not list(tmp_path.glob(".*.download-*"))


@pytest.mark.parametrize("received", [b"shor", b"short-plus-extra"])
def test_download_rejects_stream_size_mismatch_and_never_publishes(
    monkeypatch, tmp_path, received
):
    from replay_perception import observer_assets

    expected = b"short"
    model = _test_model(("weights.pt", expected))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(received),
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_SIZE_MISMATCH"):
        observer_assets.download_observer_assets("role", tmp_path)

    assert not (tmp_path / "weights.pt").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_rejects_same_size_hash_mismatch_and_never_publishes(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    expected = b"expected"
    received = b"tampered"
    model = _test_model(("weights.pt", expected))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            received, content_length=len(received)
        ),
    )

    with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH"):
        observer_assets.download_observer_assets("role", tmp_path)

    assert not (tmp_path / "weights.pt").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_timeout_cleans_partial_bytes_and_has_stable_error(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"expected"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)

    class TimedOutResponse(FakeResponse):
        def read(self, _amount):
            raise TimeoutError("network stalled")

    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: TimedOutResponse(
            payload, content_length=len(payload)
        ),
    )

    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT"):
        observer_assets.download_observer_assets("role", tmp_path)

    assert not (tmp_path / "weights.pt").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_interruption_cleans_partial_bytes_and_does_not_publish(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"expected"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)

    class InterruptedResponse(FakeResponse):
        def read(self, _amount):
            raise KeyboardInterrupt

    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: InterruptedResponse(
            payload, content_length=len(payload)
        ),
    )

    with pytest.raises(KeyboardInterrupt):
        observer_assets.download_observer_assets("role", tmp_path)

    assert not (tmp_path / "weights.pt").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_rejects_late_eof_before_publishing(monkeypatch, tmp_path):
    from replay_perception import observer_assets

    payload = b"expected"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    monkeypatch.setattr(observer_assets, "MAX_DOWNLOAD_SECONDS", 10)
    clock = {"now": 0.0}
    monkeypatch.setattr(
        observer_assets.time, "monotonic", lambda: clock["now"]
    )

    class LateEOFResponse(FakeResponse):
        def read(self, amount):
            chunk = super().read(amount)
            if not chunk:
                clock["now"] = 11.0
            return chunk

    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: LateEOFResponse(
            payload, content_length=len(payload)
        ),
    )

    with pytest.raises(TimeoutError, match="OBSERVER_MODEL_DOWNLOAD_TIMEOUT"):
        observer_assets.download_observer_assets("role", tmp_path)

    assert not (tmp_path / "weights.pt").exists()
    assert not list(tmp_path.glob(".*.download-*"))


def test_download_reads_available_bytes_without_waiting_to_fill_chunk(
    monkeypatch, tmp_path
):
    from replay_perception import observer_assets

    payload = b"expected"
    model = _test_model(("weights.pt", payload))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)

    class ReadOneResponse(FakeResponse):
        def read(self, _amount):
            raise AssertionError("buffer-filling read must not be used")

        def read1(self, amount):
            return self._stream.read(amount)

    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: ReadOneResponse(
            payload, content_length=len(payload)
        ),
    )

    provenance = observer_assets.download_observer_assets("role", tmp_path)

    assert provenance["files"]["weights.pt"] == hashlib.sha256(
        payload
    ).hexdigest()


@pytest.mark.parametrize("competing", [b"downloaded", b"other writer"])
def test_exclusive_publish_never_clobbers_a_concurrent_cache_writer(
    monkeypatch, tmp_path, competing
):
    from replay_perception import observer_assets

    downloaded = b"downloaded"
    model = _test_model(("weights.pt", downloaded))
    monkeypatch.setattr(observer_assets, "_manifest_model", lambda _key: model)
    monkeypatch.setattr(
        observer_assets,
        "_urlopen",
        lambda *_args, **_kwargs: FakeResponse(
            downloaded, content_length=len(downloaded)
        ),
    )

    def racing_link(_source, destination):
        Path(destination).write_bytes(competing)
        raise FileExistsError(destination)

    monkeypatch.setattr(observer_assets.os, "link", racing_link)

    if competing == downloaded:
        provenance = observer_assets.download_observer_assets("role", tmp_path)
        assert provenance["files"]["weights.pt"] == hashlib.sha256(
            downloaded
        ).hexdigest()
    else:
        with pytest.raises(ValueError, match="OBSERVER_MODEL_HASH_MISMATCH"):
            observer_assets.download_observer_assets("role", tmp_path)

    assert (tmp_path / "weights.pt").read_bytes() == competing
    assert not list(tmp_path.glob(".*.download-*"))


@pytest.mark.parametrize("model_key", ["role", "pose"])
def test_fetch_cli_prepares_only_the_selected_model(
    monkeypatch, tmp_path, capsys, model_key
):
    from replay_perception import fetch_observer_models

    calls = []
    monkeypatch.setattr(
        fetch_observer_models,
        "default_observer_model_dir",
        lambda key: tmp_path / key,
    )

    def fake_download(key, directory):
        calls.append((key, directory))
        return {"model_key": key, "revision": f"{key}-revision"}

    monkeypatch.setattr(
        fetch_observer_models, "download_observer_assets", fake_download
    )

    assert fetch_observer_models.main([model_key]) == 0
    assert calls == [(model_key, tmp_path / model_key)]
    assert json.loads(capsys.readouterr().out) == {
        model_key: {
            "model_key": model_key,
            "revision": f"{model_key}-revision",
        }
    }


def test_fetch_cli_defaults_to_preparing_both_approved_models(
    monkeypatch, tmp_path, capsys
):
    from replay_perception import fetch_observer_models

    calls = []
    monkeypatch.setattr(
        fetch_observer_models,
        "default_observer_model_dir",
        lambda key: tmp_path / key,
    )

    def fake_download(key, directory):
        calls.append((key, directory))
        return {"model_key": key}

    monkeypatch.setattr(
        fetch_observer_models, "download_observer_assets", fake_download
    )

    assert fetch_observer_models.main([]) == 0
    assert calls == [
        ("role", tmp_path / "role"),
        ("pose", tmp_path / "pose"),
    ]
    assert json.loads(capsys.readouterr().out) == {
        "role": {"model_key": "role"},
        "pose": {"model_key": "pose"},
    }


def test_fetch_cli_rejects_unapproved_model_selector():
    from replay_perception import fetch_observer_models

    with pytest.raises(SystemExit) as failure:
        fetch_observer_models.main(["rtdetr"])

    assert failure.value.code == 2
