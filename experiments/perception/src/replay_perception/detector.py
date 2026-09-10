from __future__ import annotations

import math
from copy import deepcopy
from pathlib import Path
from typing import Any

import numpy as np

from .model_assets import verify_model_assets
from .models import Detection


SCORE_THRESHOLD = 0.30
_OUTPUT_LABELS = frozenset({"person", "sports ball"})


def _load_runtime():
    import torch
    import transformers
    from transformers import AutoImageProcessor, RTDetrForObjectDetection

    return torch, transformers, AutoImageProcessor, RTDetrForObjectDetection


class RtdetrDetector:
    def __init__(self, model_dir: Path | str, device: str = "cpu") -> None:
        if device not in {"cpu", "mps"}:
            raise ValueError(f"DEVICE_UNSUPPORTED: {device}")
        model_path = Path(model_dir).expanduser().resolve(strict=False)

        torch, transformers, processor_class, model_class = _load_runtime()
        if device == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("DEVICE_UNAVAILABLE: mps")

        metadata = verify_model_assets(model_path)
        if (
            metadata.get("architecture") != "RTDetrForObjectDetection"
            or metadata.get("disable_custom_kernels") is not True
            or metadata.get("threshold") != SCORE_THRESHOLD
        ):
            raise ValueError("MODEL_CONFIG_MISMATCH")

        directory = str(model_path)
        processor = processor_class.from_pretrained(
            directory,
            local_files_only=True,
            trust_remote_code=False,
        )
        model = model_class.from_pretrained(
            directory,
            local_files_only=True,
            use_safetensors=True,
        )
        if not _safe_model_config(model.config):
            raise ValueError("MODEL_CONFIG_MISMATCH")
        model.to(device, dtype=torch.float32)
        model.eval()

        self._torch = torch
        self._processor = processor
        self._model = model
        self._device = device
        self._id2label = {
            int(identifier): str(label)
            for identifier, label in model.config.id2label.items()
        }
        self.provenance = {
            **deepcopy(metadata),
            "device": device,
            "precision": "float32",
            "library_versions": {
                "torch": torch.__version__,
                "transformers": transformers.__version__,
            },
        }

    def predict(self, rgb: np.ndarray) -> tuple[Detection, ...]:
        if (
            not isinstance(rgb, np.ndarray)
            or rgb.dtype != np.uint8
            or rgb.ndim != 3
            or rgb.shape[2] != 3
            or rgb.shape[0] <= 0
            or rgb.shape[1] <= 0
        ):
            raise ValueError("DETECTOR_INPUT_INVALID")

        height, width = rgb.shape[:2]
        inputs = self._processor(images=rgb, return_tensors="pt").to(self._device)
        with self._torch.inference_mode():
            outputs = self._model(**inputs)
        target_sizes = self._torch.tensor([[height, width]], device=self._device)
        processed = self._processor.post_process_object_detection(
            outputs,
            threshold=SCORE_THRESHOLD,
            target_sizes=target_sizes,
        )
        if not processed:
            return ()

        result = processed[0]
        boxes = _to_list(result["boxes"])
        scores = _to_list(result["scores"])
        labels = _to_list(result["labels"])
        detections: list[Detection] = []
        for raw_box, raw_score, raw_label in zip(boxes, scores, labels, strict=False):
            try:
                score = float(raw_score)
                label = self._id2label.get(int(raw_label))
                box = tuple(float(value) for value in raw_box)
            except (TypeError, ValueError, OverflowError):
                continue
            if (
                label not in _OUTPUT_LABELS
                or not math.isfinite(score)
                or score < SCORE_THRESHOLD
                or score > 1.0
                or len(box) != 4
                or not all(math.isfinite(value) for value in box)
            ):
                continue
            x1, y1, x2, y2 = box
            clipped = (
                min(max(x1, 0.0), float(width)),
                min(max(y1, 0.0), float(height)),
                min(max(x2, 0.0), float(width)),
                min(max(y2, 0.0), float(height)),
            )
            if clipped[2] <= clipped[0] or clipped[3] <= clipped[1]:
                continue
            detections.append(
                Detection(
                    detection_id=len(detections),
                    label=label,
                    box=clipped,
                    score=score,
                )
            )
        return tuple(detections)


def _safe_model_config(config: Any) -> bool:
    architectures = getattr(config, "architectures", None)
    return (
        isinstance(architectures, (list, tuple))
        and "RTDetrForObjectDetection" in architectures
        and getattr(config, "disable_custom_kernels", None) is True
        and isinstance(getattr(config, "id2label", None), dict)
    )


def _to_list(tensor: Any) -> list[Any]:
    return tensor.detach().cpu().tolist()
