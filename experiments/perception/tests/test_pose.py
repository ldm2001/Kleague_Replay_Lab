from importlib.util import find_spec
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from replay_perception.models import Detection
from replay_perception.observations import KEYPOINT_NAMES


def test_pose_adapter_is_available():
    assert find_spec("replay_perception.pose") is not None, "Missing local pose adapter"


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    import torch
    import transformers
    from replay_perception import pose

    processor = pose._load_runtime()[2]()
    loads = []
    metadata = {"model_key": "pose", "model_id": "usyd-community/vitpose-plus-small",
                "revision": "0c30b6534bb621af0162b481176742577264e36e",
                "architecture": "VitPoseForPoseEstimation", "files": {"model.safetensors": "verified"}}

    class Model:
        config = SimpleNamespace(
            architectures=["VitPoseForPoseEstimation"], model_type="vitpose",
            id2label=dict(enumerate(KEYPOINT_NAMES)), num_labels=17, use_simple_decoder=False,
            backbone_config=SimpleNamespace(model_type="vitpose_backbone", image_size=[256, 192],
                                            num_experts=6),
        )

        def __init__(self):
            self.calls = []
            self.training = True

        def to(self, *args, **kwargs):
            self.to_args = (args, kwargs)
            return self

        def eval(self):
            self.training = False
            return self

        def __call__(self, pixel_values, dataset_index):
            assert torch.is_inference_mode_enabled()
            self.calls.append((pixel_values.detach().clone(), dataset_index.detach().clone()))
            yy, xx = torch.meshgrid(torch.arange(64), torch.arange(48), indexing="ij")
            offset = sum(len(indices) for _, indices in self.calls[:-1])
            heatmaps = []
            for index in range(offset, offset + len(dataset_index)):
                heatmap = (1 + index / 10) * torch.exp(-((xx - 20 - index) ** 2 + (yy - 28) ** 2) / 8)
                heatmaps.append(heatmap.expand(17, 64, 48))
            return SimpleNamespace(heatmaps=torch.stack(heatmaps))

    model = Model()

    class ModelLoader:
        @staticmethod
        def from_pretrained(directory, **kwargs):
            loads.append(("model", directory, kwargs))
            return model

    class ProcessorLoader:
        @staticmethod
        def from_pretrained(directory, **kwargs):
            loads.append(("processor", directory, kwargs))
            return processor

    verified = []
    monkeypatch.setattr(pose, "verify_observer_assets", lambda key, directory: verified.append((key, directory)) or metadata)
    monkeypatch.setattr(pose, "_load_runtime", lambda: (torch, transformers, ProcessorLoader, ModelLoader))
    return SimpleNamespace(module=pose, torch=torch, processor=processor, model=model, loads=loads,
                           verified=verified, directory=tmp_path, metadata=metadata)


def make_estimator(runtime, **kwargs):
    return runtime.module.VitPoseEstimator(runtime.directory, **kwargs)


def test_verified_local_safetensors_and_explicit_preprocessing(runtime):
    estimator = make_estimator(runtime)
    assert runtime.verified == [("pose", runtime.directory)]
    loads = {kind: (directory, kwargs) for kind, directory, kwargs in runtime.loads}
    assert loads["model"] == (str(runtime.directory), {
        "local_files_only": True, "trust_remote_code": False, "use_safetensors": True, "weights_only": True,
    })
    assert loads["processor"] == (str(runtime.directory / "preprocessor_config.json"), {
        "local_files_only": True, "trust_remote_code": False,
        "size": {"height": 256, "width": 192}, "do_affine_transform": True,
        "normalize_factor": 200.0, "do_rescale": True, "rescale_factor": 1 / 255,
        "do_normalize": True, "image_mean": [0.485, 0.456, 0.406],
        "image_std": [0.229, 0.224, 0.225],
    })
    assert runtime.model.to_args == (("cpu",), {"dtype": runtime.torch.float32})
    assert runtime.model.training is False
    assert estimator.provenance["files"] == runtime.metadata["files"]
    assert estimator.provenance["expert_index"] == 0
    assert estimator.provenance["batch_size"] == 8
    assert estimator.provenance["precision"] == "float32"
    assert estimator.provenance["library_versions"]["scipy"]
    assert estimator.provenance["library_versions"]["pillow"]
    assert estimator.provenance["preprocessing"]["padding_factor"] == 1.25
    assert "VitPoseImageProcessorPil" in estimator.provenance["processor_backend"]


def test_real_processor_loader_never_reads_unverified_sibling_configuration(runtime, monkeypatch):
    from transformers import image_processing_base

    verified_file = runtime.directory / "preprocessor_config.json"
    verified_file.write_text(json.dumps({"do_convert_rgb": False}), encoding="utf-8")
    (runtime.directory / "processor_config.json").write_text(
        json.dumps({"image_processor": {"do_convert_rgb": True}}), encoding="utf-8",
    )
    torch, transformers, _, model_loader = runtime.module._load_runtime()
    monkeypatch.setattr(runtime.module, "_load_runtime",
                        lambda: (torch, transformers, type(runtime.processor), model_loader))
    read_paths = []
    original_read = image_processing_base.safe_load_json_file

    def read_configuration(path):
        read_paths.append(Path(path))
        return original_read(path)

    monkeypatch.setattr(image_processing_base, "safe_load_json_file", read_configuration)
    estimator = make_estimator(runtime)
    assert read_paths == [verified_file]
    assert estimator._processor.do_convert_rgb is False


@pytest.mark.parametrize("device", ["cuda", "auto", "CPU", "mps:0", None])
def test_unsupported_device_rejected_before_loading(runtime, device):
    with pytest.raises(ValueError, match="DEVICE_UNSUPPORTED"):
        make_estimator(runtime, device=device)
    assert runtime.loads == []


def test_unavailable_mps_does_not_fall_back(runtime, monkeypatch):
    monkeypatch.setattr(runtime.torch.backends.mps, "is_available", lambda: False)
    with pytest.raises(RuntimeError, match="DEVICE_UNAVAILABLE"):
        make_estimator(runtime, device="mps")
    assert runtime.loads == []


def test_asset_verification_failure_prevents_load(runtime, monkeypatch):
    def reject(*args):
        raise ValueError("MODEL_HASH_MISMATCH")
    monkeypatch.setattr(runtime.module, "verify_observer_assets", reject)
    with pytest.raises(ValueError, match="MODEL_HASH_MISMATCH"):
        make_estimator(runtime)
    assert runtime.loads == []


def test_model_path_keeps_lexical_repository_guard_before_resolution(runtime, monkeypatch, tmp_path):
    from replay_perception.observer_assets import verify_observer_assets

    repository = tmp_path / "repo"
    repository.mkdir()
    (repository / ".git").mkdir()
    external = tmp_path / "external-cache"
    external.mkdir()
    supplied = repository / "model-link"
    supplied.symlink_to(external, target_is_directory=True)
    monkeypatch.setattr(runtime.module, "verify_observer_assets", verify_observer_assets)
    with pytest.raises(ValueError, match="OBSERVER_MODEL_PATH_IN_REPOSITORY"):
        runtime.module.VitPoseEstimator(supplied)
    assert runtime.loads == []


@pytest.mark.parametrize("mapping", [{0: "Nose"}, dict(enumerate(reversed(KEYPOINT_NAMES))),
                                     {str(i): name for i, name in enumerate(KEYPOINT_NAMES)}])
def test_wrong_keypoint_mapping_rejected(runtime, mapping):
    runtime.model.config.id2label = mapping
    with pytest.raises(ValueError, match="POSE_MODEL_CONFIG_MISMATCH"):
        make_estimator(runtime)


@pytest.mark.parametrize(("field", "value"), [
    ("architectures", ["OtherModel"]), ("model_type", "other"), ("num_labels", 18),
    ("use_simple_decoder", True), ("image_size", None), ("image_size", [192, 256]),
    ("num_experts", 1),
])
def test_unsupported_model_config_rejected(runtime, field, value):
    target = runtime.model.config.backbone_config if field in ("image_size", "num_experts") else runtime.model.config
    setattr(target, field, value)
    with pytest.raises(ValueError, match="POSE_MODEL_CONFIG_MISMATCH"):
        make_estimator(runtime)


@pytest.mark.parametrize("image", [None, [], np.zeros((20, 20)), np.zeros((20, 20, 3)),
                                   np.zeros((20, 20, 4), np.uint8), np.zeros((0, 20, 3), np.uint8),
                                   np.zeros((20, 0, 3), np.uint8)])
def test_bad_rgb_rejected_even_without_detections(runtime, image):
    with pytest.raises(ValueError, match="POSE_INPUT_INVALID"):
        make_estimator(runtime).predict(image, ())
    assert runtime.model.calls == []


def test_empty_people_skips_processor_and_inference(runtime, monkeypatch):
    monkeypatch.setattr(runtime.processor, "preprocess", lambda *args, **kwargs: pytest.fail("empty inference"))
    assert make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8), ()) == ()
    assert runtime.model.calls == []


@pytest.mark.parametrize("people", [[], (object(),), (Detection(0, "sports ball", (0, 0, 4, 4), .8),),
                                     (Detection(0, "person", (0, 0, 100, 20), .8),),
                                     (Detection(0, "person", (0, 0, 10, 10), .8),) * 2])
def test_bad_detection_inputs_are_not_silently_filtered(runtime, people):
    with pytest.raises(ValueError, match="POSE_DETECTIONS_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8), people)
    assert runtime.model.calls == []


def test_real_processor_batching_preserves_detection_order_and_source_geometry(runtime):
    people = tuple(Detection(i * 7, "person", (10 + i, 20, 70 + i, 120), .8) for i in range(17))
    rgb = np.zeros((180, 300, 3), np.uint8)
    result = make_estimator(runtime).predict(rgb, people)
    assert tuple(item.detection_id for item in result) == tuple(item.detection_id for item in people)
    assert [len(indices) for _, indices in runtime.model.calls] == [8, 8, 1]
    for pixels, indices in runtime.model.calls:
        assert pixels.dtype == runtime.torch.float32
        assert tuple(pixels.shape[1:]) == (3, 256, 192)
        assert indices.dtype == runtime.torch.long
        assert indices.tolist() == [0] * len(indices)
    for index, (item, person) in enumerate(zip(result, people, strict=True)):
        assert item.source_box == person.box
        assert tuple(point.name for point in item.keypoints) == KEYPOINT_NAMES
        assert len(item.keypoints) == 17
        matrix = np.asarray(item.source_to_input)
        center = np.array([(person.box[0] + person.box[2]) / 2, 70, 1])
        np.testing.assert_allclose(matrix @ center, [95.5, 127.5], atol=1e-5)
        np.testing.assert_allclose(matrix[:, :2], [[191 / 93.75, 0], [0, 255 / 125]], atol=1e-6)
        projected = matrix @ [item.keypoints[0].x, item.keypoints[0].y, 1]
        np.testing.assert_allclose(projected, [(20 + index) * 191 / 47, 28 * 255 / 63], atol=1e-4)
        assert item.keypoints[0].score == pytest.approx(1 + index / 10)


@pytest.mark.parametrize("box", [(30, 50, 190, 90), (30, 10, 50, 150), (0, 0, 40, 80)])
def test_recorded_matrix_reproduces_actual_processor_pixels(runtime, box):
    from scipy.ndimage import affine_transform

    yy, xx = np.mgrid[:180, :220]
    rgb = np.stack((xx % 256, yy % 256, (xx + yy) % 256), axis=2).astype(np.uint8)
    result = make_estimator(runtime).predict(rgb, (Detection(9, "person", box, .8),))[0]
    matrix = np.vstack((result.source_to_input, [0, 0, 1]))
    inverse = np.linalg.inv(matrix)
    # scipy operates in row/column (y/x), whereas provenance is source x/y.
    linear = inverse[:2, :2][::-1, ::-1]
    offset = inverse[:2, 2][::-1]
    warped = np.stack([affine_transform(rgb[:, :, channel], linear, offset, output_shape=(256, 192),
                                       order=1, mode="constant", cval=0) for channel in range(3)], axis=0)
    expected = (warped.astype(np.float32) / 255 - np.array([.485, .456, .406])[:, None, None])
    expected /= np.array([.229, .224, .225])[:, None, None]
    np.testing.assert_allclose(runtime.model.calls[0][0][0].numpy(), expected, atol=1e-6)


def processed_pose(torch):
    return {"keypoints": torch.tensor([[-12.0, 500.0]] * 17),
            "scores": torch.tensor([1.25, -.2] + [.1] * 15),
            "labels": torch.arange(17), "bbox": torch.tensor([1., 2., 3., 4.])}


def test_raw_scores_and_outside_coordinates_are_preserved(runtime, monkeypatch):
    calls = []
    def postprocess(outputs, **kwargs):
        calls.append(kwargs)
        return [[processed_pose(runtime.torch)]]
    monkeypatch.setattr(runtime.processor, "post_process_pose_estimation", postprocess)
    result = make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                            (Detection(3, "person", (0, 0, 20, 40), .8),))
    assert result[0].keypoints[0].score == 1.25
    assert result[0].keypoints[1].score == pytest.approx(-.2)
    assert (result[0].keypoints[0].x, result[0].keypoints[0].y) == (-12, 500)
    assert calls[0]["threshold"] is None
    assert "target_sizes" not in calls[0]


@pytest.mark.parametrize("score", [0.0, -0.2])
def test_nonpositive_scores_keep_all_real_backend_decoded_joints(runtime, monkeypatch, score):
    heatmaps = runtime.torch.full((1, 17, 64, 48), score - 1)
    heatmaps[:, :, 28, 20] = score
    outputs = SimpleNamespace(heatmaps=heatmaps)
    monkeypatch.setattr(type(runtime.model), "__call__", lambda *args, **kwargs: outputs)
    expected = runtime.processor.post_process_pose_estimation(outputs, boxes=[[[10, 20, 60, 100]]], threshold=None)[0][0]
    result = make_estimator(runtime).predict(np.zeros((180, 300, 3), np.uint8),
                                            (Detection(3, "person", (10, 20, 70, 120), .8),))[0]
    # Upstream uses a sentinel peak before DARK when a maximum is <=0. We retain
    # those decoded coordinates, not a replacement peak or fabricated valid pose.
    assert len(result.keypoints) == 17
    np.testing.assert_allclose([[point.x, point.y] for point in result.keypoints], expected["keypoints"].numpy())
    assert all(point.score == pytest.approx(score) for point in result.keypoints)


@pytest.mark.parametrize("fault", ["images", "people", "joints", "scores", "labels", "float_labels", "nan", "inf"])
def test_corrupt_postprocess_output_fails(runtime, monkeypatch, fault):
    entry = processed_pose(runtime.torch)
    output = [[entry]]
    if fault == "images":
        output = []
    elif fault == "people":
        output = [[entry, entry]]
    elif fault == "joints":
        entry["keypoints"] = entry["keypoints"][:16]
    elif fault == "scores":
        entry["scores"] = entry["scores"].reshape(17, 1)
    elif fault == "labels":
        entry["labels"][0] = 1
    elif fault == "float_labels":
        entry["labels"] = entry["labels"].float()
    elif fault == "nan":
        entry["keypoints"][0, 0] = float("nan")
    else:
        entry["scores"][0] = float("inf")
    monkeypatch.setattr(runtime.processor, "post_process_pose_estimation", lambda *args, **kwargs: output)
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                        (Detection(3, "person", (0, 0, 20, 40), .8),))


@pytest.mark.parametrize("shape", [(2, 17, 64, 48), (1, 16, 64, 48), (1, 17, 32, 24), (17, 64, 48)])
def test_wrong_heatmap_shape_fails_before_postprocessing(runtime, monkeypatch, shape):
    monkeypatch.setattr(type(runtime.model), "__call__", lambda *args, **kwargs:
                        SimpleNamespace(heatmaps=runtime.torch.zeros(shape)))
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                        (Detection(3, "person", (0, 0, 20, 40), .8),))


@pytest.mark.parametrize("value", [float("nan"), float("inf")])
def test_nonfinite_heatmaps_are_not_cleaned_by_postprocessing(runtime, monkeypatch, value):
    heatmaps = runtime.torch.zeros((1, 17, 64, 48))
    heatmaps[0, 0, 0, 0] = value
    monkeypatch.setattr(type(runtime.model), "__call__", lambda *args, **kwargs: SimpleNamespace(heatmaps=heatmaps))
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                        (Detection(3, "person", (0, 0, 20, 40), .8),))


@pytest.mark.parametrize("field", ["keypoints", "scores"])
def test_nonfloating_postprocess_output_is_rejected(runtime, monkeypatch, field):
    entry = processed_pose(runtime.torch)
    entry[field] = entry[field].to(dtype=runtime.torch.int64)
    monkeypatch.setattr(runtime.processor, "post_process_pose_estimation", lambda *args, **kwargs: [[entry]])
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                        (Detection(3, "person", (0, 0, 20, 40), .8),))


def test_nonfloating_heatmap_output_is_rejected(runtime, monkeypatch):
    heatmaps = runtime.torch.ones((1, 17, 64, 48), dtype=runtime.torch.int64)
    monkeypatch.setattr(type(runtime.model), "__call__", lambda *args, **kwargs: SimpleNamespace(heatmaps=heatmaps))
    monkeypatch.setattr(runtime.processor, "post_process_pose_estimation",
                        lambda *args, **kwargs: [[processed_pose(runtime.torch)]])
    with pytest.raises(ValueError, match="POSE_OUTPUT_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                        (Detection(3, "person", (0, 0, 20, 40), .8),))


@pytest.mark.parametrize("matrix", [np.zeros((2, 3)), np.full((2, 3), np.nan), np.zeros((3, 3))])
def test_corrupt_source_transform_rejected_before_inference(runtime, monkeypatch, matrix):
    from transformers.models.vitpose import image_processing_pil_vitpose

    monkeypatch.setattr(image_processing_pil_vitpose, "get_warp_matrix", lambda *args: matrix)
    with pytest.raises(ValueError, match="POSE_TRANSFORM_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                        (Detection(3, "person", (0, 0, 20, 40), .8),))
    assert runtime.model.calls == []


@pytest.mark.parametrize("pixels", [np.zeros((1, 3, 256, 192)), None])
def test_corrupt_preprocessing_rejected(runtime, monkeypatch, pixels):
    from transformers.image_processing_utils import BatchFeature

    monkeypatch.setattr(runtime.processor, "preprocess", lambda *args, **kwargs: BatchFeature({"pixel_values": pixels}))
    with pytest.raises(ValueError, match="POSE_PREPROCESSING_INVALID"):
        make_estimator(runtime).predict(np.zeros((40, 80, 3), np.uint8),
                                        (Detection(3, "person", (0, 0, 20, 40), .8),))


@pytest.mark.parametrize("dimensions", [(1, 1), (2, 5), (3, 3)])
def test_tiny_positive_rgb_dimensions_remain_valid(runtime, dimensions):
    height, width = dimensions
    result = make_estimator(runtime).predict(np.zeros((height, width, 3), np.uint8),
                                            (Detection(3, "person", (0, 0, width, height), .8),))
    assert len(result) == 1
    assert len(result[0].keypoints) == 17
