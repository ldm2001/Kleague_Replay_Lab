from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

import numpy as np
import pytest
import torch


class HarmlessUnapproved:
    pass


class LocalModel(torch.nn.Module):
    def __init__(self, predictions=None):
        super().__init__()
        self.names = dict(enumerate(("ball", "goalkeeper", "player", "referee")))
        self.yaml = {"nc": 4, "scale": "m", "yaml_file": "yolo11m.yaml"}
        self.model = torch.nn.Sequential()
        self.marker = torch.nn.Parameter(torch.zeros(1))
        self.predictions = torch.empty((1, 8, 0)) if predictions is None else predictions
        self.input = None
        self.inference = None

    def forward(self, tensor):
        self.input = tensor
        self.inference = torch.is_inference_mode_enabled()
        return self.predictions, []


def runtime(monkeypatch, tmp_path, predictions=None):
    from replay_perception import roles

    model = LocalModel(predictions)
    metadata = {"manifest_version": 1, "model_key": "role", "model_id": "martinjolif/yolo-football-player-detection",
                "revision": "5e83fafa8d564243001ce8e063612a618a138fbe", "license": "AGPL-3.0",
                "architecture": "YOLO11m", "labels": list(model.names.values()),
                "files": {"yolo-football-player-detection.pt": "69c652bfa9814ef882c439617f04b8fd5749b6b8455aaa3c36110bc2e802aadd"}}
    monkeypatch.setattr(roles, "verify_observer_assets", lambda key, directory: deepcopy(metadata))
    # These boundaries isolate heavyweight file and dependency I/O; all image,
    # tensor, output validation, NMS and coordinate processing remains real.
    import cv2
    fake_runtime = SimpleNamespace(torch=torch, cv2=cv2, version="8.4.146", model_type=LocalModel,
                                   trusted_classes=(LocalModel,))
    monkeypatch.setattr(roles, "_load_runtime", lambda: fake_runtime)
    monkeypatch.setattr(roles, "_load_checkpoint", lambda path, runtime, **kwargs: ({"model": model}, ["test.LocalModel"]))
    monkeypatch.setattr(roles, "_validate_architecture", lambda candidate, runtime: {"name": "YOLO11m", "scale": "m"})
    return roles, model, tmp_path, metadata


def predictions(rows):
    """Rows are center x,y,width,height then four class scores, not xyxy."""
    return torch.tensor(rows, dtype=torch.float32).T.unsqueeze(0)


def test_role_detector_api_is_available():
    from replay_perception.roles import YoloRoleDetector
    assert callable(YoloRoleDetector)


@pytest.mark.parametrize("device", ["cuda", "cuda:0", "auto", "", None, 0, np.array(["cpu", "mps"])])
def test_rejects_unsupported_device_before_assets(monkeypatch, tmp_path, device):
    from replay_perception import roles
    monkeypatch.setattr(roles, "verify_observer_assets", lambda *_: pytest.fail("read invalid-device assets"))
    with pytest.raises(ValueError, match="ROLE_DEVICE_INVALID"):
        roles.YoloRoleDetector(tmp_path, device=device)


def test_unavailable_mps_does_not_fall_back(monkeypatch, tmp_path):
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: False)
    monkeypatch.setattr(roles, "_load_checkpoint", lambda *_: pytest.fail("loaded unavailable-device model"))
    with pytest.raises(ValueError, match="ROLE_MPS_UNAVAILABLE"):
        roles.YoloRoleDetector(directory, device="mps")


def test_hash_failure_precedes_runtime_and_checkpoint_load(monkeypatch, tmp_path):
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    def corrupt(*args):
        raise ValueError("MODEL_HASH_MISMATCH")
    monkeypatch.setattr(roles, "verify_observer_assets", corrupt)
    monkeypatch.setattr(roles, "_load_runtime", lambda: pytest.fail("runtime before verified assets"))
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        roles.YoloRoleDetector(directory)


def test_verifies_lexical_path_before_resolving_symlink_for_checkpoint(monkeypatch, tmp_path):
    roles, model, directory, metadata = runtime(monkeypatch, tmp_path)
    events = []
    alias = directory / "alias"
    actual = directory / "actual"
    actual.mkdir()
    alias.symlink_to(actual, target_is_directory=True)
    monkeypatch.setattr(roles, "verify_observer_assets", lambda key, path: events.append((key, path)) or metadata)
    monkeypatch.setattr(roles, "_load_checkpoint", lambda path, rt, **kwargs: events.append(("load", path)) or ({"model": model}, []))
    roles.YoloRoleDetector(alias)
    assert events == [("role", alias.absolute()), ("load", actual / "yolo-football-player-detection.pt")]


def test_safe_loader_rejects_real_unapproved_pickle_without_loading(monkeypatch, tmp_path):
    from replay_perception import roles
    checkpoint = tmp_path / "untrusted.pt"
    torch.save({"harmless": HarmlessUnapproved()}, checkpoint)
    monkeypatch.setattr(torch, "load", lambda *args, **kwargs: pytest.fail("load before unsafe-global rejection"))
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_UNSUPPORTED_GLOBAL"):
        roles._load_checkpoint(checkpoint, SimpleNamespace(torch=torch, trusted_classes=()))


def test_safe_loader_passes_weights_only_true_and_restores_allowlist(monkeypatch, tmp_path):
    from replay_perception import roles
    checkpoint = tmp_path / "tensor.pt"
    torch.save({"model": torch.tensor([1.0])}, checkpoint)
    original = torch.load
    calls = []
    before = torch.serialization.get_safe_globals().copy()
    def tracked(*args, **kwargs):
        calls.append(kwargs.copy())
        return original(*args, **kwargs)
    monkeypatch.setattr(torch, "load", tracked)
    result, globals_used = roles._load_checkpoint(checkpoint, SimpleNamespace(torch=torch, trusted_classes=()))
    assert result["model"].tolist() == [1.0]
    assert globals_used == []
    assert len(calls) == 1 and calls[0]["weights_only"] is True and calls[0]["map_location"] == "cpu"
    assert torch.serialization.get_safe_globals() == before


def test_safe_loader_rejects_even_previously_allowlisted_unknown_global(tmp_path):
    from replay_perception import roles
    checkpoint = tmp_path / "globally-allowed.pt"
    torch.save({"unknown": HarmlessUnapproved()}, checkpoint)
    with torch.serialization.safe_globals([HarmlessUnapproved]):
        with pytest.raises(ValueError, match="ROLE_CHECKPOINT_AMBIENT_ALLOWLIST"):
            roles._load_checkpoint(checkpoint, SimpleNamespace(torch=torch, trusted_classes=()))


def test_safe_loader_checks_immutable_payload_digest_before_deserialization(monkeypatch, tmp_path):
    from replay_perception import roles
    path = tmp_path / "changed.pt"
    torch.save({"model": torch.tensor([1.0])}, path)
    original_digest = hashlib.sha256(path.read_bytes()).hexdigest()
    torch.save({"model": torch.tensor([2.0])}, path)
    monkeypatch.setattr(torch, "load", lambda *args, **kwargs: pytest.fail("loaded changed bytes"))
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        roles._load_checkpoint(path, SimpleNamespace(torch=torch, trusted_classes=()), expected_sha256=original_digest)


def test_safe_loader_retains_hashed_payload_if_path_changes_during_audit(monkeypatch, tmp_path):
    from replay_perception import roles
    path = tmp_path / "changed.pt"
    torch.save({"model": torch.tensor([1.0])}, path)
    original_digest = hashlib.sha256(path.read_bytes()).hexdigest()
    audit = torch.serialization.get_unsafe_globals_in_checkpoint
    def replace_then_audit(stream):
        torch.save({"model": torch.tensor([2.0])}, path)
        return audit(stream)
    monkeypatch.setattr(torch.serialization, "get_unsafe_globals_in_checkpoint", replace_then_audit)
    value, _ = roles._load_checkpoint(path, SimpleNamespace(torch=torch, trusted_classes=()), expected_sha256=original_digest)
    assert value["model"].tolist() == [1.0]


def test_constructor_passes_manifest_hash_to_the_actual_loader(monkeypatch, tmp_path):
    roles, model, directory, metadata = runtime(monkeypatch, tmp_path)
    seen = []
    def capture(path, runtime, *, expected_sha256=None):
        seen.append(expected_sha256)
        return {"model": model}, []
    monkeypatch.setattr(roles, "_load_checkpoint", capture)
    roles.YoloRoleDetector(directory)
    assert seen == [metadata["files"]["yolo-football-player-detection.pt"]]


def test_ambient_impostor_with_a_trusted_name_is_rejected(monkeypatch, tmp_path):
    from replay_perception import roles
    impostor = type("HarmlessUnapproved", (), {})
    impostor.__module__ = HarmlessUnapproved.__module__
    impostor.__qualname__ = HarmlessUnapproved.__qualname__
    monkeypatch.setattr(torch, "load", lambda *args, **kwargs: pytest.fail("loaded with impostor"))
    with torch.serialization.safe_globals([impostor]):
        with pytest.raises(ValueError, match="ROLE_CHECKPOINT_AMBIENT_ALLOWLIST"):
            roles._load_checkpoint(tmp_path / "not-read.pt", SimpleNamespace(torch=torch, trusted_classes=(HarmlessUnapproved,)))


def test_parallel_safe_loads_cannot_overlap_process_global_allowlists(monkeypatch, tmp_path):
    from replay_perception import roles
    path = tmp_path / "parallel.pt"
    torch.save({"model": HarmlessUnapproved()}, path)
    real_load = torch.load
    first_entered, second_entered, release_first = threading.Event(), threading.Event(), threading.Event()
    counter_lock = threading.Lock()
    calls = []
    def tracked(*args, **kwargs):
        with counter_lock:
            calls.append(1)
            ordinal = len(calls)
        if ordinal == 1:
            first_entered.set()
            assert release_first.wait(3)
        else:
            second_entered.set()
        return real_load(*args, **kwargs)
    monkeypatch.setattr(torch, "load", tracked)
    local_runtime = SimpleNamespace(torch=torch, trusted_classes=(HarmlessUnapproved,))
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(roles._load_checkpoint, path, local_runtime)
        assert first_entered.wait(3)
        second = pool.submit(roles._load_checkpoint, path, local_runtime)
        overlapped = second_entered.wait(.1)
        release_first.set()
        first.result(timeout=3)
        second.result(timeout=3)
    assert overlapped is False


def test_parallel_runtime_import_restores_original_settings_path(monkeypatch, tmp_path):
    from replay_perception import roles
    import builtins
    original = str(tmp_path / "original-settings-parent")
    monkeypatch.setenv("YOLO_CONFIG_DIR", original)
    real_import = builtins.__import__
    first_entered, second_entered = threading.Event(), threading.Event()
    release_first, release_second = threading.Event(), threading.Event()
    seen = set()
    counter_lock = threading.Lock()
    def controlled_import(name, *args, **kwargs):
        if name == "ultralytics":
            with counter_lock:
                identity = threading.get_ident()
                first_for_thread = identity not in seen
                seen.add(identity)
                ordinal = len(seen)
            if first_for_thread:
                if ordinal == 1:
                    first_entered.set()
                    assert release_first.wait(5)
                else:
                    second_entered.set()
                    assert release_second.wait(5)
        return real_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", controlled_import)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(roles._load_runtime)
        assert first_entered.wait(5)
        second = pool.submit(roles._load_runtime)
        overlapped = second_entered.wait(.1)
        release_first.set()
        first.result(timeout=5)
        release_second.set()
        second.result(timeout=5)
    assert os.environ["YOLO_CONFIG_DIR"] == original
    assert not Path(original).exists()
    assert overlapped is False


def test_pose_runtime_registration_coexists_without_mutating_ambient_globals(tmp_path):
    from replay_perception import pose, roles
    pose._load_runtime()
    before = {id(value) for value in torch.serialization.get_safe_globals()}
    path = tmp_path / "tensor-after-pose.pt"
    torch.save({"model": torch.tensor([1.0])}, path)
    result, audited = roles._load_checkpoint(path, SimpleNamespace(torch=torch, trusted_classes=()))
    assert result["model"].tolist() == [1.0]
    assert audited == []
    assert {id(value) for value in torch.serialization.get_safe_globals()} == before


@pytest.mark.parametrize("type_name", ["DeviceMesh", "DTensorSpec", "TensorMeta", "DTensor", "Partial", "Replicate", "Shard", "_DimRange"])
def test_pose_runtime_global_is_still_forbidden_inside_role_checkpoint(monkeypatch, tmp_path, type_name):
    from replay_perception import pose, roles
    pose._load_runtime()
    from torch.distributed.device_mesh import DeviceMesh
    from torch.distributed.tensor._dtensor_spec import DTensorSpec, TensorMeta
    from torch.distributed.tensor import DTensor
    from torch.distributed.tensor.placement_types import Partial, Replicate, Shard
    from torch._dynamo.decorators import _DimRange
    objects = {value.__name__: value for value in (DeviceMesh, DTensorSpec, TensorMeta, DTensor, Partial, Replicate, Shard, _DimRange)}
    path = tmp_path / "unrelated-runtime-global.pt"
    torch.save({"unwanted_type": objects[type_name]}, path)
    # The public scanner hides this reference precisely because the unrelated
    # runtime already registered it. The role loader must independently reject it.
    assert torch.serialization.get_unsafe_globals_in_checkpoint(path) == []
    before = {id(value) for value in torch.serialization.get_safe_globals()}
    monkeypatch.setattr(torch, "load", lambda *args, **kwargs: pytest.fail("loaded unrelated framework global"))
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_UNSUPPORTED_GLOBAL"):
        roles._load_checkpoint(path, SimpleNamespace(torch=torch, trusted_classes=()))
    assert {id(value) for value in torch.serialization.get_safe_globals()} == before


def test_preexisting_trusted_global_is_audited_without_removing_registration(tmp_path):
    from replay_perception import roles
    path = tmp_path / "preexisting-trusted.pt"
    torch.save({"model": HarmlessUnapproved()}, path)
    with torch.serialization.safe_globals([HarmlessUnapproved]):
        before = {id(value) for value in torch.serialization.get_safe_globals()}
        result, audited = roles._load_checkpoint(path, SimpleNamespace(torch=torch, trusted_classes=(HarmlessUnapproved,)))
        assert type(result["model"]) is HarmlessUnapproved
        assert audited == [f"{HarmlessUnapproved.__module__}.{HarmlessUnapproved.__qualname__}"]
        assert {id(value) for value in torch.serialization.get_safe_globals()} == before


def test_compressed_oversized_pickle_is_rejected_before_public_audit(monkeypatch, tmp_path):
    from replay_perception import roles
    path = tmp_path / "compressed-oversized.pt"
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("archive/data.pkl", b"0" * 2048)
    assert path.stat().st_size < 1024
    monkeypatch.setattr(roles, "_CHECKPOINT_MAX_BYTES", 1024)
    monkeypatch.setattr(torch.serialization, "get_unsafe_globals_in_checkpoint",
                        lambda *args: pytest.fail("public audit ran before decompressed size bound"))
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_PICKLE_INVALID"):
        roles._load_checkpoint(path, SimpleNamespace(torch=torch, trusted_classes=()))


def test_offline_runtime_import_does_not_touch_network_or_user_settings(tmp_path):
    script = """
import os
import socket
import torch
from replay_perception.roles import _load_runtime
attempts = []
def forbidden(*args, **kwargs):
    attempts.append(args)
    raise AssertionError('NETWORK_FORBIDDEN')
socket.getaddrinfo = forbidden
socket.socket.connect = forbidden
socket.socket.connect_ex = forbidden
runtime = _load_runtime()
from ultralytics import utils
assert attempts == []
assert utils.ONLINE is False and utils.AUTOINSTALL is False
assert utils.SETTINGS['sync'] is False
assert os.environ['YOLO_OFFLINE'] == '1'
assert os.environ['YOLO_AUTOINSTALL'] == '0'
print('OFFLINE_IMPORT_OK')
"""
    result = subprocess.run([sys.executable, "-W", "error", "-c", script], cwd=Path(__file__).parents[1],
                            env={**os.environ, "PYTHONPATH": "src", "YOLO_CONFIG_DIR": str(tmp_path)},
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    assert "OFFLINE_IMPORT_OK" in result.stdout
    assert list(tmp_path.iterdir()) == []


def test_mps_with_fallback_enabled_is_explicitly_rejected(monkeypatch, tmp_path):
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: True)
    monkeypatch.setenv("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    with pytest.raises(ValueError, match="ROLE_MPS_FALLBACK_ENABLED"):
        roles.YoloRoleDetector(directory, device="mps")


@pytest.mark.parametrize("names", [{0: "player", 1: "ball", 2: "goalkeeper", 3: "referee"},
                                   {"0": "ball", "1": "goalkeeper", "2": "player", "3": "referee"},
                                   {0: "ball", 1: "goalkeeper", 2: "player"},
                                   ["ball", "goalkeeper", "player", "referee"]])
def test_actual_model_label_mapping_must_be_exact(monkeypatch, tmp_path, names):
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    model.names = names
    with pytest.raises(ValueError, match="ROLE_LABEL_MAPPING_MISMATCH"):
        roles.YoloRoleDetector(directory)


def test_missing_model_checkpoint_is_rejected(monkeypatch, tmp_path):
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    monkeypatch.setattr(roles, "_load_checkpoint", lambda *_, **kwargs: ({"ema": None}, []))
    with pytest.raises(ValueError, match="ROLE_CHECKPOINT_MODEL_INVALID"):
        roles.YoloRoleDetector(directory)


@pytest.mark.parametrize("rgb", [None, [], np.zeros((4, 4, 3)), np.zeros((4, 4), dtype=np.uint8),
                                 np.zeros((4, 4, 4), dtype=np.uint8), np.zeros((0, 4, 3), dtype=np.uint8)])
def test_invalid_rgb_is_rejected_without_inference(monkeypatch, tmp_path, rgb):
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    detector = roles.YoloRoleDetector(directory)
    with pytest.raises(ValueError, match="ROLE_RGB_INVALID"):
        detector.predict(rgb)
    assert model.input is None


def test_empty_prediction_returns_tuple_and_runs_fp32_eval_inference(monkeypatch, tmp_path):
    roles, model, directory, metadata = runtime(monkeypatch, tmp_path)
    detector = roles.YoloRoleDetector(directory)
    assert detector.predict(np.zeros((100, 200, 3), dtype=np.uint8)) == ()
    assert model.training is False and model.inference is True
    assert model.input.shape == (1, 3, 640, 640)
    assert model.input.dtype == torch.float32 and model.input.device.type == "cpu"
    assert detector.provenance["files"] == metadata["files"]
    assert detector.provenance["threshold"] == .50
    assert detector.provenance["nms"]["iou_threshold"] == .70
    assert detector.provenance["nms"]["max_detections"] == 300
    assert detector.provenance["safe_loader"]["weights_only"] is True
    assert detector.provenance["library_versions"]["torch"] == torch.__version__


def test_model_forward_stays_fp32_inside_ambient_cpu_autocast(monkeypatch, tmp_path):
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    model.first_conv = torch.nn.Conv2d(3, 4, 1)
    observed = []
    def forward(tensor):
        output = model.first_conv(tensor)
        observed.append((output.dtype, torch.is_autocast_enabled("cpu"), torch.is_inference_mode_enabled()))
        # A float32 decoded head does not prove its preceding layers were FP32.
        return model.predictions, []
    monkeypatch.setattr(model, "forward", forward)
    detector = roles.YoloRoleDetector(directory)
    assert detector.provenance["inference"]["autocast_enabled"] is False
    previous_enabled = torch.is_autocast_enabled("cpu")
    previous_dtype = torch.get_autocast_dtype("cpu")
    with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
        assert detector.predict(np.zeros((100, 200, 3), dtype=np.uint8)) == ()
        assert observed == [(torch.float32, False, True)]
        assert torch.is_autocast_enabled("cpu") is True
        assert torch.get_autocast_dtype("cpu") == torch.bfloat16
    assert torch.is_autocast_enabled("cpu") == previous_enabled
    assert torch.get_autocast_dtype("cpu") == previous_dtype


def test_four_roles_and_source_coordinate_backtransform(monkeypatch, tmp_path):
    output = predictions([[64, 224, 64, 64, .9, 0, 0, 0], [192, 224, 64, 64, 0, .8, 0, 0],
                          [320, 224, 64, 64, 0, 0, .7, 0], [448, 224, 64, 64, 0, 0, 0, .6]])
    roles, model, directory, _ = runtime(monkeypatch, tmp_path, output)
    detector = roles.YoloRoleDetector(directory)
    rgb = np.full((100, 200, 3), [255, 64, 0], dtype=np.uint8)
    result = detector.predict(rgb)
    assert tuple(item.role for item in result) == ("ball", "goalkeeper", "player", "referee")
    assert tuple(item.role_detection_id for item in result) == (0, 1, 2, 3)
    assert result[0].box == pytest.approx((10, 10, 30, 30))
    assert result[3].box == pytest.approx((130, 10, 150, 30))
    assert model.input[0, :, 200, 20].tolist() == pytest.approx([1, 64 / 255, 0])
    transform = detector.last_transform
    assert transform["sourceWidth"] == 200 and transform["sourceHeight"] == 100
    assert transform["resizedWidth"] == 640 and transform["resizedHeight"] == 320
    assert transform["paddingLTRB"] == [0, 160, 0, 160]
    assert transform["sourceToInput"] == [[3.2, 0, 0], [0, 3.2, 160]]


def test_transform_is_read_only_per_successful_frame_and_cleared_on_failure(monkeypatch, tmp_path):
    roles, _, directory, _ = runtime(monkeypatch, tmp_path)
    detector = roles.YoloRoleDetector(directory)
    provenance_before = deepcopy(detector.provenance)
    assert detector.last_transform is None
    detector.predict(np.zeros((100, 200, 3), dtype=np.uint8))
    original = detector.last_transform
    original["paddingLTRB"][0] = 999
    assert detector.last_transform["paddingLTRB"][0] == 0
    detector.predict(np.zeros((200, 100, 3), dtype=np.uint8))
    assert detector.last_transform["sourceWidth"] == 100
    assert detector.last_transform["paddingLTRB"] == [160, 0, 160, 0]
    assert detector.provenance == provenance_before
    with pytest.raises(ValueError, match="ROLE_RGB_INVALID"):
        detector.predict(None)
    assert detector.last_transform is None


def test_forward_failure_clears_previous_transform_and_restores_autocast(monkeypatch, tmp_path):
    roles, model, directory, _ = runtime(monkeypatch, tmp_path)
    detector = roles.YoloRoleDetector(directory)
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    detector.predict(image)
    assert detector.last_transform is not None
    def fail(_tensor):
        raise RuntimeError("SYNTHETIC_FORWARD_FAILURE")
    monkeypatch.setattr(model, "forward", fail)
    with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
        with pytest.raises(RuntimeError, match="SYNTHETIC_FORWARD_FAILURE"):
            detector.predict(image)
        assert torch.is_autocast_enabled("cpu") is True
        assert torch.get_autocast_dtype("cpu") == torch.bfloat16
    assert detector.last_transform is None


def test_odd_letterbox_padding_is_reversible(monkeypatch, tmp_path):
    # 331x100 scales to 640x193: 223 pixels above, 224 below.
    output = predictions([[320, 319.5, 320, 96.5, 0, 0, 0, .9]])
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    detector = roles.YoloRoleDetector(directory)
    result = detector.predict(np.zeros((100, 331, 3), dtype=np.uint8))
    assert result[0].box == pytest.approx((82.75, 25, 248.25, 75))
    assert detector.last_transform["paddingLTRB"] == [0, 223, 0, 224]
    assert detector.last_transform["resizedHeight"] == 193


def test_class_aware_nms_and_confidence_filter_are_real(monkeypatch, tmp_path):
    output = predictions([[100, 100, 40, 80, 0, 0, .9, 0], [101, 100, 40, 80, 0, 0, .8, 0],
                          [100, 100, 40, 80, 0, 0, 0, .7], [300, 300, 20, 20, .49, 0, 0, 0]])
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    assert [item.role for item in result] == ["player", "referee"]
    assert [item.score for item in result] == pytest.approx([.9, .7])


def test_confidence_boundary_is_inclusive_without_rounding_up(monkeypatch, tmp_path):
    below = np.nextafter(np.float32(.50), np.float32(0))
    output = predictions([[100, 100, 40, 80, 0, 0, .50, 0], [200, 100, 40, 80, 0, 0, below, 0]])
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    assert len(result) == 1 and result[0].score == .50


@pytest.mark.parametrize(("center_x", "expected_count"), [
    (11.5, 2),
    (np.nextafter(np.float32(11.5), np.float32(0)), 1),
    (np.nextafter(np.float32(11.5), np.float32(20)), 2),
])
def test_nms_suppresses_only_above_exact_iou_boundary(monkeypatch, tmp_path, center_x, expected_count):
    # At center_x=11.5: intersection 140 / union 200 = exactly 0.70.
    output = predictions([[8.5, 5, 17, 10, 0, 0, .9, 0], [center_x, 5, 17, 10, 0, 0, .8, 0]])
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    assert len(result) == expected_count


def test_detection_count_is_bounded(monkeypatch, tmp_path):
    rows = [[10 + i % 30 * 20, 10 + i // 30 * 20, 2, 2, .9, 0, 0, 0] for i in range(400)]
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, predictions(rows))
    result = roles.YoloRoleDetector(directory).predict(np.zeros((640, 640, 3), dtype=np.uint8))
    assert len(result) == 300


def test_boxes_clip_to_original_frame_and_padding_only_boxes_are_rejected(monkeypatch, tmp_path):
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, predictions([[20, 170, 80, 80, .9, 0, 0, 0]]))
    result = roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8))
    assert result[0].box == pytest.approx((0, 0, 18.75, 15.625))
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, predictions([[20, 20, 10, 10, .9, 0, 0, 0]]))
    assert roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8)) == ()


def test_padding_only_box_cannot_suppress_a_box_with_source_support(monkeypatch, tmp_path):
    output = predictions([[100, 80, 40, 160, .9, 0, 0, 0], [100, 90, 40, 160, .8, 0, 0, 0]])
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    result = roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8))
    assert len(result) == 1 and result[0].score == pytest.approx(.8)
    assert result[0].box == pytest.approx((25, 0, 37.5, 3.125))


def test_padding_only_boxes_do_not_exhaust_the_source_detection_cap(monkeypatch, tmp_path):
    rows = [[5 + i % 60 * 10, 5 + i // 60 * 20, 2, 2, .9, 0, 0, 0] for i in range(300)]
    rows.append([320, 320, 64, 64, 0, 0, 0, .8])
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, predictions(rows))
    result = roles.YoloRoleDetector(directory).predict(np.zeros((100, 200, 3), dtype=np.uint8))
    assert len(result) == 1 and result[0].role == "referee"


@pytest.mark.parametrize("device", ["cpu", "mps"])
def test_approved_checkpoint_runs_locally_without_network(monkeypatch, device):
    from replay_perception import pose, roles
    model_dir = os.environ.get("REPLAY_ROLE_MODEL_DIR")
    if not model_dir:
        pytest.skip("Set REPLAY_ROLE_MODEL_DIR to the approved external cache for real-model readiness")
    import socket
    calls = []
    def forbidden(*args, **kwargs):
        calls.append(args)
        raise AssertionError("NETWORK_FORBIDDEN")
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    pose._load_runtime()
    ambient_before = {id(value) for value in torch.serialization.get_safe_globals()}
    if device == "mps" and not torch.backends.mps.is_available():
        with pytest.raises(ValueError, match="ROLE_MPS_UNAVAILABLE"):
            roles.YoloRoleDetector(model_dir, device=device)
        return
    detector = roles.YoloRoleDetector(model_dir, device=device)
    result = detector.predict(np.full((360, 640, 3), [24, 115, 43], dtype=np.uint8))
    assert isinstance(result, tuple)
    assert detector.last_transform["paddingLTRB"] == [0, 140, 0, 140]
    assert detector.provenance["actual_architecture"]["parameter_count"] == 20056092
    assert detector.provenance["actual_labels"] == {0: "ball", 1: "goalkeeper", 2: "player", 3: "referee"}
    assert len(detector.provenance["safe_loader"]["class_allowlist"]) == 21
    assert calls == []
    assert {id(value) for value in torch.serialization.get_safe_globals()} == ambient_before
    if device == "cpu":
        layer_dtypes = []
        hook = detector._model.model[0].conv.register_forward_hook(
            lambda _module, _inputs, output: layer_dtypes.append(output.dtype),
        )
        try:
            with torch.autocast(device_type="cpu", dtype=torch.bfloat16):
                detector.predict(np.full((360, 640, 3), [24, 115, 43], dtype=np.uint8))
                assert torch.is_autocast_enabled("cpu") is True
                assert torch.get_autocast_dtype("cpu") == torch.bfloat16
        finally:
            hook.remove()
        assert layer_dtypes == [torch.float32]
        assert calls == []
    # These mutations reach real config/structure validation, not a fake type guard.
    model, runtime = detector._model, detector._runtime
    for new_scale in ("n", "l"):
        model.yaml["scale"] = new_scale
        with pytest.raises(ValueError, match="ROLE_ARCHITECTURE_MISMATCH"):
            roles._validate_architecture(model, runtime)
    model.yaml["scale"] = "m"
    model.model[-1].f = [15, 19, 22]
    with pytest.raises(ValueError, match="ROLE_ARCHITECTURE_MISMATCH"):
        roles._validate_architecture(model, runtime)


@pytest.mark.parametrize("output", [torch.zeros((2, 8, 1)), torch.zeros((1, 9, 1)), torch.zeros((1, 8)),
                                    torch.full((1, 8, 1), float("nan")), torch.full((1, 8, 1), float("inf")),
                                    predictions([[10, 10, -1, 3, 0, 0, .9, 0]]),
                                    predictions([[10, 10, 3, 3, 0, 0, 1.1, 0]]),
                                    predictions([[10, 10, 3, 3, -.1, 0, .9, 0]]), "invalid",
                                    torch.tensor([[[10], [10], [3], [3], [-1e-50], [0], [.9], [0]]], dtype=torch.float64),
                                    torch.empty((1, 8, 8401))])
def test_malformed_raw_outputs_fail_closed(monkeypatch, tmp_path, output):
    roles, _, directory, _ = runtime(monkeypatch, tmp_path, output)
    detector = roles.YoloRoleDetector(directory)
    with pytest.raises(ValueError, match="ROLE_OUTPUT_INVALID"):
        detector.predict(np.zeros((100, 200, 3), dtype=np.uint8))


def test_architecture_rejects_wrong_scale_or_non_detection_model(monkeypatch, tmp_path):
    from replay_perception import roles
    for candidate in (object(), SimpleNamespace(yaml={"nc": 4, "scale": "n", "yaml_file": "yolo11n.yaml"})):
        with pytest.raises(ValueError, match="ROLE_ARCHITECTURE_MISMATCH"):
            roles._validate_architecture(candidate, SimpleNamespace(model_type=LocalModel))
