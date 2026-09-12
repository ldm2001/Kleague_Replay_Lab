from __future__ import annotations

from copy import deepcopy
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np

from .models import Detection
from .observations import KEYPOINT_NAMES, Keypoint, PoseObservation
from .observer_assets import verify_observer_assets


_INPUT_SIZE = (192, 256)
_BATCH_SIZE = 8
_EXPERT_INDEX = 0
_PREPROCESSING = {
    "size": {"height": 256, "width": 192},
    "do_affine_transform": True,
    "normalize_factor": 200.0,
    "do_rescale": True,
    "rescale_factor": 1 / 255,
    "do_normalize": True,
    "image_mean": [0.485, 0.456, 0.406],
    "image_std": [0.229, 0.224, 0.225],
}


def _load_runtime():
    import torch
    import transformers
    from transformers import VitPoseForPoseEstimation
    from transformers.models.vitpose.image_processing_pil_vitpose import (
        VitPoseImageProcessorPil, get_warp_matrix, scipy_warp_affine,
    )

    class RgbVitPoseImageProcessorPil(VitPoseImageProcessorPil):
        def affine_transform(self, image, center, scale, rotation, size):
            # PilBackend always supplies CHW. Its base affine method guesses this
            # from dimensions and misreads valid RGB images <=3 pixels high.
            matrix = get_warp_matrix(rotation, center * 2.0,
                                     np.array((size.width, size.height)) - 1.0, scale * 200.0)
            transformed = scipy_warp_affine(image.transpose(1, 2, 0), matrix, (size.height, size.width))
            return transformed.transpose(2, 0, 1)

    return torch, transformers, RgbVitPoseImageProcessorPil, VitPoseForPoseEstimation


def _safe_model_config(config: Any) -> bool:
    backbone = getattr(config, "backbone_config", None)
    labels = getattr(config, "id2label", None)
    image_size = getattr(backbone, "image_size", None)
    return (
        getattr(config, "architectures", None) == ["VitPoseForPoseEstimation"]
        and getattr(config, "model_type", None) == "vitpose"
        and isinstance(labels, dict)
        and all(type(index) is int for index in labels)
        and labels == dict(enumerate(KEYPOINT_NAMES))
        and getattr(config, "num_labels", None) == 17
        and getattr(config, "use_simple_decoder", None) is False
        and getattr(backbone, "model_type", None) == "vitpose_backbone"
        and isinstance(image_size, (list, tuple)) and tuple(image_size) == (256, 192)
        and getattr(backbone, "num_experts", None) == 6
    )


def _source_to_input(box: list[float]) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    # Use the selected backend's own center/scale and UDP warp functions, including
    # its float32 rounding. A plain crop resize does not describe these input pixels.
    from transformers.models.vitpose.image_processing_pil_vitpose import (
        box_to_center_and_scale,
        get_warp_matrix,
    )

    center, scale = box_to_center_and_scale(
        box, image_width=192, image_height=256, normalize_factor=200.0, padding_factor=1.25,
    )
    matrix = get_warp_matrix(0, center * 2.0, np.array(_INPUT_SIZE) - 1.0, scale * 200.0)
    if (matrix.shape != (2, 3) or not np.isfinite(matrix).all()
            or np.linalg.det(matrix[:, :2]) == 0):
        raise ValueError("POSE_TRANSFORM_INVALID")
    return tuple(tuple(float(value) for value in row) for row in matrix)


class VitPoseEstimator:
    """Local, pinned COCO pose observations; never role, signal, or foul decisions."""

    def __init__(self, model_dir: Path | str, device: str = "cpu") -> None:
        if device not in ("cpu", "mps"):
            raise ValueError(f"DEVICE_UNSUPPORTED: {device}")
        supplied_path = Path(model_dir).expanduser()
        torch, transformers, processor_class, model_class = _load_runtime()
        if device == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("DEVICE_UNAVAILABLE: mps")
        metadata = verify_observer_assets("pose", supplied_path)
        model_path = supplied_path.resolve(strict=False)
        if metadata.get("architecture") != "VitPoseForPoseEstimation":
            raise ValueError("POSE_MODEL_CONFIG_MISMATCH")

        processor = processor_class.from_pretrained(
            str(model_path / "preprocessor_config.json"),
            local_files_only=True, trust_remote_code=False, **deepcopy(_PREPROCESSING),
        )
        model = model_class.from_pretrained(
            str(model_path), local_files_only=True, trust_remote_code=False, use_safetensors=True, weights_only=True,
        )
        if not _safe_model_config(model.config):
            raise ValueError("POSE_MODEL_CONFIG_MISMATCH")
        model.to(device, dtype=torch.float32)
        model.eval()

        self._torch = torch
        self._processor = processor
        self._model = model
        self._device = device
        self.provenance = {
            **deepcopy(metadata),
            "device": device,
            "precision": "float32",
            "expert_index": _EXPERT_INDEX,
            "expert_dataset": "COCO",
            "batch_size": _BATCH_SIZE,
            "processor_backend": f"{type(processor).__module__}.{type(processor).__name__}",
            "library_versions": {
                "torch": torch.__version__, "transformers": transformers.__version__,
                "numpy": np.__version__,
                "scipy": version("scipy"), "pillow": version("pillow"),
            },
            "preprocessing": {
                **deepcopy(_PREPROCESSING),
                "input_color": "RGB", "input_dtype": "uint8", "input_box_format": "source_xyxy",
                "affine_channel_layout": "explicit_CHW_to_HWC_no_dimension_heuristic",
                "processor_box_format": "source_xywh", "aspect_ratio": 192 / 256,
                "padding_factor": 1.25, "rotation_degrees": 0,
                "affine": "UDP: center*2, destination=(191,255), padded_scale*200",
                "resampling": "scipy.ndimage.affine_transform order=1 constant=0",
            },
            "postprocessing": {
                "method": "post_process_pose_estimation", "kernel_size": 11, "threshold": None,
                "coordinates": "source_image_pixels", "scores": "raw_heatmap_maxima_not_probabilities",
                "keypoint_order": list(KEYPOINT_NAMES), "source_box": "original_detection_xyxy_unmodified",
                "out_of_image_coordinates": "preserved", "clipping": False,
                "temporal_interpolation": False,
            },
        }

    def predict(self, rgb: np.ndarray, detections: tuple[Detection, ...]) -> tuple[PoseObservation, ...]:
        if (not isinstance(rgb, np.ndarray) or rgb.dtype != np.uint8 or rgb.ndim != 3
                or rgb.shape[2] != 3 or rgb.shape[0] <= 0 or rgb.shape[1] <= 0):
            raise ValueError("POSE_INPUT_INVALID")
        height, width = rgb.shape[:2]
        if (not isinstance(detections, tuple)
                or any(not isinstance(person, Detection) or person.label != "person"
                       or person.box[2] > width or person.box[3] > height for person in detections)
                or len({person.detection_id for person in detections}) != len(detections)):
            raise ValueError("POSE_DETECTIONS_INVALID")
        observations = []
        for offset in range(0, len(detections), _BATCH_SIZE):
            people = detections[offset:offset + _BATCH_SIZE]
            boxes = [[x1, y1, x2 - x1, y2 - y1] for x1, y1, x2, y2 in (person.box for person in people)]
            matrices = tuple(_source_to_input(box) for box in boxes)
            inputs = self._processor(images=rgb, boxes=[boxes], input_data_format="channels_last",
                                     return_tensors="pt").to(self._device)
            pixels = inputs.get("pixel_values")
            if (not isinstance(pixels, self._torch.Tensor) or tuple(pixels.shape) != (len(people), 3, 256, 192)
                    or pixels.dtype != self._torch.float32 or not self._torch.isfinite(pixels).all().item()):
                raise ValueError("POSE_PREPROCESSING_INVALID")
            dataset_index = self._torch.full((len(people),), _EXPERT_INDEX,
                                            dtype=self._torch.long, device=self._device)
            with self._torch.inference_mode():
                outputs = self._model(**inputs, dataset_index=dataset_index)
                heatmaps = getattr(outputs, "heatmaps", None)
                if (not isinstance(heatmaps, self._torch.Tensor)
                        or tuple(heatmaps.shape) != (len(people), 17, 64, 48)
                        or heatmaps.dtype != self._torch.float32
                        or not self._torch.isfinite(heatmaps).all().item()):
                    raise ValueError("POSE_OUTPUT_INVALID")
                processed = self._processor.post_process_pose_estimation(
                    outputs, boxes=[boxes], kernel_size=11, threshold=None,
                )
            if (not isinstance(processed, list) or len(processed) != 1
                    or not isinstance(processed[0], list) or len(processed[0]) != len(people)):
                raise ValueError("POSE_OUTPUT_INVALID")
            for person, matrix, result in zip(people, matrices, processed[0], strict=True):
                keypoints = self._keypoints(result)
                observations.append(PoseObservation(person.detection_id, person.box, keypoints, matrix, _INPUT_SIZE))
        return tuple(observations)

    def _keypoints(self, result: Any) -> tuple[Keypoint, ...]:
        try:
            points, scores, labels = (result[key].detach().cpu().numpy() for key in ("keypoints", "scores", "labels"))
            if (points.shape != (17, 2) or scores.shape != (17,) or labels.shape != (17,)
                    or not np.issubdtype(points.dtype, np.floating) or not np.issubdtype(scores.dtype, np.floating)
                    or not np.issubdtype(labels.dtype, np.integer)
                    or not np.array_equal(labels, np.arange(17))
                    or not np.isfinite(points).all() or not np.isfinite(scores).all()):
                raise ValueError("POSE_OUTPUT_INVALID")
            return tuple(Keypoint(index, name, float(points[index, 0]), float(points[index, 1]), float(scores[index]))
                         for index, name in enumerate(KEYPOINT_NAMES))
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ValueError("POSE_OUTPUT_INVALID") from exc
