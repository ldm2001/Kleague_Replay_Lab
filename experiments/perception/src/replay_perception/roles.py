from __future__ import annotations

from copy import deepcopy
import hashlib
from io import BytesIO
import os
from pathlib import Path
import sys
import tempfile
from threading import RLock
from types import SimpleNamespace
from typing import Any
from zipfile import ZipFile

import numpy as np

from .observations import ROLE_LABELS, RoleDetection
from .observer_assets import verify_observer_assets


_CHECKPOINT_NAME = "yolo-football-player-detection.pt"
_CHECKPOINT_MAX_BYTES = 40583084
_SAFE_LOAD_LOCK = RLock()
# Torch 2.6 registers these objects when the approved pose runtime imports
# distributed tensors and torchvision/Dynamo. This is a coexistence inventory,
# NOT a checkpoint allowlist. Do not import modules to populate it.
_RUNTIME_AMBIENT_OBJECTS = (
    ("torch.distributed.device_mesh", "DeviceMesh"),
    ("torch.distributed.tensor._dtensor_spec", "DTensorSpec"),
    ("torch.distributed.tensor._dtensor_spec", "TensorMeta"),
    ("torch.distributed.tensor", "DTensor"),
    ("torch.distributed.tensor.placement_types", "Partial"),
    ("torch.distributed.tensor.placement_types", "Replicate"),
    ("torch.distributed.tensor.placement_types", "Shard"),
    ("torch._dynamo.decorators", "_DimRange"),
)
_INPUT_SIZE = 640
_CONFIDENCE = 0.50
_NMS_IOU = 0.70
_MAX_DETECTIONS = 300
_MAX_ANCHORS = 8400  # 80x80 + 40x40 + 20x20, fixed YOLO11 input.
_LAYER_TYPES = (
    "Conv", "Conv", "C3k2", "Conv", "C3k2", "Conv", "C3k2", "Conv",
    "C3k2", "SPPF", "C2PSA", "Upsample", "Concat", "C3k2", "Upsample",
    "Concat", "C3k2", "Conv", "Concat", "C3k2", "Conv", "Concat", "C3k2", "Detect",
)


def _load_runtime() -> SimpleNamespace:
    # Runtime initialization also temporarily changes a process-global setting.
    with _SAFE_LOAD_LOCK:
        return _load_runtime_locked()


def _load_runtime_locked() -> SimpleNamespace:
    # Raw forward never uses Ultralytics' path loader, predictor, callbacks,
    # settings synchronization, dependency installer or pretrained warmup.
    os.environ["YOLO_OFFLINE"] = "1"
    os.environ["YOLO_AUTOINSTALL"] = "0"
    os.environ["ULTRALYTICS_SAFE_LOAD"] = "1"
    import cv2
    import torch

    previous_config = os.environ.get("YOLO_CONFIG_DIR")
    with tempfile.TemporaryDirectory(prefix="replay-role-settings-") as config_dir:
        os.environ["YOLO_CONFIG_DIR"] = config_dir
        try:
            import ultralytics
            from ultralytics import utils
            from ultralytics.nn.tasks import DetectionModel
            from ultralytics.nn.modules.block import Attention, Bottleneck, C2PSA, C3k, C3k2, DFL, PSABlock, SPPF
            from ultralytics.nn.modules.conv import Concat, Conv, DWConv
            from ultralytics.nn.modules.head import Detect
            utils.ONLINE = False
            utils.AUTOINSTALL = False
            # In-memory only: never modify the user's persistent settings.
            dict.__setitem__(utils.SETTINGS, "sync", False)
        finally:
            if previous_config is None:
                os.environ.pop("YOLO_CONFIG_DIR", None)
            else:
                os.environ["YOLO_CONFIG_DIR"] = previous_config
    trusted = (
        DetectionModel, Attention, Bottleneck, C2PSA, C3k, C3k2, DFL, PSABlock,
        SPPF, Concat, Conv, DWConv, Detect, torch.nn.Sequential,
        torch.nn.ModuleList, torch.nn.Conv2d, torch.nn.BatchNorm2d, torch.nn.SiLU,
        torch.nn.Identity, torch.nn.MaxPool2d, torch.nn.Upsample,
    )
    return SimpleNamespace(torch=torch, cv2=cv2, version=ultralytics.__version__,
                           model_type=DetectionModel, trusted_classes=trusted)


def _global_name(value: Any) -> str:
    return f"{value.__module__}.{value.__qualname__}"


def _known_runtime_ambient_objects() -> tuple[Any, ...]:
    objects = []
    for module_name, attribute in _RUNTIME_AMBIENT_OBJECTS:
        module = sys.modules.get(module_name)
        value = None if module is None else vars(module).get(attribute)
        if value is not None:
            objects.append(value)
    return tuple(objects)


def _checkpoint_non_intrinsic_globals(payload: bytes, torch: Any) -> set[str]:
    # The public audit subtracts process-global registrations. Independently
    # inspect every GLOBAL with the pinned Torch 2.6 static opcode scanner,
    # subtracting ONLY Torch's built-in weights-only intrinsics, never ambient
    # classes. Unsupported formats/opcodes fail closed; no pickle is executed.
    with ZipFile(BytesIO(payload)) as archive:
        records = [info for info in archive.infolist()
                   if info.filename == "data.pkl" or info.filename.endswith("/data.pkl")]
        if len(records) != 1 or records[0].file_size > _CHECKPOINT_MAX_BYTES:
            raise ValueError("ROLE_CHECKPOINT_PICKLE_INVALID")
        with archive.open(records[0]) as source:
            data = source.read(_CHECKPOINT_MAX_BYTES + 1)
        if len(data) > _CHECKPOINT_MAX_BYTES:
            raise ValueError("ROLE_CHECKPOINT_PICKLE_INVALID")
    scanner = torch._weights_only_unpickler
    return scanner.get_globals_in_pkl(BytesIO(data)) - set(scanner._get_allowed_globals())


def _load_checkpoint(path: Path, runtime: SimpleNamespace, *, expected_sha256: str | None = None) -> tuple[dict, list[str]]:
    # PyTorch safe_globals is process-global; overlapping role loads must not
    # remove each other's audited allowlist while deserialization is running.
    with _SAFE_LOAD_LOCK:
        return _load_checkpoint_locked(path, runtime, expected_sha256=expected_sha256)


def _load_checkpoint_locked(path: Path, runtime: SimpleNamespace, *, expected_sha256: str | None) -> tuple[dict, list[str]]:
    torch = runtime.torch
    trusted = {_global_name(value): value for value in runtime.trusted_classes}
    # Accept exact known framework object identities for runtime coexistence,
    # but never inherit their checkpoint authority. The exhaustive audit below
    # continues to reject these classes if the role payload references them.
    from torch.nested._internal.nested_tensor import NestedTensor, _rebuild_njt
    approved_objects = (*runtime.trusted_classes, NestedTensor, _rebuild_njt, *_known_runtime_ambient_objects())
    ambient_objects = tuple(torch.serialization.get_safe_globals())
    for value in ambient_objects:
        if not any(value is approved for approved in approved_objects):
            raise ValueError("ROLE_CHECKPOINT_AMBIENT_ALLOWLIST")
    try:
        with path.open("rb") as source:
            payload = source.read(_CHECKPOINT_MAX_BYTES + 1)
        if len(payload) > _CHECKPOINT_MAX_BYTES:
            raise ValueError("ROLE_CHECKPOINT_SIZE_INVALID")
        if expected_sha256 is not None and hashlib.sha256(payload).hexdigest() != expected_sha256:
            raise ValueError("MODEL_HASH_MISMATCH")
        # Audit and deserialize the exact immutable bytes whose digest was
        # checked, even if another process replaces or edits the cache file.
        with BytesIO(payload) as stream:
            non_intrinsic = _checkpoint_non_intrinsic_globals(payload, torch)
            unsafe = sorted(set(torch.serialization.get_unsafe_globals_in_checkpoint(stream))
                            | non_intrinsic)
            unknown = set(unsafe) - trusted.keys()
            if unknown:
                raise ValueError(f"ROLE_CHECKPOINT_UNSUPPORTED_GLOBAL: {', '.join(sorted(unknown))}")
            stream.seek(0)
            # Only the audited classes actually present are added. No dynamic
            # imports, arbitrary builtins, or unsafe fallback are permitted.
            missing = [trusted[name] for name in unsafe
                       if not any(trusted[name] is existing for existing in ambient_objects)]
            with torch.serialization.safe_globals(missing):
                checkpoint = torch.load(stream, map_location="cpu", weights_only=True)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"ROLE_CHECKPOINT_LOAD_FAILED: {type(exc).__name__}: {exc}") from exc
    if not isinstance(checkpoint, dict):
        raise ValueError("ROLE_CHECKPOINT_MODEL_INVALID")
    return checkpoint, unsafe


def _validate_architecture(model: Any, runtime: SimpleNamespace) -> dict[str, Any]:
    if type(model) is not runtime.model_type:
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    config = getattr(model, "yaml", None)
    layers = list(model.model)
    if (not isinstance(config, dict) or config.get("nc") != 4 or config.get("scale") != "m"
            or config.get("scales", {}).get("m") != [0.50, 1.00, 512]
            or tuple(type(layer).__name__ for layer in layers) != _LAYER_TYPES):
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    head = layers[-1]
    if (head.nc != 4 or head.f != [16, 19, 22] or head.stride.tolist() != [8, 16, 32]
            or bool(getattr(head, "end2end", False)) or bool(getattr(head, "xyxy", False))
            or bool(getattr(head, "export", False))
            or layers[0].conv.out_channels != 64 or layers[1].conv.out_channels != 128):
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    parameter_count = sum(p.numel() for p in model.parameters())
    if parameter_count != 20056092:
        raise ValueError("ROLE_ARCHITECTURE_MISMATCH")
    return {"name": "YOLO11m", "model_class": _global_name(type(model)), "scale": "m",
            "scale_parameters": [0.50, 1.00, 512], "layer_types": list(_LAYER_TYPES),
            "strides": [8, 16, 32], "parameter_count": parameter_count}


class YoloRoleDetector:
    """Local-only approved football-role observations, never adjudications."""

    def __init__(self, model_dir: Path | str, device: str = "cpu") -> None:
        if type(device) is not str or device not in ("cpu", "mps"):
            raise ValueError("ROLE_DEVICE_INVALID")
        requested_directory = Path(model_dir).expanduser().absolute()
        metadata = verify_observer_assets("role", requested_directory)
        directory = requested_directory.resolve()
        runtime = _load_runtime()
        if device == "mps" and not runtime.torch.backends.mps.is_available():
            raise ValueError("ROLE_MPS_UNAVAILABLE")
        if device == "mps" and os.environ.get("PYTORCH_ENABLE_MPS_FALLBACK") == "1":
            raise ValueError("ROLE_MPS_FALLBACK_ENABLED")
        checkpoint, audited_globals = _load_checkpoint(
            directory / _CHECKPOINT_NAME, runtime, expected_sha256=metadata["files"][_CHECKPOINT_NAME],
        )
        model = checkpoint.get("ema")
        if model is None:
            model = checkpoint.get("model")
        if type(model) is not runtime.model_type:
            raise ValueError("ROLE_CHECKPOINT_MODEL_INVALID")
        names = getattr(model, "names", None)
        if (type(names) is not dict or any(type(key) is not int for key in names)
                or names != dict(enumerate(ROLE_LABELS))):
            raise ValueError("ROLE_LABEL_MAPPING_MISMATCH")
        architecture = _validate_architecture(model, runtime)
        self._model = model.to(device=device, dtype=runtime.torch.float32).eval()
        self._model.requires_grad_(False)
        self._runtime = runtime
        self._device = device
        self._last_transform: dict[str, Any] | None = None
        self.provenance = {
            **metadata, "device": device, "precision": "float32", "threshold": _CONFIDENCE,
            "actual_labels": names.copy(), "actual_architecture": architecture,
            "library_versions": {"torch": runtime.torch.__version__, "ultralytics": runtime.version},
            "safe_loader": {"method": "torch.load", "weights_only": True,
                            "audit": "torch.serialization.get_unsafe_globals_in_checkpoint",
                            "independent_audit": "Torch 2.6 static all-GLOBAL scan minus native weights-only intrinsics",
                            "class_allowlist": audited_globals, "map_location": "cpu",
                            "payload_integrity": "bounded immutable bytes hashed before audit/load"},
            "inference": {"entrypoint": "DetectionModel.forward", "mode": "eval/inference_mode",
                          "local_only": True, "downloads": False, "device_fallback": False,
                          "autocast_enabled": False},
            "preprocessing": {"input_size": [640, 640], "method": "letterbox", "interpolation": "INTER_LINEAR",
                              "padding_value": 114, "color_conversion": "RGB -> BGR (resize/pad) -> RGB BCHW",
                              "normalization": "float32 / 255", "scale_up": True, "auto_stride_padding": False,
                              "mapping": "exact rounded resize factors and integer padding recorded per frame in last_transform"},
            "nms": {"method": "stable class-aware NumPy greedy NMS", "device": "cpu",
                    "iou_threshold": _NMS_IOU, "max_detections": _MAX_DETECTIONS,
                    "max_anchors": _MAX_ANCHORS, "multi_label": False, "confidence_comparison": ">= 0.50"},
        }

    @property
    def last_transform(self) -> dict[str, Any] | None:
        return deepcopy(self._last_transform)

    def predict(self, rgb: np.ndarray) -> tuple[RoleDetection, ...]:
        self._last_transform = None
        if (not isinstance(rgb, np.ndarray) or rgb.dtype != np.uint8 or rgb.ndim != 3
                or rgb.shape[2] != 3 or min(rgb.shape[:2]) <= 0):
            raise ValueError("ROLE_RGB_INVALID")
        height, width = rgb.shape[:2]
        cv2, torch = self._runtime.cv2, self._runtime.torch
        ratio = min(_INPUT_SIZE / width, _INPUT_SIZE / height)
        resized_width, resized_height = max(1, round(width * ratio)), max(1, round(height * ratio))
        left, top = (_INPUT_SIZE - resized_width) // 2, (_INPUT_SIZE - resized_height) // 2
        right, bottom = _INPUT_SIZE - resized_width - left, _INPUT_SIZE - resized_height - top
        scale_x, scale_y = resized_width / width, resized_height / height
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        resized = cv2.resize(bgr, (resized_width, resized_height), interpolation=cv2.INTER_LINEAR)
        padded = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
        chw = np.ascontiguousarray(padded[:, :, ::-1].transpose(2, 0, 1))
        tensor = torch.from_numpy(chw).unsqueeze(0).to(device=self._device, dtype=torch.float32) / 255.0
        with torch.inference_mode(), torch.autocast(device_type=self._device, enabled=False):
            output = self._model(tensor)
        if not isinstance(output, tuple) or len(output) != 2:
            raise ValueError("ROLE_OUTPUT_INVALID")
        raw = output[0]
        if (not isinstance(raw, torch.Tensor) or raw.ndim != 3 or tuple(raw.shape[:2]) != (1, 8)
                or raw.shape[2] > _MAX_ANCHORS or raw.dtype != torch.float32):
            raise ValueError("ROLE_OUTPUT_INVALID")
        rows = raw.detach().float().cpu().numpy()[0].T.astype(np.float64)
        if (not np.isfinite(rows).all() or np.any(rows[:, 2:4] <= 0)
                or np.any(rows[:, 4:] < 0) or np.any(rows[:, 4:] > 1)):
            raise ValueError("ROLE_OUTPUT_INVALID")
        scores = rows[:, 4:].max(axis=1)
        labels = rows[:, 4:].argmax(axis=1)
        selected = scores >= _CONFIDENCE
        rows, scores, labels = rows[selected], scores[selected], labels[selected]
        boxes = np.concatenate((rows[:, :2] - rows[:, 2:4] / 2, rows[:, :2] + rows[:, 2:4] / 2), axis=1)
        overlap = (np.minimum(boxes[:, 2:], [left + resized_width, top + resized_height])
                   - np.maximum(boxes[:, :2], [left, top]))
        supported = np.all(overlap > 0, axis=1)
        # Synthetic padding cannot suppress source-supported observations or
        # consume their bounded detection slots. Retain unclipped NMS geometry.
        boxes, scores, labels = boxes[supported], scores[supported], labels[supported]
        kept = _nms(boxes, scores, labels)
        results = []
        for index in kept:
            box = boxes[index].copy()
            box[[0, 2]] = np.clip((box[[0, 2]] - left) / scale_x, 0, width)
            box[[1, 3]] = np.clip((box[[1, 3]] - top) / scale_y, 0, height)
            # Predictions wholly in synthetic padding have no source support.
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            results.append(RoleDetection(len(results), ROLE_LABELS[int(labels[index])],
                                         tuple(float(value) for value in box), float(scores[index])))
        self._last_transform = {
            "sourceWidth": width, "sourceHeight": height, "inputWidth": 640, "inputHeight": 640,
            "resizedWidth": resized_width, "resizedHeight": resized_height,
            "scaleX": scale_x, "scaleY": scale_y, "paddingLTRB": [left, top, right, bottom],
            "sourceToInput": [[scale_x, 0, left], [0, scale_y, top]],
            "inputToSource": [[1 / scale_x, 0, -left / scale_x], [0, 1 / scale_y, -top / scale_y]],
        }
        return tuple(results)


def _nms(boxes: np.ndarray, scores: np.ndarray, labels: np.ndarray) -> list[int]:
    order = np.argsort(-scores, kind="stable")
    kept = []
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    while len(order) and len(kept) < _MAX_DETECTIONS:
        index = int(order[0])
        kept.append(index)
        remaining = order[1:]
        lower = np.maximum(boxes[index, :2], boxes[remaining, :2])
        upper = np.minimum(boxes[index, 2:], boxes[remaining, 2:])
        intersection = np.maximum(upper - lower, 0).prod(axis=1)
        iou = intersection / (areas[index] + areas[remaining] - intersection)
        order = remaining[(labels[remaining] != labels[index]) | (iou <= _NMS_IOU)]
    return kept
